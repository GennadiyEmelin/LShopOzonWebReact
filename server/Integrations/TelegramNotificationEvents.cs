namespace LShopOzonWebReact.Api.Integrations;

public static class TelegramNotificationEvents
{
    public static readonly IReadOnlyList<TelegramNotificationEventDefinition> All =
    [
        new("production.task.new.ozon", "Производство", "Новая задача Ozon"),
        new("production.task.new.novinka", "Производство", "Новая задача «Новинка»"),
        new("production.task.new.urgent", "Производство", "Срочная новая задача"),
        new("production.task.started", "Производство", "Задача взята в работу"),
        new("production.task.completed.ozon", "Производство", "Задача Ozon выполнена"),
        new("production.task.completed.novinka", "Производство", "Задача «Новинка» выполнена"),
        new("production.task.cancelled", "Производство", "Задача отменена"),
        new("production.task.archived", "Производство", "Задача отправлена в архив"),
        new("production.task.restored", "Производство", "Задача восстановлена из архива"),
        new("production.task.updated", "Производство", "Задача изменена"),
        new("production.file.added", "Производство", "Добавлен файл производства"),
        new("production.file.deleted", "Производство", "Удалён файл производства"),
        new("production.rework.created", "Производство", "Создана задача на доработку новинки"),
        new("production.catalog.converted", "Производство", "Новинка переведена в Ozon"),
        new("supply.created", "Поставки", "Создана поставка"),
        new("supply.updated", "Поставки", "Поставка изменена"),
        new("supply.sent", "Поставки", "Поставка отправлена"),
        new("supply.accepted", "Поставки", "Поставка принята"),
        new("supply.archived", "Поставки", "Поставка в архиве"),
        new("supply.restored", "Поставки", "Поставка восстановлена"),
        new("supply.imported", "Поставки", "Импорт позиций в поставку"),
        new("chat.direct.received", "Чаты", "Личное сообщение"),
        new("chat.group.received", "Чаты", "Сообщение в группе"),
        new("chat.group.created", "Чаты", "Создана группа"),
        new("chat.group.member.added", "Чаты", "Добавлен участник группы"),
        new("chat.group.member.removed", "Чаты", "Удалён участник группы"),
        new("chat.attachment.received", "Чаты", "Вложение в чате"),
        new("chat.system.notification", "Чаты", "Системное уведомление (отмена задачи и т.п.)"),
        new("ozon.integration.error", "Ozon", "Ошибка подключения Ozon API"),
        new("ozon.integration.updated", "Ozon", "Настройки Ozon API обновлены"),
        new("ozon.price.updated", "Ozon", "Обновлена цена товара"),
        new("ozon.products.loaded", "Ozon", "Загружен каталог товаров"),
        new("user.created", "Пользователи", "Создан пользователь"),
        new("user.password.changed", "Пользователи", "Сменён пароль пользователя"),
        new("user.settings.changed", "Пользователи", "Изменены настройки пользователя"),
        new("audit.critical", "Система", "Критичное действие в журнале"),
        new("backup.completed", "Система", "Резервная копия создана"),
        new("backup.failed", "Система", "Ошибка резервного копирования"),
        new("analytics.updated", "Аналитика", "Аналитика обновлена"),
        new("analytics.unsold.found", "Аналитика", "Найдены товары без продаж"),
    ];

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

public record TelegramNotificationEventDefinition(string Id, string Group, string Label);
