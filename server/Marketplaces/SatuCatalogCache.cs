using System.Collections.Concurrent;
using LShopOzonWebReact.Api.Ozon;
using Microsoft.Extensions.Caching.Memory;

namespace LShopOzonWebReact.Api.Marketplaces;

public sealed class SatuCatalogCache(IMemoryCache cache)
{
    private static readonly TimeSpan ProductsTtl = TimeSpan.FromMinutes(20);
    private static readonly TimeSpan AnalyticsTtl = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan OrdersTtl = TimeSpan.FromMinutes(10);

    private readonly ConcurrentDictionary<string, SemaphoreSlim> _locks = new(StringComparer.Ordinal);

    public Task<IReadOnlyList<OzonProductSummary>> GetProductsAsync(
        HttpClient httpClient,
        string apiKey,
        string merchantId,
        CancellationToken cancellationToken) =>
        GetOrLoadAsync(
            ProductsKey(apiKey),
            ProductsTtl,
            () => SatuApiClient.LoadProductsAsync(httpClient, apiKey, merchantId, cancellationToken),
            cancellationToken);

    public Task<SatuCatalogStats> GetCatalogStatsAsync(
        HttpClient httpClient,
        string apiKey,
        string merchantId,
        CancellationToken cancellationToken) =>
        GetOrLoadAsync(
            $"satu:stats:{CacheKeySuffix(apiKey)}",
            ProductsTtl,
            () => SatuApiClient.GetCatalogStatsAsync(httpClient, apiKey, cancellationToken),
            cancellationToken);

    public async Task<KzProductsPage> GetProductsPageAsync(
        HttpClient httpClient,
        string apiKey,
        string merchantId,
        int skip,
        int take,
        CancellationToken cancellationToken)
    {
        var statsKey = $"satu:stats:{CacheKeySuffix(apiKey)}";
        cache.TryGetValue(statsKey, out SatuCatalogStats? stats);

        IReadOnlyList<OzonProductSummary> items;
        if (cache.TryGetValue(ProductsKey(apiKey), out IReadOnlyList<OzonProductSummary>? cachedProducts) &&
            cachedProducts is not null)
        {
            items = cachedProducts
                .Skip(Math.Max(0, skip))
                .Take(Math.Clamp(take, 1, 500))
                .ToList();
        }
        else
        {
            items = await SatuApiClient.LoadProductsRangeAsync(
                httpClient,
                apiKey,
                merchantId,
                skip,
                take,
                cancellationToken);
        }

        if (stats is null)
        {
            _ = GetCatalogStatsAsync(httpClient, apiKey, merchantId, cancellationToken);
        }

        return new KzProductsPage(
            stats?.Total ?? Math.Max(skip + items.Count, items.Count),
            stats?.Selling ?? 0,
            stats?.Ready ?? 0,
            stats?.Archived ?? 0,
            items);
    }

    public Task<IReadOnlyList<System.Text.Json.JsonElement>> GetOrdersAsync(
        HttpClient httpClient,
        string apiKey,
        DateOnly? from,
        DateOnly? to,
        CancellationToken cancellationToken)
    {
        var rangeKey = from?.ToString("yyyy-MM-dd") ?? "all";
        rangeKey += ":" + (to?.ToString("yyyy-MM-dd") ?? "all");
        return GetOrLoadAsync(
            $"satu:orders:{CacheKeySuffix(apiKey)}:{rangeKey}",
            OrdersTtl,
            () => SatuApiClient.LoadOrdersAsync(httpClient, apiKey, from, to, cancellationToken),
            cancellationToken);
    }

    public Task<OzonAnalyticsSnapshot> GetAnalyticsSnapshotAsync(
        HttpClient httpClient,
        string apiKey,
        string merchantId,
        CancellationToken cancellationToken) =>
        GetOrLoadAsync(
            $"satu:snapshot:{CacheKeySuffix(apiKey)}",
            ProductsTtl,
            async () =>
            {
                var stats = await GetCatalogStatsAsync(httpClient, apiKey, merchantId, cancellationToken);
                return new OzonAnalyticsSnapshot(
                    stats.Total,
                    stats.Selling,
                    stats.Ready,
                    stats.Archived,
                    null,
                    "KZT",
                    DateTimeOffset.UtcNow.ToString("O"));
            },
            cancellationToken);

    public Task<OzonAnalyticsResult> GetAnalyticsAsync(
        HttpClient httpClient,
        string apiKey,
        string merchantId,
        DateOnly from,
        DateOnly to,
        CancellationToken cancellationToken) =>
        GetOrLoadAsync(
            $"satu:analytics:{CacheKeySuffix(apiKey)}:{from:yyyy-MM-dd}:{to:yyyy-MM-dd}",
            AnalyticsTtl,
            () => SatuAnalyticsBuilder.BuildAnalyticsAsync(
                httpClient,
                apiKey,
                merchantId,
                from,
                to,
                ct => GetCatalogStatsAsync(httpClient, apiKey, merchantId, ct),
                ct => GetOrdersAsync(httpClient, apiKey, from, to, ct),
                cancellationToken),
            cancellationToken);

    public async Task<(int Total, IReadOnlyList<OzonUnsoldProductRow> Items)> GetUnsoldProductsPageAsync(
        HttpClient httpClient,
        string apiKey,
        string merchantId,
        DateOnly from,
        DateOnly to,
        int skip,
        int take,
        CancellationToken cancellationToken)
    {
        var allUnsold = await GetOrLoadAsync(
            $"satu:unsold-all:{CacheKeySuffix(apiKey)}:{from:yyyy-MM-dd}:{to:yyyy-MM-dd}",
            AnalyticsTtl,
            async () =>
            {
                var products = await GetProductsAsync(httpClient, apiKey, merchantId, cancellationToken);
                var orders = await GetOrdersAsync(httpClient, apiKey, from, to, cancellationToken);
                return await SatuAnalyticsBuilder.BuildUnsoldPageAsync(products, orders, 0, int.MaxValue);
            },
            cancellationToken);

        var page = allUnsold.Items
            .Skip(Math.Max(0, skip))
            .Take(Math.Clamp(take, 1, 500))
            .ToList();

        return (allUnsold.Total, page);
    }

    private async Task<T> GetOrLoadAsync<T>(
        string key,
        TimeSpan ttl,
        Func<Task<T>> factory,
        CancellationToken cancellationToken)
    {
        if (cache.TryGetValue(key, out T? cached) && cached is not null)
        {
            return cached;
        }

        var gate = _locks.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        try
        {
            if (cache.TryGetValue(key, out cached) && cached is not null)
            {
                return cached;
            }

            var value = await factory();
            cache.Set(key, value, ttl);
            return value;
        }
        finally
        {
            gate.Release();
        }
    }

    private static string ProductsKey(string apiKey) => $"satu:products:{CacheKeySuffix(apiKey)}";

    private static string CacheKeySuffix(string apiKey)
    {
        var trimmed = apiKey.Trim();
        return trimmed.Length <= 12 ? trimmed : trimmed[^12..];
    }
}
