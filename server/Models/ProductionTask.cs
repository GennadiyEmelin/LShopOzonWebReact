namespace LShopOzonWebReact.Api.Models;

public class ProductionTask
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public long OzonProductId { get; set; }
    public string OfferId { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public int RequiredQuantity { get; set; }
    public int? ActualQuantity { get; set; }
    public string Status { get; set; } = ProductionTaskStatuses.New;
    public string? AssignedUserName { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? DeferredAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public bool IsArchived { get; set; }
    public DateTimeOffset? ArchivedAt { get; set; }
    public List<ProductionTaskItem> Items { get; set; } = [];
}

public class ProductionTaskItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProductionTaskId { get; set; }
    public ProductionTask ProductionTask { get; set; } = null!;
    public long OzonProductId { get; set; }
    public string OfferId { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public int RequiredQuantity { get; set; }
    public int? ActualQuantity { get; set; }
}

public static class ProductionTaskStatuses
{
    public const string New = "New";
    public const string InProgress = "InProgress";
    public const string Deferred = "Deferred";
    public const string Completed = "Completed";
}
