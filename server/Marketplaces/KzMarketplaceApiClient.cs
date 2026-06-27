using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using LShopOzonWebReact.Api.Ozon;

namespace LShopOzonWebReact.Api.Marketplaces;

public sealed class KzMarketplaceApiClient(HttpClient httpClient, KzMarketplaceCredentials credentials)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<IReadOnlyList<OzonProductSummary>> GetProductsAsync(string marketplace, CancellationToken cancellationToken)
    {
        var credentialSet = EnsureConfigured(marketplace);
        var normalized = MarketplaceTypes.NormalizeKzMarketplace(marketplace);

        return normalized switch
        {
            MarketplaceTypes.Kaspi => await GetKaspiProductsAsync(credentialSet, cancellationToken),
            MarketplaceTypes.Satu => await GetGenericProductsAsync(normalized, credentialSet, cancellationToken),
            MarketplaceTypes.Halyk => await GetGenericProductsAsync(normalized, credentialSet, cancellationToken),
            _ => []
        };
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

    public Task<OzonAnalyticsResult> GetAnalyticsAsync(
        string marketplace,
        DateOnly from,
        DateOnly to,
        CancellationToken cancellationToken)
    {
        _ = from;
        _ = to;
        _ = cancellationToken;
        var normalized = MarketplaceTypes.NormalizeKzMarketplace(marketplace);
        var credentialSet = credentials.Get(normalized);
        if (!credentialSet.IsConfigured)
        {
            return Task.FromResult(CreateEmptyAnalytics());
        }

        // Пока у Kaspi / Satu / Halyk нет полноценного API продаж — возвращаем пустую сводку той же формы, что Ozon.
        return Task.FromResult(CreateEmptyAnalytics());
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

    public async Task<KzMarketplaceTestResult> TestConnectionAsync(string marketplace, CancellationToken cancellationToken)
    {
        var credentialSet = EnsureConfigured(marketplace);
        var label = MarketplaceTypes.GetDisplayName(marketplace);

        try
        {
            var products = await GetProductsAsync(marketplace, cancellationToken);
            return new KzMarketplaceTestResult(
                true,
                $"{label} API отвечает. Товаров в каталоге: {products.Count}");
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
            MarketplaceTypes.Satu => "https://api.satu.kz",
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

        using var document = JsonDocument.Parse(content);
        var root = document.RootElement;
        var items = root.ValueKind switch
        {
            JsonValueKind.Array => root.EnumerateArray(),
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
            var offerId = ReadString(item, "offerId", "sku", "code", "id") ?? $"item-{index}";
            var name = ReadString(item, "name", "title", "productName") ?? offerId;
            var price = ReadDecimal(item, "price", "sellPrice", "amount");
            var productId = ReadLong(item, "productId", "id") ?? index;
            var imageUrl = ReadString(item, "imageUrl", "image", "picture", "photo") ?? string.Empty;
            var status = ReadString(item, "status", "state") ?? "selling";
            var productUrl = ReadString(item, "url", "productUrl", "link") ??
                             BuildFallbackProductUrl(marketplace, merchantId, offerId);

            products.Add(new OzonProductSummary(
                productId,
                offerId,
                ReadLong(item, "sku"),
                name,
                price,
                ReadDecimal(item, "oldPrice", "previousPrice"),
                ReadDecimal(item, "minPrice"),
                ReadString(item, "currencyCode", "currency") ?? "KZT",
                status,
                productUrl,
                imageUrl));

            index++;
        }

        return products;
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
