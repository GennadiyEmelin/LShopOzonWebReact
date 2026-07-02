namespace LShopOzonWebReact.Api.Models;

public class SatuAnalyticsCacheEntry
{
    public string CacheKey { get; set; } = string.Empty;

    public string ShopId { get; set; } = string.Empty;

    public DateOnly PeriodFrom { get; set; }

    public DateOnly PeriodTo { get; set; }

    public string PayloadJson { get; set; } = "{}";

    public DateTimeOffset ComputedAt { get; set; }
}
