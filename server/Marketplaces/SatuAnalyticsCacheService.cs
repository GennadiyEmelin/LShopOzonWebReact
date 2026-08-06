using System.Text.Json;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Ozon;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Marketplaces;

public sealed class SatuAnalyticsCacheService(AppDbContext db)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan ProductCacheTtl = TimeSpan.FromMinutes(20);

    public async Task<OzonAnalyticsResult?> TryGetAnalyticsAsync(
        string shopId,
        DateOnly from,
        DateOnly to,
        bool allowStale,
        CancellationToken cancellationToken)
    {
        var key = BuildKey(shopId, from, to, "analytics");
        var entry = await db.SatuAnalyticsCacheEntries
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.CacheKey == key, cancellationToken);

        if (entry is null)
        {
            return null;
        }

        if (!allowStale && entry.ComputedAt < DateTimeOffset.UtcNow - CacheTtl)
        {
            return null;
        }

        return JsonSerializer.Deserialize<OzonAnalyticsResult>(entry.PayloadJson, JsonOptions);
    }

    public async Task SaveAnalyticsAsync(
        string shopId,
        DateOnly from,
        DateOnly to,
        OzonAnalyticsResult analytics,
        CancellationToken cancellationToken)
    {
        var key = BuildKey(shopId, from, to, "analytics");
        var payload = JsonSerializer.Serialize(analytics, JsonOptions);
        var entry = await db.SatuAnalyticsCacheEntries.FirstOrDefaultAsync(item => item.CacheKey == key, cancellationToken);
        if (entry is null)
        {
            entry = new SatuAnalyticsCacheEntry { CacheKey = key, ShopId = shopId };
            db.SatuAnalyticsCacheEntries.Add(entry);
        }

        entry.PeriodFrom = from;
        entry.PeriodTo = to;
        entry.PayloadJson = payload;
        entry.ComputedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<OzonAnalyticsSnapshot?> TryGetSnapshotAsync(
        string shopId,
        CancellationToken cancellationToken)
    {
        var key = BuildKey(shopId, DateOnly.MinValue, DateOnly.MinValue, "snapshot");
        var entry = await db.SatuAnalyticsCacheEntries
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.CacheKey == key, cancellationToken);

        if (entry is null || entry.ComputedAt < DateTimeOffset.UtcNow - ProductCacheTtl)
        {
            return null;
        }

        return JsonSerializer.Deserialize<OzonAnalyticsSnapshot>(entry.PayloadJson, JsonOptions);
    }

    public async Task SaveSnapshotAsync(
        string shopId,
        OzonAnalyticsSnapshot snapshot,
        CancellationToken cancellationToken)
    {
        var key = BuildKey(shopId, DateOnly.MinValue, DateOnly.MinValue, "snapshot");
        var payload = JsonSerializer.Serialize(snapshot, JsonOptions);
        var entry = await db.SatuAnalyticsCacheEntries.FirstOrDefaultAsync(item => item.CacheKey == key, cancellationToken);
        if (entry is null)
        {
            entry = new SatuAnalyticsCacheEntry { CacheKey = key, ShopId = shopId };
            db.SatuAnalyticsCacheEntries.Add(entry);
        }

        entry.PeriodFrom = DateOnly.MinValue;
        entry.PeriodTo = DateOnly.MinValue;
        entry.PayloadJson = payload;
        entry.ComputedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
    }

    internal async Task<IReadOnlyList<KaspiProductCatalogItem>?> TryGetKaspiProductsAsync(
        string merchantId,
        bool allowStale,
        CancellationToken cancellationToken)
    {
        var key = BuildKey($"kaspi:{merchantId}", DateOnly.MinValue, DateOnly.MinValue, "products-full");
        var entry = await db.SatuAnalyticsCacheEntries
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.CacheKey == key, cancellationToken);

        if (entry is null)
        {
            return null;
        }

        if (!allowStale && entry.ComputedAt < DateTimeOffset.UtcNow - ProductCacheTtl)
        {
            return null;
        }

        return JsonSerializer.Deserialize<IReadOnlyList<KaspiProductCatalogItem>>(entry.PayloadJson, JsonOptions);
    }

    internal async Task SaveKaspiProductsAsync(
        string merchantId,
        IReadOnlyList<KaspiProductCatalogItem> products,
        CancellationToken cancellationToken)
    {
        var key = BuildKey($"kaspi:{merchantId}", DateOnly.MinValue, DateOnly.MinValue, "products-full");
        var payload = JsonSerializer.Serialize(products, JsonOptions);
        var entry = await db.SatuAnalyticsCacheEntries.FirstOrDefaultAsync(item => item.CacheKey == key, cancellationToken);
        if (entry is null)
        {
            entry = new SatuAnalyticsCacheEntry { CacheKey = key, ShopId = $"kaspi:{merchantId}" };
            db.SatuAnalyticsCacheEntries.Add(entry);
        }

        entry.PeriodFrom = DateOnly.MinValue;
        entry.PeriodTo = DateOnly.MinValue;
        entry.PayloadJson = payload;
        entry.ComputedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
    }

    private static string BuildKey(string shopId, DateOnly from, DateOnly to, string kind) =>
        $"{shopId}:{kind}:{from:yyyy-MM-dd}:{to:yyyy-MM-dd}";
}
