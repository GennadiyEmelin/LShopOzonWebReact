using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LShopOzonWebReact.Api.Ozon;

/// <summary>
/// Работа с тарифами Ozon: /v5/product/info/prices.
/// Вынесено в отдельный файл, чтобы не наращивать OzonApiClient.cs (3600+ строк).
/// </summary>
public partial class OzonApiClient
{
    private const int PricesPageLimit = 1000;

    /// <summary>
    /// Выгружает тарифы по всему каталогу постранично.
    /// Курсорная пагинация: пустой курсор в ответе или пустая страница = конец.
    /// </summary>
    public async Task<IReadOnlyList<OzonProductPriceInfo>> GetAllProductPricesAsync(
        CancellationToken cancellationToken)
    {
        var result = new List<OzonProductPriceInfo>();
        var cursor = string.Empty;
        var seenCursors = new HashSet<string>(StringComparer.Ordinal);

        while (!cancellationToken.IsCancellationRequested)
        {
            var page = await GetProductPricesPageAsync(cursor, Array.Empty<long>(), cancellationToken);
            if (page.Items.Count == 0)
            {
                break;
            }

            result.AddRange(page.Items);

            if (string.IsNullOrEmpty(page.Cursor))
            {
                break;
            }

            // Защита от зацикливания: Ozon иногда возвращает тот же курсор.
            // Ровно та же проблема ловилась в синхронизации SATU (коммит 8e2aa31).
            if (!seenCursors.Add(page.Cursor))
            {
                break;
            }

            cursor = page.Cursor;

            // Пауза между страницами — метод чувствителен к частоте запросов.
            await Task.Delay(TimeSpan.FromMilliseconds(300), cancellationToken);
        }

        return result;
    }

    /// <summary>
    /// Выгружает тарифы по конкретным товарам. Разбивает на пачки по 1000.
    /// </summary>
    public async Task<IReadOnlyList<OzonProductPriceInfo>> GetProductPricesAsync(
        IReadOnlyCollection<long> productIds,
        CancellationToken cancellationToken)
    {
        var distinctIds = productIds.Where(id => id > 0).Distinct().ToArray();
        if (distinctIds.Length == 0)
        {
            return Array.Empty<OzonProductPriceInfo>();
        }

        var result = new List<OzonProductPriceInfo>();

        foreach (var batch in distinctIds.Chunk(PricesPageLimit))
        {
            var page = await GetProductPricesPageAsync(string.Empty, batch, cancellationToken);
            result.AddRange(page.Items);

            if (distinctIds.Length > PricesPageLimit)
            {
                await Task.Delay(TimeSpan.FromMilliseconds(300), cancellationToken);
            }
        }

        return result;
    }

    private async Task<OzonProductPricesPage> GetProductPricesPageAsync(
        string cursor,
        IReadOnlyCollection<long> productIds,
        CancellationToken cancellationToken)
    {
        EnsureConfigured();

        var payload = new OzonProductPricesRequest(
            cursor ?? string.Empty,
            new OzonProductPricesFilter(
                productIds.Select(id => id.ToString(CultureInfo.InvariantCulture)).ToArray(),
                Array.Empty<string>(),
                "ALL"),
            PricesPageLimit);

        var content = await SendPricesRequestAsync("/v5/product/info/prices", payload, cancellationToken);

        using var document = JsonDocument.Parse(content);
        var root = document.RootElement;

        // v5 отдаёт items/cursor в корне, v4 — внутри result. Поддерживаем оба.
        var itemsElement = default(JsonElement);
        var cursorValue = string.Empty;

        if (root.TryGetProperty("items", out var directItems))
        {
            itemsElement = directItems;
            cursorValue = root.TryGetProperty("cursor", out var directCursor)
                ? directCursor.GetString() ?? string.Empty
                : string.Empty;
        }
        else if (root.TryGetProperty("result", out var resultElement))
        {
            if (resultElement.TryGetProperty("items", out var nestedItems))
            {
                itemsElement = nestedItems;
            }

            cursorValue = resultElement.TryGetProperty("cursor", out var nestedCursor)
                ? nestedCursor.GetString() ?? string.Empty
                : resultElement.TryGetProperty("last_id", out var lastId)
                    ? lastId.GetString() ?? string.Empty
                    : string.Empty;
        }

        if (itemsElement.ValueKind != JsonValueKind.Array)
        {
            return new OzonProductPricesPage(Array.Empty<OzonProductPriceInfo>(), string.Empty);
        }

        var items = new List<OzonProductPriceInfo>();
        foreach (var element in itemsElement.EnumerateArray())
        {
            items.Add(MapPriceInfo(element));
        }

        return new OzonProductPricesPage(items, cursorValue);
    }

