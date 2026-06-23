using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace LShopOzonWebReact.Api.Ozon;

public class OzonApiClient(HttpClient httpClient, IOptions<OzonOptions> options)
{
    private readonly OzonOptions _options = options.Value;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private const int MaxAnalyticsChunkDays = 28;

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
                GetOptionalOzonPrice(request.OldPrice, request.Price),
                GetOptionalOzonPrice(request.MinPrice, request.Price),
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
        var errors = GetOzonPriceImportErrors(data);
        if (!string.IsNullOrWhiteSpace(errors))
        {
            return new OzonPriceUpdateResult(false, errors, data);
        }

        return new OzonPriceUpdateResult(true, "Цена успешно обновлена в Ozon", data);
    }

    public async Task<OzonAnalyticsResult> GetAnalyticsAsync(DateOnly dateFrom, DateOnly dateTo, CancellationToken cancellationToken)
    {
        var financeOperations = new List<OzonFinanceOperation>();
        var postings = new List<OzonPosting>();

        foreach (var (from, to) in SplitDateRange(dateFrom, dateTo))
        {
            financeOperations.AddRange(await GetAllFinanceTransactionsAsync(from, to, cancellationToken));

            postings.AddRange(await GetFboPostingsAsync(from, to, string.Empty, cancellationToken));
            postings.AddRange(await GetFbsPostingsAsync(from, to, string.Empty, cancellationToken));
            postings.AddRange(await GetFboPostingsAsync(from, to, "cancelled", cancellationToken));
            postings.AddRange(await GetFbsPostingsAsync(from, to, "cancelled", cancellationToken));
        }

        postings = DeduplicatePostings(postings);

        var productRows = financeOperations
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
                    operation.Services.Sum(service => Math.Abs(service.Price)),
                    operation.OperationDate ?? string.Empty);
            }))
            .OrderByDescending(row => row.Revenue)
            .ToList();

        var orderRows = BuildOrderRows(postings, productRows);

        var revenueTotal = productRows.Sum(row => row.Revenue);
        var commissionTotal = productRows.Sum(row => row.CommissionAmount);
        var payoutTotal = productRows.Sum(row => row.Payout);
        var logisticsTotal = productRows.Sum(row => row.LogisticsAmount);
        var orderedUnitsTotal = productRows.Count(row => row.Revenue > 0);
        var productsForStatus = await GetProductSummariesAsync(1000, cancellationToken);
        var productStatusSummary = GetProductStatusSummary(productsForStatus);
        decimal? accountBalance = null;
        var accountBalanceCurrency = string.Empty;

        try
        {
            var balanceDateTo = DateOnly.FromDateTime(DateTime.UtcNow);
            var balanceDateFrom = balanceDateTo.AddDays(-27);
            var balance = await GetFinanceBalanceAsync(balanceDateFrom, balanceDateTo, cancellationToken);
            accountBalance = balance.Total.ClosingBalance.Value;
            accountBalanceCurrency = balance.Total.ClosingBalance.CurrencyCode;
        }
        catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
        {
            accountBalance = null;
            accountBalanceCurrency = string.Empty;
        }

        var nonCancelledPostings = postings
            .Where(posting => !posting.Status.Equals("cancelled", StringComparison.OrdinalIgnoreCase))
            .ToList();
        var salesTotalCount = nonCancelledPostings
            .SelectMany(posting => posting.Products)
            .Sum(product => product.Quantity);
        var salesAmountTotal = nonCancelledPostings
            .SelectMany(posting => posting.Products)
            .Sum(product => product.Price * product.Quantity);
        var inTransitAmount = nonCancelledPostings
            .Where(posting => posting.Status.Equals("delivering", StringComparison.OrdinalIgnoreCase))
            .SelectMany(posting => posting.Products)
            .Sum(product => product.Price * product.Quantity);
        var deliveredAmount = nonCancelledPostings
            .Where(posting => posting.Status.Equals("delivered", StringComparison.OrdinalIgnoreCase))
            .SelectMany(posting => posting.Products)
            .Sum(product => product.Price * product.Quantity);
        var inTransitCount = nonCancelledPostings
            .Where(posting => posting.Status.Equals("delivering", StringComparison.OrdinalIgnoreCase))
            .SelectMany(posting => posting.Products)
            .Sum(product => product.Quantity);
        var deliveredProductCount = nonCancelledPostings
            .Where(posting => posting.Status.Equals("delivered", StringComparison.OrdinalIgnoreCase))
            .SelectMany(posting => posting.Products)
            .Sum(product => product.Quantity);
        var cancelledCount = postings
            .Where(posting => posting.Status.Equals("cancelled", StringComparison.OrdinalIgnoreCase))
            .SelectMany(posting => posting.Products)
            .Sum(product => product.Quantity);
        var cancelledAmount = postings
            .Where(posting => posting.Status.Equals("cancelled", StringComparison.OrdinalIgnoreCase))
            .SelectMany(posting => posting.Products)
            .Sum(product => product.Price * product.Quantity);
        var cancelledPostingNumbers = postings
            .Where(posting => posting.Status.Equals("cancelled", StringComparison.OrdinalIgnoreCase))
            .Select(posting => posting.PostingNumber)
            .Where(number => !string.IsNullOrWhiteSpace(number))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var cancelledFinanceOperations = await CollectCancelledFinanceOperations(
            financeOperations,
            cancelledPostingNumbers,
            dateFrom,
            dateTo,
            cancellationToken);
        var cancelledLogisticsTotal = cancelledFinanceOperations.Values.Sum(SumCancelledOperationExpense);

        IReadOnlyList<OzonStockSummary> stocks = [];
        try
        {
            stocks = await GetStockSummariesAsync(1000, cancellationToken);
        }
        catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
        {
            stocks = [];
        }

        var stocksBySku = stocks
            .Where(stock => stock.Sku is not null)
            .GroupBy(stock => stock.Sku!.Value)
            .ToDictionary(group => group.Key, group => group.Sum(stock => stock.FboPresent + stock.FbsPresent));
        var stocksByOfferId = stocks
            .Where(stock => !string.IsNullOrWhiteSpace(stock.OfferId))
            .GroupBy(stock => stock.OfferId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.Sum(stock => stock.FboPresent + stock.FbsPresent), StringComparer.OrdinalIgnoreCase);

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
                    first.CurrencyCode,
                    first.Sku != 0 && stocksBySku.TryGetValue(first.Sku, out var stockBySku)
                        ? stockBySku
                        : stocksByOfferId.GetValueOrDefault(first.OfferId, 0));
            })
            .OrderByDescending(row => row.Quantity)
            .ThenByDescending(row => row.Revenue)
            .ToList();

        var allTimeSoldProductKeys = await GetAllTimeSoldProductKeysAsync(cancellationToken);
        foreach (var posting in postings.Where(posting => !posting.Status.Equals("cancelled", StringComparison.OrdinalIgnoreCase)))
        {
            foreach (var product in posting.Products)
            {
                allTimeSoldProductKeys.Add(GetProductKey(product.Sku, product.OfferId));
            }
        }

        var unsoldProducts = productsForStatus
            .Where(product => !allTimeSoldProductKeys.Contains(GetProductKey(product.Sku ?? 0, product.OfferId)))
            .Select(product =>
            {
                var sku = product.Sku ?? 0;
                return new OzonUnsoldProductRow(
                    sku,
                    product.OfferId,
                    product.Name,
                    product.Price,
                    product.CurrencyCode,
                    sku != 0 && stocksBySku.TryGetValue(sku, out var stockBySku)
                        ? stockBySku
                        : stocksByOfferId.GetValueOrDefault(product.OfferId, 0),
                    product.Status,
                    product.ImageUrl);
            })
            .OrderBy(row => row.OfferId, StringComparer.OrdinalIgnoreCase)
            .ThenBy(row => row.ProductName, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new OzonAnalyticsResult(
            productRows,
            orderRows,
            topProducts,
            unsoldProducts,
            orderedUnitsTotal,
            revenueTotal,
            commissionTotal,
            payoutTotal,
            logisticsTotal,
            financeOperations.Where(operation => operation.Type == "services").Sum(operation => operation.Amount),
            postings.Count(posting => posting.Status == "awaiting_deliver"),
            postings.Count(posting => posting.Status == "delivering"),
            postings.Count(posting => posting.Status == "delivered"),
            salesTotalCount,
            salesAmountTotal,
            inTransitCount,
            inTransitAmount,
            deliveredProductCount,
            deliveredAmount,
            cancelledCount,
            cancelledAmount,
            cancelledLogisticsTotal,
            accountBalance,
            accountBalanceCurrency,
            productStatusSummary.Selling,
            productStatusSummary.ReadyForSale,
            productStatusSummary.Archived,
            DateTimeOffset.UtcNow.ToString("yyyy-MM-dd HH:mm:ss"));
    }

    private static OzonProductStatusSummary GetProductStatusSummary(IReadOnlyList<OzonProductSummary> products)
    {
        var selling = 0;
        var readyForSale = 0;
        var archived = 0;

        foreach (var product in products)
        {
            var status = product.Status.Trim().ToLowerInvariant();
            if (status is "ready_for_sale" or "ready_to_supply" or "готов к продаже" or "готово к продаже")
            {
                readyForSale++;
            }
            else if (status is "archived" or "archive" or "архив" or "в архиве")
            {
                archived++;
            }
            else if (status is "visible" or "selling" or "active" or "продается" or "продаётся")
            {
                selling++;
            }
        }

        return new OzonProductStatusSummary(selling, readyForSale, archived);
    }

    private async Task<HashSet<string>> GetAllTimeSoldProductKeysAsync(CancellationToken cancellationToken)
    {
        var dateTo = DateOnly.FromDateTime(DateTime.UtcNow);
        var dateFrom = dateTo.AddYears(-2);
        var soldKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var (from, to) in SplitDateRange(dateFrom, dateTo))
        {
            var operations = await GetAllFinanceTransactionsAsync(from, to, string.Empty, cancellationToken);
            foreach (var operation in operations)
            {
                if (operation.AccrualsForSale <= 0 && !operation.Type.Equals("orders", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                foreach (var item in operation.Items)
                {
                    if (item.Sku > 0)
                    {
                        soldKeys.Add(GetProductKey(item.Sku, string.Empty));
                    }
                }
            }
        }

        return soldKeys;
    }

    private static string GetProductKey(long sku, string offerId) =>
        sku != 0 ? $"sku:{sku}" : $"offer:{offerId}";

    private static List<OzonAnalyticsRow> BuildOrderRows(
        IReadOnlyList<OzonPosting> postings,
        IReadOnlyList<OzonAnalyticsRow> financeRows)
    {
        var financeByKey = financeRows
            .Where(row => !string.IsNullOrWhiteSpace(row.PostingNumber) && row.Sku > 0)
            .GroupBy(row => $"{row.PostingNumber}|{row.Sku}", StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => AggregateFinanceRows(group), StringComparer.OrdinalIgnoreCase);

        var financeByPosting = financeRows
            .Where(row => !string.IsNullOrWhiteSpace(row.PostingNumber))
            .GroupBy(row => row.PostingNumber, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => AggregateFinanceRows(group), StringComparer.OrdinalIgnoreCase);

        return postings
            .SelectMany(posting =>
            {
                var postingProducts = posting.Products.ToList();
                var postingProductRevenue = postingProducts.Sum(product => product.Price * product.Quantity);
                financeByPosting.TryGetValue(posting.PostingNumber, out var postingFinance);

                return postingProducts.Select(product =>
                {
                    var financeKey = $"{posting.PostingNumber}|{product.Sku}";
                    financeByKey.TryGetValue(financeKey, out var financeRow);
                    var financialProduct = posting.FinancialData?.Products
                        .FirstOrDefault(item => item.ProductId == product.ProductId);
                    var orderAmount = product.Price * product.Quantity;
                    var revenue = financeRow is { Revenue: > 0 } ? financeRow.Revenue : orderAmount;
                    var revenueShare = postingProductRevenue > 0 ? orderAmount / postingProductRevenue : 1m;

                    var commissionAmount = financialProduct is { CommissionAmount: > 0 }
                        ? financialProduct.CommissionAmount
                        : financeRow is { CommissionAmount: > 0 }
                            ? financeRow.CommissionAmount
                            : postingFinance is { CommissionAmount: > 0 }
                                ? Math.Round(postingFinance.CommissionAmount * revenueShare, 2)
                                : 0m;

                    var commissionPercent = financialProduct is { CommissionPercent: > 0 }
                        ? financialProduct.CommissionPercent
                        : financeRow is { CommissionPercent: > 0 }
                            ? financeRow.CommissionPercent
                            : revenue > 0 && commissionAmount > 0
                                ? Math.Round(commissionAmount / revenue * 100, 2)
                                : 0m;

                    var payout = financeRow?.Payout ?? financialProduct?.Payout ?? 0m;
                    if (payout == 0 && postingFinance is { Payout: > 0 })
                    {
                        payout = Math.Round(postingFinance.Payout * revenueShare, 2);
                    }

                    var logisticsAmount = financeRow?.LogisticsAmount ?? 0m;
                    if (logisticsAmount == 0 && postingFinance is { LogisticsAmount: > 0 })
                    {
                        logisticsAmount = Math.Round(postingFinance.LogisticsAmount * revenueShare, 2);
                    }

                    return new OzonAnalyticsRow(
                        product.Sku,
                        product.OfferId,
                        product.Name,
                        posting.Status,
                        posting.PostingNumber,
                        product.Quantity,
                        revenue,
                        commissionPercent,
                        commissionAmount,
                        payout,
                        string.IsNullOrWhiteSpace(product.CurrencyCode) ? "KZT" : product.CurrencyCode,
                        logisticsAmount,
                        ResolvePostingOperationDate(posting, financeRow?.OperationDate));
                });
            })
            .OrderByDescending(row => row.Revenue)
            .ThenBy(row => row.PostingNumber)
            .ToList();
    }

    private static OzonAnalyticsRow AggregateFinanceRows(IEnumerable<OzonAnalyticsRow> rows)
    {
        var list = rows.ToList();
        var first = list[0];
        var revenue = list.Sum(row => row.Revenue);
        var commissionAmount = list.Sum(row => row.CommissionAmount);
        var payout = list.Sum(row => row.Payout);
        var logisticsAmount = list.Sum(row => row.LogisticsAmount);
        var quantity = list.Sum(row => row.Quantity);
        var commissionedRows = list.Where(row => row.CommissionAmount > 0).ToList();
        var withPercent = commissionedRows.Where(row => row.CommissionPercent > 0).ToList();
        decimal commissionPercent;
        if (withPercent.Count > 0)
        {
            var uniquePercents = withPercent.Select(row => row.CommissionPercent).Distinct().ToList();
            var totalCommission = withPercent.Sum(row => row.CommissionAmount);
            commissionPercent = uniquePercents.Count == 1
                ? uniquePercents[0]
                : totalCommission > 0
                    ? Math.Round(withPercent.Sum(row => row.CommissionPercent * row.CommissionAmount) / totalCommission, 2)
                    : withPercent[0].CommissionPercent;
        }
        else
        {
            var commissionedRevenue = commissionedRows.Sum(row => row.Revenue);
            commissionPercent = commissionedRevenue > 0 && commissionAmount > 0
                ? Math.Round(commissionAmount / commissionedRevenue * 100, 2)
                : 0m;
        }
        var operationDate = list
            .Select(row => row.OperationDate)
            .FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))
            ?? string.Empty;

        return new OzonAnalyticsRow(
            first.Sku,
            first.OfferId,
            first.ProductName,
            first.Status,
            first.PostingNumber,
            quantity,
            revenue,
            commissionPercent,
            commissionAmount,
            payout,
            first.CurrencyCode,
            logisticsAmount,
            operationDate);
    }

    private static string ResolvePostingOperationDate(OzonPosting posting, string? financeOperationDate)
    {
        if (!string.IsNullOrWhiteSpace(financeOperationDate))
        {
            return NormalizeOperationDate(financeOperationDate);
        }

        var status = posting.Status.Trim().ToLowerInvariant();
        var cancellationDate = posting.Cancellation?.CancelledAt ?? posting.Cancellation?.CancelDate;

        return status switch
        {
            "cancelled" => FirstDate(cancellationDate, posting.InProcessAt, posting.CreatedAt),
            "delivered" => FirstDate(posting.DeliveringDate, posting.InProcessAt, posting.CreatedAt),
            "delivering" => FirstDate(posting.InProcessAt, posting.CreatedAt, posting.ShipmentDate),
            "awaiting_deliver" => FirstDate(posting.InProcessAt, posting.CreatedAt, posting.ShipmentDate),
            _ => FirstDate(posting.InProcessAt, posting.DeliveringDate, posting.CreatedAt, posting.ShipmentDate)
        };
    }

    private static string FirstDate(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                return NormalizeOperationDate(value);
            }
        }

        return string.Empty;
    }

    private static string NormalizeOperationDate(string value)
    {
        var trimmed = value.Trim();
        return trimmed.Length >= 10 ? trimmed[..10] : trimmed;
    }

    private static IEnumerable<(DateOnly From, DateOnly To)> SplitDateRange(DateOnly dateFrom, DateOnly dateTo)
    {
        var current = dateFrom;
        while (current <= dateTo)
        {
            var end = current.AddDays(MaxAnalyticsChunkDays - 1);
            if (end > dateTo)
            {
                end = dateTo;
            }

            yield return (current, end);
            current = end.AddDays(1);
        }
    }

    private async Task<List<OzonFinanceOperation>> GetAllFinanceTransactionsAsync(
        DateOnly dateFrom,
        DateOnly dateTo,
        CancellationToken cancellationToken)
    {
        return await GetAllFinanceTransactionsAsync(dateFrom, dateTo, string.Empty, cancellationToken);
    }

    private async Task<List<OzonFinanceOperation>> GetAllFinanceTransactionsAsync(
        DateOnly dateFrom,
        DateOnly dateTo,
        string postingNumber,
        CancellationToken cancellationToken)
    {
        var operations = new List<OzonFinanceOperation>();
        var page = 1;
        var pageCount = 1;

        while (page <= pageCount)
        {
            var result = await GetFinanceTransactionsPageAsync(
                dateFrom,
                dateTo,
                postingNumber,
                page,
                cancellationToken);
            operations.AddRange(result.Operations);
            pageCount = Math.Max(result.PageCount, 1);
            page++;
        }

        return operations;
    }

    private async Task<OzonFinanceTransactionResult> GetFinanceTransactionsPageAsync(
        DateOnly dateFrom,
        DateOnly dateTo,
        string postingNumber,
        int page,
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
                postingNumber,
                "all"),
            page,
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

    private async Task<Dictionary<long, OzonFinanceOperation>> CollectCancelledFinanceOperations(
        IReadOnlyList<OzonFinanceOperation> financeOperations,
        HashSet<string> cancelledPostingNumbers,
        DateOnly dateFrom,
        DateOnly dateTo,
        CancellationToken cancellationToken)
    {
        var cancelledFinanceOperations = new Dictionary<long, OzonFinanceOperation>();
        var postingMatchKeys = BuildCancelledPostingMatchKeys(cancelledPostingNumbers);

        foreach (var operation in financeOperations)
        {
            if (MatchesCancelledPosting(operation.Posting.PostingNumber, postingMatchKeys))
            {
                cancelledFinanceOperations[operation.OperationId] = operation;
            }
        }

        if (cancelledPostingNumbers.Count == 0)
        {
            return cancelledFinanceOperations;
        }

        var financeDateToExtended = dateTo.AddDays(60);
        foreach (var postingNumber in cancelledPostingNumbers)
        {
            foreach (var (from, to) in SplitDateRange(dateFrom, financeDateToExtended))
            {
                var postingOperations = await GetAllFinanceTransactionsAsync(
                    from,
                    to,
                    postingNumber,
                    cancellationToken);

                foreach (var operation in postingOperations)
                {
                    cancelledFinanceOperations[operation.OperationId] = operation;
                }
            }
        }

        return cancelledFinanceOperations;
    }

    private static List<OzonPosting> DeduplicatePostings(IReadOnlyList<OzonPosting> postings)
    {
        return postings
            .Where(posting => !string.IsNullOrWhiteSpace(posting.PostingNumber))
            .GroupBy(posting => posting.PostingNumber, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToList();
    }

    private static HashSet<string> BuildCancelledPostingMatchKeys(IEnumerable<string> postingNumbers)
    {
        var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var postingNumber in postingNumbers)
        {
            if (string.IsNullOrWhiteSpace(postingNumber))
            {
                continue;
            }

            keys.Add(postingNumber);

            var parts = postingNumber.Split('-', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length >= 2)
            {
                keys.Add($"{parts[0]}-{parts[1]}");
            }

            if (parts.Length >= 1)
            {
                keys.Add(parts[0]);
            }
        }

        return keys;
    }

    private static bool MatchesCancelledPosting(string postingNumber, HashSet<string> matchKeys)
    {
        if (string.IsNullOrWhiteSpace(postingNumber))
        {
            return false;
        }

        if (matchKeys.Contains(postingNumber))
        {
            return true;
        }

        var parts = postingNumber.Split('-', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length >= 2 && matchKeys.Contains($"{parts[0]}-{parts[1]}"))
        {
            return true;
        }

        return parts.Length >= 1 && matchKeys.Contains(parts[0]);
    }

    private static decimal SumCancelledOperationExpense(OzonFinanceOperation operation)
    {
        var servicesTotal = operation.Services.Sum(service => Math.Abs(service.Price));
        var negativeAmount = operation.Amount < 0 ? Math.Abs(operation.Amount) : 0m;

        if (servicesTotal > 0 && negativeAmount > 0)
        {
            return Math.Max(servicesTotal, negativeAmount);
        }

        return servicesTotal + negativeAmount;
    }

    private async Task<OzonFinanceBalanceResponse> GetFinanceBalanceAsync(
        DateOnly dateFrom,
        DateOnly dateTo,
        CancellationToken cancellationToken)
    {
        EnsureConfigured();

        using var request = new HttpRequestMessage(HttpMethod.Post, "/v1/finance/balance");
        request.Headers.Add("Client-Id", _options.ClientId);
        request.Headers.Add("Api-Key", _options.ApiKey);
        request.Content = JsonContent.Create(new OzonFinanceBalanceRequest(
            $"{dateFrom:yyyy-MM-dd}",
            $"{dateTo:yyyy-MM-dd}"));

        using var response = await httpClient.SendAsync(request, cancellationToken);
        var content = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Ozon API returned {(int)response.StatusCode}: {content}",
                null,
                response.StatusCode);
        }

        return JsonSerializer.Deserialize<OzonFinanceBalanceResponse>(content, JsonOptions)
            ?? throw new InvalidOperationException("Ozon API returned an empty balance response.");
    }

    private async Task<List<OzonPosting>> GetFboPostingsAsync(
        DateOnly dateFrom,
        DateOnly dateTo,
        CancellationToken cancellationToken)
    {
        return await GetFboPostingsAsync(dateFrom, dateTo, string.Empty, cancellationToken);
    }

    private async Task<List<OzonPosting>> GetFboPostingsAsync(
        DateOnly dateFrom,
        DateOnly dateTo,
        string status,
        CancellationToken cancellationToken)
    {
        var response = await SendPostingRequestAsync(
            "/v2/posting/fbo/list",
            dateFrom,
            dateTo,
            status,
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
        return await GetFbsPostingsAsync(dateFrom, dateTo, string.Empty, cancellationToken);
    }

    private async Task<List<OzonPosting>> GetFbsPostingsAsync(
        DateOnly dateFrom,
        DateOnly dateTo,
        string status,
        CancellationToken cancellationToken)
    {
        var response = await SendPostingRequestAsync(
            "/v3/posting/fbs/list",
            dateFrom,
            dateTo,
            status,
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
        return await SendPostingRequestAsync(path, dateFrom, dateTo, string.Empty, cancellationToken);
    }

    private async Task<string> SendPostingRequestAsync(
        string path,
        DateOnly dateFrom,
        DateOnly dateTo,
        string status,
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
                status),
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

    private static string GetOptionalOzonPrice(decimal? value, decimal price)
    {
        if (value is null || value <= 0 || value <= price)
        {
            return "0";
        }

        return value.Value.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);
    }

    private static string GetOzonPriceImportErrors(JsonElement data)
    {
        var messages = new List<string>();

        if (!data.TryGetProperty("result", out var result) || result.ValueKind != JsonValueKind.Array)
        {
            return string.Empty;
        }

        foreach (var item in result.EnumerateArray())
        {
            if (item.TryGetProperty("updated", out var updated)
                && updated.ValueKind is JsonValueKind.False)
            {
                messages.Add("Ozon не обновил цену товара.");
            }

            if (!item.TryGetProperty("errors", out var errors) || errors.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            foreach (var error in errors.EnumerateArray())
            {
                var message = error.TryGetProperty("message", out var messageElement)
                    ? messageElement.GetString()
                    : null;
                var code = error.TryGetProperty("code", out var codeElement)
                    ? codeElement.GetString()
                    : null;

                if (!string.IsNullOrWhiteSpace(message))
                {
                    messages.Add(message);
                }
                else if (!string.IsNullOrWhiteSpace(code))
                {
                    messages.Add(code);
                }
            }
        }

        return string.Join(" ", messages.Distinct());
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
    [property: JsonConverter(typeof(SafeDecimalConverter))]
    decimal Price,
    [property: JsonPropertyName("old_price")]
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)]
    [property: JsonConverter(typeof(SafeDecimalConverter))]
    decimal OldPrice,
    [property: JsonPropertyName("min_price")]
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)]
    [property: JsonConverter(typeof(SafeDecimalConverter))]
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

