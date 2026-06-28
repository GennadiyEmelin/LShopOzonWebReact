using System.Net.Http.Headers;
using System.Text.Json;
using LShopOzonWebReact.Api.Ozon;

namespace LShopOzonWebReact.Api.Marketplaces;

internal static class SatuApiClient
{
    internal const string BaseUrl = "https://my.satu.kz/api/v1/";
    internal const int PageSize = 100;

    internal static async Task<IReadOnlyList<OzonProductSummary>> GetProductsAsync(
        HttpClient httpClient,
        string apiKey,
        string merchantId,
        CancellationToken cancellationToken)
    {
        var result = new List<OzonProductSummary>();
        var offset = 0;

        while (true)
        {
            var page = await GetProductsPageAsync(httpClient, apiKey, offset, cancellationToken);
            if (page.Count == 0)
            {
                break;
            }

            result.AddRange(page.Select(item => ToProductSummary(item, merchantId, result.Count + 1)));

            if (page.Count < PageSize)
            {
                break;
            }

            offset += PageSize;
        }

        return result;
    }

    internal static async Task<SatuCatalogStats> GetCatalogStatsAsync(
        HttpClient httpClient,
        string apiKey,
        CancellationToken cancellationToken)
    {
        var stats = new SatuCatalogStats();
        var offset = 0;

        while (true)
        {
            var page = await GetProductsPageAsync(httpClient, apiKey, offset, cancellationToken);
            if (page.Count == 0)
            {
                break;
            }

            foreach (var item in page)
            {
                stats.Total++;
                switch (NormalizeCatalogStatus(item))
                {
                    case "selling":
                        stats.Selling++;
                        break;
                    case "ready":
                        stats.Ready++;
                        break;
                    case "archived":
                        stats.Archived++;
                        break;
                }
            }

            if (page.Count < PageSize)
            {
                break;
            }

            offset += PageSize;
        }

        return stats;
    }

    internal static async Task<int> GetOrdersCountAsync(
        HttpClient httpClient,
        string apiKey,
        CancellationToken cancellationToken)
    {
        var content = await GetJsonAsync(httpClient, "orders/list", apiKey, cancellationToken);
        using var document = JsonDocument.Parse(content);
        var root = document.RootElement;

        if (root.TryGetProperty("orders", out var orders) && orders.ValueKind == JsonValueKind.Array)
        {
            return orders.GetArrayLength();
        }

        return root.ValueKind == JsonValueKind.Array ? root.GetArrayLength() : 0;
    }

    private static async Task<List<JsonElement>> GetProductsPageAsync(
        HttpClient httpClient,
        string apiKey,
        int offset,
        CancellationToken cancellationToken)
    {
        var query = offset > 0
            ? $"products/list?limit={PageSize}&offset={offset}"
            : $"products/list?limit={PageSize}";
        var content = await GetJsonAsync(httpClient, query, apiKey, cancellationToken);
        return ExtractProductElements(content);
    }

    internal static async Task<string> GetJsonAsync(
        HttpClient httpClient,
        string relativePath,
        string apiKey,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, BuildUrl(relativePath));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey.Trim());
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        using var response = await httpClient.SendAsync(request, cancellationToken);
        var content = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Satu API {(int)response.StatusCode}: {TrimResponse(content)}",
                null,
                response.StatusCode);
        }

        EnsureJsonPayload(content, relativePath);
        return content;
    }

    private static string BuildUrl(string relativePath) =>
        $"{BaseUrl}{relativePath.TrimStart('/')}";

    private static void EnsureJsonPayload(string content, string relativePath)
    {
        var trimmed = content.AsSpan().TrimStart();
        if (trimmed.Length == 0)
        {
            throw new InvalidOperationException($"Satu API ({relativePath}) вернул пустой ответ.");
        }

        if (trimmed[0] is not ('{' or '['))
        {
            throw new InvalidOperationException(
                $"Satu API ({relativePath}) вернул не JSON. Проверьте API Key. Ответ: {TrimResponse(content)}");
        }
    }

    private static string TrimResponse(string content) =>
        content.Length <= 240 ? content : content[..240] + "...";

    private static List<JsonElement> ExtractProductElements(string content)
    {
        using var document = JsonDocument.Parse(content);
        var root = document.RootElement;
        var items = root.ValueKind switch
        {
            JsonValueKind.Array => root.EnumerateArray(),
            JsonValueKind.Object when root.TryGetProperty("products", out var products) && products.ValueKind == JsonValueKind.Array =>
                products.EnumerateArray(),
            _ => Enumerable.Empty<JsonElement>()
        };

        return items.Select(item => item.Clone()).ToList();
    }

    private static OzonProductSummary ToProductSummary(JsonElement item, string merchantId, int fallbackIndex)
    {
        var sku = ReadString(item, "sku") ?? ReadString(item, "external_id") ?? $"item-{fallbackIndex}";
        var name = ReadString(item, "name") ?? sku;
        var productId = ReadLong(item, "id") ?? fallbackIndex;
        var imageUrl = ReadString(item, "main_image") ?? string.Empty;

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

        var productUrl = ReadString(item, "url") ??
                         (productId > 0 ? $"https://satu.kz/p/{productId}" : string.Empty);

        return new OzonProductSummary(
            productId,
            sku,
            ReadLong(item, "id"),
            name,
            ReadDecimal(item, "price"),
            ReadDecimal(item, "discount"),
            0,
            ReadString(item, "currency") ?? "KZT",
            NormalizeCatalogStatus(item),
            productUrl,
            imageUrl);
    }

    internal static string NormalizeCatalogStatus(JsonElement item)
    {
        var status = ReadString(item, "status")?.Trim().ToLowerInvariant() ?? string.Empty;
        var presence = ReadString(item, "presence")?.Trim().ToLowerInvariant() ?? string.Empty;

        if (status is "deleted" or "off" or "removed")
        {
            return "archived";
        }

        if (status is "draft" or "not_on_display")
        {
            return "ready";
        }

        if (status is "on_display" or "on" or "published")
        {
            return presence is "not_available" or "order" or "service"
                ? "ready"
                : "selling";
        }

        if (presence is "available")
        {
            return "selling";
        }

        if (presence is "not_available" or "order" or "service")
        {
            return "ready";
        }

        return status switch
        {
            "selling" or "active" or "visible" => "selling",
            "ready_for_sale" or "ready" => "ready",
            "archived" or "archive" => "archived",
            _ => "ready"
        };
    }

    private static string? ReadString(JsonElement element, params string[] names)
    {
        foreach (var name in names)
        {
            if (!element.TryGetProperty(name, out var value))
            {
                continue;
            }

            if (value.ValueKind == JsonValueKind.String)
            {
                return value.GetString();
            }

            if (value.ValueKind is JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False)
            {
                return value.ToString();
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

internal sealed record SatuCatalogStats
{
    public int Total { get; set; }
    public int Selling { get; set; }
    public int Ready { get; set; }
    public int Archived { get; set; }
}