    /// <summary>
    /// Название и категория товара — тарифы API отдаёт без них.
    /// Читаем сырой JSON, чтобы не трогать существующие DTO в OzonApiClient.cs.
    /// </summary>
    public async Task<IReadOnlyList<OzonProductCatalogInfo>> GetProductCatalogInfoAsync(
        IReadOnlyCollection<long> productIds,
        CancellationToken cancellationToken)
    {
        var distinctIds = productIds.Where(id => id > 0).Distinct().ToArray();
        if (distinctIds.Length == 0)
        {
            return Array.Empty<OzonProductCatalogInfo>();
        }

        EnsureConfigured();
        var result = new List<OzonProductCatalogInfo>();

        foreach (var batch in distinctIds.Chunk(1000))
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/v3/product/info/list");
            request.Headers.Add("Client-Id", _credentials.ClientId);
            request.Headers.Add("Api-Key", _credentials.ApiKey);
            request.Content = new StringContent(
                JsonSerializer.Serialize(new
                {
                    product_id = batch.Select(id => id.ToString(CultureInfo.InvariantCulture)).ToArray(),
                }),
                System.Text.Encoding.UTF8,
                "application/json");

            using var response = await httpClient.SendAsync(request, cancellationToken);
            var content = await response.Content.ReadAsStringAsync(cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                throw new HttpRequestException(
                    $"Ozon API returned {(int)response.StatusCode} for /v3/product/info/list: {content}",
                    null,
                    response.StatusCode);
            }

            using var document = JsonDocument.Parse(content);
            var root = document.RootElement;

            if (!root.TryGetProperty("items", out var items)
                && (!root.TryGetProperty("result", out var resultElement)
                    || !resultElement.TryGetProperty("items", out items)))
            {
                continue;
            }

            if (items.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            foreach (var item in items.EnumerateArray())
            {
                result.Add(new OzonProductCatalogInfo(
                    ReadNumber<long>(item, "id"),
                    item.TryGetProperty("name", out var name) ? name.GetString() ?? string.Empty : string.Empty,
                    // В новых методах поле называется description_category_id, в старых — category_id.
                    ReadOptionalNumber(item, "description_category_id") is { } categoryId
                        ? (long)categoryId
                        : ReadOptionalNumber(item, "category_id") is { } legacyId
                            ? (long)legacyId
                            : null,
                    ReadOptionalNumber(item, "type_id") is { } typeId ? (long)typeId : null));
            }

            if (distinctIds.Length > 1000)
            {
                await Task.Delay(TimeSpan.FromMilliseconds(300), cancellationToken);
            }
        }

        return result;
    }

    private async Task<string> SendPricesRequestAsync(
        string path,
        OzonProductPricesRequest payload,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path);
        request.Headers.Add("Client-Id", _credentials.ClientId);
        request.Headers.Add("Api-Key", _credentials.ApiKey);
        request.Content = new StringContent(
            JsonSerializer.Serialize(payload, JsonOptions),
            System.Text.Encoding.UTF8,
            "application/json");

