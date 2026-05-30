using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace LShopOzonWebReact.Api.Ozon;

public class OzonApiClient(HttpClient httpClient, IOptions<OzonOptions> options)
{
    private readonly OzonOptions _options = options.Value;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<OzonProductListResult> GetProductListAsync(int limit, CancellationToken cancellationToken)
    {
        EnsureConfigured();

        using var request = new HttpRequestMessage(HttpMethod.Post, "/v3/product/list");
        request.Headers.Add("Client-Id", _options.ClientId);
        request.Headers.Add("Api-Key", _options.ApiKey);
        request.Content = JsonContent.Create(new OzonProductListRequest(
            new OzonProductListFilter("ALL"),
            string.Empty,
            Math.Clamp(limit, 1, 1000)));

        using var response = await httpClient.SendAsync(request, cancellationToken);
        var content = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Ozon API returned {(int)response.StatusCode}: {content}",
                null,
                response.StatusCode);
        }

        var data = JsonSerializer.Deserialize<OzonProductListResponse>(content, JsonOptions)
            ?? throw new InvalidOperationException("Ozon API returned an empty response.");

        return data.Result;
    }

    public async Task<OzonStockListResult> GetStocksAsync(int limit, CancellationToken cancellationToken)
    {
        EnsureConfigured();

        using var request = new HttpRequestMessage(HttpMethod.Post, "/v4/product/info/stocks");
        request.Headers.Add("Client-Id", _options.ClientId);
        request.Headers.Add("Api-Key", _options.ApiKey);
        request.Content = JsonContent.Create(new OzonStockListRequest(
            new OzonProductListFilter("ALL"),
            string.Empty,
            Math.Clamp(limit, 1, 1000)));

        using var response = await httpClient.SendAsync(request, cancellationToken);
        var content = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Ozon API returned {(int)response.StatusCode}: {content}",
                null,
                response.StatusCode);
        }

        var data = JsonSerializer.Deserialize<OzonStockListResult>(content, JsonOptions)
            ?? throw new InvalidOperationException("Ozon API returned an empty response.");

        return data;
    }

    public async Task<IReadOnlyList<OzonProductSummary>> GetProductSummariesAsync(int limit, CancellationToken cancellationToken)
    {
        var list = await GetProductListAsync(limit, cancellationToken);
        var ids = list.Items.Select(item => item.ProductId).ToArray();
        if (ids.Length == 0)
        {
            return [];
        }

        return await GetProductInfoAsync(ids, cancellationToken);
    }

    public async Task<IReadOnlyList<OzonStockSummary>> GetStockSummariesAsync(int limit, CancellationToken cancellationToken)
    {
        var stocks = await GetStocksAsync(limit, cancellationToken);
        var productIds = stocks.Items.Select(item => item.ProductId).Distinct().ToArray();
        var details = await GetProductInfoAsync(productIds, cancellationToken);
        var detailsById = details.ToDictionary(item => item.ProductId);

        return stocks.Items.Select(item =>
        {
            detailsById.TryGetValue(item.ProductId, out var detail);
            var fbo = item.Stocks.FirstOrDefault(stock => stock.Type.Equals("fbo", StringComparison.OrdinalIgnoreCase));
            var fbs = item.Stocks.FirstOrDefault(stock => stock.Type.Equals("fbs", StringComparison.OrdinalIgnoreCase));
            var sku = fbo?.Sku ?? fbs?.Sku ?? detail?.Sku;

            return new OzonStockSummary(
                item.ProductId,
                item.OfferId,
                sku,
                detail?.Name ?? string.Empty,
                detail?.Price ?? 0,
                detail?.OldPrice ?? 0,
                detail?.MinPrice ?? 0,
                detail?.CurrencyCode ?? string.Empty,
                fbo?.Present ?? 0,
                fbs?.Present ?? 0,
                sku is null ? string.Empty : $"https://www.ozon.kz/product/{sku}/",
                detail?.ImageUrl ?? string.Empty);
        }).ToList();
    }

    public async Task<OzonPriceUpdateResult> UpdatePriceAsync(OzonPriceUpdateRequest request, CancellationToken cancellationToken)
    {
        EnsureConfigured();

        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, "/v1/product/import/prices");
        httpRequest.Headers.Add("Client-Id", _options.ClientId);
        httpRequest.Headers.Add("Api-Key", _options.ApiKey);
        httpRequest.Content = JsonContent.Create(new OzonImportPricesRequest([
            new OzonImportPriceItem(
                request.ProductId,
                request.OfferId,
                request.Price.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture),
                request.OldPrice?.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                request.MinPrice?.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                request.CurrencyCode)
        ]));

        using var response = await httpClient.SendAsync(httpRequest, cancellationToken);
        var content = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Ozon API returned {(int)response.StatusCode}: {content}",
                null,
                response.StatusCode);
        }

        var data = JsonSerializer.Deserialize<JsonElement>(content, JsonOptions);
        return new OzonPriceUpdateResult(true, "Цена отправлена в Ozon", data);
    }

    public async Task<OzonAnalyticsResult> GetAnalyticsAsync(DateOnly dateFrom, DateOnly dateTo, CancellationToken cancellationToken)
    {
        var finance = await GetFinanceTransactionsAsync(dateFrom, dateTo, cancellationToken);

        var productRows = finance.Operations
            .Where(operation => operation.Type == "orders" || operation.Items.Count > 0)
            .SelectMany(operation => operation.Items.DefaultIfEmpty().Select(item =>
            {
                return new OzonAnalyticsRow(
                    item?.Sku ?? 0,
                    string.Empty,
                    item?.Name ?? operation.OperationTypeName,
                    operation.OperationTypeName,
                    operation.Posting.PostingNumber,
                    operation.AccrualsForSale > 0 ? 1 : 0,
                    operation.AccrualsForSale,
                    operation.AccrualsForSale == 0
                        ? 0
                        : Math.Round(Math.Abs(operation.SaleCommission) / operation.AccrualsForSale * 100, 2),
                    Math.Abs(operation.SaleCommission),
                    operation.Amount,
                    "KZT",
                    operation.Services.Sum(service => Math.Abs(service.Price)));
            }))
            .OrderByDescending(row => row.Revenue)
            .ToList();

        var revenueTotal = productRows.Sum(row => row.Revenue);
        var commissionTotal = productRows.Sum(row => row.CommissionAmount);
        var payoutTotal = productRows.Sum(row => row.Payout);
        var logisticsTotal = productRows.Sum(row => row.LogisticsAmount);
        var orderedUnitsTotal = productRows.Count(row => row.Revenue > 0);

        var postings = await GetFboPostingsAsync(dateFrom, dateTo, cancellationToken);
        postings.AddRange(await GetFbsPostingsAsync(dateFrom, dateTo, cancellationToken));

        var topProducts = postings
            .Where(posting => posting.Status != "cancelled")
            .SelectMany(posting => posting.Products)
            .Where(product => product.Quantity > 0)
            .GroupBy(product => product.Sku != 0 ? $"sku:{product.Sku}" : $"offer:{product.OfferId}")
            .Select(group =>
            {
                var first = group.First();
                return new OzonTopProductRow(
                    first.Sku,
                    first.OfferId,
                    first.Name,
                    group.Sum(product => product.Quantity),
                    group.Sum(product => product.Price * product.Quantity),
                    first.CurrencyCode);
            })
            .OrderByDescending(row => row.Quantity)
            .ThenByDescending(row => row.Revenue)
            .ToList();

        return new OzonAnalyticsResult(
            productRows,
            topProducts,
            orderedUnitsTotal,
            revenueTotal,
            commissionTotal,
            payoutTotal,
            logisticsTotal,
            finance.Operations.Where(operation => operation.Type == "services").Sum(operation => operation.Amount),
            postings.Count(posting => posting.Status == "awaiting_deliver"),
            postings.Count(posting => posting.Status == "delivering"),
            postings.Count(posting => posting.Status == "delivered"),
            DateTimeOffset.UtcNow.ToString("yyyy-MM-dd HH:mm:ss"));
    }

    private async Task<OzonFinanceTransactionResult> GetFinanceTransactionsAsync(
        DateOnly dateFrom,
        DateOnly dateTo,
        CancellationToken cancellationToken)
    {
        EnsureConfigured();

        using var request = new HttpRequestMessage(HttpMethod.Post, "/v3/finance/transaction/list");
        request.Headers.Add("Client-Id", _options.ClientId);
        request.Headers.Add("Api-Key", _options.ApiKey);
        request.Content = JsonContent.Create(new OzonFinanceTransactionRequest(
            new OzonFinanceFilter(
                new OzonFinanceDateRange(
                    $"{dateFrom:yyyy-MM-dd}T00:00:00.000Z",
                    $"{dateTo:yyyy-MM-dd}T23:59:59.000Z"),
                [],
                string.Empty,
                "all"),
            1,
            1000));

        using var response = await httpClient.SendAsync(request, cancellationToken);
        var content = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Ozon API returned {(int)response.StatusCode}: {content}",
                null,
                response.StatusCode);
        }

        var data = JsonSerializer.Deserialize<OzonFinanceTransactionResponse>(content, JsonOptions)
            ?? throw new InvalidOperationException("Ozon API returned an empty response.");

        return data.Result;
    }

    private async Task<List<OzonPosting>> GetFboPostingsAsync(
        DateOnly dateFrom,
        DateOnly dateTo,
        CancellationToken cancellationToken)
    {
        var response = await SendPostingRequestAsync(
            "/v2/posting/fbo/list",
            dateFrom,
            dateTo,
            cancellationToken);

        var data = JsonSerializer.Deserialize<OzonFboPostingListResponse>(response, JsonOptions)
            ?? throw new InvalidOperationException("Ozon API returned an empty response.");

        return data.Result.ToList();
    }

    private async Task<List<OzonPosting>> GetFbsPostingsAsync(
        DateOnly dateFrom,
        DateOnly dateTo,
        CancellationToken cancellationToken)
    {
        var response = await SendPostingRequestAsync(
            "/v3/posting/fbs/list",
            dateFrom,
            dateTo,
            cancellationToken);

        var data = JsonSerializer.Deserialize<OzonPostingListResponse>(response, JsonOptions)
            ?? throw new InvalidOperationException("Ozon API returned an empty response.");

        return data.Result.Postings.ToList();
    }

    private async Task<string> SendPostingRequestAsync(
        string path,
        DateOnly dateFrom,
        DateOnly dateTo,
        CancellationToken cancellationToken)
    {
        EnsureConfigured();

        using var request = new HttpRequestMessage(HttpMethod.Post, path);
        request.Headers.Add("Client-Id", _options.ClientId);
        request.Headers.Add("Api-Key", _options.ApiKey);
        request.Content = JsonContent.Create(new OzonPostingListRequest(
            "ASC",
            new OzonPostingFilter(
                $"{dateFrom:yyyy-MM-dd}T00:00:00Z",
                $"{dateTo:yyyy-MM-dd}T23:59:59Z",
                string.Empty),
            1000,
            0,
            new OzonPostingWith(true, true)));

        using var response = await httpClient.SendAsync(request, cancellationToken);
        var content = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Ozon API returned {(int)response.StatusCode}: {content}",
                null,
                response.StatusCode);
        }

        return content;
    }

    private async Task<IReadOnlyList<OzonProductSummary>> GetProductInfoAsync(
        IReadOnlyCollection<long> productIds,
        CancellationToken cancellationToken)
    {
        EnsureConfigured();

        using var request = new HttpRequestMessage(HttpMethod.Post, "/v3/product/info/list");
        request.Headers.Add("Client-Id", _options.ClientId);
        request.Headers.Add("Api-Key", _options.ApiKey);
        request.Content = JsonContent.Create(new OzonProductInfoListRequest(productIds));

        using var response = await httpClient.SendAsync(request, cancellationToken);
        var content = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Ozon API returned {(int)response.StatusCode}: {content}",
                null,
                response.StatusCode);
        }

        var data = JsonSerializer.Deserialize<OzonProductInfoListResponse>(content, JsonOptions)
            ?? throw new InvalidOperationException("Ozon API returned an empty response.");

        return data.Items.Select(item =>
        {
            var sku = item.Sku ?? item.Sources.FirstOrDefault()?.Sku;
            return new OzonProductSummary(
                item.Id,
                item.OfferId,
                sku,
                item.Name,
                item.Price,
                item.OldPrice,
                item.MinPrice,
                item.CurrencyCode,
                item.Statuses?.StatusName ?? string.Empty,
                sku is null ? string.Empty : $"https://www.ozon.kz/product/{sku}/",
                item.PrimaryImage.FirstOrDefault() ?? item.Images.FirstOrDefault() ?? string.Empty);
        }).ToList();
    }

    private void EnsureConfigured()
    {
        if (string.IsNullOrWhiteSpace(_options.ClientId) || string.IsNullOrWhiteSpace(_options.ApiKey))
        {
            throw new InvalidOperationException("Ozon API credentials are not configured.");
        }
    }
}

