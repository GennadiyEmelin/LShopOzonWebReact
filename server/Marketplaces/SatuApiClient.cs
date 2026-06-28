using System.Net.Http.Headers;
using System.Text.Json;
using LShopOzonWebReact.Api.Ozon;

namespace LShopOzonWebReact.Api.Marketplaces;

internal static class SatuApiClient
{
    internal const string BaseUrl = "https://my.satu.kz/api/v1/";
    internal const int PageSize = 100;
    internal const int ParallelPages = 10;

    internal static async Task<IReadOnlyList<OzonProductSummary>> GetProductsAsync(
        HttpClient httpClient,
        string apiKey,
        string merchantId,
        CancellationToken cancellationToken) =>
        await LoadProductsAsync(httpClient, apiKey, merchantId, cancellationToken);

    internal static async Task<IReadOnlyList<OzonProductSummary>> LoadProductsAsync(
        HttpClient httpClient,
        string apiKey,
        string merchantId,
        CancellationToken cancellationToken)
    {
        var result = new List<OzonProductSummary>();
        var offset = 0;

        while (true)
        {
            var offsets = Enumerable.Range(0, ParallelPages)
                .Select(index => offset + index * PageSize)
                .ToArray();

            var pages = await Task.WhenAll(
                offsets.Select(pageOffset =>
                    GetProductsPageAsync(httpClient, apiKey, pageOffset, cancellationToken)));

            var reachedEnd = false;
            var addedInBatch = false;

            foreach (var page in pages)
            {
                if (page.Count == 0)
                {
                    continue;
                }

                addedInBatch = true;
                result.AddRange(page.Select(item => ToProductSummary(item, merchantId, result.Count + 1)));

                if (page.Count < PageSize)
                {
                    reachedEnd = true;
                }
            }

            if (reachedEnd || !addedInBatch)
            {
                break;
            }

            offset += ParallelPages * PageSize;
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
            var offsets = Enumerable.Range(0, ParallelPages)
                .Select(index => offset + index * PageSize)
                .ToArray();

            var pages = await Task.WhenAll(
                offsets.Select(pageOffset =>
                    GetProductsPageAsync(httpClient, apiKey, pageOffset, cancellationToken)));

            var reachedEnd = false;
            var addedInBatch = false;

            foreach (var page in pages)
            {
                if (page.Count == 0)
                {
                    continue;
                }

                addedInBatch = true;

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
                    reachedEnd = true;
                }
            }

            if (reachedEnd || !addedInBatch)
            {
                break;
            }

            offset += ParallelPages * PageSize;
        }

