using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using LShopOzonWebReact.Api.Ozon;

namespace LShopOzonWebReact.Api.Marketplaces;

public sealed class KzMarketplaceApiClient(
    HttpClient httpClient,
    KzMarketplaceCredentials credentials,
    SatuCatalogCache satuCatalogCache)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<IReadOnlyList<OzonProductSummary>> GetProductsAsync(string marketplace, CancellationToken cancellationToken)
    {
        var credentialSet = EnsureConfigured(marketplace);
        var normalized = MarketplaceTypes.NormalizeKzMarketplace(marketplace);

        if (normalized == MarketplaceTypes.Satu)
        {
            return await satuCatalogCache.GetProductsAsync(
                httpClient,
                credentialSet.ApiKey,
                credentialSet.MerchantId,
                cancellationToken);
        }

        return (await GetProductsPageAsync(marketplace, null, 0, int.MaxValue, cancellationToken)).Items;
    }

    public async Task<KzProductsPage> GetProductsPageAsync(
        string marketplace,
        string? status,
        int skip,
        int take,
        CancellationToken cancellationToken)
    {
        var credentialSet = EnsureConfigured(marketplace);
        var normalized = MarketplaceTypes.NormalizeKzMarketplace(marketplace);

        if (normalized == MarketplaceTypes.Satu)
        {
            return await satuCatalogCache.GetProductsPageAsync(
                httpClient,
                credentialSet.ApiKey,
                credentialSet.MerchantId,
                status,
                skip,
                take,
                cancellationToken);
        }

        var products = normalized switch
        {
            MarketplaceTypes.Kaspi => await GetKaspiProductsAsync(credentialSet, cancellationToken),
            MarketplaceTypes.Halyk => await GetGenericProductsAsync(normalized, credentialSet, cancellationToken),
            _ => (IReadOnlyList<OzonProductSummary>)[]
        };

        var summary = BuildCatalogSummary(products);
        var filtered = FilterProductsByStatus(products, status);
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
            items);
    }

    public async Task<IReadOnlyList<OzonStockSummary>> GetStocksAsync(string marketplace, CancellationToken cancellationToken)
    {
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
        CancellationToken cancellationToken)
    {
        var normalized = MarketplaceTypes.NormalizeKzMarketplace(marketplace);
        var credentialSet = EnsureConfigured(marketplace);

        if (normalized == MarketplaceTypes.Satu)
        {
            return await satuCatalogCache.GetAnalyticsAsync(
                httpClient,
                credentialSet.ApiKey,
                credentialSet.MerchantId,
                from,
                to,
                cancellationToken);
        }

        return CreateEmptyAnalytics();
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

        if (normalized != MarketplaceTypes.Satu)
        {
            return new KzUnsoldProductsPage(0, []);
        }

        var (total, items) = await satuCatalogCache.GetUnsoldProductsPageAsync(
            httpClient,
            credentialSet.ApiKey,
            credentialSet.MerchantId,
            from,
            to,
            skip,
            take,
            cancellationToken);

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
            return await satuCatalogCache.GetAnalyticsSnapshotAsync(
                httpClient,
                credentialSet.ApiKey,
                credentialSet.MerchantId,
                cancellationToken);
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
            var stats = await satuCatalogCache.GetCatalogStatsAsync(
                httpClient,
                credentialSet.ApiKey,
                credentialSet.MerchantId,
                cancellationToken);

            return new KzCatalogSummary(stats.Total, stats.Selling, stats.Ready, stats.Archived);
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
                var ordersCount = summary.Total > 0
                    ? (await satuCatalogCache.GetOrdersAsync(
                        httpClient,
                        credentialSet.ApiKey,
                        null,
                        null,
                        cancellationToken)).Count
                    : 0;
                return new KzMarketplaceTestResult(
                    true,
                    $"{label} API отвечает. Заказов: {ordersCount}, товаров в каталоге: {summary.Total}");
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

    private async Task<IReadOnlyList<OzonProductSummary>> GetKaspiProductsAsync(
        KzMarketplaceCredentialSet credentialSet,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://kaspi.kz/shop/api/v2/products");
        request.Headers.Add("X-Auth-Token", credentialSet.ApiKey);
        request.Headers.Add("X-Merchant-Id", credentialSet.MerchantId);

        using var response = await httpClient.SendAsync(request, cancellationToken);
        var content = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Kaspi API returned {(int)response.StatusCode}: {content}",
                null,
                response.StatusCode);
        }

        return ParseGenericProductPayload(content, MarketplaceTypes.Kaspi, credentialSet.MerchantId);
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

    private static string BuildFallbackProductUrl(string marketplace, string merchantId, string offerId) =>
        marketplace switch
        {
            MarketplaceTypes.Kaspi => $"https://kaspi.kz/shop/p/-/{offerId}/",
            MarketplaceTypes.Satu => $"https://satu.kz/p/{offerId}",
            MarketplaceTypes.Halyk => $"https://halykmarket.kz/p/{offerId}",
            _ => string.Empty
        };

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

public record KzProductsPage(
    int Total,
    int Selling,
    int Ready,
    int Archived,
    int MatchedTotal,
    IReadOnlyList<OzonProductSummary> Items);