public record OzonProductListRequest(
    [property: JsonPropertyName("filter")] OzonProductListFilter Filter,
    [property: JsonPropertyName("last_id")] string LastId,
    [property: JsonPropertyName("limit")] int Limit);

public record OzonProductListFilter(
    [property: JsonPropertyName("visibility")] string Visibility);

public record OzonProductListResponse(
    [property: JsonPropertyName("result")] OzonProductListResult Result);

public record OzonProductListResult(
    [property: JsonPropertyName("items")] IReadOnlyList<OzonProductListItem> Items,
    [property: JsonPropertyName("total")] int Total,
    [property: JsonPropertyName("last_id")] string LastId);

public record OzonProductListItem(
    [property: JsonPropertyName("product_id")] long ProductId,
    [property: JsonPropertyName("offer_id")] string OfferId);

public record OzonStockListRequest(
    [property: JsonPropertyName("filter")] OzonProductListFilter Filter,
    [property: JsonPropertyName("last_id")] string LastId,
    [property: JsonPropertyName("limit")] int Limit);

public record OzonStockListResult(
    [property: JsonPropertyName("items")] IReadOnlyList<OzonStockListItem> Items,
    [property: JsonPropertyName("total")] int Total,
    [property: JsonPropertyName("cursor")] string Cursor);

