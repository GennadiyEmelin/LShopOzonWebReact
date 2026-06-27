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
    public string TaskType { get; set; } = ProductionTaskTypes.Ozon;
    public bool IsUrgent { get; set; }
    public Guid? CreatedByUserId { get; set; }
    public string? CreatedByDisplayName { get; set; }
    public string? AssignedUserName { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? CancelledAt { get; set; }
    public Guid? CancelledByUserId { get; set; }
    public string? CancelledByDisplayName { get; set; }
    public string? CancellationComment { get; set; }
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
    public bool EnforceMinimumQuantity { get; set; }
    public string ProductLink { get; set; } = string.Empty;
    public string FilePath { get; set; } = string.Empty;
}

public static class ProductionTaskTypes
{
    public const string Ozon = "Ozon";
    public const string Novinka = "Novinka";
    public const string Kaspi = "Kaspi";
    public const string Satu = "Satu";
    public const string Halyk = "Halyk";

    public static readonly IReadOnlyList<string> MarketplaceTypes =
        [Ozon, Kaspi, Satu, Halyk];
}

public static class ProductionTaskStatuses
{
    public const string New = "New";
    public const string InProgress = "InProgress";
    public const string Cancelled = "Cancelled";
    public const string Completed = "Completed";
}