        using var response = await httpClient.SendAsync(request, cancellationToken);
        var content = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Ozon API returned {(int)response.StatusCode} for {path}: {content}",
                null,
                response.StatusCode);
        }

        return content;
    }

    private static OzonProductPriceInfo MapPriceInfo(JsonElement element)
    {
        var commissions = element.TryGetProperty("commissions", out var commissionsElement)
            && commissionsElement.ValueKind == JsonValueKind.Object
                ? commissionsElement
                : default;

        var price = element.TryGetProperty("price", out var priceElement)
            && priceElement.ValueKind == JsonValueKind.Object
                ? priceElement
                : default;

        // Эквайринг Ozon кладёт то в корень товара, то в блок комиссий —
        // зависит от версии метода. Ищем в обоих местах.
        decimal? acquiring = ReadOptionalNumber(element, "acquiring")
            ?? ReadOptionalNumber(commissions, "acquiring");

        return new OzonProductPriceInfo(
            ReadNumber<long>(element, "product_id"),
            element.TryGetProperty("offer_id", out var offerId) ? offerId.GetString() ?? string.Empty : string.Empty,

            ReadNumber(commissions, "sales_percent_fbo"),
            ReadNumber(commissions, "sales_percent_fbs"),

            ReadNumber(commissions, "fbo_fulfillment_amount"),
            ReadNumber(commissions, "fbo_direct_flow_trans_min_amount"),
            ReadNumber(commissions, "fbo_direct_flow_trans_max_amount"),
            ReadNumber(commissions, "fbo_deliv_to_customer_amount"),
            ReadNumber(commissions, "fbo_return_flow_amount"),

            ReadNumber(commissions, "fbs_first_mile_min_amount"),
            ReadNumber(commissions, "fbs_first_mile_max_amount"),
            ReadNumber(commissions, "fbs_direct_flow_trans_min_amount"),
            ReadNumber(commissions, "fbs_direct_flow_trans_max_amount"),
            ReadNumber(commissions, "fbs_deliv_to_customer_amount"),
            ReadNumber(commissions, "fbs_return_flow_amount"),

            acquiring,

            ReadNumber(price, "price"),
            ReadOptionalNumber(price, "old_price"),
            ReadOptionalNumber(price, "marketing_price"),
            ReadOptionalNumber(price, "min_price"),
            price.ValueKind == JsonValueKind.Object && price.TryGetProperty("currency_code", out var currency)
                ? currency.GetString() ?? string.Empty
                : string.Empty,

            ReadOptionalNumber(element, "volume_weight"),

            commissions.ValueKind == JsonValueKind.Object ? commissions.GetRawText() : "{}");
    }

    /// <summary>
    /// Ozon отдаёт денежные значения то числом, то строкой ("1490.00").
    /// Разбираем оба варианта, иначе на боевых данных всё падает.
    /// </summary>
    private static decimal ReadNumber(JsonElement parent, string propertyName)
        => ReadOptionalNumber(parent, propertyName) ?? 0m;

    private static decimal? ReadOptionalNumber(JsonElement parent, string propertyName)
    {
        if (parent.ValueKind != JsonValueKind.Object
            || !parent.TryGetProperty(propertyName, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number => value.TryGetDecimal(out var number) ? number : null,
            JsonValueKind.String => decimal.TryParse(
                value.GetString(),
                NumberStyles.Any,
                CultureInfo.InvariantCulture,
                out var parsed)
                    ? parsed
                    : null,
            _ => null,
        };
    }

    private static T ReadNumber<T>(JsonElement parent, string propertyName) where T : struct
    {
        var value = ReadOptionalNumber(parent, propertyName) ?? 0m;
        return (T)Convert.ChangeType(value, typeof(T), CultureInfo.InvariantCulture);
    }
}

public record OzonProductPricesRequest(
    [property: JsonPropertyName("cursor")] string Cursor,
    [property: JsonPropertyName("filter")] OzonProductPricesFilter Filter,
    [property: JsonPropertyName("limit")] int Limit);

public record OzonProductPricesFilter(
    [property: JsonPropertyName("product_id")] IReadOnlyList<string> ProductId,
    [property: JsonPropertyName("offer_id")] IReadOnlyList<string> OfferId,
    [property: JsonPropertyName("visibility")] string Visibility);

public record OzonProductCatalogInfo(
    long ProductId,
    string Name,
    long? DescriptionCategoryId,
    long? TypeId);

public record OzonProductPricesPage(
    IReadOnlyList<OzonProductPriceInfo> Items,
    string Cursor);