        return stats;
    }

    internal static async Task<IReadOnlyList<OzonProductSummary>> LoadProductsRangeAsync(
        HttpClient httpClient,
        string apiKey,
        string merchantId,
        int skip,
        int take,
        CancellationToken cancellationToken)
    {
        take = Math.Clamp(take, 1, 500);
        skip = Math.Max(0, skip);

        if (take == 0)
        {
            return [];
        }

        var startOffset = skip / PageSize * PageSize;
        var endOffset = (skip + take - 1) / PageSize * PageSize;
        var offsets = new List<int>();
        for (var pageOffset = startOffset; pageOffset <= endOffset; pageOffset += PageSize)
        {
            offsets.Add(pageOffset);
        }

        var collected = new List<OzonProductSummary>();
        var fallbackIndex = skip + 1;

        for (var batchStart = 0; batchStart < offsets.Count; batchStart += ParallelPages)
        {
            var batchOffsets = offsets.Skip(batchStart).Take(ParallelPages).ToArray();
            var pages = await Task.WhenAll(
                batchOffsets.Select(pageOffset =>
                    GetProductsPageAsync(httpClient, apiKey, pageOffset, cancellationToken)));

            foreach (var page in pages)
            {
                foreach (var item in page)
                {
                    collected.Add(ToProductSummary(item, merchantId, fallbackIndex++));
                }
            }
        }

        var sliceStart = skip - startOffset;
        if (sliceStart >= collected.Count)
        {
            return [];
        }

        return collected
            .Skip(sliceStart)
            .Take(take)
            .ToList();
    }

    internal static bool MatchesStatusGroup(string status, string? group)
    {
        if (string.IsNullOrWhiteSpace(group) || group.Equals("all", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var normalized = status.Trim().ToLowerInvariant();
        return group.ToLowerInvariant() switch
        {
            "selling" => normalized is "selling" or "active" or "visible" or "on_display" or "on" or "published",
            "archived" => normalized is "archived" or "archive" or "deleted" or "off" or "removed",
            "ready" => normalized is not ("selling" or "active" or "visible" or "on_display" or "on" or "published"
                or "archived" or "archive" or "deleted" or "off" or "removed"),
            _ => true
        };
    }

    internal static async Task<IReadOnlyList<OzonProductSummary>> LoadProductsFilteredRangeAsync(
        HttpClient httpClient,
        string apiKey,
        string merchantId,
        string? statusGroup,
        int skip,
        int take,
        CancellationToken cancellationToken)
    {
        take = Math.Clamp(take, 1, 500);
        skip = Math.Max(0, skip);

        if (string.IsNullOrWhiteSpace(statusGroup) || statusGroup.Equals("all", StringComparison.OrdinalIgnoreCase))
        {
            return await LoadProductsRangeAsync(httpClient, apiKey, merchantId, skip, take, cancellationToken);
        }

        var matched = new List<OzonProductSummary>();
        var offset = 0;
        var fallbackIndex = 1;
        var targetCount = skip + take;

        while (matched.Count < targetCount)
        {
            var batchOffsets = Enumerable.Range(0, ParallelPages)
                .Select(index => offset + index * PageSize)
                .ToArray();

            var pages = await Task.WhenAll(
                batchOffsets.Select(pageOffset =>
                    GetProductsPageAsync(httpClient, apiKey, pageOffset, cancellationToken)));

            var reachedEnd = false;
            var addedInBatch = false;

            foreach (var page in pages)
            {
                if (page.Count == 0)
                {
                    continue;
                }

                addedInBatch = true;

                foreach (var item in page)
                {
                    var summary = ToProductSummary(item, merchantId, fallbackIndex++);
                    if (MatchesStatusGroup(summary.Status, statusGroup))
                    {
                        matched.Add(summary);
                    }
                }

                if (page.Count < PageSize)
                {
                    reachedEnd = true;
                }
            }

            if (reachedEnd || !addedInBatch)
            {
                break;
            }

            offset += ParallelPages * PageSize;
        }

        return matched
            .Skip(skip)
            .Take(take)
            .ToList();
    }

    internal static async Task<int> GetOrdersCountAsync(
        HttpClient httpClient,
        string apiKey,
        CancellationToken cancellationToken)
    {
        var orders = await GetOrdersAsync(httpClient, apiKey, null, null, cancellationToken);
        return orders.Count;
    }

    internal static async Task<IReadOnlyList<JsonElement>> GetOrdersAsync(
        HttpClient httpClient,
        string apiKey,
        DateOnly? from,
        DateOnly? to,
        CancellationToken cancellationToken) =>
        await LoadOrdersAsync(httpClient, apiKey, from, to, cancellationToken);

    internal static async Task<IReadOnlyList<JsonElement>> LoadOrdersAsync(
        HttpClient httpClient,
        string apiKey,
        DateOnly? from,
        DateOnly? to,
        CancellationToken cancellationToken)
    {
        var result = new List<JsonElement>();
        var offset = 0;

        while (true)
        {
            var page = await GetOrdersPageAsync(httpClient, apiKey, offset, from, cancellationToken);
            if (page.Count == 0)
            {
                break;
            }

            foreach (var order in page)
            {
                var orderDate = ReadOrderDate(order);
                if (from is not null && orderDate is not null && orderDate.Value < from.Value)
                {
                    return result;
                }

                if (to is not null && orderDate is not null && orderDate.Value > to.Value)
                {
                    continue;
                }

                result.Add(order);
            }

            if (page.Count < PageSize)
            {
                break;
            }

            offset += PageSize;
        }

        return result;
    }

    internal static string NormalizeOrderStatus(string? status)
    {
        var normalized = status?.Trim().ToLowerInvariant() ?? string.Empty;
        return normalized switch
        {
            "delivered" => "delivered",
            "canceled" or "cancelled" or "cancel" => "cancelled",
            "paid" or "delivering" or "shipping" or "sent" => "delivering",
            _ => "awaiting_deliver"
        };
    }

    internal static DateOnly? ReadOrderDate(JsonElement order)
    {
        foreach (var name in new[] { "date_created", "created_at", "date", "order_date", "updated_at" })
        {
            var value = ReadString(order, name);
            if (string.IsNullOrWhiteSpace(value))
            {
                continue;
            }

            if (DateTimeOffset.TryParse(value, out var parsed))
            {
                return DateOnly.FromDateTime(parsed.UtcDateTime);
            }
        }

        return null;
    }

    internal static IEnumerable<JsonElement> EnumerateOrderProducts(JsonElement order)
    {
        foreach (var name in new[] { "products", "items", "order_items" })
        {
            if (order.TryGetProperty(name, out var products) && products.ValueKind == JsonValueKind.Array)
            {
                foreach (var product in products.EnumerateArray())
                {
                    yield return product;
                }

                yield break;
            }
        }
    }

    private static async Task<List<JsonElement>> GetOrdersPageAsync(
        HttpClient httpClient,
        string apiKey,
        int offset,
        DateOnly? from,
        CancellationToken cancellationToken)
    {
        var query = $"orders/list?limit={PageSize}";
        if (offset > 0)
        {
            query += $"&offset={offset}";
        }

        if (from is not null)
        {
            query += $"&date_from={from.Value:yyyy-MM-dd}T00:00:00Z";
        }

        var content = await GetJsonAsync(httpClient, query, apiKey, cancellationToken);
        return ExtractOrderElements(content);
    }

    private static List<JsonElement> ExtractOrderElements(string content)
    {
        using var document = JsonDocument.Parse(content);
        var root = document.RootElement;
        var items = root.ValueKind switch
        {
            JsonValueKind.Array => root.EnumerateArray(),
            JsonValueKind.Object when root.TryGetProperty("orders", out var orders) && orders.ValueKind == JsonValueKind.Array =>
                orders.EnumerateArray(),
            _ => Enumerable.Empty<JsonElement>()
        };

        return items.Select(item => item.Clone()).ToList();
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

    internal static string? ReadString(JsonElement element, params string[] names)
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

    internal static long? ReadLong(JsonElement element, params string[] names)
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

    internal static decimal ReadDecimal(JsonElement element, params string[] names)
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

public sealed class SatuCatalogStats
{
    public int Total { get; set; }
    public int Selling { get; set; }
    public int Ready { get; set; }
    public int Archived { get; set; }
}