public class SafeDecimalConverter : JsonConverter<decimal>
{
    public override decimal Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        try
        {
            if (reader.TokenType == JsonTokenType.Number)
            {
                return reader.GetDecimal();
            }

            if (reader.TokenType == JsonTokenType.String)
            {
                var value = reader.GetString();
                if (string.IsNullOrWhiteSpace(value))
                {
                    return 0;
                }

                return decimal.TryParse(
                    value,
                    System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture,
                    out var parsed)
                    ? parsed
                    : 0;
            }
        }
        catch (FormatException)
        {
            return 0;
        }
        catch (OverflowException)
        {
            return 0;
        }

        return 0;
    }

    public override void Write(Utf8JsonWriter writer, decimal value, JsonSerializerOptions options) =>
        writer.WriteNumberValue(value);
}

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
    IReadOnlyList<OzonAnalyticsRow> OrderRows,
    IReadOnlyList<OzonTopProductRow> TopProducts,
    IReadOnlyList<OzonUnsoldProductRow> UnsoldProducts,
    decimal OrderedUnitsTotal,
    decimal RevenueTotal,
    decimal CommissionTotal,
    decimal PayoutTotal,
    decimal LogisticsTotal,
    decimal ServicesTotal,
    int AwaitingDeliverCount,
    int DeliveringCount,
    int DeliveredCount,
    decimal SalesTotalCount,
    decimal SalesAmountTotal,
    decimal InTransitCount,
    decimal InTransitAmount,
    decimal DeliveredProductCount,
    decimal DeliveredAmount,
    decimal CancelledCount,
    decimal CancelledAmount,
    decimal CancelledLogisticsTotal,
    decimal? AccountBalance,
    string AccountBalanceCurrency,
    int SellingProductsCount,
    int ReadyForSaleProductsCount,
    int ArchivedProductsCount,
    string Timestamp);

