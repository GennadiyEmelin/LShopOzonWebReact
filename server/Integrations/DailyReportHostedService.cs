using LShopOzonWebReact.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Integrations;

public class DailyReportHostedService(
    IServiceProvider serviceProvider,
    ILogger<DailyReportHostedService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessDueReportsAsync(stoppingToken);
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Daily report iteration failed.");
            }

            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
        }
    }

    private async Task ProcessDueReportsAsync(CancellationToken cancellationToken)
    {
        using var scope = serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var reportService = scope.ServiceProvider.GetRequiredService<DailyReportService>();
        var telegram = scope.ServiceProvider.GetRequiredService<TelegramNotificationService>();

        if (!telegram.IsBotConfigured)
        {
            return;
        }

        var users = await db.Users
            .Where(user =>
                user.IsActive &&
                user.TelegramDailyReportEnabled &&
                !string.IsNullOrWhiteSpace(user.TelegramChatId))
            .ToListAsync(cancellationToken);

        foreach (var user in users)
        {
            if (!DailyReportService.TryParseReportTime(user.TelegramDailyReportTime, out var reportTime))
            {
                logger.LogWarning("Invalid daily report time for user {UserName}: {ReportTime}", user.UserName, user.TelegramDailyReportTime);
                reportTime = new TimeOnly(19, 0);
            }

            var timezone = DailyReportService.ResolveTimeZone(user.TelegramDailyReportTimezone);
            var localNow = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, timezone);
            if (!DailyReportService.IsReportDue(localNow, reportTime, user.TelegramDailyReportLastSentOn))
            {
                continue;
            }

            var localDate = DateOnly.FromDateTime(localNow.DateTime);
            var message = await reportService.BuildReportAsync(user, localDate, cancellationToken);
            var sent = await telegram.SendMessageAsync(user.TelegramChatId, message, cancellationToken);
            if (!sent)
            {
                continue;
            }

            user.TelegramDailyReportLastSentOn = localDate;
            await db.SaveChangesAsync(cancellationToken);
            logger.LogInformation("Daily report sent to user {UserName} for {Date}", user.UserName, localDate);
        }
    }
}
