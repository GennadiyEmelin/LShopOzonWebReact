namespace LShopOzonWebReact.Api.Integrations;

public static class TelegramReportSections
{
    public const string AccountingSales = "accounting.sales";
    public const string AccountingMaterials = "accounting.materials";

    public static readonly IReadOnlyList<TelegramReportSectionDefinition> All =
    [
        new("orders.count", "Заказы", "Количество заказов за день"),
        new("orders.revenue", "Заказы", "Выручка за день"),
        new("orders.awaitingDeliver", "Заказы", "Заказы в сборке"),
        new("orders.cancelled", "Заказы", "Отменённые заказы"),
        new("production.newTasks", "Производство", "Новые задачи за день"),
        new("production.completedTasks", "Производство", "Выполненные задачи за день"),
        new("production.cancelledTasks", "Производство", "Отменённые задачи за день"),
        new("production.inProgressTasks", "Производство", "Задачи в работе сейчас"),
        new("production.urgentTasks", "Производство", "Срочные активные задачи"),
        new("production.archivedTasks", "Производство", "Архивированные задачи за день"),
        new("production.completedByAssignee", "Производство", "Выполнено по исполнителям"),
        new("supplies.created", "Поставки", "Созданные поставки за день"),
        new("supplies.sent", "Поставки", "Отправленные поставки за день"),
        new("supplies.accepted", "Поставки", "Принятые поставки за день"),
        new("analytics.balance", "Аналитика", "Баланс Ozon"),
        new("analytics.commission", "Аналитика", "Комиссия Ozon за день"),
        new(AccountingSales, "Учет / Отчетность", "Получать отчет продаж"),
        new(AccountingMaterials, "Учет / Отчетность", "Получать отчет материалов"),
    ];

    public static HashSet<string> Parse(string? value) =>
        (value ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(section => All.Any(definition => definition.Id == section))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

    public static string Serialize(IEnumerable<string> sections) =>
        string.Join(',', sections
            .Where(section => All.Any(definition => definition.Id == section))
            .Distinct(StringComparer.OrdinalIgnoreCase));

    public static bool IsEnabled(string? storedSections, string sectionId)
    {
        var enabled = Parse(storedSections);
        return enabled.Contains(sectionId);
    }
}

public record TelegramReportSectionDefinition(string Id, string Group, string Label);
