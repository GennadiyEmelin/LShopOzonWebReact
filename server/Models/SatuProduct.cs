namespace LShopOzonWebReact.Api.Models;

public class SatuProduct
{
    public Guid Id { get; set; }

    public long SatuProductId { get; set; }

    public string ShopId { get; set; } = string.Empty;

    public string OfferId { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public decimal Price { get; set; }

    public decimal OldPrice { get; set; }

    public int Stock { get; set; }

    public string Description { get; set; } = string.Empty;

    public string? CategoryId { get; set; }

    public string ImageUrlsJson { get; set; } = "[]";

    public string Status { get; set; } = "ready";

    public string ProductUrl { get; set; } = string.Empty;

    public string ImageUrl { get; set; } = string.Empty;

    public string CurrencyCode { get; set; } = "KZT";

    public bool IsActive { get; set; } = true;

    public DateTimeOffset LastSyncedAt { get; set; }

    public DateTimeOffset? ExternalUpdatedAt { get; set; }

    public string RawJson { get; set; } = "{}";
}
