using System.Globalization;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Ozon;
using LShopOzonWebReact.Api.Supplies;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Integrations;

public class DailyReportService(AppDbContext db, OzonApiClient ozonApi, ILogger<DailyReportService> logger)
{
    public async Task<string> BuildReportAsync(AppUser user, DateOnly reportDate, CancellationToken cancellationToken = default)
    {
        var enabled = TelegramReportSections.Parse(user.TelegramDailyReportSections);
        if (enabled.Count == 0)
        {
            enabled = TelegramReportSections.All.Select(section => section.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        }

        var timezone = ResolveTimeZone(user.TelegramDailyReportTimezone);
        var dayStart = new DateTimeOffset(reportDate.ToDateTime(TimeOnly.MinValue), timezone.GetUtcOffset(reportDate.ToDateTime(TimeOnly.MinValue)));
        var dayEnd = dayStart.AddDays(1);

        var builder = new System.Text.StringBuilder();
        builder.AppendLine($"📊 Отчёт LShop · {reportDate:dd.MM.yyyy}");
        builder.AppendLine($"Пользователь: {user.DisplayName}");
        builder.AppendLine();

        if (enabled.Contains("production.newTasks") ||
            enabled.Contains("production.completedTasks") ||
            enabled.Contains("production.cancelledTasks") ||
            enabled.Contains("production.inProgressTasks") ||
            enabled.Contains("production.urgentTasks") ||
            enabled.Contains("production.archivedTasks") ||
            enabled.Contains("production.completedByAssignee"))
        {
            var tasks = await db.ProductionTasks.AsNoTracking().ToListAsync(cancellationToken);
            if (enabled.Contains("production.newTasks"))
            {
                var count = tasks.Count(task => task.CreatedAt >= dayStart && task.CreatedAt < dayEnd);
                builder.AppendLine($"Новые задачи: {count}");
            }

            if (enabled.Contains("production.completedTasks"))
            {
                var count = tasks.Count(task =>
                    task.CompletedAt is not null &&
                    task.CompletedAt >= dayStart &&
                    task.CompletedAt < dayEnd);
                builder.AppendLine($"Выполненные задачи: {count}");
            }

            if (enabled.Contains("production.cancelledTasks"))
            {
                var count = tasks.Count(task =>
                    task.CancelledAt is not null &&
                    task.CancelledAt >= dayStart &&
                    task.CancelledAt < dayEnd);
                builder.AppendLine($"Отменённые задачи: {count}");
            }

            if (enabled.Contains("production.inProgressTasks"))
            {
                var count = tasks.Count(task => !task.IsArchived && task.Status == ProductionTaskStatuses.InProgress);
                builder.AppendLine($"В работе сейчас: {count}");
            }

            if (enabled.Contains("production.urgentTasks"))
            {
                var count = tasks.Count(task =>
                    !task.IsArchived &&
                    task.IsUrgent &&
                    task.Status is ProductionTaskStatuses.New or ProductionTaskStatuses.InProgress);
                builder.AppendLine($"Срочные активные: {count}");
            }

            if (enabled.Contains("production.archivedTasks"))
            {
                var count = tasks.Count(task =>
                    task.IsArchived &&
                    task.ArchivedAt is not null &&
                    task.ArchivedAt >= dayStart &&
                    task.ArchivedAt < dayEnd);
                builder.AppendLine($"Архивировано задач: {count}");
            }

            if (enabled.Contains("production.completedByAssignee"))
            {
                var completedByAssignee = tasks
                    .Where(task =>
                        task.CompletedAt is not null &&
                        task.CompletedAt >= dayStart &&
                        task.CompletedAt < dayEnd)
                    .GroupBy(task => string.IsNullOrWhiteSpace(task.AssignedUserName) ? "—" : task.AssignedUserName.Trim())
                    .OrderByDescending(group => group.Count())
                    .ThenBy(group => group.Key)
                    .ToList();

                if (completedByAssignee.Count == 0)
                {
                    builder.AppendLine("Выполнено по исполнителям: нет");
                }
                else
                {
                    builder.AppendLine("Выполнено по исполнителям:");
                    foreach (var group in completedByAssignee)
                    {
                        builder.AppendLine($"  {group.Key}: {group.Count()}");
                    }
                }
            }

            builder.AppendLine();
        }

        if (enabled.Contains("supplies.created") ||
            enabled.Contains("supplies.sent") ||
            enabled.Contains("supplies.accepted"))
        {
            var supplies = await db.Supplies.AsNoTracking().Where(supply => !supply.IsArchived).ToListAsync(cancellationToken);
            if (enabled.Contains("supplies.created"))
            {
                var count = supplies.Count(supply => supply.CreatedAt >= dayStart && supply.CreatedAt < dayEnd);
                builder.AppendLine($"Создано поставок: {count}");
            }

            if (enabled.Contains("supplies.sent"))
            {
                var count = supplies.Count(supply =>
                    supply.SentAt is not null &&
                    supply.SentAt >= dayStart &&
                    supply.SentAt < dayEnd);
                builder.AppendLine($"Отправлено поставок: {count}");
            }

            if (enabled.Contains("supplies.accepted"))
            {
                var count = supplies.Count(supply =>
                    supply.AcceptedAt is not null &&
                    supply.AcceptedAt >= dayStart &&
                    supply.AcceptedAt < dayEnd);
                builder.AppendLine($"Принято поставок: {count}");
            }

            builder.AppendLine();
        }

        var needsOzon = enabled.Any(section =>
            section.StartsWith("orders.", StringComparison.OrdinalIgnoreCase) ||
            section.StartsWith("analytics.", StringComparison.OrdinalIgnoreCase));

        if (needsOzon)
        {
            try
            {
                var supplyArrivalDates = await SupplyAnalyticsHelper.BuildAcceptedSupplyArrivalDatesAsync(db);
                var analytics = await ozonApi.GetAnalyticsAsync(
                    reportDate,
                    reportDate,
                    supplyArrivalDates,
                    timezone,
                    cancellationToken);
                var snapshot = await ozonApi.GetAnalyticsSnapshotAsync(cancellationToken);
                var currency = analytics.AccountBalanceCurrency ?? snapshot.AccountBalanceCurrency ?? "KZT";

                if (enabled.Contains("orders.count"))
                {
                    builder.AppendLine($"Заказов за день: {(int)analytics.SalesTotalCount}");
                }

                if (enabled.Contains("orders.revenue"))
                {
                    builder.AppendLine($"Выручка: {analytics.RevenueTotal:N0} {currency}");
                }

                if (enabled.Contains("orders.awaitingDeliver"))
                {
                    builder.AppendLine($"В сборке: {analytics.AwaitingDeliverCount}");
                }

                if (enabled.Contains("orders.cancelled"))
                {
                    builder.AppendLine($"Отменено за день: {(int)analytics.CancelledCount}");
                }

                if (enabled.Contains("analytics.balance"))
                {
                    builder.AppendLine($"Баланс Ozon: {snapshot.AccountBalance:N0} {snapshot.AccountBalanceCurrency}");
                }

                if (enabled.Contains("analytics.commission"))
                {
                    builder.AppendLine($"Комиссия Ozon: {analytics.CommissionTotal:N0} {currency}");
                }

                builder.AppendLine();
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Daily report Ozon metrics unavailable for user {UserId}", user.Id);
                builder.AppendLine("Метрики Ozon временно недоступны.");
                builder.AppendLine();
            }
        }

        return builder.ToString().TrimEnd();
    }

    public static TimeZoneInfo ResolveTimeZone(string? timezoneId)
    {
        if (!string.IsNullOrWhiteSpace(timezoneId))
        {
            var normalized = timezoneId.Trim() switch
            {
                "Russian Standard Time" => "Europe/Moscow",
                "Moscow" => "Europe/Moscow",
                "Almaty" => "Asia/Almaty",
                _ => timezoneId.Trim()
            };

            try
            {
                return TimeZoneInfo.FindSystemTimeZoneById(normalized);
            }
            catch (TimeZoneNotFoundException)
            {
            }
            catch (InvalidTimeZoneException)
            {
            }
        }

        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Asia/Almaty");
        }
        catch
        {
            return TimeZoneInfo.Utc;
        }
    }

    public static bool TryParseReportTime(string? value, out TimeOnly time)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            time = new TimeOnly(19, 0);
            return true;
        }

        var trimmed = value.Trim();
        if (TimeOnly.TryParse(trimmed, CultureInfo.InvariantCulture, DateTimeStyles.None, out time))
        {
            return true;
        }

        if (TimeOnly.TryParseExact(
                trimmed,
                ["HH:mm", "H:mm", "HH:mm:ss", "H:mm:ss"],
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out time))
        {
            return true;
        }

        time = new TimeOnly(19, 0);
        return false;
    }

    public static bool IsReportDue(DateTimeOffset localNow, TimeOnly reportTime, DateOnly? lastSentOn)
    {
        var localDate = DateOnly.FromDateTime(localNow.DateTime);
        if (lastSentOn == localDate)
        {
            return false;
        }

        var dueAt = localNow.Date + reportTime.ToTimeSpan();
        return localNow.DateTime >= dueAt;
    }
}
