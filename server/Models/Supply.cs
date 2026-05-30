namespace LShopOzonWebReact.Api.Models;

public class Supply
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Status { get; set; } = SupplyStatuses.Created;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? SentAt { get; set; }
    public DateTimeOffset? AcceptedAt { get; set; }
    public bool IsArchived { get; set; }
    public DateTimeOffset? ArchivedAt { get; set; }
    public List<SupplyItem> Items { get; set; } = [];
}

public class SupplyItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SupplyId { get; set; }
    public Supply Supply { get; set; } = null!;
    public long? OzonProductId { get; set; }
    public string OfferId { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public int Quantity { get; set; }
    public bool IsReserve { get; set; }
}

public static class SupplyStatuses
{
    public const string Created = "Created";
    public const string Sent = "Sent";
    public const string Accepted = "Accepted";
}
