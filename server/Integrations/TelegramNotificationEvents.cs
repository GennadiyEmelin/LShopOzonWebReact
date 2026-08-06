namespace LShopOzonWebReact.Api.Integrations;

public static class TelegramNotificationEvents
{
    public const string ShopRegionRf = "rf";
    public const string ShopRegionKz = "kz";
    public const string ShopRegionBoth = "both";

    public static readonly IReadOnlyList<TelegramNotificationEventDefinition> All =
    [
        new("production.task.new.ozon", "Производство · РФ", "Новая задача Ozon", ShopRegionRf),
        new("production.task.new.novinka", "Производство · РФ", "Новая задача «Новинка» (Ozon)", ShopRegionRf),
        new("production.task.completed.ozon", "Производство · РФ", "Задача Ozon выполнена", ShopRegionRf),
        new("production.task.completed.novinka", "Производство · РФ", "Задача «Новинка» (Ozon) выполнена", ShopRegionRf),
        new("production.task.new.kaspi", "Производство · КЗ", "Новая задача Kaspi", ShopRegionKz),
        new("production.task.new.satu", "Производство · КЗ", "Новая задача Satu", ShopRegionKz),
        new("production.task.new.halyk", "Производство · КЗ", "Новая задача Halyk", ShopRegionKz),
        new("production.task.new.novinka.kz", "Производство · КЗ", "Новая задача «Новинка» (КЗ)", ShopRegionKz),
        new("production.task.completed.kaspi", "Производство · КЗ", "Задача Kaspi выполнена", ShopRegionKz),
        new("production.task.completed.satu", "Производство · КЗ", "Задача Satu выполнена", ShopRegionKz),
        new("production.task.completed.halyk", "Производство · КЗ", "Задача Halyk выполнена", ShopRegionKz),
        new("production.task.completed.novinka.kz", "Производство · КЗ", "Задача «Новинка» (КЗ) выполнена", ShopRegionKz),
        new("production.task.new.urgent", "Производство", "Срочная новая задача", ShopRegionBoth),
        new("production.task.started", "Производство", "Задача взята в работу", ShopRegionBoth),
        new("production.task.cancelled", "Производство", "Задача отменена", ShopRegionBoth),
        new("production.task.archived", "Производство", "Задача отправлена в архив", ShopRegionBoth),
        new("production.task.restored", "Производство", "Задача восстановлена из архива", ShopRegionBoth),
        new("production.task.updated", "Производство", "Задача изменена", ShopRegionBoth),
        new("production.task.overdue", "Производство", "Задача просрочена", ShopRegionBoth),
        new("production.file.added", "Производство", "Добавлен файл производства", ShopRegionBoth),
        new("production.file.deleted", "Производство", "Удалён файл производства", ShopRegionBoth),
        new("production.rework.created", "Производство", "Создана задача на доработку новинки", ShopRegionBoth),
        new("production.catalog.converted", "Производство · РФ", "Новинка переведена в Ozon", ShopRegionRf),
        new("supply.created", "Поставки · РФ", "Создана поставка", ShopRegionRf),
        new("supply.updated", "Поставки · РФ", "Поставка изменена", ShopRegionRf),
        new("supply.sent", "Поставки · РФ", "Поставка отправлена", ShopRegionRf),
        new("supply.accepted", "Поставки · РФ", "Поставка принята", ShopRegionRf),
        new("supply.archived", "Поставки · РФ", "Поставка в архиве", ShopRegionRf),
        new("supply.restored", "Поставки · РФ", "Поставка восстановлена", ShopRegionRf),
        new("supply.imported", "Поставки · РФ", "Импорт позиций в поставку", ShopRegionRf),
        new("chat.direct.received", "Чаты", "Личное сообщение", ShopRegionBoth),
        new("chat.group.received", "Чаты", "Сообщение в группе", ShopRegionBoth),
        new("chat.group.created", "Чаты", "Создана группа", ShopRegionBoth),
        new("chat.group.member.added", "Чаты", "Добавлен участник группы", ShopRegionBoth),
        new("chat.group.member.removed", "Чаты", "Удалён участник группы", ShopRegionBoth),
        new("chat.attachment.received", "Чаты", "Вложение в чате", ShopRegionBoth),
        new("chat.system.notification", "Чаты", "Системное уведомление (отмена задачи и т.п.)", ShopRegionBoth),
        new("ozon.integration.error", "Ozon · РФ", "Ошибка подключения Ozon API", ShopRegionRf),
        new("ozon.integration.updated", "Ozon · РФ", "Настройки Ozon API обновлены", ShopRegionRf),
        new("ozon.price.updated", "Ozon · РФ", "Обновлена цена товара", ShopRegionRf),
        new("ozon.products.loaded", "Ozon · РФ", "Загружен каталог товаров", ShopRegionRf),
        new("user.created", "Пользователи", "Создан пользователь", ShopRegionBoth),
        new("user.password.changed", "Пользователи", "Сменён пароль пользователя", ShopRegionBoth),
        new("user.settings.changed", "Пользователи", "Изменены настройки пользователя", ShopRegionBoth),
        new("audit.critical", "Система", "Критичное действие в журнале", ShopRegionBoth),
        new("backup.completed", "Система", "Резервная копия создана", ShopRegionBoth),
        new("backup.failed", "Система", "Ошибка резервного копирования", ShopRegionBoth),
        new("analytics.updated", "Аналитика · РФ", "Аналитика обновлена", ShopRegionRf),
        new("analytics.unsold.found", "Аналитика · РФ", "Найдены товары без продаж", ShopRegionRf),
    ];

    public static IReadOnlyList<TelegramNotificationEventDefinition> ForShopRegion(string? shopRegion) =>
        NormalizeShopRegion(shopRegion) switch
        {
            ShopRegionKz => All
                .Where(definition => definition.ShopRegion is ShopRegionKz or ShopRegionBoth)
                .ToList(),
            _ => All
                .Where(definition => definition.ShopRegion is ShopRegionRf or ShopRegionBoth)
                .ToList()
        };

    public static IEnumerable<string> DefaultEventIdsForShopRegion(string? shopRegion) =>
        ForShopRegion(shopRegion)
            .Select(definition => definition.Id)
            .Where(id => !string.Equals(id, "production.task.overdue", StringComparison.OrdinalIgnoreCase));

    public static string NormalizeShopRegion(string? shopRegion) =>
        string.Equals(shopRegion, ShopRegionKz, StringComparison.OrdinalIgnoreCase)
            ? ShopRegionKz
            : ShopRegionRf;

    public static HashSet<string> Parse(string? value) =>
        (value ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(value => All.Any(definition => definition.Id == value))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

    public static string Serialize(IEnumerable<string> events) =>
        string.Join(',', events
            .Where(value => All.Any(definition => definition.Id == value))
            .Distinct(StringComparer.OrdinalIgnoreCase));

    public static bool IsEnabled(string? storedEvents, string eventId)
    {
        var enabled = Parse(storedEvents);
        return enabled.Contains(eventId);
    }
}

public record TelegramNotificationEventDefinition(
    string Id,
    string Group,
    string Label,
    string ShopRegion = TelegramNotificationEvents.ShopRegionBoth);
