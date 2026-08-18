namespace LShopOzonWebReact.Api.Models;

public class Supply
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Status { get; set; } = SupplyStatuses.Created;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? SentAt { get; set; }
    public DateTimeOffset? AcceptedAt { get; set; }
    public decimal? ShippingCost { get; set; }
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
    public string ItemKind { get; set; } = SupplyItemKinds.Product;
}

public class SupplyFboDefect
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string ProductKey { get; set; } = string.Empty;
    public string OfferId { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public int Quantity { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public Guid CreatedByUserId { get; set; }
    public AppUser CreatedByUser { get; set; } = null!;
}

public class SupplyFboDiscrepancy
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string ProductKey { get; set; } = string.Empty;
    public string OfferId { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public int Quantity { get; set; }
    public string Comment { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public Guid CreatedByUserId { get; set; }
    public AppUser CreatedByUser { get; set; } = null!;
}

public class SupplyExpense
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public DateTimeOffset PurchasedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public Guid CreatedByUserId { get; set; }
    public AppUser CreatedByUser { get; set; } = null!;
}

public static class SupplyStatuses
{
    public const string Created = "Created";
    public const string Sent = "Sent";
    public const string Accepted = "Accepted";
}

public static class SupplyItemKinds
{
    public const string Product = "Product";
    public const string Consumable = "Consumable";
    public const string MaterialAsset = "MaterialAsset";

    public static string Normalize(string? value) =>
        value switch
        {
            Consumable => Consumable,
            MaterialAsset => MaterialAsset,
            _ => Product
        };
}
