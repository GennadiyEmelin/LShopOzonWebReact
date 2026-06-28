using System.Security.Claims;
using System.Text;
using LShopOzonWebReact.Api.Contracts.Production;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Security;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Production;
static class ProductionTaskRoleFilter
{
    public static async Task<IQueryable<ProductionTask>> ApplyAsync(
        IQueryable<ProductionTask> query,
        AppDbContext db,
        ClaimsPrincipal principal)
    {
        var role = await UserRoleResolver.GetRoleAsync(db, principal);

        if (role == UserRoles.Admin)
        {
            return query;
        }

        var allowed = await FeatureAccess.GetAllowedFeaturesAsync(db, principal);
        var seeNovinka = FeatureAccess.CanSeeNovinkaProductionTasks(role, allowed);
        var seeOzon = FeatureAccess.CanSeeOzonProductionTasks(role, allowed);

        if (seeNovinka && seeOzon)
        {
            return query;
        }

        if (seeNovinka)
        {
            return query.Where(task => task.TaskType == ProductionTaskTypes.Novinka);
        }

        if (seeOzon)
        {
            return query.Where(task => task.TaskType != ProductionTaskTypes.Novinka);
        }

        return query.Where(_ => false);
    }
}

static class ProductionAnalyticsQueries
{
    public static (DateTimeOffset From, DateTimeOffset To) ResolveDateRange(string? dateFrom, string? dateTo)
    {
        var utcToday = DateOnly.FromDateTime(DateTime.UtcNow);
        var fromDate = DateOnly.TryParse(dateFrom, out var parsedFrom)
            ? parsedFrom
            : new DateOnly(utcToday.Year, utcToday.Month, 1);
        var toDate = DateOnly.TryParse(dateTo, out var parsedTo) ? parsedTo : utcToday;

        if (toDate < fromDate)
        {
            (fromDate, toDate) = (toDate, fromDate);
        }

        var from = new DateTimeOffset(fromDate.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc));
        var to = new DateTimeOffset(toDate.ToDateTime(new TimeOnly(23, 59, 59), DateTimeKind.Utc));
        return (from, to);
    }
}

static class ProductionTaskResponses
{
    public static string NormalizeTaskType(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return ProductionTaskTypes.Ozon;
        }

        var normalized = value.Trim();
        if (string.Equals(normalized, ProductionTaskTypes.Novinka, StringComparison.OrdinalIgnoreCase))
        {
            return ProductionTaskTypes.Novinka;
        }

        foreach (var taskType in ProductionTaskTypes.MarketplaceTypes)
        {
            if (string.Equals(normalized, taskType, StringComparison.OrdinalIgnoreCase))
            {
                return taskType;
            }
        }

