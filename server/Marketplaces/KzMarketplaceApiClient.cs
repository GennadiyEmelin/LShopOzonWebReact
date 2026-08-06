using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Ozon;

namespace LShopOzonWebReact.Api.Marketplaces;

public sealed class KzMarketplaceApiClient(
    HttpClient httpClient,
    KzMarketplaceCredentials credentials,
    SatuCatalogCache satuCatalogCache,
    SatuProductRepository satuProductRepository,
    ISatuProductSyncCoordinator satuProductSyncCoordinator,
    IKaspiProductSyncCoordinator kaspiProductSyncCoordinator,
    SatuAnalyticsCacheService satuAnalyticsCacheService)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<IReadOnlyList<OzonProductSummary>> GetProductsAsync(string marketplace, CancellationToken cancellationToken)
    {
        var credentialSet = EnsureConfigured(marketplace);
        var normalized = MarketplaceTypes.NormalizeKzMarketplace(marketplace);

        if (normalized == MarketplaceTypes.Satu)
        {
            return await satuProductRepository.GetActiveProductsAsync(credentialSet.MerchantId, cancellationToken);
        }

        return (await GetProductsPageAsync(marketplace, null, null, 0, 0, cancellationToken)).Items;
    }

    public async Task<KzProductsPage> GetProductsPageAsync(
        string marketplace,
        string? status,
        string? search,
        int skip,
        int take,
        CancellationToken cancellationToken)
    {
        var credentialSet = EnsureConfigured(marketplace);
        var normalized = MarketplaceTypes.NormalizeKzMarketplace(marketplace);

        if (normalized == MarketplaceTypes.Satu)
        {
            var page = await satuProductRepository.GetProductsPageAsync(
                credentialSet.MerchantId,
                status,
                search,
                skip,
                take,
                cancellationToken);

            await EnsureSatuSyncScheduledAsync(credentialSet.MerchantId, page, cancellationToken);
            return page;
        }

        IReadOnlyList<OzonProductSummary> products;
        string? message = null;

        if (normalized == MarketplaceTypes.Kaspi)
        {
            var kaspiResult = await GetKaspiProductsForPageAsync(credentialSet, cancellationToken);
            products = kaspiResult.Products;
            message = kaspiResult.Message;
        }
        else
        {
            products = normalized switch
            {
                MarketplaceTypes.Halyk => await GetGenericProductsAsync(normalized, credentialSet, cancellationToken),
                _ => (IReadOnlyList<OzonProductSummary>)[]
            };
        }

        var summary = BuildCatalogSummary(products);
        var filtered = FilterProductsBySearch(
            FilterProductsByStatus(products, status),
            search);
        var items = filtered
            .Skip(Math.Max(0, skip))
            .Take(take <= 0 ? filtered.Count : Math.Clamp(take, 1, 500))
            .ToList();

        return new KzProductsPage(
            summary.Total,
            summary.Selling,
            summary.Ready,
            summary.Archived,
            filtered.Count,
            items,
            message);
    }

    public async Task<IReadOnlyList<OzonStockSummary>> GetStocksAsync(string marketplace, CancellationToken cancellationToken)
    {
        var normalized = MarketplaceTypes.NormalizeKzMarketplace(marketplace);
        if (normalized == MarketplaceTypes.Kaspi)
        {
            var credentialSet = EnsureConfigured(marketplace);
            var catalogItems = await GetKaspiProductCatalogItemsForReadAsync(credentialSet, cancellationToken);
            return catalogItems.Select(item =>
            {
                var product = item.Summary;
                return new OzonStockSummary(
                    product.ProductId,
                    product.OfferId,
                    product.Sku,
                    product.Name,
                    product.Price,
                    product.OldPrice,
                    product.MinPrice,
                    product.CurrencyCode,
                    item.Stock,
                    item.Stock,
                    product.ProductUrl,
                    product.ImageUrl);
            }).ToList();
        }

        var products = await GetProductsAsync(marketplace, cancellationToken);
        return products.Select(product => new OzonStockSummary(
            product.ProductId,
            product.OfferId,
            product.Sku,
            product.Name,
            product.Price,
            product.OldPrice,
            product.MinPrice,
            product.CurrencyCode,
            0,
            0,
            product.ProductUrl,
            product.ImageUrl)).ToList();
    }

    public async Task<OzonPriceUpdateResult> UpdatePriceAsync(
        string marketplace,
        OzonPriceUpdateRequest request,
        CancellationToken cancellationToken)
    {
        EnsureConfigured(marketplace);
        var label = MarketplaceTypes.GetDisplayName(marketplace);
        return new OzonPriceUpdateResult(
            false,
            $"Обновление цен для {label} пока не реализовано. Сохраните ключи и проверьте подключение.",
            JsonDocument.Parse("{}").RootElement);
    }

    public async Task<OzonAnalyticsResult> GetAnalyticsAsync(
        string marketplace,
        DateOnly from,
        DateOnly to,
        bool forceRefresh,
        CancellationToken cancellationToken)
    {
        var normalized = MarketplaceTypes.NormalizeKzMarketplace(marketplace);
        var credentialSet = EnsureConfigured(marketplace);

        if (normalized == MarketplaceTypes.Satu)
        {
            if (!forceRefresh)
            {
                var cached = await satuAnalyticsCacheService.TryGetAnalyticsAsync(
                    credentialSet.MerchantId,
                    from,
                    to,
                    allowStale: true,
                    cancellationToken);
                if (cached is not null)
                {
                    return cached;
                }
            }

            var summary = await satuProductRepository.GetCatalogSummaryAsync(credentialSet.MerchantId, cancellationToken);
            var stats = new SatuCatalogStats
            {
                Total = summary.Total,
                Selling = summary.Selling,
                Ready = summary.Ready,
                Archived = summary.Archived
            };

            var result = await SatuAnalyticsBuilder.BuildAnalyticsAsync(
                httpClient,
                credentialSet.ApiKey,
                credentialSet.MerchantId,
                from,
                to,
                _ => Task.FromResult(stats),
                ct => satuCatalogCache.GetOrdersAsync(httpClient, credentialSet.ApiKey, from, to, ct),
                cancellationToken);

            await satuAnalyticsCacheService.SaveAnalyticsAsync(
                credentialSet.MerchantId,
                from,
                to,
                result,
                cancellationToken);

            return result;
        }

        if (normalized == MarketplaceTypes.Kaspi)
        {
            var cacheShopId = BuildMarketplaceCacheShopId(MarketplaceTypes.Kaspi, credentialSet.MerchantId);
            if (!forceRefresh)
            {
                var cached = await satuAnalyticsCacheService.TryGetAnalyticsAsync(
                    cacheShopId,
                    from,
                    to,
                    allowStale: true,
                    cancellationToken);
                if (cached is not null)
                {
                    return cached;
                }
            }

            var result = await BuildKaspiAnalyticsAsync(credentialSet, from, to, cancellationToken);
            await SaveKaspiSnapshotFromAnalyticsAsync(cacheShopId, result, cancellationToken);
            await satuAnalyticsCacheService.SaveAnalyticsAsync(
                cacheShopId,
                from,
                to,
                result,
                cancellationToken);

            return result;
        }

        return CreateEmptyAnalytics();
    }

    public async Task<IReadOnlyList<KzAccountingSalesChannelRow>> GetKaspiSalesChannelRowsAsync(
        DateOnly from,
        DateOnly to,
        CancellationToken cancellationToken)
    {
        var credentialSet = EnsureConfigured(MarketplaceTypes.Kaspi);
        var allOrders = await GetKaspiOrdersForPeriodAsync(credentialSet, from, to, cancellationToken);

        var periodStart = ToKaspiUnixMilliseconds(from, startOfDay: true);
        var periodEnd = ToKaspiUnixMilliseconds(to, startOfDay: false);
        var activeOrders = allOrders
            .Where(order => order.CreationDate >= periodStart && order.CreationDate <= periodEnd)
            .Where(order => NormalizeKaspiOrderStatus(order.Status) != "cancelled")
            .ToList();

        var rows = new[]
        {
            new { Id = "kaspi-express", Channel = "Kaspi Express" },
            new { Id = "kaspi-zamler", Channel = "Kaspi Zamler" },
            new { Id = "kaspi-pickup", Channel = "Kaspi pickup" }
        };

        return rows
            .Select(row =>
            {
                var orders = activeOrders
                    .Where(order => string.Equals(ClassifyKaspiSalesChannel(order), row.Id, StringComparison.OrdinalIgnoreCase))
                    .ToList();

                return new KzAccountingSalesChannelRow(
                    row.Id,
                    row.Channel,
                    orders.Count,
                    orders.Sum(order => order.TotalPrice),
                    null);
            })
            .ToList();
    }

    public async Task<KzUnsoldProductsPage> GetUnsoldProductsPageAsync(
        string marketplace,
        DateOnly from,
        DateOnly to,
        int skip,
        int take,
        CancellationToken cancellationToken)
    {
        var normalized = MarketplaceTypes.NormalizeKzMarketplace(marketplace);
        var credentialSet = EnsureConfigured(marketplace);

        if (normalized == MarketplaceTypes.Kaspi)
        {
            var kaspiProducts = await GetKaspiProductCatalogItemsForReadAsync(credentialSet, cancellationToken);
            var allOrders = await GetKaspiOrdersForPeriodAsync(credentialSet, from, to, cancellationToken);

            var soldOfferCodes = allOrders
                .Where(order => NormalizeKaspiOrderStatus(order.Status) != "cancelled")
                .SelectMany(order => order.Entries)
                .Select(entry => entry.OfferCode)
                .Where(code => !string.IsNullOrWhiteSpace(code))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var unsold = kaspiProducts
                .Where(item => !soldOfferCodes.Contains(item.Summary.OfferId))
                .OrderBy(item => item.Summary.OfferId, StringComparer.OrdinalIgnoreCase)
                .ThenBy(item => item.Summary.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();

            var kaspiUnsoldItems = unsold
                .Skip(Math.Max(0, skip))
                .Take(Math.Clamp(take, 1, 500))
                .Select(item => new OzonUnsoldProductRow(
                    item.Summary.Sku ?? 0,
                    item.Summary.OfferId,
                    item.Summary.Name,
                    item.Summary.Price,
                    item.Summary.CurrencyCode,
                    item.Stock,
                    item.Summary.Status,
                    item.Summary.ImageUrl))
                .ToList();

            return new KzUnsoldProductsPage(unsold.Count, kaspiUnsoldItems);
        }

        if (normalized != MarketplaceTypes.Satu)
        {
            return new KzUnsoldProductsPage(0, []);
        }

        var products = await satuProductRepository.GetActiveProductsAsync(credentialSet.MerchantId, cancellationToken);
        var orders = await satuCatalogCache.GetOrdersAsync(httpClient, credentialSet.ApiKey, from, to, cancellationToken);
        var (total, items) = await SatuAnalyticsBuilder.BuildUnsoldPageAsync(products, orders, skip, take);

        return new KzUnsoldProductsPage(total, items);
    }

    public async Task<OzonAnalyticsSnapshot> GetAnalyticsSnapshotAsync(
        string marketplace,
        CancellationToken cancellationToken)
    {
        var normalized = MarketplaceTypes.NormalizeKzMarketplace(marketplace);
        var credentialSet = EnsureConfigured(marketplace);

        if (normalized == MarketplaceTypes.Satu)
        {
            var cached = await satuAnalyticsCacheService.TryGetSnapshotAsync(credentialSet.MerchantId, cancellationToken);
            if (cached is not null)
            {
                return cached;
            }

            var catalogSummary = await satuProductRepository.GetCatalogSummaryAsync(credentialSet.MerchantId, cancellationToken);
            var snapshot = new OzonAnalyticsSnapshot(
                catalogSummary.Total,
                catalogSummary.Selling,
                catalogSummary.Ready,
                catalogSummary.Archived,
                null,
                "KZT",
                DateTimeOffset.UtcNow.ToString("O"));

            await satuAnalyticsCacheService.SaveSnapshotAsync(credentialSet.MerchantId, snapshot, cancellationToken);
            return snapshot;
        }

        if (normalized == MarketplaceTypes.Kaspi)
        {
            var cacheShopId = BuildMarketplaceCacheShopId(MarketplaceTypes.Kaspi, credentialSet.MerchantId);
            var cached = await satuAnalyticsCacheService.TryGetSnapshotAsync(cacheShopId, cancellationToken);
            if (cached is not null && cached.TotalProductsCount > 0)
            {
                return cached;
            }

            var cachedProducts = await satuAnalyticsCacheService.TryGetKaspiProductsAsync(
                credentialSet.MerchantId,
                allowStale: true,
                cancellationToken);
            if (cachedProducts is not null)
            {
                var cachedSummary = BuildCatalogSummary(cachedProducts.Select(item => item.Summary).ToList());
                var cachedSnapshot = new OzonAnalyticsSnapshot(
                    cachedSummary.Total,
                    cachedSummary.Selling,
                    cachedSummary.Ready,
                    cachedSummary.Archived,
                    null,
                    "KZT",
                    DateTimeOffset.UtcNow.ToString("O"));

                await satuAnalyticsCacheService.SaveSnapshotAsync(cacheShopId, cachedSnapshot, cancellationToken);
                return cachedSnapshot;
            }

            try
            {
                var products = (await GetKaspiProductCatalogItemsForReadAsync(credentialSet, cancellationToken))
                    .Select(item => item.Summary)
                    .ToList();
                var kaspiSummary = BuildCatalogSummary(products);
                var snapshot = new OzonAnalyticsSnapshot(
                    kaspiSummary.Total,
                    kaspiSummary.Selling,
                    kaspiSummary.Ready,
                    kaspiSummary.Archived,
                    null,
                    "KZT",
                    DateTimeOffset.UtcNow.ToString("O"));

                await satuAnalyticsCacheService.SaveSnapshotAsync(cacheShopId, snapshot, cancellationToken);
                return snapshot;
            }
            catch
            {
                var today = DateOnly.FromDateTime(DateTime.UtcNow);
                var monthStart = new DateOnly(today.Year, today.Month, 1);
                var cachedAnalytics = await satuAnalyticsCacheService.TryGetAnalyticsAsync(
                    cacheShopId,
                    monthStart,
                    today,
                    allowStale: true,
                    cancellationToken);
                if (cachedAnalytics is not null)
                {
                    var fallbackSnapshot = BuildKaspiSnapshotFromAnalytics(cachedAnalytics);
                    await satuAnalyticsCacheService.SaveSnapshotAsync(cacheShopId, fallbackSnapshot, cancellationToken);
                    return fallbackSnapshot;
                }

                return new OzonAnalyticsSnapshot(0, 0, 0, 0, null, "KZT", DateTimeOffset.UtcNow.ToString("O"));
            }
        }

        var summary = await GetCatalogSummaryAsync(marketplace, cancellationToken);
        return new OzonAnalyticsSnapshot(
            summary.Total,
            summary.Selling,
            summary.Ready,
            summary.Archived,
            null,
            "KZT",
            DateTimeOffset.UtcNow.ToString("O"));
    }

    public static OzonAnalyticsResult CreateEmptyAnalytics(string currencyCode = "KZT") =>
        new(
            [],
            [],
            [],
            [],
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            null,
            currencyCode,
            0,
            0,
            0,
            DateTimeOffset.UtcNow.ToString("O"));

    public async Task<KzCatalogSummary> GetCatalogSummaryAsync(string marketplace, CancellationToken cancellationToken)
    {
        var normalized = MarketplaceTypes.NormalizeKzMarketplace(marketplace);
        var credentialSet = EnsureConfigured(marketplace);

        if (normalized == MarketplaceTypes.Satu)
        {
            return await satuProductRepository.GetCatalogSummaryAsync(credentialSet.MerchantId, cancellationToken);
        }

        var products = await GetProductsAsync(marketplace, cancellationToken);
        return BuildCatalogSummary(products);
    }

    public async Task<KzMarketplaceTestResult> TestConnectionAsync(string marketplace, CancellationToken cancellationToken)
    {
        var credentialSet = EnsureConfigured(marketplace);
        var label = MarketplaceTypes.GetDisplayName(marketplace);

        try
        {
            if (MarketplaceTypes.NormalizeKzMarketplace(marketplace) == MarketplaceTypes.Satu)
            {
                var summary = await GetCatalogSummaryAsync(marketplace, cancellationToken);
                var localCount = summary.Total;
                if (localCount == 0)
                {
                    var firstPage = await SatuApiClient.GetProductsPageAsync(httpClient, credentialSet.ApiKey, 0, cancellationToken);
                    if (firstPage.Count == 0)
                    {
                        return new KzMarketplaceTestResult(true, $"{label} API отвечает. Локальный каталог пуст — запущен импорт.");
                    }
                }

                return new KzMarketplaceTestResult(
                    true,
                    $"{label} API отвечает. Товаров в локальном каталоге: {localCount}");
            }

            if (MarketplaceTypes.NormalizeKzMarketplace(marketplace) == MarketplaceTypes.Kaspi)
            {
                var today = DateOnly.FromDateTime(DateTime.UtcNow);
                var from = today.AddDays(-14);
                var orders = await GetKaspiOrdersAsync(credentialSet, from, today, 0, 1, cancellationToken);
                return new KzMarketplaceTestResult(
                    true,
                    $"{label} API отвечает. Заказов за последние 14 дней: {orders.TotalCount}");
            }

            var catalogProducts = await GetProductsAsync(marketplace, cancellationToken);
            return new KzMarketplaceTestResult(
                true,
                $"{label} API отвечает. Товаров в каталоге: {catalogProducts.Count}");
        }
        catch (Exception exception)
        {
            return new KzMarketplaceTestResult(false, exception.Message);
        }
    }

    public async Task<SatuSyncStatusResponse> GetSatuSyncStatusAsync(CancellationToken cancellationToken)
    {
        var credentialSet = EnsureConfigured(MarketplaceTypes.Satu);
        return await satuProductSyncCoordinator.GetStatusAsync(credentialSet.MerchantId, cancellationToken);
    }

    public void RequestSatuSync(bool fullSync)
    {
        var credentialSet = EnsureConfigured(MarketplaceTypes.Satu);
        satuProductSyncCoordinator.RequestSync(credentialSet.MerchantId, fullSync);
    }

    private async Task EnsureSatuSyncScheduledAsync(
        string shopId,
        KzProductsPage page,
        CancellationToken cancellationToken)
    {
        var status = await satuProductSyncCoordinator.GetStatusAsync(shopId, cancellationToken);
        if (status.Status == SatuSyncStatuses.InProgress)
        {
            return;
        }

        if (page.Items.Count == 0 && status.LocalProductCount == 0)
        {
            satuProductSyncCoordinator.RequestSync(shopId, fullSync: true);
        }
    }

    private KzMarketplaceCredentialSet EnsureConfigured(string marketplace)
    {
        var credentialSet = credentials.Get(marketplace);
        if (!credentialSet.IsConfigured)
        {
            throw new InvalidOperationException(
                $"Сначала сохраните ID и API Key для {MarketplaceTypes.GetDisplayName(marketplace)}.");
        }

        return credentialSet;
    }

    private async Task<OzonAnalyticsResult> BuildKaspiAnalyticsAsync(
        KzMarketplaceCredentialSet credentialSet,
        DateOnly from,
        DateOnly to,
        CancellationToken cancellationToken)
    {
        var allOrders = await GetKaspiOrdersForPeriodAsync(credentialSet, from, to, cancellationToken);

        var periodStart = ToKaspiUnixMilliseconds(from, startOfDay: true);
        var periodEnd = ToKaspiUnixMilliseconds(to, startOfDay: false);
        allOrders = allOrders
            .Where(order => order.CreationDate >= periodStart && order.CreationDate <= periodEnd)
            .ToList();

        var rows = new List<OzonAnalyticsRow>();
        foreach (var order in allOrders)
        {
            var rowStatus = NormalizeKaspiOrderStatus(order.Status);
            if (order.Entries.Count == 0)
            {
                rows.Add(new OzonAnalyticsRow(
                    0,
                    order.Code,
                    $"Kaspi заказ {order.Code}",
                    rowStatus,
                    order.Code,
                    1,
                    order.TotalPrice,
                    0,
                    0,
                    rowStatus == "cancelled" ? 0 : order.TotalPrice - order.DeliveryCostForSeller,
                    "KZT",
                    order.DeliveryCostForSeller,
                    DateTimeOffset.FromUnixTimeMilliseconds(order.CreationDate).ToString("O")));
                continue;
            }

            foreach (var entry in order.Entries)
            {
                rows.Add(new OzonAnalyticsRow(
                    0,
                    entry.OfferCode,
                    entry.ProductName,
                    rowStatus,
                    order.Code,
                    entry.Quantity,
                    entry.TotalPrice,
                    0,
                    0,
                    rowStatus == "cancelled" ? 0 : entry.TotalPrice,
                    "KZT",
                    0,
                    DateTimeOffset.FromUnixTimeMilliseconds(order.CreationDate).ToString("O")));
            }
        }

        var activeRows = rows.Where(row => row.Status != "cancelled").ToList();
        var deliveredRows = rows.Where(row => row.Status == "delivered").ToList();
        var awaitingRows = rows.Where(row => row.Status == "awaiting_deliver").ToList();
        var deliveringRows = rows.Where(row => row.Status == "delivering").ToList();
        var inTransitRows = awaitingRows.Concat(deliveringRows).ToList();
        var cancelledRows = rows.Where(row => row.Status == "cancelled").ToList();
        var logisticsTotal = allOrders.Sum(order => order.DeliveryCostForSeller);
        var deliveredOrderCodes = allOrders
            .Where(order => NormalizeKaspiOrderStatus(order.Status) == "delivered")
            .Select(order => order.Code)
            .Distinct()
            .Count();

        var topProducts = rows
            .Where(row => row.Status != "cancelled")
            .GroupBy(row => string.IsNullOrWhiteSpace(row.OfferId) ? row.ProductName : row.OfferId)
            .Select(group =>
            {
                var first = group.First();
                return new OzonTopProductRow(
                    first.Sku,
                    first.OfferId,
                    first.ProductName,
                    group.Sum(row => row.Quantity),
                    group.Sum(row => row.Revenue),
                    "KZT",
                    0);
            })
            .OrderByDescending(row => row.Quantity)
            .ThenByDescending(row => row.Revenue)
            .ToList();

        return new OzonAnalyticsResult(
            rows,
            rows,
            topProducts,
            [],
            rows.Sum(row => row.Quantity),
            activeRows.Sum(row => row.Revenue),
            0,
            activeRows.Sum(row => row.Payout) - logisticsTotal,
            logisticsTotal,
            0,
            awaitingRows.Select(row => row.PostingNumber).Distinct().Count(),
            awaitingRows.Sum(row => row.Revenue),
            deliveringRows.Select(row => row.PostingNumber).Distinct().Count(),
            deliveredOrderCodes,
            allOrders.Count,
            rows.Sum(row => row.Revenue),
            inTransitRows.Sum(row => row.Quantity),
            inTransitRows.Sum(row => row.Revenue),
            deliveredRows.Sum(row => row.Quantity),
            deliveredRows.Sum(row => row.Revenue),
            cancelledRows.Select(row => row.PostingNumber).Distinct().Count(),
            cancelledRows.Sum(row => row.Revenue),
            0,
            cancelledRows.Sum(row => row.Revenue),
            null,
            "KZT",
            0,
            0,
            0,
            DateTimeOffset.UtcNow.ToString("O"));
    }

    private async Task<KaspiOrdersPage> GetKaspiOrdersAsync(
        KzMarketplaceCredentialSet credentialSet,
        DateOnly from,
        DateOnly to,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var fromMillis = ToKaspiUnixMilliseconds(from, startOfDay: true);
        var toMillis = ToKaspiUnixMilliseconds(to, startOfDay: false);
        var url =
            "https://kaspi.kz/shop/api/v2/orders" +
            $"?filter[orders][creationDate][$ge]={fromMillis}" +
            $"&filter[orders][creationDate][$le]={toMillis}" +
            "&include[orders]=entries" +
            $"&page[number]={page}" +
            $"&page[size]={Math.Clamp(pageSize, 1, 100)}";

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Add("X-Auth-Token", credentialSet.ApiKey);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.api+json"));

        using var response = await httpClient.SendAsync(request, cancellationToken);
        var content = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Kaspi API returned {(int)response.StatusCode}: {content}",
                null,
                response.StatusCode);
        }

        return ParseKaspiOrdersPayload(content);
    }

    private async Task<List<KaspiOrder>> GetKaspiOrdersForPeriodAsync(
        KzMarketplaceCredentialSet credentialSet,
        DateOnly from,
        DateOnly to,
        CancellationToken cancellationToken)
    {
        var ordersById = new Dictionary<string, KaspiOrder>(StringComparer.OrdinalIgnoreCase);
        foreach (var (chunkFrom, chunkTo) in SplitKaspiOrderDateRange(from, to))
        {
            IReadOnlyList<KaspiOrder> pageOrders;
            var page = 0;
            const int pageSize = 100;
            var totalCount = 0;
            var chunkOrdersCount = 0;

            do
            {
                var result = await GetKaspiOrdersAsync(
                    credentialSet,
                    chunkFrom,
                    chunkTo,
                    page,
                    pageSize,
                    cancellationToken);
                pageOrders = result.Orders;
                totalCount = result.TotalCount;
                foreach (var order in pageOrders)
                {
                    ordersById[order.Id] = order;
                }

                chunkOrdersCount += pageOrders.Count;
                page++;
            }
            while (pageOrders.Count == pageSize && chunkOrdersCount < totalCount && page < 1000);
        }

        return ordersById.Values
            .OrderByDescending(order => order.CreationDate)
            .ToList();
    }

    private static IEnumerable<(DateOnly From, DateOnly To)> SplitKaspiOrderDateRange(DateOnly from, DateOnly to)
    {
        var current = from;
        while (current <= to)
        {
            var chunkTo = current.AddDays(13);
            if (chunkTo > to)
            {
                chunkTo = to;
            }

            yield return (current, chunkTo);
            current = chunkTo.AddDays(1);
        }
    }

    private static long ToKaspiUnixMilliseconds(DateOnly date, bool startOfDay)
    {
        var local = startOfDay
            ? date.ToDateTime(TimeOnly.MinValue)
            : date.ToDateTime(new TimeOnly(23, 59, 59));
        return new DateTimeOffset(local, TimeSpan.FromHours(5)).ToUnixTimeMilliseconds();
    }

    private static KaspiOrdersPage ParseKaspiOrdersPayload(string content)
    {
        using var document = JsonDocument.Parse(content);
        var root = document.RootElement;
        var entriesByOrderId = new Dictionary<string, List<KaspiOrderEntry>>(StringComparer.OrdinalIgnoreCase);

        if (root.TryGetProperty("included", out var included) && included.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in included.EnumerateArray())
            {
                if (!string.Equals(ReadString(item, "type"), "orderentries", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var id = ReadString(item, "id") ?? string.Empty;
                var orderId = id.Split('#')[0];
                if (string.IsNullOrWhiteSpace(orderId) ||
                    !item.TryGetProperty("attributes", out var attributes) ||
                    attributes.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                var offerCode = string.Empty;
                var productName = string.Empty;
                if (attributes.TryGetProperty("offer", out var offer) && offer.ValueKind == JsonValueKind.Object)
                {
                    offerCode = ReadString(offer, "code") ?? string.Empty;
                    productName = ReadString(offer, "name") ?? string.Empty;
                }

                if (string.IsNullOrWhiteSpace(productName) &&
                    attributes.TryGetProperty("category", out var category) &&
                    category.ValueKind == JsonValueKind.Object)
                {
                    productName = ReadString(category, "title") ?? string.Empty;
                }

                var entry = new KaspiOrderEntry(
                    offerCode,
                    string.IsNullOrWhiteSpace(productName) ? offerCode : productName,
                    ReadDecimal(attributes, "quantity"),
                    ReadDecimal(attributes, "basePrice"),
                    ReadDecimal(attributes, "totalPrice"));

                if (!entriesByOrderId.TryGetValue(orderId, out var orderEntries))
                {
                    orderEntries = [];
                    entriesByOrderId[orderId] = orderEntries;
                }

                orderEntries.Add(entry);
            }
        }

        var orders = new List<KaspiOrder>();
        if (root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in data.EnumerateArray())
            {
                if (!item.TryGetProperty("attributes", out var attributes) ||
                    attributes.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                var id = ReadString(item, "id") ?? string.Empty;
                entriesByOrderId.TryGetValue(id, out var orderEntries);
                orders.Add(new KaspiOrder(
                    id,
                    ReadString(attributes, "code") ?? id,
                    ReadLong(attributes, "creationDate") ?? 0,
                    ReadString(attributes, "status") ?? string.Empty,
                    ReadString(attributes, "state") ?? string.Empty,
                    ReadString(attributes, "deliveryMode") ?? string.Empty,
                    ReadString(attributes, "paymentMode") ?? string.Empty,
                    ReadBool(attributes, "isKaspiDelivery"),
                    ReadString(attributes, "pickupPointId") ?? string.Empty,
                    ReadDecimal(attributes, "totalPrice"),
                    ReadDecimal(attributes, "deliveryCostForSeller"),
                    orderEntries ?? []));
            }
        }

        var totalCount = orders.Count;
        if (root.TryGetProperty("meta", out var meta) && meta.ValueKind == JsonValueKind.Object)
        {
            totalCount = (int)(ReadLong(meta, "totalCount") ?? totalCount);
        }

        return new KaspiOrdersPage(totalCount, orders);
    }

    private static string NormalizeKaspiOrderStatus(string status)
    {
        var normalized = status.Trim().ToUpperInvariant();
        return normalized switch
        {
            "CANCELLED" or "CANCELLING" or "RETURNED" => "cancelled",
            "COMPLETED" => "delivered",
            "DELIVERY" or "TRANSMITTED_TO_DELIVERY" or "KASPI_DELIVERY_RETURN_REQUESTED" => "delivering",
            _ => "awaiting_deliver"
        };
    }

    private static string ClassifyKaspiSalesChannel(KaspiOrder order)
    {
        var deliveryMode = (order.DeliveryMode ?? string.Empty).Trim().ToUpperInvariant();
        var paymentMode = (order.PaymentMode ?? string.Empty).Trim().ToUpperInvariant();
        var status = (order.Status ?? string.Empty).Trim().ToUpperInvariant();
        var state = (order.State ?? string.Empty).Trim().ToUpperInvariant();
        var pickupPointId = (order.PickupPointId ?? string.Empty).Trim().ToUpperInvariant();
        var raw = string.Join(' ', deliveryMode, paymentMode, status, state, pickupPointId);

        if (ContainsAny(raw, "ZAMLER", "POSTOMAT", "POSTAMAT", "LOCKER", "PARCEL", "PVZ"))
        {
            return "kaspi-zamler";
        }

        if (ContainsAny(raw, "PICKUP", "SELF_PICKUP", "SAMOVYVOZ", "SELF") && !ContainsAny(raw, "ZAMLER", "POSTOMAT", "POSTAMAT"))
        {
            return "kaspi-pickup";
        }

        if (order.IsKaspiDelivery || ContainsAny(raw, "DELIVERY", "COURIER", "EXPRESS", "KASPI"))
        {
            return "kaspi-express";
        }

        return "kaspi-express";
    }

    private static bool ContainsAny(string value, params string[] needles) =>
        needles.Any(needle => value.Contains(needle, StringComparison.OrdinalIgnoreCase));

    private async Task<IReadOnlyList<OzonProductSummary>> GetKaspiProductsAsync(
        KzMarketplaceCredentialSet credentialSet,
        CancellationToken cancellationToken)
    {
        var catalogItems = await GetKaspiProductCatalogItemsAsync(credentialSet, cancellationToken);
        return catalogItems.Select(item => item.Summary).ToList();
    }

    private async Task<KaspiProductsPageSource> GetKaspiProductsForPageAsync(
        KzMarketplaceCredentialSet credentialSet,
        CancellationToken cancellationToken)
    {
        var fresh = await satuAnalyticsCacheService.TryGetKaspiProductsAsync(
            credentialSet.MerchantId,
            allowStale: false,
            cancellationToken);
        if (fresh is not null)
        {
            var freshProducts = FilterKaspiCatalogProducts(fresh.Select(item => item.Summary)).ToList();
            if (freshProducts.Count > 0)
            {
                return new KaspiProductsPageSource(
                    freshProducts,
                    null);
            }
        }

        kaspiProductSyncCoordinator.RequestSync(credentialSet.MerchantId);

        var stale = await satuAnalyticsCacheService.TryGetKaspiProductsAsync(
            credentialSet.MerchantId,
            allowStale: true,
            cancellationToken);
        if (stale is not null)
        {
            var staleProducts = FilterKaspiCatalogProducts(stale.Select(item => item.Summary)).ToList();
            if (staleProducts.Count == 0)
            {
                var staleSyncStatus = kaspiProductSyncCoordinator.GetStatus(credentialSet.MerchantId);
                return new KaspiProductsPageSource(
                    [],
                    string.IsNullOrWhiteSpace(staleSyncStatus.Message)
                        ? "Полный каталог Kaspi загружается в фоне. Обновите страницу через несколько минут."
                        : staleSyncStatus.Message);
            }

            var status = kaspiProductSyncCoordinator.GetStatus(credentialSet.MerchantId);
            return new KaspiProductsPageSource(
                staleProducts,
                string.IsNullOrWhiteSpace(status.Message)
                    ? "Каталог Kaspi обновляется в фоне. Показан последний сохранённый каталог."
                    : status.Message);
        }

        var analyticsProducts = await GetKaspiProductsFromCachedAnalyticsAsync(credentialSet, cancellationToken);
        if (analyticsProducts.Count > 0)
        {
            await SaveKaspiProductSummariesAsync(credentialSet.MerchantId, analyticsProducts, cancellationToken);
            return new KaspiProductsPageSource(
                analyticsProducts,
                "Полный каталог Kaspi обновляется в фоне. Пока показаны товары из сохраненной аналитики.");
        }

        try
        {
            var orderProducts = await GetKaspiProductsFromRecentOrdersAsync(credentialSet, cancellationToken);
            if (orderProducts.Count > 0)
            {
                await SaveKaspiProductSummariesAsync(credentialSet.MerchantId, orderProducts, cancellationToken);
                return new KaspiProductsPageSource(
                    orderProducts,
                    "Полный каталог Kaspi обновляется в фоне. Пока показаны товары из заказов за последние 14 дней.");
            }
        }
        catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
        {
            var status = kaspiProductSyncCoordinator.GetStatus(credentialSet.MerchantId);
            return new KaspiProductsPageSource(
                [],
                string.IsNullOrWhiteSpace(status.Message)
                    ? $"Не удалось получить данные Kaspi: {exception.Message}"
                    : status.Message);
        }

        var syncStatus = kaspiProductSyncCoordinator.GetStatus(credentialSet.MerchantId);
        return new KaspiProductsPageSource(
            [],
            string.IsNullOrWhiteSpace(syncStatus.Message)
                ? "Полный каталог Kaspi загружается в фоне. Обновите страницу через несколько минут."
                : syncStatus.Message);
    }

    public async Task<KzCatalogSummary> RefreshKaspiProductCatalogAsync(CancellationToken cancellationToken)
    {
        var credentialSet = EnsureConfigured(MarketplaceTypes.Kaspi);
        var catalogItems = await FetchKaspiProductCatalogItemsFromRemoteAsync(credentialSet, cancellationToken);
        await satuAnalyticsCacheService.SaveKaspiProductsAsync(
            credentialSet.MerchantId,
            catalogItems,
            cancellationToken);

        return BuildCatalogSummary(catalogItems.Select(item => item.Summary).ToList());
    }

    private async Task<IReadOnlyList<OzonProductSummary>> GetKaspiProductsFromCachedAnalyticsAsync(
        KzMarketplaceCredentialSet credentialSet,
        CancellationToken cancellationToken)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(5));
        var monthStart = new DateOnly(today.Year, today.Month, 1);
        var cacheShopId = BuildMarketplaceCacheShopId(MarketplaceTypes.Kaspi, credentialSet.MerchantId);
        var cachedAnalytics = await satuAnalyticsCacheService.TryGetAnalyticsAsync(
            cacheShopId,
            monthStart,
            today,
            allowStale: true,
            cancellationToken);

        if (cachedAnalytics is null)
        {
            return [];
        }

        return cachedAnalytics.Rows
            .Where(row => !string.IsNullOrWhiteSpace(row.OfferId) || !string.IsNullOrWhiteSpace(row.ProductName))
            .GroupBy(row => string.IsNullOrWhiteSpace(row.OfferId) ? row.ProductName : row.OfferId, StringComparer.OrdinalIgnoreCase)
            .Select((group, index) =>
            {
                var first = group.First();
                var offerId = string.IsNullOrWhiteSpace(first.OfferId) ? $"kaspi-analytics-{index + 1}" : first.OfferId;
                var sku = first.Sku;
                var name = string.IsNullOrWhiteSpace(first.ProductName) ? offerId : first.ProductName;
                var quantity = group.Sum(row => row.Quantity);
                var revenue = group.Sum(row => row.Revenue);
                var price = quantity > 0 ? Math.Round(revenue / quantity, 2) : 0;

                return new OzonProductSummary(
                    index + 1,
                    offerId,
                    sku,
                    name,
                    price,
                    0,
                    0,
                    first.CurrencyCode,
                    "selling",
                    BuildFallbackProductUrl(MarketplaceTypes.Kaspi, credentialSet.MerchantId, offerId),
                    string.Empty);
            })
            .OrderBy(product => product.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private async Task SaveKaspiProductSummariesAsync(
        string merchantId,
        IReadOnlyList<OzonProductSummary> products,
        CancellationToken cancellationToken)
    {
        var catalogItems = products
            .Select(product => new KaspiProductCatalogItem(product, 0))
            .ToList();
        await satuAnalyticsCacheService.SaveKaspiProductsAsync(merchantId, catalogItems, cancellationToken);
    }

    private static IEnumerable<OzonProductSummary> FilterKaspiCatalogProducts(IEnumerable<OzonProductSummary> products) =>
        products.Where(product => !IsKaspiOrderFallbackProduct(product));

    private static IEnumerable<KaspiProductCatalogItem> FilterKaspiCatalogItems(IEnumerable<KaspiProductCatalogItem> products) =>
        products.Where(product => !IsKaspiOrderFallbackProduct(product.Summary));

    private static bool IsKaspiOrderFallbackProduct(OzonProductSummary product) =>
        product.OfferId.StartsWith("kaspi-order-", StringComparison.OrdinalIgnoreCase) ||
        product.Name.StartsWith("Kaspi заказ ", StringComparison.OrdinalIgnoreCase);

    private async Task<IReadOnlyList<OzonProductSummary>> GetKaspiProductsFromRecentOrdersAsync(
        KzMarketplaceCredentialSet credentialSet,
        CancellationToken cancellationToken)
    {
        return [];

        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(5));
        // Kaspi rejects order date filters wider than 14 days.
        var from = today.AddDays(-13);
        var orders = new List<KaspiOrder>();
        const int pageSize = 100;
        const int maxPages = 120;

        for (var page = 0; page < maxPages; page++)
        {
            var result = await GetKaspiOrdersAsync(credentialSet, from, today, page, pageSize, cancellationToken);
            orders.AddRange(result.Orders);
            if (result.Orders.Count < pageSize || orders.Count >= result.TotalCount)
            {
                break;
            }
        }

        return orders
            .SelectMany(order => order.Entries)
            .Where(entry => !string.IsNullOrWhiteSpace(entry.OfferCode) || !string.IsNullOrWhiteSpace(entry.ProductName))
            .GroupBy(entry => string.IsNullOrWhiteSpace(entry.OfferCode) ? entry.ProductName : entry.OfferCode, StringComparer.OrdinalIgnoreCase)
            .Select((group, index) =>
            {
                var first = group.First();
                var offerId = string.IsNullOrWhiteSpace(first.OfferCode) ? $"kaspi-order-{index + 1}" : first.OfferCode;
                var name = string.IsNullOrWhiteSpace(first.ProductName) ? offerId : first.ProductName;
                var quantity = group.Sum(item => item.Quantity);
                var revenue = group.Sum(item => item.TotalPrice);
                var price = quantity > 0 ? Math.Round(revenue / quantity, 2) : first.BasePrice;

                return new OzonProductSummary(
                    index + 1,
                    offerId,
                    long.TryParse(offerId, out var sku) ? sku : null,
                    name,
                    price,
                    0,
                    0,
                    "KZT",
                    "selling",
                    BuildFallbackProductUrl(MarketplaceTypes.Kaspi, credentialSet.MerchantId, offerId),
                    string.Empty);
            })
            .OrderBy(product => product.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private async Task<IReadOnlyList<KaspiProductCatalogItem>> GetKaspiProductCatalogItemsAsync(
        KzMarketplaceCredentialSet credentialSet,
        CancellationToken cancellationToken)
    {
        var cached = await satuAnalyticsCacheService.TryGetKaspiProductsAsync(
            credentialSet.MerchantId,
            allowStale: false,
            cancellationToken);
        if (cached is not null)
        {
            return cached;
        }

        var result = await FetchKaspiProductCatalogItemsFromRemoteAsync(credentialSet, cancellationToken);
        await satuAnalyticsCacheService.SaveKaspiProductsAsync(
            credentialSet.MerchantId,
            result,
            cancellationToken);

        return result;
    }

    private async Task<IReadOnlyList<KaspiProductCatalogItem>> GetKaspiProductCatalogItemsForReadAsync(
        KzMarketplaceCredentialSet credentialSet,
        CancellationToken cancellationToken)
    {
        var fresh = await satuAnalyticsCacheService.TryGetKaspiProductsAsync(
            credentialSet.MerchantId,
            allowStale: false,
            cancellationToken);
        if (fresh is not null)
        {
            var filteredFresh = FilterKaspiCatalogItems(fresh).ToList();
            if (filteredFresh.Count > 0)
            {
                return filteredFresh;
            }
        }

        kaspiProductSyncCoordinator.RequestSync(credentialSet.MerchantId);

        var stale = await satuAnalyticsCacheService.TryGetKaspiProductsAsync(
            credentialSet.MerchantId,
            allowStale: true,
            cancellationToken);
        if (stale is not null)
        {
            var filteredStale = FilterKaspiCatalogItems(stale).ToList();
            if (filteredStale.Count > 0)
            {
                return filteredStale;
            }
        }

        return await GetKaspiFallbackCatalogItemsForReadAsync(credentialSet, cancellationToken);
    }

    private async Task<IReadOnlyList<KaspiProductCatalogItem>> GetKaspiFallbackCatalogItemsForReadAsync(
        KzMarketplaceCredentialSet credentialSet,
        CancellationToken cancellationToken)
    {
        var analyticsProducts = await GetKaspiProductsFromCachedAnalyticsAsync(credentialSet, cancellationToken);
        if (analyticsProducts.Count > 0)
        {
            var analyticsItems = analyticsProducts.Select(product => new KaspiProductCatalogItem(product, 0)).ToList();
            await satuAnalyticsCacheService.SaveKaspiProductsAsync(
                credentialSet.MerchantId,
                analyticsItems,
                cancellationToken);
            return analyticsItems;
        }

        try
        {
            var orderProducts = await GetKaspiProductsFromRecentOrdersAsync(credentialSet, cancellationToken);
            var orderItems = orderProducts.Select(product => new KaspiProductCatalogItem(product, 0)).ToList();
            if (orderItems.Count > 0)
            {
                await satuAnalyticsCacheService.SaveKaspiProductsAsync(
                    credentialSet.MerchantId,
                    orderItems,
                    cancellationToken);
            }

            return orderItems;
        }
        catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
        {
            return [];
        }
    }

    private async Task<IReadOnlyList<KaspiProductCatalogItem>> FetchKaspiProductCatalogItemsFromRemoteAsync(
        KzMarketplaceCredentialSet credentialSet,
        CancellationToken cancellationToken)
    {
        var items = new List<KaspiProductCatalogItem>();
        const int pageSize = 100;
        const int maxPages = 500;
        var pageDelay = TimeSpan.FromMilliseconds(650);

        for (var page = 0; page < maxPages; page++)
        {
            var url =
                "https://kaspi.kz/yml/product-view/pl/results" +
                $"?merchantId={Uri.EscapeDataString(credentialSet.MerchantId)}" +
                $"&page={page}" +
                $"&size={pageSize}";

            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            AddKaspiCatalogHeaders(request, credentialSet.MerchantId);

            var content = await SendKaspiCatalogRequestAsync(request, cancellationToken);

            var pageItems = ParseKaspiProductPayload(content);
            if (pageItems.Count == 0)
            {
                break;
            }

            items.AddRange(pageItems);
            if (pageItems.Count < pageSize)
            {
                break;
            }

            await Task.Delay(pageDelay, cancellationToken);
        }

        var result = items
            .GroupBy(item => item.Summary.OfferId, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToList();

        return result;
    }

    private static void AddKaspiCatalogHeaders(HttpRequestMessage request, string merchantId)
    {
        request.Headers.UserAgent.ParseAdd(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36");
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.Referrer = new Uri($"https://kaspi.kz/shop/search/?merchantId={Uri.EscapeDataString(merchantId)}");
    }

    private async Task<string> SendKaspiCatalogRequestAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        const int maxAttempts = 5;
        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            using var clonedRequest = CloneRequest(request);
            using var response = await httpClient.SendAsync(clonedRequest, cancellationToken);
            var content = await response.Content.ReadAsStringAsync(cancellationToken);

            if ((int)response.StatusCode != 429 || attempt == maxAttempts)
            {
                if (!response.IsSuccessStatusCode)
                {
                    if ((int)response.StatusCode == 429)
                    {
                        throw new HttpRequestException(
                            "Kaspi временно ограничил загрузку каталога товаров (429). Каталог продолжит обновляться в фоне.",
                            null,
                            response.StatusCode);
                    }

                    throw new HttpRequestException(
                        $"Kaspi catalog returned {(int)response.StatusCode}: {BuildSafeResponsePreview(content)}",
                        null,
                        response.StatusCode);
                }

                return content;
            }

            var retryAfter = response.Headers.RetryAfter?.Delta;
            await Task.Delay(retryAfter ?? TimeSpan.FromSeconds(attempt * 8), cancellationToken);
        }

        return string.Empty;
    }

    private static string BuildSafeResponsePreview(string content)
    {
        if (string.IsNullOrWhiteSpace(content))
        {
            return string.Empty;
        }

        var trimmed = content.Trim();
        if (trimmed.StartsWith("<!DOCTYPE", StringComparison.OrdinalIgnoreCase) ||
            trimmed.StartsWith("<html", StringComparison.OrdinalIgnoreCase))
        {
            return "Kaspi returned an HTML page instead of JSON.";
        }

        return trimmed.Length <= 300 ? trimmed : trimmed[..300] + "...";
    }

    private static HttpRequestMessage CloneRequest(HttpRequestMessage source)
    {
        var clone = new HttpRequestMessage(source.Method, source.RequestUri);
        foreach (var header in source.Headers)
        {
            clone.Headers.TryAddWithoutValidation(header.Key, header.Value);
        }

        return clone;
    }

    private static IReadOnlyList<KaspiProductCatalogItem> ParseKaspiProductPayload(string content)
    {
        if (string.IsNullOrWhiteSpace(content))
        {
            return [];
        }

        var trimmed = content.AsSpan().TrimStart();
        if (trimmed.Length == 0 || trimmed[0] is not ('{' or '['))
        {
            throw new JsonException("Kaspi returned non-JSON while loading product catalog.");
        }

        using var document = JsonDocument.Parse(content);
        if (!document.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var items = new List<KaspiProductCatalogItem>();
        var index = 1;
        foreach (var item in data.EnumerateArray())
        {
            var offerId = ReadString(item, "configSku", "id") ?? $"kaspi-{index}";
            var sku = ReadLong(item, "configSku", "id");
            var productId = ReadLong(item, "id", "configSku") ?? index;
            var name = ReadString(item, "title") ?? offerId;
            var salePrice = ReadDecimal(item, "unitSalePrice");
            var price = salePrice > 0 ? salePrice : ReadDecimal(item, "unitPrice");
            var oldPrice = ReadDecimal(item, "unitPrice");
            var stock = (int)Math.Max(0, ReadLong(item, "stock") ?? 0);
            var status = stock > 0 ? "selling" : "ready";
            var shopLink = ReadString(item, "shopLink");
            var imageUrl = ReadKaspiImageUrl(item);

            items.Add(new KaspiProductCatalogItem(
                new OzonProductSummary(
                    productId,
                    offerId,
                    sku,
                    name,
                    price,
                    oldPrice > price ? oldPrice : 0,
                    0,
                    ReadString(item, "currency") ?? "KZT",
                    status,
                    ResolveKaspiUrl(shopLink, offerId),
                    imageUrl,
                    ReadString(item, "createdTime")),
                stock));

            index++;
        }

        return items;
    }

    private static string ResolveKaspiUrl(string? shopLink, string offerId)
    {
        if (string.IsNullOrWhiteSpace(shopLink))
        {
            return BuildFallbackProductUrl(MarketplaceTypes.Kaspi, string.Empty, offerId);
        }

        return shopLink.StartsWith("http", StringComparison.OrdinalIgnoreCase)
            ? shopLink
            : $"https://kaspi.kz{shopLink}";
    }

    private static string ReadKaspiImageUrl(JsonElement item)
    {
        if (!item.TryGetProperty("previewImages", out var images) || images.ValueKind != JsonValueKind.Array)
        {
            return string.Empty;
        }

        foreach (var image in images.EnumerateArray())
        {
            var url = ReadString(image, "large", "medium", "small");
            if (!string.IsNullOrWhiteSpace(url))
            {
                return url;
            }
        }

        return string.Empty;
    }

    private async Task<IReadOnlyList<OzonProductSummary>> GetGenericProductsAsync(
        string marketplace,
        KzMarketplaceCredentialSet credentialSet,
        CancellationToken cancellationToken)
    {
        var label = MarketplaceTypes.GetDisplayName(marketplace);
        var baseUrl = marketplace switch
        {
            MarketplaceTypes.Halyk => "https://api.halykmarket.kz",
            _ => string.Empty
        };

        using var request = new HttpRequestMessage(HttpMethod.Get, $"{baseUrl}/v1/products");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credentialSet.ApiKey);
        request.Headers.Add("X-Merchant-Id", credentialSet.MerchantId);

        using var response = await httpClient.SendAsync(request, cancellationToken);
        var content = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"{label} API returned {(int)response.StatusCode}: {content}",
                null,
                response.StatusCode);
        }

        return ParseGenericProductPayload(content, marketplace, credentialSet.MerchantId);
    }

    private static IReadOnlyList<OzonProductSummary> ParseGenericProductPayload(
        string content,
        string marketplace,
        string merchantId)
    {
        if (string.IsNullOrWhiteSpace(content))
        {
            return [];
        }

        var trimmed = content.AsSpan().TrimStart();
        if (trimmed.Length == 0 || trimmed[0] is not ('{' or '['))
        {
            throw new InvalidOperationException(
                $"{MarketplaceTypes.GetDisplayName(marketplace)} API вернул не JSON. Проверьте ключи. Ответ: {(content.Length <= 240 ? content : content[..240] + "...")}");
        }

        using var document = JsonDocument.Parse(content);
        var root = document.RootElement;
        var items = root.ValueKind switch
        {
            JsonValueKind.Array => root.EnumerateArray(),
            JsonValueKind.Object when root.TryGetProperty("products", out var productsNode) && productsNode.ValueKind == JsonValueKind.Array =>
                productsNode.EnumerateArray(),
            JsonValueKind.Object when root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array =>
                data.EnumerateArray(),
            JsonValueKind.Object when root.TryGetProperty("items", out var itemsNode) && itemsNode.ValueKind == JsonValueKind.Array =>
                itemsNode.EnumerateArray(),
            _ => Enumerable.Empty<JsonElement>()
        };

        var products = new List<OzonProductSummary>();
        var index = 1;

        foreach (var item in items)
        {
            var offerId = ReadString(item, "sku", "offerId", "code", "external_id", "id") ?? $"item-{index}";
            var name = ReadString(item, "name", "title", "productName") ?? offerId;
            var price = ReadDecimal(item, "price", "sellPrice", "amount");
            var productId = ReadLong(item, "productId", "id") ?? index;
            var imageUrl = ReadString(item, "main_image", "imageUrl", "image", "picture", "photo") ?? string.Empty;
            if (string.IsNullOrWhiteSpace(imageUrl) &&
                item.TryGetProperty("images", out var images) &&
                images.ValueKind == JsonValueKind.Array)
            {
                foreach (var image in images.EnumerateArray())
                {
                    imageUrl = ReadString(image, "url", "thumbnail_url") ?? string.Empty;
                    if (!string.IsNullOrWhiteSpace(imageUrl))
                    {
                        break;
                    }
                }
            }

            var status = ReadString(item, "status", "state", "presence") ?? "selling";
            var productUrl = ReadString(item, "url", "productUrl", "link") ??
                             BuildFallbackProductUrl(marketplace, merchantId, offerId);

            products.Add(new OzonProductSummary(
                productId,
                offerId,
                ReadLong(item, "sku", "productId", "id"),
                name,
                price,
                ReadDecimal(item, "oldPrice", "previousPrice", "discount"),
                ReadDecimal(item, "minPrice"),
                ReadString(item, "currencyCode", "currency") ?? "KZT",
                status,
                productUrl,
                imageUrl));

            index++;
        }

        return products;
    }

    private static KzCatalogSummary BuildCatalogSummary(IReadOnlyList<OzonProductSummary> products)
    {
        var summary = new KzCatalogSummary(products.Count, 0, 0, 0);
        foreach (var product in products)
        {
            switch (product.Status.Trim().ToLowerInvariant())
            {
                case "selling":
                case "active":
                case "visible":
                case "on_display":
                    summary = summary with { Selling = summary.Selling + 1 };
                    break;
                case "archived":
                case "archive":
                case "deleted":
                case "off":
                    summary = summary with { Archived = summary.Archived + 1 };
                    break;
                default:
                    summary = summary with { Ready = summary.Ready + 1 };
                    break;
            }
        }

        return summary;
    }

    private static List<OzonProductSummary> FilterProductsByStatus(
        IReadOnlyList<OzonProductSummary> products,
        string? status)
    {
        if (string.IsNullOrWhiteSpace(status) || status.Equals("all", StringComparison.OrdinalIgnoreCase))
        {
            return products.ToList();
        }

        return products
            .Where(product => SatuApiClient.MatchesStatusGroup(product.Status, status))
            .ToList();
    }

    private static List<OzonProductSummary> FilterProductsBySearch(
        IReadOnlyList<OzonProductSummary> products,
        string? search)
    {
        if (string.IsNullOrWhiteSpace(search))
        {
            return products.ToList();
        }

        var query = search.Trim();
        return products
            .Where(product =>
                product.Name.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                product.OfferId.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                (product.Sku?.ToString().Contains(query, StringComparison.OrdinalIgnoreCase) ?? false))
            .ToList();
    }

    private static string BuildFallbackProductUrl(string marketplace, string merchantId, string offerId) =>
        marketplace switch
        {
            MarketplaceTypes.Kaspi => $"https://kaspi.kz/shop/p/-/{offerId}/",
            MarketplaceTypes.Satu => $"https://satu.kz/p/{offerId}",
            MarketplaceTypes.Halyk => $"https://halykmarket.kz/p/{offerId}",
            _ => string.Empty
        };

    private static string BuildMarketplaceCacheShopId(string marketplace, string merchantId) =>
        $"{marketplace}:{merchantId}";

    private async Task SaveKaspiSnapshotFromAnalyticsAsync(
        string cacheShopId,
        OzonAnalyticsResult analytics,
        CancellationToken cancellationToken)
    {
        var snapshot = BuildKaspiSnapshotFromAnalytics(analytics);
        if (snapshot.TotalProductsCount > 0)
        {
            await satuAnalyticsCacheService.SaveSnapshotAsync(cacheShopId, snapshot, cancellationToken);
        }
    }

    private static OzonAnalyticsSnapshot BuildKaspiSnapshotFromAnalytics(OzonAnalyticsResult analytics)
    {
        var total = analytics.Rows
            .Select(row => string.IsNullOrWhiteSpace(row.OfferId) ? row.ProductName : row.OfferId)
            .Where(key => !string.IsNullOrWhiteSpace(key))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Count();

        return new OzonAnalyticsSnapshot(
            total,
            total,
            0,
            0,
            analytics.AccountBalance,
            analytics.AccountBalanceCurrency,
            DateTimeOffset.UtcNow.ToString("O"));
    }

    private static string? ReadString(JsonElement element, params string[] names)
    {
        foreach (var name in names)
        {
            if (element.TryGetProperty(name, out var value))
            {
                if (value.ValueKind == JsonValueKind.String)
                {
                    return value.GetString();
                }

                if (value.ValueKind is JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False)
                {
                    return value.ToString();
                }
            }
        }

        return null;
    }

    private static long? ReadLong(JsonElement element, params string[] names)
    {
        foreach (var name in names)
        {
            if (!element.TryGetProperty(name, out var value))
            {
                continue;
            }

            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var number))
            {
                return number;
            }

            if (value.ValueKind == JsonValueKind.String &&
                long.TryParse(value.GetString(), out var parsed))
            {
                return parsed;
            }
        }

        return null;
    }

    private static bool ReadBool(JsonElement element, params string[] names)
    {
        foreach (var name in names)
        {
            if (!element.TryGetProperty(name, out var value))
            {
                continue;
            }

            if (value.ValueKind == JsonValueKind.True)
            {
                return true;
            }

            if (value.ValueKind == JsonValueKind.False)
            {
                return false;
            }

            if (value.ValueKind == JsonValueKind.String &&
                bool.TryParse(value.GetString(), out var parsed))
            {
                return parsed;
            }
        }

        return false;
    }

    private static decimal ReadDecimal(JsonElement element, params string[] names)
    {
        foreach (var name in names)
        {
            if (!element.TryGetProperty(name, out var value))
            {
                continue;
            }

            if (value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out var number))
            {
                return number;
            }

            if (value.ValueKind == JsonValueKind.String &&
                decimal.TryParse(value.GetString(), out var parsed))
            {
                return parsed;
            }
        }

        return 0;
    }
}

