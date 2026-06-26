namespace LShopOzonWebReact.Api.Models;

public class ProductionAnalyticsTaskRecord
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? SourceTaskId { get; set; }
    public DateTimeOffset CompletedAt { get; set; }
    public DateTimeOffset RecordedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? UpdatedAt { get; set; }
    public Guid? UpdatedByUserId { get; set; }
    public long OzonProductId { get; set; }
    public string OfferId { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public int RequiredQuantity { get; set; }
    public int? ActualQuantity { get; set; }
    public string TaskType { get; set; } = ProductionTaskTypes.Ozon;
    public bool IsUrgent { get; set; }
    public string? AssignedUserName { get; set; }
    public Guid? AssignedUserId { get; set; }
    public Guid? CreatedByUserId { get; set; }
    public string? CreatedByDisplayName { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? StartedAt { get; set; }
    public string ItemsJson { get; set; } = "[]";
}