public record OzonStockListItem(
    [property: JsonPropertyName("product_id")] long ProductId,
    [property: JsonPropertyName("offer_id")] string OfferId,
    [property: JsonPropertyName("stocks")] IReadOnlyList<OzonStockItem> Stocks);

public record OzonStockItem(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("present")] int Present,
    [property: JsonPropertyName("reserved")] int Reserved,
    [property: JsonPropertyName("sku")] long Sku);

public record OzonProductInfoListRequest(
    [property: JsonPropertyName("product_id")] IReadOnlyCollection<long> ProductIds);

public record OzonProductInfoListResponse(
    [property: JsonPropertyName("items")] IReadOnlyList<OzonProductInfoItem> Items);

public record OzonProductInfoItem(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("offer_id")] string OfferId,
    [property: JsonPropertyName("price")]
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)]
    decimal Price,
    [property: JsonPropertyName("old_price")]
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)]
    decimal OldPrice,
    [property: JsonPropertyName("min_price")]
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)]
    decimal MinPrice,
    [property: JsonPropertyName("currency_code")] string CurrencyCode,
    [property: JsonPropertyName("sku")] long? Sku,
    [property: JsonPropertyName("sources")] IReadOnlyList<OzonProductSource> Sources,
    [property: JsonPropertyName("images")] IReadOnlyList<string> Images,
    [property: JsonPropertyName("primary_image")] IReadOnlyList<string> PrimaryImage,
    [property: JsonPropertyName("statuses")] OzonProductStatuses? Statuses);

