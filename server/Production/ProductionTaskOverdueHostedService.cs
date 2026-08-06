using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Hubs;
using LShopOzonWebReact.Api.Integrations;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Security;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Production;

public sealed class ProductionTaskOverdueHostedService(
    IServiceScopeFactory scopeFactory,
    ILogger<ProductionTaskOverdueHostedService> logger) : BackgroundService
{
    private static readonly TimeSpan CheckInterval = TimeSpan.FromMinutes(1);
    private const string EventId = "production.task.overdue";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(CheckInterval);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await NotifyOverdueTasksAsync(stoppingToken);
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Failed to publish overdue production task notifications.");
            }

            try
            {
                await timer.WaitForNextTickAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task NotifyOverdueTasksAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var telegram = scope.ServiceProvider.GetRequiredService<TelegramNotificationService>();
        var hub = scope.ServiceProvider.GetRequiredService<IHubContext<AppHub>>();
        var now = DateTimeOffset.UtcNow;

        var tasks = await db.ProductionTasks
            .Include(task => task.Items)
            .Where(task =>
                !task.IsArchived &&
                task.DueAt.HasValue &&
                task.DueAt <= now &&
                task.OverdueNotifiedAt == null &&
                (task.Status == ProductionTaskStatuses.New || task.Status == ProductionTaskStatuses.InProgress))
            .OrderBy(task => task.DueAt)
            .Take(50)
            .ToListAsync(cancellationToken);

        if (tasks.Count == 0)
        {
            return;
        }

        var recipientCandidates = await db.Users
            .AsNoTracking()
            .Where(user =>
                user.IsActive &&
                !string.IsNullOrWhiteSpace(user.TelegramChatId))
            .Select(user => new { user.Id, user.Role, user.AllowedFeatures })
            .ToListAsync(cancellationToken);
        var recipientIds = recipientCandidates
            .Where(user =>
                user.Role == UserRoles.Admin ||
                FeatureAccess.Parse(user.AllowedFeatures).Contains(FeatureAccess.ProductionTaskDeadline))
            .Select(user => user.Id)
            .ToList();

        if (recipientIds.Count == 0)
        {
            return;
        }

        foreach (var task in tasks)
        {
            task.OverdueNotifiedAt = now;
        }

        await db.SaveChangesAsync(cancellationToken);

        foreach (var task in tasks)
        {
            await IntegrationNotificationPublisher.PublishTaskAsync(
                telegram,
                db,
                task,
                EventId,
                ProductionTaskResponses.BuildOverdueTaskTelegramMessage(task),
                recipientIds);
        }

        await hub.Clients.All.SendAsync("ProductionTasksChanged", cancellationToken);
    }
}