public record KzMarketplaceTestResult(bool Success, string Message);

public record KzCatalogSummary(int Total, int Selling, int Ready, int Archived);

public record KzUnsoldProductsPage(int Total, IReadOnlyList<OzonUnsoldProductRow> Items);

public record KzAccountingSalesChannelRow(
    string Id,
    string Channel,
    int Orders,
    decimal LshopAmount,
    decimal? JoyAmount);

internal record KaspiOrdersPage(int TotalCount, IReadOnlyList<KaspiOrder> Orders);

internal record KaspiProductCatalogItem(OzonProductSummary Summary, int Stock);

internal record KaspiOrder(
    string Id,
    string Code,
    long CreationDate,
    string Status,
    string State,
    string DeliveryMode,
    string PaymentMode,
    bool IsKaspiDelivery,
    string PickupPointId,
    decimal TotalPrice,
    decimal DeliveryCostForSeller,
    IReadOnlyList<KaspiOrderEntry> Entries);

internal record KaspiOrderEntry(
    string OfferCode,
    string ProductName,
    decimal Quantity,
    decimal BasePrice,
    decimal TotalPrice);

public record KzProductsPage(
    int Total,
    int Selling,
    int Ready,
    int Archived,
    int MatchedTotal,
    IReadOnlyList<OzonProductSummary> Items,
    string? Message = null);

internal record KaspiProductsPageSource(
    IReadOnlyList<OzonProductSummary> Products,
    string? Message);
