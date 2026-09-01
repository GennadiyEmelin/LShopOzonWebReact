using System.Globalization;
using System.Text;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Marketplaces;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Ozon;
using LShopOzonWebReact.Api.Production;
using LShopOzonWebReact.Api.Supplies;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Integrations;

public class TelegramBotMenuService(
    AppDbContext db,
    OzonApiClient ozonApi,
    KzMarketplaceApiClient kzApi,
    ILogger<TelegramBotMenuService> logger)
{
    public const string OzonTodayButton = "Ozon сегодня";
    public const string OzonMonthButton = "Ozon месяц";
    public const string BalanceButton = "Баланс Ozon";
    public const string ProductsButton = "Товары Ozon";
    public const string KaspiTodayButton = "Kaspi сегодня";
    public const string KaspiMonthButton = "Kaspi месяц";
    public const string KaspiProductsButton = "Товары Kaspi";
    public const string SatuTodayButton = "Satu сегодня";
    public const string SatuMonthButton = "Satu месяц";
    public const string SatuProductsButton = "Товары Satu";
    public const string DesignTasksButton = "Задачи дизайн";
    public const string ProductionTasksButton = "Задачи производство";

    private static readonly CultureInfo RuCulture = CultureInfo.GetCultureInfo("ru-RU");

    public static TelegramReplyKeyboardMarkup BuildKeyboard() =>
        new(
            [
                [new TelegramKeyboardButton(OzonTodayButton), new TelegramKeyboardButton(OzonMonthButton)],
                [new TelegramKeyboardButton(BalanceButton), new TelegramKeyboardButton(ProductsButton)],
                [new TelegramKeyboardButton(KaspiTodayButton), new TelegramKeyboardButton(KaspiMonthButton), new TelegramKeyboardButton(KaspiProductsButton)],
                [new TelegramKeyboardButton(SatuTodayButton), new TelegramKeyboardButton(SatuMonthButton), new TelegramKeyboardButton(SatuProductsButton)],
                [new TelegramKeyboardButton(DesignTasksButton), new TelegramKeyboardButton(ProductionTasksButton)]
            ]);

    public static bool IsMenuRequest(string text) =>
        text.Equals("/menu", StringComparison.OrdinalIgnoreCase) ||
        text.Equals("меню", StringComparison.OrdinalIgnoreCase);

    public static bool IsKnownButton(string text) =>
        NormalizeButton(text) is not null;

    public static string BuildMenuText(AppUser user)
    {
        var name = string.IsNullOrWhiteSpace(user.DisplayName) ? user.UserName : user.DisplayName;
        return $"Меню LShop для {name}. Нажмите кнопку ниже, и я пришлю актуальные данные.";
    }

    public async Task<string> BuildResponseAsync(AppUser user, string text, CancellationToken cancellationToken = default)
    {
        var button = NormalizeButton(text);
        var request = button is null ? ParseFreeText(text) : TelegramMenuRequest.FromButton(button);
        if (request is null)
        {
            return BuildHelpText(user);
        }

        try
        {
            return request.Kind switch
            {
                TelegramMenuRequestKind.Orders => await BuildOrdersAsync(user, request.Marketplace, request.CurrentMonth, cancellationToken),
                TelegramMenuRequestKind.Balance => await BuildBalanceAsync(request.Marketplace, cancellationToken),
                TelegramMenuRequestKind.Products => await BuildProductsAsync(request.Marketplace, cancellationToken),
                TelegramMenuRequestKind.Tasks => await BuildTasksAsync(request.DesignTasks, cancellationToken),
                _ => BuildHelpText(user)
            };
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Telegram bot menu action failed for user {UserId}: {Action}", user.Id, text);
            return "Не удалось получить данные. Попробуйте ещё раз через минуту.";
        }
    }

    private async Task<string> BuildOrdersAsync(
        AppUser user,
        string marketplace,
        bool currentMonth,
        CancellationToken cancellationToken)
    {
        var timezone = DailyReportService.ResolveTimeZone(user.TelegramDailyReportTimezone);
        var today = GetLocalDate(timezone);
        var from = currentMonth ? new DateOnly(today.Year, today.Month, 1) : today;
        var analytics = await GetMarketplaceAnalyticsAsync(marketplace, from, today, timezone, cancellationToken);
        var currency = string.IsNullOrWhiteSpace(analytics.AccountBalanceCurrency)
            ? "KZT"
            : analytics.AccountBalanceCurrency;
        var marketplaceTitle = GetMarketplaceTitle(marketplace);

        var title = currentMonth
            ? $"Заказы {marketplaceTitle} за месяц ({from:dd.MM.yyyy}-{today:dd.MM.yyyy})"
            : $"Заказы {marketplaceTitle} за сегодня ({today:dd.MM.yyyy})";

        var builder = new StringBuilder();
        builder.AppendLine(title);
        builder.AppendLine($"Заказано товаров: {(int)analytics.OrderedUnitsTotal}");
        builder.AppendLine($"Заказано на сумму: {FormatMoney(analytics.SalesAmountTotal, currency)}");
        builder.AppendLine($"Выкуплено товаров: {(int)analytics.DeliveredProductCount}");
        builder.AppendLine($"Выкуплено на сумму: {FormatMoney(analytics.DeliveredAmount, currency)}");
        builder.AppendLine($"В пути: {(int)analytics.InTransitCount}");
        builder.AppendLine($"В пути на сумму: {FormatMoney(analytics.InTransitAmount, currency)}");
        builder.AppendLine($"Отменено: {(int)analytics.CancelledCount}");
        builder.AppendLine($"Отменено на сумму: {FormatMoney(analytics.CancelledAmount, currency)}");
        builder.AppendLine($"К выплате: {FormatMoney(analytics.PayoutTotal, currency)}");
        return builder.ToString().TrimEnd();
    }

    private async Task<string> BuildBalanceAsync(string marketplace, CancellationToken cancellationToken)
    {
        if (!IsOzon(marketplace))
        {
            return $"Баланс для {GetMarketplaceTitle(marketplace)} сейчас не отдаётся API. Можно запросить заказы и товары.";
        }

        var snapshot = await ozonApi.GetAnalyticsSnapshotAsync(cancellationToken);
        return new StringBuilder()
            .AppendLine("Баланс Ozon")
            .AppendLine($"Баланс: {FormatMoney(snapshot.AccountBalance, snapshot.AccountBalanceCurrency)}")
            .AppendLine($"Обновлено: {snapshot.Timestamp}")
            .ToString()
            .TrimEnd();
    }

    private async Task<string> BuildProductsAsync(string marketplace, CancellationToken cancellationToken)
    {
        var snapshot = IsOzon(marketplace)
            ? await ozonApi.GetAnalyticsSnapshotAsync(cancellationToken)
            : await kzApi.GetAnalyticsSnapshotAsync(marketplace, cancellationToken);
        var marketplaceTitle = GetMarketplaceTitle(marketplace);
        return new StringBuilder()
            .AppendLine($"Товары {marketplaceTitle}")
            .AppendLine($"Всего: {snapshot.TotalProductsCount}")
            .AppendLine($"Продаётся: {snapshot.SellingProductsCount}")
            .AppendLine($"Готово к продаже: {snapshot.ReadyForSaleProductsCount}")
            .AppendLine($"В архиве: {snapshot.ArchivedProductsCount}")
            .AppendLine($"Обновлено: {snapshot.Timestamp}")
            .ToString()
            .TrimEnd();
    }

    private async Task<string> BuildTasksAsync(bool designTasks, CancellationToken cancellationToken)
    {
        var tasks = await db.ProductionTasks
            .AsNoTracking()
            .Include(task => task.Items)
            .Where(task => !task.IsArchived)
            .ToListAsync(cancellationToken);

        var filtered = tasks
            .Where(task => IsDesignTask(task) == designTasks)
            .OrderByDescending(task => task.CreatedAt)
            .ToList();

        var title = designTasks ? "Задачи дизайн" : "Задачи производство";
        var active = filtered.Where(task => task.Status is ProductionTaskStatuses.New or ProductionTaskStatuses.InProgress).ToList();
        var inProgress = filtered.Count(task => task.Status == ProductionTaskStatuses.InProgress);
        var completed = filtered.Count(task => task.Status == ProductionTaskStatuses.Completed);
        var cancelled = filtered.Count(task => task.Status == ProductionTaskStatuses.Cancelled);

        var builder = new StringBuilder();
        builder.AppendLine(title);
        builder.AppendLine($"Всего не в архиве: {filtered.Count}");
        builder.AppendLine($"Новые: {filtered.Count(task => task.Status == ProductionTaskStatuses.New)}");
        builder.AppendLine($"В работе: {inProgress}");
        builder.AppendLine($"Выполненные: {completed}");
        builder.AppendLine($"Отменённые: {cancelled}");

        if (active.Count == 0)
        {
            builder.AppendLine("Активных задач нет.");
            return builder.ToString().TrimEnd();
        }

        builder.AppendLine();
        builder.AppendLine("Активные задачи:");
        foreach (var task in active.Take(12))
        {
            var productCount = task.Items.Count > 0 ? task.Items.Count : 1;
            var quantity = task.Items.Count > 0 ? task.Items.Sum(item => item.RequiredQuantity) : task.RequiredQuantity;
            builder.AppendLine(
                $"- {Truncate(task.ProductName, 55)} · {FormatTaskStatus(task.Status)} · {productCount} поз. · план {quantity} · создана {task.CreatedAt:dd.MM.yyyy HH:mm} · исполнитель {FormatAssignee(task.AssignedUserName)}");
        }

        if (active.Count > 12)
        {
            builder.AppendLine($"Ещё активных: {active.Count - 12}");
        }

        return builder.ToString().TrimEnd();
    }

    private async Task<OzonAnalyticsResult> GetMarketplaceAnalyticsAsync(
        string marketplace,
        DateOnly from,
        DateOnly to,
        TimeZoneInfo timezone,
        CancellationToken cancellationToken)
    {
        if (!IsOzon(marketplace))
        {
            return await kzApi.GetAnalyticsAsync(marketplace, from, to, forceRefresh: false, cancellationToken);
        }

        var supplyArrivalDates = await SupplyAnalyticsHelper.BuildAcceptedSupplyArrivalDatesAsync(db);
        return await ozonApi.GetAnalyticsAsync(from, to, supplyArrivalDates, timezone, cancellationToken);
    }

    private static DateOnly GetLocalDate(TimeZoneInfo timezone) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, timezone).DateTime);

    private static string? NormalizeButton(string text)
    {
        var normalized = text.Trim();
        return normalized switch
        {
            OzonTodayButton => OzonTodayButton,
            OzonMonthButton => OzonMonthButton,
            BalanceButton => BalanceButton,
            ProductsButton => ProductsButton,
            KaspiTodayButton => KaspiTodayButton,
            KaspiMonthButton => KaspiMonthButton,
            KaspiProductsButton => KaspiProductsButton,
            SatuTodayButton => SatuTodayButton,
            SatuMonthButton => SatuMonthButton,
            SatuProductsButton => SatuProductsButton,
            DesignTasksButton => DesignTasksButton,
            ProductionTasksButton => ProductionTasksButton,
            _ => null
        };
    }

    private static TelegramMenuRequest? ParseFreeText(string text)
    {
        var normalized = text.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return null;
        }

        if (normalized.Contains("дизайн", StringComparison.OrdinalIgnoreCase))
        {
            return new TelegramMenuRequest(TelegramMenuRequestKind.Tasks, "ozon", false, DesignTasks: true);
        }

        if (normalized.Contains("производ", StringComparison.OrdinalIgnoreCase) ||
            normalized.Contains("задач", StringComparison.OrdinalIgnoreCase))
        {
            return new TelegramMenuRequest(TelegramMenuRequestKind.Tasks, "ozon", false, DesignTasks: false);
        }

        var marketplace = ResolveMarketplaceFromText(normalized);
        if (normalized.Contains("баланс", StringComparison.OrdinalIgnoreCase))
        {
            return new TelegramMenuRequest(TelegramMenuRequestKind.Balance, marketplace, false, false);
        }

        if (normalized.Contains("товар", StringComparison.OrdinalIgnoreCase) ||
            normalized.Contains("позици", StringComparison.OrdinalIgnoreCase) ||
            normalized.Contains("каталог", StringComparison.OrdinalIgnoreCase))
        {
            return new TelegramMenuRequest(TelegramMenuRequestKind.Products, marketplace, false, false);
        }

        if (normalized.Contains("заказ", StringComparison.OrdinalIgnoreCase) ||
            normalized.Contains("продаж", StringComparison.OrdinalIgnoreCase) ||
            normalized.Contains("сегодня", StringComparison.OrdinalIgnoreCase) ||
            normalized.Contains("месяц", StringComparison.OrdinalIgnoreCase))
        {
            return new TelegramMenuRequest(
                TelegramMenuRequestKind.Orders,
                marketplace,
                normalized.Contains("месяц", StringComparison.OrdinalIgnoreCase),
                false);
        }

        return null;
    }

    private static string ResolveMarketplaceFromText(string text)
    {
        if (text.Contains("kaspi", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("каспи", StringComparison.OrdinalIgnoreCase))
        {
            return MarketplaceTypes.Kaspi;
        }

        if (text.Contains("satu", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("сату", StringComparison.OrdinalIgnoreCase))
        {
            return MarketplaceTypes.Satu;
        }

        return "ozon";
    }

    private static string BuildHelpText(AppUser user) =>
        new StringBuilder()
            .AppendLine(BuildMenuText(user))
            .AppendLine()
            .AppendLine("Можно писать текстом:")
            .AppendLine("- ozon сегодня")
            .AppendLine("- kaspi за месяц")
            .AppendLine("- satu товары")
            .AppendLine("- баланс озон")
            .AppendLine("- задачи дизайн")
            .AppendLine("- задачи производство")
            .ToString()
            .TrimEnd();

    private static bool IsDesignTask(ProductionTask task) =>
        ProductionTaskResponses.NormalizeTaskType(task.TaskType) == ProductionTaskTypes.Novinka;

    private static bool IsOzon(string marketplace) =>
        string.Equals(marketplace, "ozon", StringComparison.OrdinalIgnoreCase);

    private static string GetMarketplaceTitle(string marketplace) =>
        IsOzon(marketplace) ? "Ozon" : MarketplaceTypes.GetDisplayName(marketplace);

    private static string FormatTaskStatus(string status) =>
        status switch
        {
            ProductionTaskStatuses.New => "новая",
            ProductionTaskStatuses.InProgress => "в работе",
            ProductionTaskStatuses.Completed => "выполнена",
            ProductionTaskStatuses.Cancelled => "отменена",
            _ => status
        };

    private static string FormatAssignee(string? assignee) =>
        string.IsNullOrWhiteSpace(assignee) ? "—" : assignee.Trim();

    private static string Truncate(string value, int maxLength)
    {
        var normalized = string.IsNullOrWhiteSpace(value) ? "Без названия" : value.Trim();
        return normalized.Length <= maxLength ? normalized : $"{normalized[..maxLength]}...";
    }

    private static string FormatMoney(decimal? value, string? currency)
    {
        if (value is null)
        {
            return "—";
        }

        return $"{value.Value.ToString("N2", RuCulture)} {NormalizeCurrency(currency)}";
    }

    private static string NormalizeCurrency(string? currency) =>
        string.IsNullOrWhiteSpace(currency) ? "KZT" : currency.Trim();
}

internal enum TelegramMenuRequestKind
{
    Orders,
    Balance,
    Products,
    Tasks
}

internal sealed record TelegramMenuRequest(
    TelegramMenuRequestKind Kind,
    string Marketplace,
    bool CurrentMonth,
    bool DesignTasks)
{
    public static TelegramMenuRequest? FromButton(string button) =>
        button switch
        {
            TelegramBotMenuService.OzonTodayButton => new(TelegramMenuRequestKind.Orders, "ozon", false, false),
            TelegramBotMenuService.OzonMonthButton => new(TelegramMenuRequestKind.Orders, "ozon", true, false),
            TelegramBotMenuService.BalanceButton => new(TelegramMenuRequestKind.Balance, "ozon", false, false),
            TelegramBotMenuService.ProductsButton => new(TelegramMenuRequestKind.Products, "ozon", false, false),
            TelegramBotMenuService.KaspiTodayButton => new(TelegramMenuRequestKind.Orders, MarketplaceTypes.Kaspi, false, false),
            TelegramBotMenuService.KaspiMonthButton => new(TelegramMenuRequestKind.Orders, MarketplaceTypes.Kaspi, true, false),
            TelegramBotMenuService.KaspiProductsButton => new(TelegramMenuRequestKind.Products, MarketplaceTypes.Kaspi, false, false),
            TelegramBotMenuService.SatuTodayButton => new(TelegramMenuRequestKind.Orders, MarketplaceTypes.Satu, false, false),
            TelegramBotMenuService.SatuMonthButton => new(TelegramMenuRequestKind.Orders, MarketplaceTypes.Satu, true, false),
            TelegramBotMenuService.SatuProductsButton => new(TelegramMenuRequestKind.Products, MarketplaceTypes.Satu, false, false),
            TelegramBotMenuService.DesignTasksButton => new(TelegramMenuRequestKind.Tasks, "ozon", false, true),
            TelegramBotMenuService.ProductionTasksButton => new(TelegramMenuRequestKind.Tasks, "ozon", false, false),
            _ => null
        };
}
