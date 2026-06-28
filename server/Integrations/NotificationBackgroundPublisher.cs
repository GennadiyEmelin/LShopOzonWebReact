using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Production;
using Microsoft.Extensions.DependencyInjection;

namespace LShopOzonWebReact.Api.Integrations;

public static class NotificationBackgroundPublisher
{
    public static void Publish(
        IServiceScopeFactory scopeFactory,
        string eventId,
        string message,
        IEnumerable<Guid>? onlyUserIds = null,
        Guid? excludeUserId = null,
        string? shopRegion = null)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var telegram = scope.ServiceProvider.GetRequiredService<TelegramNotificationService>();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                await IntegrationNotificationPublisher.PublishAsync(
                    telegram,
                    db,
                    eventId,
                    message,
                    onlyUserIds,
                    excludeUserId,
                    shopRegion);
            }
            catch
            {
                // Уведомления не должны блокировать основной запрос.
            }
        });
    }

    public static void PublishTask(
        IServiceScopeFactory scopeFactory,
        ProductionTask task,
        string eventId,
        string message,
        IEnumerable<Guid>? onlyUserIds = null,
        Guid? excludeUserId = null)
    {
        Publish(
            scopeFactory,
            eventId,
            message,
            onlyUserIds,
            excludeUserId,
            ProductionTaskResponses.ResolveTaskShopRegion(task));
    }
}