public record OzonProductStatusSummary(
    int Selling,
    int ReadyForSale,
    int Archived);

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
    decimal LogisticsAmount,
    string OperationDate);

public record OzonTopProductRow(
    long Sku,
    string OfferId,
    string ProductName,
    decimal Quantity,
    decimal Revenue,
    string CurrencyCode,
    int StockTotal);

public record OzonUnsoldProductRow(
    long Sku,
    string OfferId,
    string ProductName,
    decimal Price,
    string CurrencyCode,
    int StockTotal,
    string Status,
    string ImageUrl);

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
    [property: JsonPropertyName("financial_data")] OzonPostingFinancialData? FinancialData,
    [property: JsonPropertyName("in_process_at")] string? InProcessAt = null,
    [property: JsonPropertyName("shipment_date")] string? ShipmentDate = null,
    [property: JsonPropertyName("delivering_date")] string? DeliveringDate = null,
    [property: JsonPropertyName("created_at")] string? CreatedAt = null,
    [property: JsonPropertyName("cancellation")] OzonPostingCancellation? Cancellation = null);

public record OzonPostingCancellation(
    [property: JsonPropertyName("cancelled_at")] string? CancelledAt = null,
    [property: JsonPropertyName("cancel_date")] string? CancelDate = null);

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

public record OzonFinanceBalanceRequest(
    [property: JsonPropertyName("date_from")] string DateFrom,
    [property: JsonPropertyName("date_to")] string DateTo);

public record OzonFinanceBalanceResponse(
    [property: JsonPropertyName("total")] OzonFinanceBalanceTotal Total);

public record OzonFinanceBalanceTotal(
    [property: JsonPropertyName("closing_balance")] OzonMoney ClosingBalance);

public record OzonMoney(
    [property: JsonPropertyName("value")] decimal Value,
    [property: JsonPropertyName("currency_code")] string CurrencyCode);

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
    [property: JsonPropertyName("services")] IReadOnlyList<OzonFinanceService> Services,
    [property: JsonPropertyName("operation_date")] string? OperationDate);

public record OzonFinancePosting(
    [property: JsonPropertyName("posting_number")] string PostingNumber);

public record OzonFinanceItem(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("sku")] long Sku);

public record OzonFinanceService(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("price")] decimal Price);