        return ProductionTaskTypes.Ozon;
    }

    public static string BuildNovinkaOfferId(Guid itemId) => $"NV-{itemId:N}";

    public static bool MatchesProductionFile(ProductionFile file, ProductionTaskItem taskItem) =>
        (!string.IsNullOrWhiteSpace(taskItem.OfferId) && file.OfferId == taskItem.OfferId) ||
        (taskItem.OzonProductId > 0 && file.OzonProductId == taskItem.OzonProductId) ||
        MatchesNovinkaProductionFile(file, taskItem.OfferId, taskItem.ProductName, taskItem.ProductLink);

    public static bool MatchesProductionFilePath(ProductionFilePath path, ProductionTaskItem taskItem) =>
        (!string.IsNullOrWhiteSpace(taskItem.OfferId) && path.OfferId == taskItem.OfferId) ||
        (taskItem.OzonProductId > 0 && path.OzonProductId == taskItem.OzonProductId) ||
        MatchesNovinkaProductionFilePath(path, taskItem.OfferId, taskItem.ProductName, taskItem.ProductLink);

    public static bool MatchesNovinkaProductionFilePath(
        ProductionFilePath path,
        string offerId,
        string productName,
        string productLink) =>
        MatchesNovinkaProductionFile(
            new ProductionFile
            {
                OfferId = path.OfferId,
                ProductName = path.ProductName,
                ProductLink = path.ProductLink,
                OzonProductId = path.OzonProductId
            },
            offerId,
            productName,
            productLink);

    public static bool IsNovinkaProductionFile(ProductionFile file) =>
        file.OfferId.StartsWith("NV-", StringComparison.OrdinalIgnoreCase) ||
        (!string.IsNullOrWhiteSpace(file.ProductLink) && file.OzonProductId is null or 0);

    public static bool MatchesNovinkaProductionFile(
        ProductionFile file,
        string offerId,
        string productName,
        string productLink)
    {
        if (!string.IsNullOrWhiteSpace(offerId) &&
            string.Equals(file.OfferId, offerId.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (!string.IsNullOrWhiteSpace(productLink) &&
            string.Equals(file.ProductLink, productLink.Trim(), StringComparison.OrdinalIgnoreCase) &&
            string.Equals(file.ProductName, productName.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return !string.IsNullOrWhiteSpace(productName) &&
               file.OfferId.StartsWith("NV-", StringComparison.OrdinalIgnoreCase) &&
               string.Equals(file.ProductName, productName.Trim(), StringComparison.OrdinalIgnoreCase);
    }

    public static async Task<ProductionTaskListItem?> TryCreateNovinkaReworkTaskAsync(
        AppDbContext db,
        ClaimsPrincipal principal,
        string productName,
        string productLink,
        string offerId)
    {
        var normalizedName = productName.Trim();
        if (string.IsNullOrWhiteSpace(normalizedName))
        {
            return null;
        }

        var normalizedOfferId = offerId.Trim();
        var normalizedLink = await ResolveNovinkaProductLinkAsync(
            db,
            normalizedName,
            productLink,
            normalizedOfferId);

        if (string.IsNullOrWhiteSpace(normalizedLink) && string.IsNullOrWhiteSpace(normalizedOfferId))
        {
            return null;
        }

        var activeTasks = await db.ProductionTasks
            .AsNoTracking()
            .Include(task => task.Items)
            .Where(task =>
                !task.IsArchived &&
                task.TaskType == ProductionTaskTypes.Novinka &&
                (task.Status == ProductionTaskStatuses.New || task.Status == ProductionTaskStatuses.InProgress))
            .ToListAsync();

        var existingActiveTask = activeTasks.FirstOrDefault(task =>
            TaskMatchesNovinkaProduct(task, normalizedName, normalizedLink, normalizedOfferId));

        if (existingActiveTask is not null)
        {
            return ToListItem(existingActiveTask);
        }

        var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        var currentUser = Guid.TryParse(currentUserId, out var parsedUserId)
            ? await db.Users.AsNoTracking().FirstOrDefaultAsync(user => user.Id == parsedUserId)
            : null;
        var builtItems = BuildTaskItems(
            ProductionTaskTypes.Novinka,
            [new CreateProductionTaskItemRequest(0, string.Empty, normalizedName, 0, false, normalizedLink)]);
        var firstItem = builtItems[0];
        var task = new ProductionTask
        {
            TaskType = ProductionTaskTypes.Novinka,
            Status = ProductionTaskStatuses.New,
            OzonProductId = firstItem.OzonProductId,
            OfferId = firstItem.OfferId.Trim(),
            ProductName = normalizedName,
            RequiredQuantity = 0,
            CreatedByUserId = currentUser?.Id,
            CreatedByDisplayName = currentUser?.DisplayName
                ?? principal.FindFirstValue("display_name")
                ?? principal.FindFirstValue(ClaimTypes.Name),
            Items = builtItems
        };

        db.ProductionTasks.Add(task);
        AuditLogWriter.Add(
            db,
            principal,
            "Автосоздание задачи после удаления файлов новинки",
            "ProductionTask",
            task.Id.ToString(),
            task.ProductName);
        await db.SaveChangesAsync();

        return ToListItem(task);
    }

    private static async Task<string> ResolveNovinkaProductLinkAsync(
        AppDbContext db,
        string productName,
        string productLink,
        string offerId)
    {
        if (!string.IsNullOrWhiteSpace(productLink))
        {
            return productLink.Trim();
        }

        if (!string.IsNullOrWhiteSpace(offerId))
        {
            var linkByOffer = await db.ProductionTaskItems
                .AsNoTracking()
                .Where(item =>
                    item.OfferId == offerId &&
                    !string.IsNullOrWhiteSpace(item.ProductLink))
                .OrderByDescending(item => item.Id)
                .Select(item => item.ProductLink)
                .FirstOrDefaultAsync();

            if (!string.IsNullOrWhiteSpace(linkByOffer))
            {
                return linkByOffer.Trim();
            }
        }

        var linkByName = await db.ProductionTaskItems
            .AsNoTracking()
            .Where(item =>
                item.ProductName == productName &&
                !string.IsNullOrWhiteSpace(item.ProductLink))
            .OrderByDescending(item => item.Id)
            .Select(item => item.ProductLink)
            .FirstOrDefaultAsync();

        return linkByName?.Trim() ?? string.Empty;
    }

    private static bool TaskMatchesNovinkaProduct(
        ProductionTask task,
        string productName,
        string productLink,
        string offerId)
    {
        return task.Items.Any(item =>
            (string.Equals(item.ProductName, productName, StringComparison.OrdinalIgnoreCase) &&
             (string.IsNullOrWhiteSpace(productLink) ||
              string.Equals(item.ProductLink, productLink, StringComparison.OrdinalIgnoreCase))) ||
            (!string.IsNullOrWhiteSpace(offerId) &&
             string.Equals(item.OfferId, offerId, StringComparison.OrdinalIgnoreCase)));
    }

    public static ProductionTaskListItem ToListItem(ProductionTask task) =>
        new(
            task.Id,
            task.OzonProductId,
            task.OfferId,
            task.ProductName,
            task.RequiredQuantity,
            task.ActualQuantity,
            task.Status,
            NormalizeTaskType(task.TaskType),
            task.IsUrgent,
            task.AssignedUserName,
            task.CreatedByUserId,
            task.CreatedByDisplayName,
            task.CreatedAt,
            task.StartedAt,
            task.CancelledAt,
            task.CancelledByUserId,
            task.CancelledByDisplayName,
            task.CancellationComment,
            task.CompletedAt,
            task.IsArchived,
            task.ArchivedAt,
            MapItems(task));

    public static string BuildNewTaskTelegramMessage(ProductionTask task)
    {
        var taskType = NormalizeTaskType(task.TaskType);
        var isNovinka = taskType == ProductionTaskTypes.Novinka;
        var items = task.Items.Count > 0
            ? task.Items.OrderBy(item => item.ProductName).ToList()
            :
            [
                new ProductionTaskItem
                {
                    OfferId = task.OfferId,
                    ProductName = task.ProductName,
                    RequiredQuantity = task.RequiredQuantity
                }
            ];

        var builder = new StringBuilder();
        builder.Append("Новая задача");
        if (task.IsUrgent)
        {
            builder.Append(" (срочно)");
        }

        builder.AppendLine();
        builder.AppendLine($"Тип: {GetTaskTypeLabel(task)}");

        if (items.Count == 1)
        {
            var item = items[0];
            builder.AppendLine($"Товар: {ShortenText(item.ProductName)}");
            if (!string.IsNullOrWhiteSpace(item.OfferId))
            {
                builder.AppendLine($"Артикул: {item.OfferId.Trim()}");
            }

            if (!isNovinka && item.RequiredQuantity > 0)
            {
                builder.AppendLine($"Количество: {item.RequiredQuantity} шт.");
            }

            if (isNovinka && !string.IsNullOrWhiteSpace(item.ProductLink))
            {
                builder.AppendLine($"Ссылка: {ShortenText(item.ProductLink, 96)}");
            }
        }
        else
        {
            builder.AppendLine($"Позиций: {items.Count}");
            foreach (var item in items.Take(5))
            {
                var line = new StringBuilder($"• {ShortenText(item.ProductName, 52)}");
                if (!isNovinka && item.RequiredQuantity > 0)
                {
                    line.Append($" — {item.RequiredQuantity} шт.");
                }

                if (!string.IsNullOrWhiteSpace(item.OfferId))
                {
                    line.Append($" · {item.OfferId.Trim()}");
                }

                builder.AppendLine(line.ToString());
            }

            if (items.Count > 5)
            {
                builder.AppendLine($"• … ещё {items.Count - 5}");
            }
        }

        var executor = string.IsNullOrWhiteSpace(task.AssignedUserName)
            ? "не назначен"
            : task.AssignedUserName.Trim();
        builder.AppendLine($"Исполнитель: {executor}");

        var creator = string.IsNullOrWhiteSpace(task.CreatedByDisplayName)
            ? "—"
            : task.CreatedByDisplayName.Trim();
        builder.AppendLine($"Создал: {creator}");

        return builder.ToString().TrimEnd();
    }

    public static string BuildCancelledTaskTelegramMessage(
        ProductionTask task,
        string cancelledByName,
        string comment)
    {
        var items = task.Items.Count > 0
            ? task.Items.OrderBy(item => item.ProductName).ToList()
            :
            [
                new ProductionTaskItem
                {
                    OfferId = task.OfferId,
                    ProductName = task.ProductName,
                    RequiredQuantity = task.RequiredQuantity
                }
            ];

        var builder = new StringBuilder();
        builder.AppendLine("Задача отменена");
        builder.AppendLine($"Товар: {ShortenText(items.Count == 1 ? items[0].ProductName : task.ProductName)}");

        if (items.Count == 1 && !string.IsNullOrWhiteSpace(items[0].OfferId))
        {
            builder.AppendLine($"Артикул: {items[0].OfferId.Trim()}");
        }
        else if (items.Count > 1)
        {
            builder.AppendLine($"Позиций: {items.Count}");
        }

        if (items.Count == 1 && items[0].RequiredQuantity > 0)
        {
            builder.AppendLine($"Количество: {items[0].RequiredQuantity} шт.");
        }

        builder.AppendLine($"Отменил: {cancelledByName.Trim()}");

        var creator = string.IsNullOrWhiteSpace(task.CreatedByDisplayName)
            ? "—"
            : task.CreatedByDisplayName.Trim();
        builder.AppendLine($"Создал: {creator}");
        builder.AppendLine($"Причина: {comment.Trim()}");

        return builder.ToString().TrimEnd();
    }

    public static string BuildStartedTaskTelegramMessage(ProductionTask task, string startedByName)
    {
        var builder = new StringBuilder();
        builder.AppendLine("Задача взята в работу");
        AppendTaskProductLines(builder, task);
        builder.AppendLine($"Исполнитель: {startedByName.Trim()}");
        return builder.ToString().TrimEnd();
    }

    public static string BuildCompletedTaskTelegramMessage(ProductionTask task)
    {
        var isNovinka = NormalizeTaskType(task.TaskType) == ProductionTaskTypes.Novinka;
        var builder = new StringBuilder();
        builder.AppendLine(isNovinka ? "Задача «Новинка» выполнена" : "Задача Ozon выполнена");
        AppendTaskProductLines(builder, task);

        var executor = string.IsNullOrWhiteSpace(task.AssignedUserName) ? "—" : task.AssignedUserName.Trim();
        builder.AppendLine($"Исполнитель: {executor}");

        if (!isNovinka && task.ActualQuantity is int actualQuantity)
        {
            builder.AppendLine($"Факт: {actualQuantity} шт.");
        }

        return builder.ToString().TrimEnd();
    }

    public static string BuildUpdatedTaskTelegramMessage(ProductionTask task) =>
        $"Задача изменена\n{BuildTaskHeadline(task)}";

    public static string BuildArchivedTaskTelegramMessage(ProductionTask task) =>
        $"Задача отправлена в архив\n{BuildTaskHeadline(task)}";

    public static string BuildReworkTaskTelegramMessage(ProductionTask task) =>
        $"Создана задача на доработку новинки\n{BuildTaskHeadline(task)}";

    private static string BuildTaskHeadline(ProductionTask task)
    {
        var items = GetTaskItemsForMessage(task);
        if (items.Count == 1)
        {
            var item = items[0];
            return string.IsNullOrWhiteSpace(item.OfferId)
                ? ShortenText(item.ProductName)
                : $"{ShortenText(item.ProductName)} · {item.OfferId.Trim()}";
        }

        return $"{ShortenText(task.ProductName)} · {items.Count} поз.";
    }

    private static void AppendTaskProductLines(StringBuilder builder, ProductionTask task)
    {
        var isNovinka = NormalizeTaskType(task.TaskType) == ProductionTaskTypes.Novinka;
        var items = GetTaskItemsForMessage(task);

        builder.AppendLine($"Тип: {(isNovinka ? "Новинка" : "Ozon")}");

        if (items.Count == 1)
        {
            var item = items[0];
            builder.AppendLine($"Товар: {ShortenText(item.ProductName)}");
            if (!string.IsNullOrWhiteSpace(item.OfferId))
            {
                builder.AppendLine($"Артикул: {item.OfferId.Trim()}");
            }

            if (!isNovinka && item.RequiredQuantity > 0)
            {
                builder.AppendLine($"Количество: {item.RequiredQuantity} шт.");
            }
        }
        else
        {
            builder.AppendLine($"Позиций: {items.Count}");
            foreach (var item in items.Take(3))
            {
                builder.AppendLine($"• {ShortenText(item.ProductName, 52)}");
            }

            if (items.Count > 3)
            {
                builder.AppendLine($"• … ещё {items.Count - 3}");
            }
        }
    }

    private static List<ProductionTaskItem> GetTaskItemsForMessage(ProductionTask task) =>
        task.Items.Count > 0
            ? task.Items.OrderBy(item => item.ProductName).ToList()
            :
            [
                new ProductionTaskItem
                {
                    OfferId = task.OfferId,
                    ProductName = task.ProductName,
                    RequiredQuantity = task.RequiredQuantity
                }
            ];

    private static string ShortenText(string? value, int maxLength = 72)
    {
        var trimmed = (value ?? string.Empty).Replace('\r', ' ').Replace('\n', ' ').Trim();
        while (trimmed.Contains("  ", StringComparison.Ordinal))
        {
            trimmed = trimmed.Replace("  ", " ", StringComparison.Ordinal);
        }

        if (trimmed.Length <= maxLength)
        {
            return trimmed;
        }

        return trimmed[..(maxLength - 1)].TrimEnd() + "…";
    }

    public static List<ProductionTaskItemListItem> MapItems(ProductionTask task) =>
        task.Items.Count == 0
            ? [new ProductionTaskItemListItem(task.Id, task.OzonProductId, task.OfferId, task.ProductName, string.Empty, task.RequiredQuantity, task.ActualQuantity, false, string.Empty)]
            : task.Items
                .OrderBy(item => item.ProductName)
                .Select(item => new ProductionTaskItemListItem(
                    item.Id,
                    item.OzonProductId,
                    item.OfferId,
                    item.ProductName,
                    item.ProductLink,
                    item.RequiredQuantity,
                    item.ActualQuantity,
                    item.EnforceMinimumQuantity,
                    item.FilePath))
                .ToList();

    public static List<ProductionTaskItem> BuildTaskItems(
        string taskType,
        IReadOnlyCollection<CreateProductionTaskItemRequest> requestItems)
    {
        if (NormalizeTaskType(taskType) == ProductionTaskTypes.Novinka)
        {
            return requestItems.Select(itemRequest =>
            {
                var normalized = NormalizeTaskItemRequest(itemRequest);
                var itemId = Guid.NewGuid();
                return new ProductionTaskItem
                {
                    Id = itemId,
                    OzonProductId = 0,
                    OfferId = BuildNovinkaOfferId(itemId),
                    ProductName = normalized.ProductName,
                    ProductLink = normalized.ProductLink,
                    RequiredQuantity = 0,
                    EnforceMinimumQuantity = false
                };
            }).ToList();
        }

        return requestItems.Select(itemRequest =>
        {
            var normalized = NormalizeTaskItemRequest(itemRequest);
            return new ProductionTaskItem
            {
                OzonProductId = normalized.OzonProductId,
                OfferId = normalized.OfferId,
                ProductName = normalized.ProductName,
                ProductLink = normalized.ProductLink,
                RequiredQuantity = normalized.RequiredQuantity,
                EnforceMinimumQuantity = normalized.EnforceMinimumQuantity
            };
        }).ToList();
    }

    public static bool IsNovinkaTaskUpdate(
        ProductionTask task,
        IReadOnlyCollection<CreateProductionTaskItemRequest> requestItems)
    {
        if (NormalizeTaskType(task.TaskType) == ProductionTaskTypes.Novinka)
        {
            return true;
        }

        if (requestItems.Count > 0 &&
            requestItems.All(item =>
                item.OzonProductId <= 0 &&
                item.RequiredQuantity <= 0 &&
                !string.IsNullOrWhiteSpace(item.ProductName) &&
                !string.IsNullOrWhiteSpace(item.ProductLink)))
        {
            return true;
        }

        return task.Items.Count > 0 &&
               task.Items.All(item =>
                   item.OzonProductId <= 0 &&
                   (!string.IsNullOrWhiteSpace(item.ProductLink) ||
                    item.OfferId.StartsWith("NV-", StringComparison.OrdinalIgnoreCase)));
    }

    public static List<ProductionTaskItem> ReconcileNovinkaTaskItems(
        ProductionTask task,
        IReadOnlyCollection<CreateProductionTaskItemRequest> requestItems)
    {
        var matchedExisting = new HashSet<Guid>();
        var result = new List<ProductionTaskItem>();

        foreach (var requestItem in requestItems)
        {
            var normalized = NormalizeTaskItemRequest(requestItem);
            var normalizedLink = NormalizeNovinkaLink(normalized.ProductLink);
            var existing = task.Items.FirstOrDefault(item =>
                !matchedExisting.Contains(item.Id) &&
                string.Equals(item.ProductName.Trim(), normalized.ProductName, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(NormalizeNovinkaLink(item.ProductLink), normalizedLink, StringComparison.OrdinalIgnoreCase));

            if (existing is null && !string.IsNullOrWhiteSpace(normalized.OfferId))
            {
                existing = task.Items.FirstOrDefault(item =>
                    !matchedExisting.Contains(item.Id) &&
                    string.Equals(item.OfferId.Trim(), normalized.OfferId, StringComparison.OrdinalIgnoreCase));
            }

            if (existing is not null)
            {
                matchedExisting.Add(existing.Id);
                existing.OzonProductId = 0;
                existing.OfferId = string.IsNullOrWhiteSpace(existing.OfferId)
                    ? BuildNovinkaOfferId(existing.Id)
                    : existing.OfferId;
                existing.ProductName = normalized.ProductName;
                existing.ProductLink = normalized.ProductLink;
                existing.RequiredQuantity = 0;
                existing.EnforceMinimumQuantity = false;
                result.Add(existing);
                continue;
            }

            var itemId = Guid.NewGuid();
            var newItem = new ProductionTaskItem
            {
                Id = itemId,
                ProductionTaskId = task.Id,
                OzonProductId = 0,
                OfferId = BuildNovinkaOfferId(itemId),
                ProductName = normalized.ProductName,
                ProductLink = normalized.ProductLink,
                RequiredQuantity = 0,
                EnforceMinimumQuantity = false,
            };
            task.Items.Add(newItem);
            result.Add(newItem);
        }

        var keepIds = result.Select(item => item.Id).ToHashSet();
        foreach (var removed in task.Items.Where(item => !keepIds.Contains(item.Id)).ToList())
        {
            task.Items.Remove(removed);
        }

        return result;
    }

    public static List<ProductionTaskItem> ReconcileTaskItems(
        ProductionTask task,
        IReadOnlyCollection<CreateProductionTaskItemRequest> requestItems)
    {
        var matchedExisting = new HashSet<Guid>();
        var result = new List<ProductionTaskItem>();

        foreach (var requestItem in requestItems)
        {
            var normalized = NormalizeTaskItemRequest(requestItem);
            var existing = task.Items.FirstOrDefault(item =>
                !matchedExisting.Contains(item.Id) &&
                item.OzonProductId == normalized.OzonProductId &&
                string.Equals(
                    (item.OfferId ?? string.Empty).Trim(),
                    normalized.OfferId,
                    StringComparison.OrdinalIgnoreCase));

            if (existing is null && normalized.OzonProductId > 0)
            {
                existing = task.Items.FirstOrDefault(item =>
                    !matchedExisting.Contains(item.Id) &&
                    item.OzonProductId == normalized.OzonProductId);
            }

            if (existing is not null)
            {
                matchedExisting.Add(existing.Id);
                existing.OzonProductId = normalized.OzonProductId;
                existing.OfferId = normalized.OfferId;
                existing.ProductName = normalized.ProductName;
                existing.ProductLink = normalized.ProductLink;
                existing.RequiredQuantity = normalized.RequiredQuantity;
                existing.EnforceMinimumQuantity = normalized.EnforceMinimumQuantity;
                result.Add(existing);
                continue;
            }

            var newItem = new ProductionTaskItem
            {
                ProductionTaskId = task.Id,
                OzonProductId = normalized.OzonProductId,
                OfferId = normalized.OfferId,
                ProductName = normalized.ProductName,
                ProductLink = normalized.ProductLink,
                RequiredQuantity = normalized.RequiredQuantity,
                EnforceMinimumQuantity = normalized.EnforceMinimumQuantity,
            };
            task.Items.Add(newItem);
            result.Add(newItem);
        }

        var keepIds = result.Select(item => item.Id).ToHashSet();
        foreach (var removed in task.Items.Where(item => !keepIds.Contains(item.Id)).ToList())
        {
            task.Items.Remove(removed);
        }

        return result;
    }

    private static (long OzonProductId, string OfferId, string ProductName, string ProductLink, int RequiredQuantity, bool EnforceMinimumQuantity)
        NormalizeTaskItemRequest(CreateProductionTaskItemRequest itemRequest) =>
        (
            itemRequest.OzonProductId,
            (itemRequest.OfferId ?? string.Empty).Trim(),
            (itemRequest.ProductName ?? string.Empty).Trim(),
            (itemRequest.ProductLink ?? string.Empty).Trim(),
            itemRequest.RequiredQuantity,
            itemRequest.EnforceMinimumQuantity);

    private static string NormalizeNovinkaLink(string? value) =>
        string.IsNullOrWhiteSpace(value)
            ? string.Empty
            : System.Text.RegularExpressions.Regex.Replace(
                value.Trim(),
                @"\s*;?\s*marketplace:(ozon|kaspi|satu|halyk)\b",
                string.Empty,
                System.Text.RegularExpressions.RegexOptions.IgnoreCase).Trim();

    public static bool IsValidOzonTaskItemRequest(CreateProductionTaskItemRequest item)
    {
        if (item.RequiredQuantity <= 0)
        {
            return false;
        }

        var offerId = item.OfferId ?? string.Empty;
        var productName = item.ProductName ?? string.Empty;
        var productLink = item.ProductLink ?? string.Empty;

        if (item.OzonProductId > 0)
        {
            return !string.IsNullOrWhiteSpace(offerId) || !string.IsNullOrWhiteSpace(productName);
        }

        return !string.IsNullOrWhiteSpace(offerId) ||
               (!string.IsNullOrWhiteSpace(productName) && !string.IsNullOrWhiteSpace(productLink));
    }

    public static async Task<List<ProductionCatalogItem>> BuildCatalogAsync(
        AppDbContext db,
        string taskType)
    {
        var normalizedTaskType = NormalizeTaskType(taskType);
        var files = await db.ProductionFiles.AsNoTracking().ToListAsync();

        if (normalizedTaskType == ProductionTaskTypes.Novinka)
        {
            return BuildNovinkaCatalogFromFiles(files);
        }

        var tasks = await db.ProductionTasks
            .AsNoTracking()
            .Include(task => task.Items)
            .Where(task =>
                task.Status == ProductionTaskStatuses.Completed &&
                !task.IsArchived &&
                task.TaskType == normalizedTaskType)
            .ToListAsync();

        var catalog = new List<ProductionCatalogItem>();

        foreach (var task in tasks)
        {
            var taskItems = task.Items.Count == 0
                ?
                [
                    new ProductionTaskItem
                    {
                        Id = task.Id,
                        OzonProductId = task.OzonProductId,
                        OfferId = task.OfferId,
                        ProductName = task.ProductName,
                        ProductLink = string.Empty
                    }
                ]
                : task.Items;

            foreach (var item in taskItems)
            {
                var itemFiles = files.Where(file =>
                        (!string.IsNullOrWhiteSpace(item.OfferId) && file.OfferId == item.OfferId) ||
                        (item.OzonProductId > 0 && file.OzonProductId == item.OzonProductId))
                    .ToList();

                if (itemFiles.Count == 0)
                {
                    continue;
                }

                catalog.Add(new ProductionCatalogItem(
                    item.OfferId,
                    item.OzonProductId > 0 ? item.OzonProductId : null,
                    item.ProductName,
                    item.ProductLink,
                    itemFiles.Count,
                    task.CompletedAt));
            }
        }

        return catalog
            .GroupBy(item => item.OfferId, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.OrderByDescending(item => item.CompletedAt).First())
            .OrderBy(item => item.ProductName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public static string GetNovinkaCatalogKey(ProductionFile file) =>
        GetNovinkaCatalogKeyFromCatalogItem(file.OfferId, file.ProductName, file.ProductLink);

    private static string GetNovinkaCatalogKeyFromCatalogItem(string offerId, string productName, string productLink)
    {
        var name = productName.Trim();
        var link = productLink.Trim();
        if (!string.IsNullOrEmpty(link))
        {
            return $"{name.ToLowerInvariant()}|{link.ToLowerInvariant()}";
        }

        if (!string.IsNullOrWhiteSpace(offerId))
        {
            return offerId.Trim().ToUpperInvariant();
        }

        return name.ToLowerInvariant();
    }

    public static List<ProductionFile> FindNovinkaCatalogFiles(
        IEnumerable<ProductionFile> files,
        string offerId,
        string productName,
        string productLink)
    {
        var key = GetNovinkaCatalogKeyFromCatalogItem(offerId, productName, productLink);
        return files
            .Where(IsNovinkaProductionFile)
            .Where(file => string.Equals(GetNovinkaCatalogKey(file), key, StringComparison.OrdinalIgnoreCase))
            .ToList();
    }

    private static List<ProductionCatalogItem> BuildNovinkaCatalogFromFiles(List<ProductionFile> files) =>
        files
            .Where(IsNovinkaProductionFile)
            .GroupBy(GetNovinkaCatalogKey, StringComparer.OrdinalIgnoreCase)
            .Select(group =>
            {
                var latest = group.OrderByDescending(file => file.CreatedAt).First();
                return new ProductionCatalogItem(
                    latest.OfferId,
                    latest.OzonProductId is > 0 ? latest.OzonProductId : null,
                    latest.ProductName,
                    latest.ProductLink,
                    group.Count(),
                    group.Max(file => file.CreatedAt));
            })
            .OrderBy(item => item.ProductName, StringComparer.OrdinalIgnoreCase)
            .ToList();

    public static string ResolveTaskShopRegion(ProductionTask task)
    {
        var taskType = NormalizeTaskType(task.TaskType);
        return taskType switch
        {
            ProductionTaskTypes.Kaspi or ProductionTaskTypes.Satu or ProductionTaskTypes.Halyk => "kz",
            ProductionTaskTypes.Ozon => "rf",
            ProductionTaskTypes.Novinka => ResolveNovinkaShopRegion(task),
            _ => "rf"
        };
    }

    public static string ResolveNewTaskEventId(ProductionTask task)
    {
        if (task.IsUrgent)
        {
            return "production.task.new.urgent";
        }

        var taskType = NormalizeTaskType(task.TaskType);
        return taskType switch
        {
            ProductionTaskTypes.Novinka => ResolveTaskShopRegion(task) == "kz"
                ? "production.task.new.novinka.kz"
                : "production.task.new.novinka",
            ProductionTaskTypes.Kaspi => "production.task.new.kaspi",
            ProductionTaskTypes.Satu => "production.task.new.satu",
            ProductionTaskTypes.Halyk => "production.task.new.halyk",
            _ => "production.task.new.ozon"
        };
    }

    public static string ResolveCompletedTaskEventId(ProductionTask task)
    {
        var taskType = NormalizeTaskType(task.TaskType);
        return taskType switch
        {
            ProductionTaskTypes.Novinka => ResolveTaskShopRegion(task) == "kz"
                ? "production.task.completed.novinka.kz"
                : "production.task.completed.novinka",
            ProductionTaskTypes.Kaspi => "production.task.completed.kaspi",
            ProductionTaskTypes.Satu => "production.task.completed.satu",
            ProductionTaskTypes.Halyk => "production.task.completed.halyk",
            _ => "production.task.completed.ozon"
        };
    }

    public static string GetTaskTypeLabel(ProductionTask task)
    {
        var taskType = NormalizeTaskType(task.TaskType);
        if (taskType == ProductionTaskTypes.Novinka)
        {
            return ResolveTaskShopRegion(task) == "kz" ? "Новинка (КЗ)" : "Новинка (Ozon)";
        }

        return taskType switch
        {
            ProductionTaskTypes.Kaspi => "Kaspi",
            ProductionTaskTypes.Satu => "Satu",
            ProductionTaskTypes.Halyk => "Halyk",
            _ => "Ozon"
        };
    }

    private static string ResolveNovinkaShopRegion(ProductionTask task)
    {
        foreach (var item in task.Items)
        {
            if (ContainsKzMarketplaceMarker(item.ProductLink) || ContainsKzMarketplaceMarker(item.FilePath))
            {
                return "kz";
            }
        }

        return "rf";
    }

    private static bool ContainsKzMarketplaceMarker(string? value) =>
        !string.IsNullOrWhiteSpace(value) &&
        System.Text.RegularExpressions.Regex.IsMatch(
            value,
            @"marketplace:(kaspi|satu|halyk)\b",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
}