/// <summary>
/// Тарифы Ozon по одному товару — то, что ляжет в OzonCommissionSnapshot.
/// </summary>
public record OzonProductPriceInfo(
    long ProductId,
    string OfferId,
    decimal SalesPercentFbo,
    decimal SalesPercentFbs,
    decimal FboFulfillmentAmount,
    decimal FboDirectFlowTransMinAmount,
    decimal FboDirectFlowTransMaxAmount,
    decimal FboDelivToCustomerAmount,
    decimal FboReturnFlowAmount,
    decimal FbsFirstMileMinAmount,
    decimal FbsFirstMileMaxAmount,
    decimal FbsDirectFlowTransMinAmount,
    decimal FbsDirectFlowTransMaxAmount,
    decimal FbsDelivToCustomerAmount,
    decimal FbsReturnFlowAmount,
    decimal? AcquiringPercent,
    decimal CurrentPrice,
    decimal? OldPrice,
    decimal? MarketingPrice,
    decimal? MinPrice,
    string CurrencyCode,
    decimal? VolumeWeight,
    string RawCommissionsJson);

public partial class OzonApiClient
{
    /// <summary>
    /// Названия категорий из дерева Ozon: id → человекочитаемое имя.
    ///
    /// Нужно, чтобы в ручном режиме калькулятора был выбор «Кружки», а не
    /// «Категория 17027899». Если метод недоступен, возвращаем пустой словарь —
    /// справочник просто останется с номерами, ничего не сломается.
    /// </summary>
    public async Task<IReadOnlyDictionary<long, string>> GetCategoryNamesAsync(
        CancellationToken cancellationToken)
    {
        EnsureConfigured();

        var names = new Dictionary<long, string>();

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/v1/description-category/tree");
            request.Headers.Add("Client-Id", _credentials.ClientId);
            request.Headers.Add("Api-Key", _credentials.ApiKey);
            request.Content = new StringContent(
                JsonSerializer.Serialize(new { language = "RU" }),
                System.Text.Encoding.UTF8,
                "application/json");

            using var response = await httpClient.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return names;
            }

            var content = await response.Content.ReadAsStringAsync(cancellationToken);
            using var document = JsonDocument.Parse(content);

            CollectCategoryNames(document.RootElement, names, string.Empty);
        }
        catch (Exception)
        {
            // Названия — украшение, а не данные расчёта. Молча возвращаем что есть.
        }

        return names;
    }

    /// <summary>
    /// Обходит дерево рекурсивно. Структуру ответа не знаем наверняка,
    /// поэтому ищем по именам полей, а не по фиксированному пути.
    /// </summary>
    private static void CollectCategoryNames(
        JsonElement element,
        Dictionary<long, string> names,
        string parentPath)
    {
        if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var child in element.EnumerateArray())
            {
                CollectCategoryNames(child, names, parentPath);
            }

            return;
        }

        if (element.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        var currentName = element.TryGetProperty("category_name", out var nameElement)
            ? nameElement.GetString() ?? string.Empty
            : element.TryGetProperty("type_name", out var typeName)
                ? typeName.GetString() ?? string.Empty
                : string.Empty;

        // Полный путь читается лучше: «Посуда / Кружки» вместо просто «Кружки».
        var fullPath = string.IsNullOrWhiteSpace(currentName)
            ? parentPath
            : string.IsNullOrWhiteSpace(parentPath)
                ? currentName
                : $"{parentPath} / {currentName}";

        if (element.TryGetProperty("description_category_id", out var idElement)
            && ReadOptionalNumber(element, "description_category_id") is { } rawId
            && rawId > 0
            && !string.IsNullOrWhiteSpace(fullPath))
        {
            names[(long)rawId] = fullPath.Length > 500 ? fullPath[..500] : fullPath;
            _ = idElement;
        }

        foreach (var property in element.EnumerateObject())
        {
            if (property.Value.ValueKind is JsonValueKind.Array or JsonValueKind.Object)
            {
                CollectCategoryNames(property.Value, names, fullPath);
            }
        }
    }
}