public record OzonProductSource(
    [property: JsonPropertyName("sku")] long Sku);

public record OzonProductStatuses(
    [property: JsonPropertyName("status_name")] string StatusName);

public record OzonProductSummary(
    long ProductId,
    string OfferId,
    long? Sku,
    string Name,
    decimal Price,
    decimal OldPrice,
    decimal MinPrice,
    string CurrencyCode,
    string Status,
    string ProductUrl,
    string ImageUrl);

public record OzonStockSummary(
    long ProductId,
    string OfferId,
    long? Sku,
    string Name,
    decimal Price,
    decimal OldPrice,
    decimal MinPrice,
    string CurrencyCode,
    int FboPresent,
    int FbsPresent,
    string ProductUrl,
    string ImageUrl);

public record OzonPriceUpdateRequest(
    long ProductId,
    string OfferId,
    decimal Price,
    decimal? OldPrice,
    decimal? MinPrice,
    string CurrencyCode);

public record OzonImportPricesRequest(
    [property: JsonPropertyName("prices")] IReadOnlyList<OzonImportPriceItem> Prices);

public record OzonImportPriceItem(
    [property: JsonPropertyName("product_id")] long ProductId,
    [property: JsonPropertyName("offer_id")] string OfferId,
    [property: JsonPropertyName("price")] string Price,
    [property: JsonPropertyName("old_price")] string OldPrice,
    [property: JsonPropertyName("min_price")] string MinPrice,
    [property: JsonPropertyName("currency_code")] string CurrencyCode);

public record OzonPriceUpdateResult(bool Success, string Message, JsonElement Raw);

public record OzonAnalyticsResult(
    IReadOnlyList<OzonAnalyticsRow> Rows,
    IReadOnlyList<OzonTopProductRow> TopProducts,
    decimal OrderedUnitsTotal,
    decimal RevenueTotal,
    decimal CommissionTotal,
    decimal PayoutTotal,
    decimal LogisticsTotal,
    decimal ServicesTotal,
    int AwaitingDeliverCount,
    int DeliveringCount,
    int DeliveredCount,
    string Timestamp);

public record OzonAnalyticsRow(
    long Sku,
    string OfferId,
    string ProductName,
    string Status,
    string PostingNumber,
    decimal Quantity,
    decimal Revenue,
    decimal CommissionPercent,
    decimal CommissionAmount,
    decimal Payout,
    string CurrencyCode,
    decimal LogisticsAmount);

