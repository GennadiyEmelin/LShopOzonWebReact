using System.Net.Http.Headers;
using System.Text.Json;
using LShopOzonWebReact.Api.Ozon;

namespace LShopOzonWebReact.Api.Marketplaces;

internal static class SatuApiClient
{
    internal const string BaseUrl = "https://my.satu.kz/api/v1/";

    internal static async Task<IReadOnlyList<OzonProductSummary>> GetProductsAsync(
        HttpClient httpClient,
        string apiKey,
        string merchantId,
        CancellationToken cancellationToken)
    {
        var content = await GetJsonAsync(httpClient, "products/list", apiKey, cancellationToken);
        return ParseProducts(content, merchantId);
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

    private static IReadOnlyList<OzonProductSummary> ParseProducts(string content, string merchantId)
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

        var result = new List<OzonProductSummary>();
        var index = 1;

        foreach (var item in items)
        {
            var sku = ReadString(item, "sku") ?? ReadString(item, "external_id") ?? $"item-{index}";
            var name = ReadString(item, "name") ?? sku;
            var productId = ReadLong(item, "id") ?? index;
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

            result.Add(new OzonProductSummary(
                productId,
                sku,
                ReadLong(item, "id"),
                name,
                ReadDecimal(item, "price"),
                ReadDecimal(item, "discount"),
                0,
                ReadString(item, "currency") ?? "KZT",
                ReadString(item, "status", "presence") ?? "selling",
                productUrl,
                imageUrl));

            index++;
        }

        return result;
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
