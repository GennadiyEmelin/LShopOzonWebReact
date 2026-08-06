using System.Text.Json;
using LShopOzonWebReact.Api.Contracts.Production;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Security;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Production;

public static class ProductionAnalyticsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static async Task BackfillMissingRecordsAsync(AppDbContext db, CancellationToken cancellationToken = default)
    {
        var completedTasks = await db.ProductionTasks
            .AsNoTracking()
            .Include(task => task.Items)
            .Where(task =>
                task.Status == ProductionTaskStatuses.Completed &&
                task.CompletedAt != null)
            .ToListAsync(cancellationToken);

        if (completedTasks.Count == 0)
        {
            return;
        }

        var existingSourceIds = await db.ProductionAnalyticsTaskRecords
            .AsNoTracking()
            .Where(record => record.SourceTaskId != null)
            .Select(record => record.SourceTaskId!.Value)
            .ToListAsync(cancellationToken);
        var existingSet = existingSourceIds.ToHashSet();

        foreach (var task in completedTasks)
        {
            if (existingSet.Contains(task.Id))
            {
                continue;
            }

            db.ProductionAnalyticsTaskRecords.Add(await BuildRecordFromTaskAsync(db, task, cancellationToken));
            try
            {
                await db.SaveChangesAsync(cancellationToken);
                existingSet.Add(task.Id);
            }
            catch (DbUpdateException)
            {
                db.ChangeTracker.Clear();
            }
        }
    }

    public static async Task UpsertFromTaskAsync(AppDbContext db, ProductionTask task, CancellationToken cancellationToken = default)
    {
        var record = await db.ProductionAnalyticsTaskRecords
            .FirstOrDefaultAsync(entry => entry.SourceTaskId == task.Id, cancellationToken);

        if (record is null)
        {
            record = await BuildRecordFromTaskAsync(db, task, cancellationToken);
            db.ProductionAnalyticsTaskRecords.Add(record);
        }
        else
        {
            ApplyTaskSnapshot(record, await BuildRecordFromTaskAsync(db, task, cancellationToken));
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    public static IQueryable<ProductionAnalyticsTaskRecord> BuildRecordsQuery(
        AppDbContext db,
        DateTimeOffset from,
        DateTimeOffset to) =>
        db.ProductionAnalyticsTaskRecords
            .AsNoTracking()
            .Where(record => record.CompletedAt >= from && record.CompletedAt <= to);

    public static async Task<List<ProductionAnalyticsSummaryRow>> BuildSummaryAsync(
        AppDbContext db,
        List<ProductionAnalyticsTaskRecord> records)
    {
        var users = await db.Users.AsNoTracking()
            .Where(user => user.IsActive)
            .Select(user => new
            {
                user.Id,
                user.DisplayName,
                user.UserName,
                user.Role,
                user.AvatarFileName
            })
            .ToListAsync();

        return records
            .GroupBy(record => string.IsNullOrWhiteSpace(record.AssignedUserName) ? "—" : record.AssignedUserName.Trim())
            .Select(group =>
            {
                var assigneeName = group.Key;
                var matchedUser = group.FirstOrDefault(record => record.AssignedUserId.HasValue) is { AssignedUserId: var userId }
                    ? users.FirstOrDefault(user => user.Id == userId)
                    : users.FirstOrDefault(user =>
                        string.Equals(user.DisplayName, assigneeName, StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(user.UserName, assigneeName, StringComparison.OrdinalIgnoreCase));

                return new ProductionAnalyticsSummaryRow(
                    matchedUser?.Id ?? group.Select(record => record.AssignedUserId).FirstOrDefault(id => id.HasValue),
                    assigneeName,
                    matchedUser?.Role ?? string.Empty,
                    UserResponses.AvatarUrl(matchedUser?.AvatarFileName ?? string.Empty),
                    group.Count(),
                    group.Sum(record => CountItems(record)));
            })
            .OrderByDescending(row => row.TaskCount)
            .ThenBy(row => row.UserName)
            .ToList();
    }

    public static ProductionTaskListItem ToListItem(ProductionAnalyticsTaskRecord record) =>
        new(
            record.Id,
            record.OzonProductId,
            record.OfferId,
            record.ProductName,
            record.RequiredQuantity,
            record.ActualQuantity,
            ProductionTaskStatuses.Completed,
            ProductionTaskResponses.NormalizeTaskType(record.TaskType),
            record.IsUrgent,
            record.AssignedUserName,
            record.CreatedByUserId,
            record.CreatedByDisplayName,
            record.CreatedAt,
            null,
            null,
            record.StartedAt,
            null,
            null,
            null,
            null,
            record.CompletedAt,
            false,
            null,
            ParseItems(record));

    public static void ApplyUpdate(
        ProductionAnalyticsTaskRecord record,
        UpdateProductionAnalyticsRecordRequest request,
        Guid? updatedByUserId)
    {
        if (request.CompletedAt.HasValue)
        {
            record.CompletedAt = request.CompletedAt.Value;
        }

        if (request.AssignedUserName is not null)
        {
            record.AssignedUserName = request.AssignedUserName.Trim();
        }

        if (request.AssignedUserId.HasValue)
        {
            record.AssignedUserId = request.AssignedUserId.Value == Guid.Empty ? null : request.AssignedUserId;
        }

        if (request.OzonProductId.HasValue)
        {
            record.OzonProductId = request.OzonProductId.Value;
        }

        if (request.OfferId is not null)
        {
            record.OfferId = request.OfferId.Trim();
        }

        if (request.ProductName is not null)
        {
            record.ProductName = request.ProductName.Trim();
        }

        if (request.RequiredQuantity.HasValue)
        {
            record.RequiredQuantity = request.RequiredQuantity.Value;
        }

        if (request.ActualQuantity.HasValue)
        {
            record.ActualQuantity = request.ActualQuantity.Value;
        }

        if (request.TaskType is not null)
        {
            record.TaskType = ProductionTaskResponses.NormalizeTaskType(request.TaskType);
        }

        if (request.IsUrgent.HasValue)
        {
            record.IsUrgent = request.IsUrgent.Value;
        }

        if (request.CreatedByDisplayName is not null)
        {
            record.CreatedByDisplayName = request.CreatedByDisplayName.Trim();
        }

        if (request.CreatedAt.HasValue)
        {
            record.CreatedAt = request.CreatedAt.Value;
        }

        if (request.StartedAt.HasValue)
        {
            record.StartedAt = request.StartedAt.Value;
        }

        if (request.Items is not null)
        {
            record.ItemsJson = JsonSerializer.Serialize(request.Items, JsonOptions);
        }

        record.UpdatedAt = DateTimeOffset.UtcNow;
        record.UpdatedByUserId = updatedByUserId;
    }

    private static async Task<ProductionAnalyticsTaskRecord> BuildRecordFromTaskAsync(
        AppDbContext db,
        ProductionTask task,
        CancellationToken cancellationToken)
    {
        var assigneeUserId = await ResolveAssigneeUserIdAsync(db, task.AssignedUserName, cancellationToken);
        return new ProductionAnalyticsTaskRecord
        {
            Id = task.Id,
            SourceTaskId = task.Id,
            CompletedAt = task.CompletedAt ?? DateTimeOffset.UtcNow,
            OzonProductId = task.OzonProductId,
            OfferId = task.OfferId,
            ProductName = task.ProductName,
            RequiredQuantity = task.RequiredQuantity,
            ActualQuantity = task.ActualQuantity,
            TaskType = ProductionTaskResponses.NormalizeTaskType(task.TaskType),
            IsUrgent = task.IsUrgent,
            AssignedUserName = task.AssignedUserName,
            AssignedUserId = assigneeUserId,
            CreatedByUserId = task.CreatedByUserId,
            CreatedByDisplayName = task.CreatedByDisplayName,
            CreatedAt = task.CreatedAt,
            StartedAt = task.StartedAt,
            ItemsJson = JsonSerializer.Serialize(ProductionTaskResponses.MapItems(task), JsonOptions)
        };
    }

    private static void ApplyTaskSnapshot(ProductionAnalyticsTaskRecord target, ProductionAnalyticsTaskRecord source)
    {
        target.CompletedAt = source.CompletedAt;
        target.OzonProductId = source.OzonProductId;
        target.OfferId = source.OfferId;
        target.ProductName = source.ProductName;
        target.RequiredQuantity = source.RequiredQuantity;
        target.ActualQuantity = source.ActualQuantity;
        target.TaskType = source.TaskType;
        target.IsUrgent = source.IsUrgent;
        target.AssignedUserName = source.AssignedUserName;
        target.AssignedUserId = source.AssignedUserId;
        target.CreatedByUserId = source.CreatedByUserId;
        target.CreatedByDisplayName = source.CreatedByDisplayName;
        target.CreatedAt = source.CreatedAt;
        target.StartedAt = source.StartedAt;
        target.ItemsJson = source.ItemsJson;
    }

    private static async Task<Guid?> ResolveAssigneeUserIdAsync(
        AppDbContext db,
        string? assignedUserName,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(assignedUserName))
        {
            return null;
        }

        var normalized = assignedUserName.Trim();
        return await db.Users.AsNoTracking()
            .Where(user =>
                user.IsActive &&
                (user.DisplayName == normalized || user.UserName == normalized))
            .Select(user => (Guid?)user.Id)
            .FirstOrDefaultAsync(cancellationToken);
    }

    private static int CountItems(ProductionAnalyticsTaskRecord record)
    {
        var items = ParseItems(record);
        return items.Count == 0 ? 1 : items.Count;
    }

    private static List<ProductionTaskItemListItem> ParseItems(ProductionAnalyticsTaskRecord record)
    {
        if (string.IsNullOrWhiteSpace(record.ItemsJson))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<List<ProductionTaskItemListItem>>(record.ItemsJson, JsonOptions) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }
}