public record OzonTopProductRow(
    long Sku,
    string OfferId,
    string ProductName,
    decimal Quantity,
    decimal Revenue,
    string CurrencyCode);

public record OzonPostingListRequest(
    [property: JsonPropertyName("dir")] string Dir,
    [property: JsonPropertyName("filter")] OzonPostingFilter Filter,
    [property: JsonPropertyName("limit")] int Limit,
    [property: JsonPropertyName("offset")] int Offset,
    [property: JsonPropertyName("with")] OzonPostingWith With);

public record OzonPostingFilter(
    [property: JsonPropertyName("since")] string Since,
    [property: JsonPropertyName("to")] string To,
    [property: JsonPropertyName("status")] string Status);

public record OzonPostingWith(
    [property: JsonPropertyName("analytics_data")] bool AnalyticsData,
    [property: JsonPropertyName("financial_data")] bool FinancialData);

public record OzonPostingListResponse(
    [property: JsonPropertyName("result")] OzonPostingListResult Result);

public record OzonFboPostingListResponse(
    [property: JsonPropertyName("result")] IReadOnlyList<OzonPosting> Result);

public record OzonPostingListResult(
    [property: JsonPropertyName("postings")] IReadOnlyList<OzonPosting> Postings,
    [property: JsonPropertyName("has_next")] bool HasNext);

public record OzonPosting(
    [property: JsonPropertyName("posting_number")] string PostingNumber,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("products")] IReadOnlyList<OzonPostingProduct> Products,
    [property: JsonPropertyName("financial_data")] OzonPostingFinancialData? FinancialData);

public record OzonPostingProduct(
    [property: JsonPropertyName("sku")] long Sku,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("quantity")] decimal Quantity,
    [property: JsonPropertyName("offer_id")] string OfferId,
    [property: JsonPropertyName("product_id")] long ProductId,
    [property: JsonPropertyName("price")]
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)]
    decimal Price,
    [property: JsonPropertyName("currency_code")] string CurrencyCode);

public record OzonPostingFinancialData(
    [property: JsonPropertyName("products")] IReadOnlyList<OzonPostingFinancialProduct> Products);

public record OzonPostingFinancialProduct(
    [property: JsonPropertyName("product_id")] long ProductId,
    [property: JsonPropertyName("commission_amount")] decimal CommissionAmount,
    [property: JsonPropertyName("commission_percent")] decimal CommissionPercent,
    [property: JsonPropertyName("payout")] decimal Payout);

public record OzonFinanceTransactionRequest(
    [property: JsonPropertyName("filter")] OzonFinanceFilter Filter,
    [property: JsonPropertyName("page")] int Page,
    [property: JsonPropertyName("page_size")] int PageSize);

public record OzonFinanceFilter(
    [property: JsonPropertyName("date")] OzonFinanceDateRange Date,
    [property: JsonPropertyName("operation_type")] IReadOnlyList<string> OperationType,
    [property: JsonPropertyName("posting_number")] string PostingNumber,
    [property: JsonPropertyName("transaction_type")] string TransactionType);

public record OzonFinanceDateRange(
    [property: JsonPropertyName("from")] string From,
    [property: JsonPropertyName("to")] string To);

public record OzonFinanceTransactionResponse(
    [property: JsonPropertyName("result")] OzonFinanceTransactionResult Result);

public record OzonFinanceTransactionResult(
    [property: JsonPropertyName("operations")] IReadOnlyList<OzonFinanceOperation> Operations,
    [property: JsonPropertyName("page_count")] int PageCount,
    [property: JsonPropertyName("row_count")] int RowCount);

public record OzonFinanceOperation(
    [property: JsonPropertyName("operation_id")] long OperationId,
    [property: JsonPropertyName("operation_type_name")] string OperationTypeName,
    [property: JsonPropertyName("accruals_for_sale")] decimal AccrualsForSale,
    [property: JsonPropertyName("sale_commission")] decimal SaleCommission,
    [property: JsonPropertyName("amount")] decimal Amount,
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("posting")] OzonFinancePosting Posting,
    [property: JsonPropertyName("items")] IReadOnlyList<OzonFinanceItem> Items,
    [property: JsonPropertyName("services")] IReadOnlyList<OzonFinanceService> Services);

public record OzonFinancePosting(
    [property: JsonPropertyName("posting_number")] string PostingNumber);

public record OzonFinanceItem(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("sku")] long Sku);

public record OzonFinanceService(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("price")] decimal Price);
