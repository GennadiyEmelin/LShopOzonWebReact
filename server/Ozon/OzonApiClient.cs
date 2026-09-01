using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace LShopOzonWebReact.Api.Ozon;

public partial class OzonApiClient(HttpClient httpClient, OzonRuntimeCredentials credentials)
{
    private readonly OzonRuntimeCredentials _credentials = credentials;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private const int MaxAnalyticsChunkDays = 28;

    public async Task<OzonProductListResult> GetProductListAsync(int limit, CancellationToken cancellationToken)
    {
        return await GetProductListPageAsync(limit, string.Empty, cancellationToken);
    }

    private async Task<OzonProductListResult> GetProductListPageAsync(
        int limit,
        string lastId,
        CancellationToken cancellationToken)
    {
        EnsureConfigured();

        using var request = new HttpRequestMessage(HttpMethod.Post, "/v3/product/list");
        request.Headers.Add("Client-Id", _credentials.ClientId);
        request.Headers.Add("Api-Key", _credentials.ApiKey);
        request.Content = JsonContent.Create(new OzonProductListRequest(
            new OzonProductListFilter("ALL"),
            lastId,
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
        return await GetStocksPageAsync(limit, string.Empty, cancellationToken);
    }

    private async Task<OzonStockListResult> GetStocksPageAsync(
        int limit,
        string lastId,
        CancellationToken cancellationToken)
    {
        EnsureConfigured();

        using var request = new HttpRequestMessage(HttpMethod.Post, "/v4/product/info/stocks");
        request.Headers.Add("Client-Id", _credentials.ClientId);
        request.Headers.Add("Api-Key", _credentials.ApiKey);
        request.Content = JsonContent.Create(new OzonStockListRequest(
            new OzonProductListFilter("ALL"),
            lastId,
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

    private async Task<IReadOnlyList<OzonProductSummary>> GetAllProductSummariesAsync(CancellationToken cancellationToken)
    {
        var ids = new List<long>();
        var lastId = string.Empty;

        while (true)
        {
            var page = await GetProductListPageAsync(1000, lastId, cancellationToken);
            ids.AddRange(page.Items.Select(item => item.ProductId));

            if (string.IsNullOrWhiteSpace(page.LastId) || page.LastId == lastId || ids.Count >= page.Total)
            {
                break;
            }

            lastId = page.LastId;
        }

        return await GetProductInfoAsync(ids.Distinct().ToArray(), cancellationToken);
    }

    public async Task<OzonProductSummary?> GetProductSummaryByIdAsync(long productId, CancellationToken cancellationToken)
    {
        if (productId <= 0)
        {
            return null;
        }

        var products = await GetProductInfoAsync([productId], cancellationToken);
        return products.FirstOrDefault();
    }

    public async Task<IReadOnlyList<OzonStockSummary>> GetStockSummariesAsync(int limit, CancellationToken cancellationToken)
    {
        var stocks = await GetStocksAsync(limit, cancellationToken);
        return await BuildStockSummariesAsync(stocks.Items, cancellationToken);
    }

    private async Task<IReadOnlyList<OzonStockSummary>> GetAllStockSummariesAsync(CancellationToken cancellationToken)
    {
        var items = new List<OzonStockListItem>();
        var lastId = string.Empty;

        while (true)
        {
            var page = await GetStocksPageAsync(1000, lastId, cancellationToken);
            items.AddRange(page.Items);

            if (string.IsNullOrWhiteSpace(page.Cursor) || page.Cursor == lastId || items.Count >= page.Total)
            {
                break;
            }

            lastId = page.Cursor;
        }

        return await BuildStockSummariesAsync(items, cancellationToken);
    }

    private async Task<IReadOnlyList<OzonStockSummary>> BuildStockSummariesAsync(
        IReadOnlyList<OzonStockListItem> stockItems,
        CancellationToken cancellationToken)
    {
        var productIds = stockItems.Select(item => item.ProductId).Distinct().ToArray();
        var details = await GetProductInfoAsync(productIds, cancellationToken);
        var detailsById = details
            .GroupBy(item => item.ProductId)
            .ToDictionary(group => group.Key, group => group.First());

        return stockItems.Select(item =>
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
        httpRequest.Headers.Add("Client-Id", _credentials.ClientId);
        httpRequest.Headers.Add("Api-Key", _credentials.ApiKey);
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

    public async Task<OzonAnalyticsResult> GetAnalyticsAsync(
        DateOnly dateFrom,
        DateOnly dateTo,
        IReadOnlyDictionary<string, string>? supplementalArrivalDates = null,
        TimeZoneInfo? analyticsTimeZone = null,
        CancellationToken cancellationToken = default)
    {
        var timeZone = analyticsTimeZone ?? ResolveDefaultAnalyticsTimeZone();
        var financeOperations = new List<OzonFinanceOperation>();
        var postings = new List<OzonPosting>();

        foreach (var (from, to) in SplitDateRange(dateFrom, dateTo))
        {
            financeOperations.AddRange(await GetAllFinanceTransactionsAsync(from, to, timeZone, cancellationToken));
        }

        financeOperations = DeduplicateFinanceOperations(financeOperations);

        postings = await GetAllPostingsForRangeAsync(dateFrom, dateTo, timeZone, includeCancelled: true, cancellationToken);

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
            timeZone,
            cancellationToken);

        var financeOperationsForOrders = financeOperations
            .GroupBy(operation => operation.OperationId)
            .ToDictionary(group => group.Key, group => group.First());
        foreach (var operation in cancelledFinanceOperations.Values)
        {
            financeOperationsForOrders[operation.OperationId] = operation;
        }

        var productRows = BuildFinanceRows(financeOperations);
        var financeRowsForOrders = BuildFinanceRows(financeOperationsForOrders.Values);
        var orderRows = BuildOrderRows(postings, financeRowsForOrders, timeZone);
        var cancelledLogisticsTotal = SumCancelledOrderExpenses(orderRows);
        var cancelledMissedProfitTotal = SumCancelledMissedProfit(orderRows);

        var revenueTotal = productRows.Sum(row => row.Revenue);
        var commissionTotal = productRows.Sum(row => row.CommissionAmount);
        var payoutTotal = financeOperations.Sum(operation => operation.Amount);
        var logisticsTotal = productRows.Sum(row => row.LogisticsAmount);
        var servicesTotal = Math.Abs(financeOperations
            .Where(operation => operation.Type.Equals("services", StringComparison.OrdinalIgnoreCase))
            .Sum(operation => operation.Amount));
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
        catch (Exception exception) when (IsRecoverableOzonException(exception))
        {
            accountBalance = null;
            accountBalanceCurrency = string.Empty;
        }

        var nonCancelledPostings = postings
            .Where(posting => !posting.Status.Equals("cancelled", StringComparison.OrdinalIgnoreCase))
            .ToList();
        var rangePostings = nonCancelledPostings
            .Where(posting => IsPostingInLocalDateRange(posting, dateFrom, dateTo, timeZone))
            .ToList();
        var orderedUnitsTotal = rangePostings
            .SelectMany(posting => posting.Products)
            .Sum(product => product.Quantity);
        var salesTotalCount = rangePostings
            .Select(posting => posting.PostingNumber)
            .Where(number => !string.IsNullOrWhiteSpace(number))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Count();
        var salesAmountTotal = rangePostings
            .SelectMany(posting => posting.Products)
            .Sum(product => product.Price * product.Quantity);
        var inTransitAmount = rangePostings
            .Where(posting => posting.Status.Equals("delivering", StringComparison.OrdinalIgnoreCase))
            .SelectMany(posting => posting.Products)
            .Sum(product => product.Price * product.Quantity);
        var deliveredAmount = rangePostings
            .Where(posting => posting.Status.Equals("delivered", StringComparison.OrdinalIgnoreCase))
            .SelectMany(posting => posting.Products)
            .Sum(product => product.Price * product.Quantity);
        var inTransitCount = rangePostings
            .Where(posting => posting.Status.Equals("delivering", StringComparison.OrdinalIgnoreCase))
            .Select(posting => posting.PostingNumber)
            .Where(number => !string.IsNullOrWhiteSpace(number))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Count();
        var deliveredProductCount = rangePostings
            .Where(posting => posting.Status.Equals("delivered", StringComparison.OrdinalIgnoreCase))
            .Select(posting => posting.PostingNumber)
            .Where(number => !string.IsNullOrWhiteSpace(number))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Count();
        var awaitingDeliverPostings = rangePostings
            .Where(posting => IsCollectingStatus(posting.Status))
            .ToList();
        var awaitingDeliverCount = awaitingDeliverPostings
            .SelectMany(posting => posting.Products)
            .Sum(product => product.Quantity);
        var awaitingDeliverAmount = awaitingDeliverPostings
            .SelectMany(posting => posting.Products)
            .Sum(product => product.Price * product.Quantity);
        var cancelledCount = postings
            .Where(posting => posting.Status.Equals("cancelled", StringComparison.OrdinalIgnoreCase))
            .SelectMany(posting => posting.Products)
            .Sum(product => product.Quantity);
        var cancelledAmount = postings
            .Where(posting => posting.Status.Equals("cancelled", StringComparison.OrdinalIgnoreCase))
            .SelectMany(posting => posting.Products)
            .Sum(product => product.Price * product.Quantity);

        IReadOnlyList<OzonStockSummary> stocks = [];
        try
        {
            stocks = await GetStockSummariesAsync(1000, cancellationToken);
        }
        catch (Exception exception) when (IsRecoverableOzonException(exception))
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

        return new OzonAnalyticsResult(
            productRows,
            orderRows,
            topProducts,
            [],
            orderedUnitsTotal,
            revenueTotal,
            commissionTotal,
            payoutTotal,
            logisticsTotal,
            servicesTotal,
            (int)awaitingDeliverCount,
            awaitingDeliverAmount,
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
            cancelledMissedProfitTotal,
            accountBalance,
            accountBalanceCurrency,
            productStatusSummary.Selling,
            productStatusSummary.ReadyForSale,
            productStatusSummary.Archived,
            DateTimeOffset.UtcNow.ToString("yyyy-MM-dd HH:mm:ss"));
    }

    public async Task<OzonUnsoldProductsResult> GetUnsoldProductsAsync(
        IReadOnlyDictionary<string, string>? supplementalArrivalDates = null,
        TimeZoneInfo? analyticsTimeZone = null,
        CancellationToken cancellationToken = default)
    {
        var timeZone = analyticsTimeZone ?? ResolveDefaultAnalyticsTimeZone();
        var productsForStatus = await GetAllProductSummariesAsync(cancellationToken);

        IReadOnlyList<OzonStockSummary> stocks = [];
        try
        {
            stocks = await GetAllStockSummariesAsync(cancellationToken);
        }
        catch (Exception exception) when (IsRecoverableOzonException(exception))
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
        var stocksByProductId = stocks
            .Where(stock => stock.ProductId > 0)
            .GroupBy(stock => stock.ProductId)
            .ToDictionary(group => group.Key, group => group.Sum(stock => stock.FboPresent + stock.FbsPresent));
        var stockedProductKeys = stocks
            .Where(stock => stock.FboPresent + stock.FbsPresent > 0)
            .SelectMany(stock =>
            {
                var keys = new List<string>();
                if (stock.Sku is > 0)
                {
                    keys.Add($"sku:{stock.Sku.Value}");
                }

                if (!string.IsNullOrWhiteSpace(stock.OfferId))
                {
                    keys.Add($"offer:{stock.OfferId.Trim()}");
                }

                if (stock.ProductId > 0)
                {
                    keys.Add($"product:{stock.ProductId}");
                }

                return keys;
            })
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var ozonSupplyArrivalIndex = await TryBuildOzonSupplyArrivalIndexAsync(cancellationToken);
        OzonStockArrivalIndex? supplyArrivalIndex = ozonSupplyArrivalIndex;
        if (supplementalArrivalDates is { Count: > 0 })
        {
            supplyArrivalIndex = (supplyArrivalIndex ?? new OzonStockArrivalIndex([], [], []))
                .MergeSupplementalGaps(supplementalArrivalDates);
        }

        var todayInTimeZone = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, timeZone).Date);
        var candidatesWithSupply = productsForStatus
            .Select(product =>
            {
                var sku = product.Sku ?? 0;
                var supplyDate = ResolveUnsoldProductSupplyDate(product, sku, supplyArrivalIndex);
                var daysWithoutSales = CalculateDaysSinceSupplyDate(supplyDate, todayInTimeZone);

                return new
                {
                    Product = product,
                    Sku = sku,
                    SupplyDate = supplyDate,
                    DaysWithoutSales = daysWithoutSales,
                    StockTotal = ResolveStockTotal(product.ProductId, sku, product.OfferId, stocksBySku, stocksByOfferId, stocksByProductId)
                };
            })
            .Where(row => !string.IsNullOrWhiteSpace(row.SupplyDate))
            .Where(row => row.StockTotal > 0 || IsProductInStock(row.Product.ProductId, row.Sku, row.Product.OfferId, stockedProductKeys))
            .ToList();

        var supplyDatesByProductKey = BuildSupplyDatesByProductKey(candidatesWithSupply.Select(row => (
            row.Sku,
            row.Product.OfferId,
            row.SupplyDate)));
        var soldAfterSupplyKeys = await GetSoldProductKeysSinceSupplyDatesAsync(
            supplyDatesByProductKey,
            timeZone,
            cancellationToken);

        var items = candidatesWithSupply
            .Where(row => !WasProductSoldAfterSupply(row.Sku, row.Product.OfferId, soldAfterSupplyKeys))
            .Select(row =>
            {
                var product = row.Product;
                var sku = row.Sku;

                return new OzonUnsoldProductRow(
                    sku,
                    product.OfferId,
                    product.Name,
                    product.Price,
                    product.CurrencyCode,
                    row.StockTotal,
                    product.Status,
                    product.ImageUrl,
                    row.SupplyDate,
                    row.DaysWithoutSales);
            })
            .OrderByDescending(row => row.DaysWithoutSales ?? 0)
            .ThenBy(row => row.OfferId, StringComparer.OrdinalIgnoreCase)
            .ThenBy(row => row.ProductName, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new OzonUnsoldProductsResult(
            items.Count,
            items,
            DateTimeOffset.UtcNow.ToString("yyyy-MM-dd HH:mm:ss"));
    }

    public async Task<OzonAnalyticsSnapshot> GetAnalyticsSnapshotAsync(CancellationToken cancellationToken = default)
    {
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
        catch (Exception exception) when (IsRecoverableOzonException(exception))
        {
            accountBalance = null;
            accountBalanceCurrency = string.Empty;
        }

        return new OzonAnalyticsSnapshot(
            productsForStatus.Count,
            productStatusSummary.Selling,
            productStatusSummary.ReadyForSale,
            productStatusSummary.Archived,
            accountBalance,
            accountBalanceCurrency,
            DateTimeOffset.UtcNow.ToString("yyyy-MM-dd HH:mm:ss"));
    }

    public async Task<OzonSalesChartResult> GetSalesChartAsync(
        DateOnly dateFrom,
        DateOnly dateTo,
        string groupBy,
        TimeZoneInfo? analyticsTimeZone = null,
        CancellationToken cancellationToken = default)
    {
        var timeZone = analyticsTimeZone ?? ResolveDefaultAnalyticsTimeZone();
        var postings = await GetAllPostingsForRangeAsync(dateFrom, dateTo, timeZone, includeCancelled: false, cancellationToken);
        var normalizedGroupBy = groupBy.Equals("day", StringComparison.OrdinalIgnoreCase) ? "day" : "month";
        var buckets = new Dictionary<string, (HashSet<string> Postings, decimal Revenue)>(StringComparer.Ordinal);
        var currencyCode = "KZT";

        foreach (var posting in postings)
        {
            if (posting.Status.Equals("cancelled", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (!TryResolvePostingOrderDateOnly(posting, timeZone, out var date))
            {
                continue;
            }

            if (date < dateFrom || date > dateTo)
            {
                continue;
            }

            var key = normalizedGroupBy == "day"
                ? date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
                : date.ToString("yyyy-MM", CultureInfo.InvariantCulture);

            if (!buckets.TryGetValue(key, out var bucket))
            {
                bucket = (new HashSet<string>(StringComparer.OrdinalIgnoreCase), 0m);
            }

            if (!string.IsNullOrWhiteSpace(posting.PostingNumber))
            {
                bucket.Postings.Add(posting.PostingNumber);
            }

            foreach (var product in posting.Products)
            {
                bucket.Revenue += product.Price * product.Quantity;
                if (!string.IsNullOrWhiteSpace(product.CurrencyCode))
                {
                    currencyCode = product.CurrencyCode;
                }
            }

            buckets[key] = bucket;
        }

        var points = BuildSalesChartPoints(dateFrom, dateTo, normalizedGroupBy, buckets);

        return new OzonSalesChartResult(
            points,
            currencyCode,
            points.Sum(point => point.Orders),
            points.Sum(point => point.Revenue));
    }

    private async Task<List<OzonPosting>> GetAllPostingsForRangeAsync(
        DateOnly dateFrom,
        DateOnly dateTo,
        TimeZoneInfo timeZone,
        bool includeCancelled,
        CancellationToken cancellationToken)
    {
        var fetchFrom = dateFrom.AddDays(-1);
        var fetchTo = dateTo.AddDays(1);
        var postings = new List<OzonPosting>();

        foreach (var (from, to) in SplitDateRange(fetchFrom, fetchTo))
        {
            postings.AddRange(await GetFboPostingsAsync(from, to, string.Empty, timeZone, cancellationToken));
            postings.AddRange(await GetFbsPostingsAsync(from, to, string.Empty, timeZone, cancellationToken));
            if (includeCancelled)
            {
                postings.AddRange(await GetFboPostingsAsync(from, to, "cancelled", timeZone, cancellationToken));
                postings.AddRange(await GetFbsPostingsAsync(from, to, "cancelled", timeZone, cancellationToken));
            }
        }

        return DeduplicatePostings(postings);
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
            else if (IsSellingStatus(product.Status))
            {
                selling++;
            }
        }

        return new OzonProductStatusSummary(selling, readyForSale, archived);
    }

    private static bool IsSellingStatus(string status)
    {
        var normalized = status.Trim().ToLowerInvariant();
        return normalized is "visible" or "selling" or "active" or "продается" or "продаётся";
    }

    private async Task<HashSet<string>> GetAllTimeSoldProductKeysAsync(
        TimeZoneInfo timeZone,
        CancellationToken cancellationToken)
    {
        var dateTo = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, timeZone).Date);
        var dateFrom = dateTo.AddYears(-3);
        var soldKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var (from, to) in SplitDateRange(dateFrom, dateTo))
        {
            var operations = await GetAllFinanceTransactionsAsync(from, to, string.Empty, timeZone, cancellationToken);
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

        try
        {
            var postings = await GetAllPostingsForRangeAsync(
                dateFrom,
                dateTo,
                timeZone,
                includeCancelled: false,
                cancellationToken);
            foreach (var posting in postings)
            {
                foreach (var product in posting.Products)
                {
                    if (product.Quantity <= 0)
                    {
                        continue;
                    }

                    soldKeys.Add(GetProductKey(product.Sku, product.OfferId));
                }
            }
        }
        catch (Exception exception) when (IsRecoverableOzonException(exception))
        {
            // Postings are supplemental for sold detection; finance transactions remain the primary source.
        }

        return soldKeys;
    }

    private static string GetProductKey(long sku, string offerId) =>
        sku != 0 ? $"sku:{sku}" : $"offer:{offerId}";

    private static Dictionary<string, DateOnly> BuildSupplyDatesByProductKey(
        IEnumerable<(long Sku, string OfferId, string? SupplyDate)> rows)
    {
        var result = new Dictionary<string, DateOnly>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in rows)
        {
            if (string.IsNullOrWhiteSpace(row.SupplyDate) ||
                !TryParseSellingSinceDate(row.SupplyDate, out var supplyDate))
            {
                continue;
            }

            if (row.Sku > 0)
            {
                result[$"sku:{row.Sku}"] = supplyDate;
            }

            if (!string.IsNullOrWhiteSpace(row.OfferId))
            {
                result[$"offer:{row.OfferId.Trim()}"] = supplyDate;
            }
        }

        return result;
    }

    private async Task<HashSet<string>> GetSoldProductKeysSinceSupplyDatesAsync(
        IReadOnlyDictionary<string, DateOnly> supplyDatesByProductKey,
        TimeZoneInfo timeZone,
        CancellationToken cancellationToken)
    {
        var soldKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (supplyDatesByProductKey.Count == 0)
        {
            return soldKeys;
        }

        var dateFrom = supplyDatesByProductKey.Values.Min();
        var dateTo = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, timeZone).Date);
        foreach (var (from, to) in SplitDateRange(dateFrom, dateTo))
        {
            var operations = await GetAllFinanceTransactionsAsync(from, to, string.Empty, timeZone, cancellationToken);
            foreach (var operation in operations)
            {
                if (operation.AccrualsForSale <= 0 &&
                    !operation.Type.Equals("orders", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (!TryParseOzonDate(operation.OperationDate, out var operationDate))
                {
                    continue;
                }

                foreach (var item in operation.Items)
                {
                    if (item.Sku > 0)
                    {
                        TryAddSoldKeyAfterSupply($"sku:{item.Sku}", operationDate, supplyDatesByProductKey, soldKeys);
                    }
                }
            }
        }

        try
        {
            var postings = await GetAllPostingsForRangeAsync(
                dateFrom,
                dateTo,
                timeZone,
                includeCancelled: false,
                cancellationToken);
            foreach (var posting in postings)
            {
                if (!TryParseOzonDate(ResolvePostingOperationDate(posting, null, timeZone), out var postingDate))
                {
                    continue;
                }

                foreach (var product in posting.Products)
                {
                    if (product.Quantity <= 0)
                    {
                        continue;
                    }

                    if (product.Sku > 0)
                    {
                        TryAddSoldKeyAfterSupply($"sku:{product.Sku}", postingDate, supplyDatesByProductKey, soldKeys);
                    }

                    if (!string.IsNullOrWhiteSpace(product.OfferId))
                    {
                        TryAddSoldKeyAfterSupply(
                            $"offer:{product.OfferId.Trim()}",
                            postingDate,
                            supplyDatesByProductKey,
                            soldKeys);
                    }
                }
            }
        }
        catch (Exception exception) when (IsRecoverableOzonException(exception))
        {
            // Finance transactions remain the primary source; postings only improve matching by offer id.
        }

        return soldKeys;
    }

    private static void TryAddSoldKeyAfterSupply(
        string key,
        DateOnly saleDate,
        IReadOnlyDictionary<string, DateOnly> supplyDatesByProductKey,
        HashSet<string> soldKeys)
    {
        if (supplyDatesByProductKey.TryGetValue(key, out var supplyDate) && saleDate >= supplyDate)
        {
            soldKeys.Add(key);
        }
    }

    private static bool WasProductSoldAfterSupply(long sku, string offerId, IReadOnlySet<string> soldKeys)
    {
        if (sku > 0 && soldKeys.Contains($"sku:{sku}"))
        {
            return true;
        }

        return !string.IsNullOrWhiteSpace(offerId) && soldKeys.Contains($"offer:{offerId.Trim()}");
    }

    private static int ResolveStockTotal(
        long productId,
        long sku,
        string offerId,
        IReadOnlyDictionary<long, int> stocksBySku,
        IReadOnlyDictionary<string, int> stocksByOfferId,
        IReadOnlyDictionary<long, int> stocksByProductId)
    {
        if (sku > 0 && stocksBySku.TryGetValue(sku, out var stockBySku))
        {
            return stockBySku;
        }

        if (!string.IsNullOrWhiteSpace(offerId) &&
            stocksByOfferId.TryGetValue(offerId.Trim(), out var stockByOfferId))
        {
            return stockByOfferId;
        }

        return productId > 0 && stocksByProductId.TryGetValue(productId, out var stockByProductId)
            ? stockByProductId
            : 0;
    }

    private static bool IsProductInStock(
        long productId,
        long sku,
        string offerId,
        IReadOnlySet<string> stockedProductKeys)
    {
        if (sku > 0 && stockedProductKeys.Contains($"sku:{sku}"))
        {
            return true;
        }

        if (!string.IsNullOrWhiteSpace(offerId) && stockedProductKeys.Contains($"offer:{offerId.Trim()}"))
        {
            return true;
        }

        return productId > 0 && stockedProductKeys.Contains($"product:{productId}");
    }

    private static int? CalculateDaysSinceSupplyDate(string? supplyDateAt, DateOnly periodEnd)
    {
        if (string.IsNullOrWhiteSpace(supplyDateAt))
        {
            return null;
        }

        if (!TryParseSellingSinceDate(supplyDateAt, out var supplyDate))
        {
            return null;
        }

        if (supplyDate > periodEnd)
        {
            return 0;
        }

        return Math.Max(0, periodEnd.DayNumber - supplyDate.DayNumber);
    }

    private static bool TryParseSellingSinceDate(string value, out DateOnly sellingDate)
    {
        sellingDate = default;
        if (DateOnly.TryParse(value, out sellingDate))
        {
            return true;
        }

        if (DateTimeOffset.TryParse(value, out var parsedDateTime))
        {
            sellingDate = DateOnly.FromDateTime(parsedDateTime.DateTime);
            return true;
        }

        return false;
    }

    private static string? ResolveUnsoldProductSupplyDate(
        OzonProductSummary product,
        long sku,
        OzonStockArrivalIndex? supplyArrivalIndex)
    {
        if (supplyArrivalIndex is null)
        {
            return null;
        }

        if (sku > 0 && TryParseOzonDate(supplyArrivalIndex.GetSkuDate(sku), out var skuDate))
        {
            return skuDate.ToString("yyyy-MM-dd");
        }

        if (!string.IsNullOrWhiteSpace(product.OfferId) &&
            TryParseOzonDate(supplyArrivalIndex.GetOfferDate(product.OfferId), out var offerDate))
        {
            return offerDate.ToString("yyyy-MM-dd");
        }

        if (TryParseOzonDate(supplyArrivalIndex.GetProductDate(product.ProductId), out var productDate))
        {
            return productDate.ToString("yyyy-MM-dd");
        }

        return null;
    }

    private async Task<OzonStockArrivalIndex?> TryBuildOzonSupplyArrivalIndexAsync(CancellationToken cancellationToken)
    {
        try
        {
            var orderIds = await ListCompletedSupplyOrderIdsAsync(cancellationToken);
            if (orderIds.Count == 0)
            {
                return null;
            }

            var bySku = new Dictionary<long, DateOnly>();
            var byOfferId = new Dictionary<string, DateOnly>(StringComparer.OrdinalIgnoreCase);
            var byProductId = new Dictionary<long, DateOnly>();

            foreach (var batch in orderIds.Chunk(50))
            {
                string content;
                try
                {
                    content = await PostOzonJsonAsync(
                        "/v3/supply-order/get",
                        new { order_ids = batch },
                        cancellationToken);
                }
                catch (HttpRequestException)
                {
                    continue;
                }

                using var document = JsonDocument.Parse(content);
                if (!document.RootElement.TryGetProperty("orders", out var orders) ||
                    orders.ValueKind != JsonValueKind.Array)
                {
                    continue;
                }

                foreach (var order in orders.EnumerateArray())
                {
                    if (!order.TryGetProperty("state", out var stateProperty) ||
                        !stateProperty.GetString()?.Equals("COMPLETED", StringComparison.OrdinalIgnoreCase) == true)
                    {
                        continue;
                    }

                    if (!TryResolveOzonSupplyShipmentDate(order, out var shipmentDate))
                    {
                        continue;
                    }

                    if (!order.TryGetProperty("supplies", out var supplies) ||
                        supplies.ValueKind != JsonValueKind.Array)
                    {
                        continue;
                    }

                    foreach (var supply in supplies.EnumerateArray())
                    {
                        if (!supply.TryGetProperty("bundle_id", out var bundleProperty))
                        {
                            continue;
                        }

                        var bundleId = bundleProperty.GetString();
                        if (string.IsNullOrWhiteSpace(bundleId))
                        {
                            continue;
                        }

                        List<(long Sku, string OfferId, long ProductId)> bundleItems;
                        try
                        {
                            bundleItems = await GetSupplyBundleItemsAsync(bundleId, cancellationToken);
                        }
                        catch (HttpRequestException)
                        {
                            continue;
                        }

                        foreach (var item in bundleItems)
                        {
                            if (item.Sku > 0)
                            {
                                MergeMostRecentDate(bySku, item.Sku, shipmentDate);
                            }

                            if (!string.IsNullOrWhiteSpace(item.OfferId))
                            {
                                MergeMostRecentOfferDate(byOfferId, item.OfferId, shipmentDate);
                            }

                            if (item.ProductId > 0)
                            {
                                MergeMostRecentDate(byProductId, item.ProductId, shipmentDate);
                            }
                        }
                    }
                }
            }

            if (bySku.Count == 0 && byOfferId.Count == 0 && byProductId.Count == 0)
            {
                return null;
            }

            return new OzonStockArrivalIndex(bySku, byOfferId, byProductId);
        }
        catch (Exception)
        {
            return null;
        }
    }

    public async Task<IReadOnlyList<OzonSupplyShipmentQuantity>> GetCompletedSupplyShipmentQuantitiesAsync(
        CancellationToken cancellationToken)
    {
        var orderIds = await ListCompletedSupplyOrderIdsAsync(cancellationToken);
        if (orderIds.Count == 0)
        {
            return [];
        }

        var quantities = new Dictionary<string, OzonSupplyShipmentQuantity>(StringComparer.OrdinalIgnoreCase);

        foreach (var orderId in orderIds)
        {
            var orderItems = await GetSupplyOrderItemQuantitiesAsync(orderId, cancellationToken);

            foreach (var item in orderItems)
            {
                var key = !string.IsNullOrWhiteSpace(item.OfferId)
                    ? $"offer:{item.OfferId.Trim()}"
                    : item.Sku > 0
                        ? $"sku:{item.Sku}"
                        : item.ProductId > 0
                            ? $"product:{item.ProductId}"
                            : string.Empty;

                if (string.IsNullOrWhiteSpace(key))
                {
                    continue;
                }

                quantities.TryGetValue(key, out var current);
                quantities[key] = new OzonSupplyShipmentQuantity(
                    item.Sku > 0 ? item.Sku : current?.Sku ?? 0,
                    !string.IsNullOrWhiteSpace(item.OfferId) ? item.OfferId.Trim() : current?.OfferId ?? string.Empty,
                    item.ProductId > 0 ? item.ProductId : current?.ProductId ?? 0,
                    (current?.Quantity ?? 0) + item.Quantity,
                    !string.IsNullOrWhiteSpace(item.ProductName) ? item.ProductName.Trim() : current?.ProductName ?? string.Empty);
            }

            // Состав каждой поставки требует ещё одного запроса к bundle API.
            // Небольшая пауза не даёт серии завершённых поставок упереться в лимит Ozon.
            await Task.Delay(TimeSpan.FromMilliseconds(300), cancellationToken);
        }

        return quantities.Values.ToList();
    }

    private static bool TryResolveOzonSupplyShipmentDate(JsonElement order, out DateOnly shipmentDate)
    {
        shipmentDate = default;
        if (order.TryGetProperty("timeslot", out var timeslotWrapper) &&
            timeslotWrapper.TryGetProperty("timeslot", out var timeslot) &&
            timeslot.TryGetProperty("from", out var fromProperty) &&
            TryParseOzonSupplyCompletionDate(fromProperty.GetString(), out shipmentDate))
        {
            return true;
        }

        if (order.TryGetProperty("timeslot", out var flatTimeslot) &&
            flatTimeslot.TryGetProperty("from", out var flatFromProperty) &&
            TryParseOzonSupplyCompletionDate(flatFromProperty.GetString(), out shipmentDate))
        {
            return true;
        }

        return false;
    }

    private async Task<List<long>> ListCompletedSupplyOrderIdsAsync(CancellationToken cancellationToken)
    {
        var orderIds = new List<long>();
        var lastId = string.Empty;

        for (var page = 0; page < 50; page++)
        {
            var content = await PostOzonJsonAsync(
                "/v3/supply-order/list",
                new
                {
                    filter = new
                    {
                        states = new[] { "COMPLETED" }
                    },
                    limit = 100,
                    last_id = lastId,
                    sort_by = 1
                },
                cancellationToken);

            using var document = JsonDocument.Parse(content);
            var root = ResolveOzonResultElement(document.RootElement);
            CollectOzonSupplyOrderIds(root, orderIds);

            var hasNext = root.TryGetProperty("has_next", out var hasNextProperty) &&
                          hasNextProperty.ValueKind == JsonValueKind.True;
            if (!hasNext)
            {
                break;
            }

            var nextLastId = root.TryGetProperty("last_id", out var lastIdProperty)
                ? ReadJsonElementString(lastIdProperty)
                : string.Empty;

            if (string.IsNullOrWhiteSpace(nextLastId) || nextLastId == lastId)
            {
                break;
            }

            lastId = nextLastId;
        }

        return orderIds.Distinct().ToList();
    }

    private async Task<List<(long Sku, string OfferId, long ProductId)>> GetSupplyBundleItemsAsync(
        string bundleId,
        CancellationToken cancellationToken)
    {
        var items = new List<(long Sku, string OfferId, long ProductId)>();
        var lastId = string.Empty;

        for (var page = 0; page < 20; page++)
        {
            var content = await PostOzonJsonAsync(
                "/v1/supply-order/bundle",
                new
                {
                    bundle_ids = new[] { bundleId },
                    limit = 100,
                    last_id = lastId
                },
                cancellationToken);

            using var document = JsonDocument.Parse(content);
            var root = ResolveOzonResultElement(document.RootElement);
            if (root.TryGetProperty("items", out var bundleItems) &&
                bundleItems.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in bundleItems.EnumerateArray())
                {
                    var sku = item.TryGetProperty("sku", out var skuProperty) && skuProperty.TryGetInt64(out var parsedSku)
                        ? parsedSku
                        : 0L;
                    var offerId = item.TryGetProperty("offer_id", out var offerProperty)
                        ? offerProperty.GetString() ?? string.Empty
                        : string.Empty;
                    var productId = item.TryGetProperty("product_id", out var productProperty) &&
                                    productProperty.TryGetInt64(out var parsedProductId)
                        ? parsedProductId
                        : 0L;

                    if (sku > 0 || !string.IsNullOrWhiteSpace(offerId) || productId > 0)
                    {
                        items.Add((sku, offerId, productId));
                    }
                }
            }

            var hasNext = root.TryGetProperty("has_next", out var hasNextProperty) &&
                          hasNextProperty.ValueKind == JsonValueKind.True;
            var nextLastId = root.TryGetProperty("last_id", out var lastIdProperty)
                ? ReadJsonElementString(lastIdProperty)
                : string.Empty;

            if (!hasNext || string.IsNullOrWhiteSpace(nextLastId) || nextLastId == lastId)
            {
                break;
            }

            lastId = nextLastId;
        }

        return items;
    }

    private async Task<List<OzonSupplyBundleItemQuantity>> GetSupplyBundleItemQuantitiesAsync(
        string bundleId,
        CancellationToken cancellationToken)
    {
        var items = new List<OzonSupplyBundleItemQuantity>();
        var lastId = string.Empty;

        for (var page = 0; page < 20; page++)
        {
            var content = await PostOzonJsonAsync(
                "/v1/supply-order/bundle",
                new
                {
                    bundle_ids = new[] { bundleId },
                    limit = 100,
                    last_id = lastId
                },
                cancellationToken);

            using var document = JsonDocument.Parse(content);
            var root = ResolveOzonResultElement(document.RootElement);
            if (root.TryGetProperty("items", out var bundleItems) &&
                bundleItems.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in bundleItems.EnumerateArray())
                {
                    var sku = item.TryGetProperty("sku", out var skuProperty) && skuProperty.TryGetInt64(out var parsedSku)
                        ? parsedSku
                        : 0L;
                    var offerId = item.TryGetProperty("offer_id", out var offerProperty)
                        ? offerProperty.GetString() ?? string.Empty
                        : string.Empty;
                    var productId = item.TryGetProperty("product_id", out var productProperty) &&
                                    productProperty.TryGetInt64(out var parsedProductId)
                        ? parsedProductId
                        : 0L;
                    var productName = ReadOzonSupplyStringProperty(
                        item,
                        "product_name",
                        "productName",
                        "name",
                        "title",
                        "offer_name",
                        "item_name");
                    var quantity = ReadOzonSupplyItemQuantity(item);

                    if ((sku > 0 || !string.IsNullOrWhiteSpace(offerId) || productId > 0) && quantity > 0)
                    {
                        items.Add(new OzonSupplyBundleItemQuantity(sku, offerId, productId, quantity, productName));
                    }
                }
            }

            var hasNext = root.TryGetProperty("has_next", out var hasNextProperty) &&
                          hasNextProperty.ValueKind == JsonValueKind.True;
            var nextLastId = root.TryGetProperty("last_id", out var lastIdProperty)
                ? ReadJsonElementString(lastIdProperty)
                : string.Empty;

            if (!hasNext || string.IsNullOrWhiteSpace(nextLastId) || nextLastId == lastId)
            {
                break;
            }

            lastId = nextLastId;
        }

        return items;
    }

    private async Task<List<OzonSupplyBundleItemQuantity>> GetSupplyOrderItemQuantitiesAsync(
        long orderId,
        CancellationToken cancellationToken)
    {
        var items = new List<OzonSupplyBundleItemQuantity>();
        var content = await PostOzonJsonAsync(
            "/v3/supply-order/get",
            new
            {
                order_ids = new[] { orderId.ToString(CultureInfo.InvariantCulture) }
            },
            cancellationToken);

        using var document = JsonDocument.Parse(content);
        var root = ResolveOzonResultElement(document.RootElement);
        CollectOzonSupplyItems(root, items);

        if (!root.TryGetProperty("orders", out var orders) ||
            orders.ValueKind != JsonValueKind.Array)
        {
            return items;
        }

        foreach (var order in orders.EnumerateArray())
        {
            if (!order.TryGetProperty("supplies", out var supplies) ||
                supplies.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            foreach (var supply in supplies.EnumerateArray())
            {
                CollectOzonSupplyItems(supply, items);

                if (!supply.TryGetProperty("bundle_id", out var bundleProperty))
                {
                    continue;
                }

                var bundleId = bundleProperty.GetString();
                if (string.IsNullOrWhiteSpace(bundleId))
                {
                    continue;
                }

                items.AddRange(await GetSupplyBundleItemQuantitiesAsync(bundleId, cancellationToken));
            }
        }

        return items;
    }

    private async Task<List<OzonSupplyBundleItemQuantity>> GetSupplyOrderItemsEndpointQuantitiesAsync(
        long orderId,
        CancellationToken cancellationToken)
    {
        var items = new List<OzonSupplyBundleItemQuantity>();

        for (var page = 1; page <= 50; page++)
        {
            var content = await PostOzonJsonAsync(
                "/v1/supply-order/items",
                new
                {
                    page,
                    page_size = 100,
                    supply_order_id = orderId
                },
                cancellationToken);

            using var document = JsonDocument.Parse(content);
            var root = ResolveOzonResultElement(document.RootElement);
            CollectOzonSupplyItems(root, items);

            var hasNext = root.TryGetProperty("has_next", out var hasNextProperty) &&
                          hasNextProperty.ValueKind == JsonValueKind.True;
            if (!hasNext)
            {
                break;
            }
        }

        return items;
    }

    private static bool TryReadJsonLong(JsonElement value, out long result)
    {
        result = 0;
        return value.ValueKind switch
        {
            JsonValueKind.Number => value.TryGetInt64(out result),
            JsonValueKind.String => long.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out result),
            _ => false
        };
    }

    private static void CollectOzonSupplyOrderIds(JsonElement root, List<long> orderIds)
    {
        foreach (var propertyName in new[] { "order_ids", "supply_order_ids" })
        {
            if (!root.TryGetProperty(propertyName, out var ids) || ids.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            foreach (var item in ids.EnumerateArray())
            {
                if (TryReadJsonLong(item, out var orderId) && orderId > 0)
                {
                    orderIds.Add(orderId);
                }
            }
        }

        foreach (var arrayName in new[] { "orders", "items", "supply_orders" })
        {
            if (!root.TryGetProperty(arrayName, out var items) || items.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            foreach (var item in items.EnumerateArray())
            {
                foreach (var idName in new[] { "id", "order_id", "supply_order_id", "supply_order_number" })
                {
                    if (item.TryGetProperty(idName, out var idProperty) &&
                        TryReadJsonLong(idProperty, out var orderId) &&
                        orderId > 0)
                    {
                        orderIds.Add(orderId);
                        break;
                    }
                }
            }
        }
    }

    private static void CollectOzonSupplyItems(JsonElement root, List<OzonSupplyBundleItemQuantity> items)
    {
        CollectOzonSupplyItems(root, items, new HashSet<string>(StringComparer.OrdinalIgnoreCase));
    }

    private static void CollectOzonSupplyItems(
        JsonElement root,
        List<OzonSupplyBundleItemQuantity> items,
        HashSet<string> seenItems)
    {
        if (root.ValueKind == JsonValueKind.Object)
        {
            if (TryReadOzonSupplyItemQuantity(root, out var quantity))
            {
                var identity = $"{quantity.Sku}|{quantity.OfferId}|{quantity.ProductId}|{quantity.Quantity}|{quantity.ProductName}";
                if (seenItems.Add(identity))
                {
                    items.Add(quantity);
                }
            }

            foreach (var property in root.EnumerateObject())
            {
                if (property.Value.ValueKind is JsonValueKind.Object or JsonValueKind.Array)
                {
                    CollectOzonSupplyItems(property.Value, items, seenItems);
                }
            }

            return;
        }

        if (root.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        foreach (var item in root.EnumerateArray())
        {
            CollectOzonSupplyItems(item, items, seenItems);
        }
    }

    private static bool TryReadOzonSupplyItemQuantity(JsonElement item, out OzonSupplyBundleItemQuantity quantity)
    {
        var sku = ReadOzonSupplyLongProperty(item, "sku", "sku_id", "skuId");
        var offerId = ReadOzonSupplyStringProperty(
            item,
            "offer_id",
            "offerId",
            "seller_sku",
            "sellerSku",
            "item_code",
            "article",
            "barcode");
        var productId = ReadOzonSupplyLongProperty(item, "product_id", "productId");
        var productName = ReadOzonSupplyStringProperty(
            item,
            "product_name",
            "productName",
            "name",
            "title",
            "offer_name",
            "item_name");

        if (sku <= 0)
        {
            sku = ReadOzonSupplyLongPropertyDeep(item, "sku", "sku_id", "skuId");
        }

        if (string.IsNullOrWhiteSpace(offerId))
        {
            offerId = ReadOzonSupplyStringPropertyDeep(
                item,
                "offer_id",
                "offerId",
                "seller_sku",
                "sellerSku",
                "item_code",
                "article",
                "barcode");
        }

        if (productId <= 0)
        {
            productId = ReadOzonSupplyLongPropertyDeep(item, "product_id", "productId");
        }

        if (string.IsNullOrWhiteSpace(productName))
        {
            productName = ReadOzonSupplyStringPropertyDeep(
                item,
                "product_name",
                "productName",
                "name",
                "title",
                "offer_name",
                "item_name");
        }

        var count = ReadOzonSupplyItemQuantity(item);

        quantity = new OzonSupplyBundleItemQuantity(sku, offerId, productId, count, productName);
        return count > 0 && (sku > 0 || !string.IsNullOrWhiteSpace(offerId) || productId > 0);
    }

    private static long ReadOzonSupplyLongProperty(JsonElement item, params string[] propertyNames)
    {
        foreach (var propertyName in propertyNames)
        {
            if (item.TryGetProperty(propertyName, out var property) &&
                TryReadJsonLong(property, out var result))
            {
                return result;
            }
        }

        return 0;
    }

    private static string ReadOzonSupplyStringProperty(JsonElement item, params string[] propertyNames)
    {
        foreach (var propertyName in propertyNames)
        {
            if (!item.TryGetProperty(propertyName, out var property))
            {
                continue;
            }

            var value = ReadJsonElementString(property);
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }
        }

        return string.Empty;
    }

    private static long ReadOzonSupplyLongPropertyDeep(JsonElement item, params string[] propertyNames)
    {
        if (item.ValueKind == JsonValueKind.Object)
        {
            var direct = ReadOzonSupplyLongProperty(item, propertyNames);
            if (direct > 0)
            {
                return direct;
            }

            foreach (var property in item.EnumerateObject())
            {
                if (property.Value.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array))
                {
                    continue;
                }

                var nested = ReadOzonSupplyLongPropertyDeep(property.Value, propertyNames);
                if (nested > 0)
                {
                    return nested;
                }
            }
        }

        if (item.ValueKind != JsonValueKind.Array)
        {
            return 0;
        }

        foreach (var child in item.EnumerateArray())
        {
            var nested = ReadOzonSupplyLongPropertyDeep(child, propertyNames);
            if (nested > 0)
            {
                return nested;
            }
        }

        return 0;
    }

    private static string ReadOzonSupplyStringPropertyDeep(JsonElement item, params string[] propertyNames)
    {
        if (item.ValueKind == JsonValueKind.Object)
        {
            var direct = ReadOzonSupplyStringProperty(item, propertyNames);
            if (!string.IsNullOrWhiteSpace(direct))
            {
                return direct;
            }

            foreach (var property in item.EnumerateObject())
            {
                if (property.Value.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array))
                {
                    continue;
                }

                var nested = ReadOzonSupplyStringPropertyDeep(property.Value, propertyNames);
                if (!string.IsNullOrWhiteSpace(nested))
                {
                    return nested;
                }
            }
        }

        if (item.ValueKind != JsonValueKind.Array)
        {
            return string.Empty;
        }

        foreach (var child in item.EnumerateArray())
        {
            var nested = ReadOzonSupplyStringPropertyDeep(child, propertyNames);
            if (!string.IsNullOrWhiteSpace(nested))
            {
                return nested;
            }
        }

        return string.Empty;
    }

    private static string ReadJsonElementString(JsonElement value)
    {
        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString() ?? string.Empty,
            JsonValueKind.Number => value.ToString(),
            _ => string.Empty
        };
    }

    private static int ReadOzonSupplyItemQuantity(JsonElement item)
    {
        foreach (var propertyName in new[]
                 {
                     "quantity",
                     "count",
                     "items_count",
                     "sku_quantity",
                     "available_quantity",
                     "total_quantity",
                     "fact_quantity",
                     "accepted_quantity",
                     "declared_quantity",
                     "requested_quantity",
                     "bundle_quantity",
                     "planned_quantity",
                     "valid_quantity",
                     "real_quantity",
                     "quantity_info",
                     "quantityInfo",
                     "amount"
                 })
        {
            if (!item.TryGetProperty(propertyName, out var property))
            {
                continue;
            }

            if (property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out var number))
            {
                return Math.Max(0, number);
            }

            if (property.ValueKind == JsonValueKind.String &&
                int.TryParse(property.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
            {
                return Math.Max(0, parsed);
            }

            if (property.ValueKind == JsonValueKind.Object)
            {
                foreach (var nestedName in new[]
                         {
                             "value",
                             "count",
                             "quantity",
                             "items_count",
                             "total_quantity",
                             "fact_quantity",
                             "accepted_quantity",
                             "declared_quantity",
                             "requested_quantity",
                             "planned_quantity",
                             "valid_quantity",
                             "real_quantity"
                         })
                {
                    if (property.TryGetProperty(nestedName, out var nestedProperty) &&
                        TryReadJsonLong(nestedProperty, out var nested) &&
                        nested > 0)
                    {
                        return (int)Math.Min(int.MaxValue, nested);
                    }
                }
            }
        }

        return 0;
    }

    private static JsonElement ResolveOzonResultElement(JsonElement root)
    {
        return root.TryGetProperty("result", out var result) && result.ValueKind == JsonValueKind.Object
            ? result
            : root;
    }

    private static void MergeMostRecentDate(Dictionary<long, DateOnly> map, long key, DateOnly date)
    {
        if (!map.TryGetValue(key, out var existing) || date > existing)
        {
            map[key] = date;
        }
    }

    private static void MergeMostRecentOfferDate(Dictionary<string, DateOnly> map, string offerId, DateOnly date)
    {
        var normalizedOfferId = offerId.Trim();
        if (string.IsNullOrWhiteSpace(normalizedOfferId))
        {
            return;
        }

        if (!map.TryGetValue(normalizedOfferId, out var existing) || date > existing)
        {
            map[normalizedOfferId] = date;
        }
    }

    private async Task<IReadOnlyDictionary<long, int>> TryGetAnalyticsDaysWithoutSalesBySkuAsync(
        IEnumerable<long> skus,
        CancellationToken cancellationToken)
    {
        var result = new Dictionary<long, int>();
        var skuList = skus.Where(sku => sku > 0).Distinct().ToList();
        if (skuList.Count == 0)
        {
            return result;
        }

        foreach (var batch in skuList.Chunk(100))
        {
            try
            {
                var content = await PostOzonJsonAsync(
                    "/v1/analytics/stocks",
                    new { skus = batch.Select(sku => sku.ToString()).ToArray() },
                    cancellationToken);

                using var document = JsonDocument.Parse(content);
                if (!TryGetAnalyticsStocksItems(document.RootElement, out var items))
                {
                    continue;
                }

                foreach (var item in items.EnumerateArray())
                {
                    if (!TryReadAnalyticsStockSku(item, out var sku))
                    {
                        continue;
                    }

                    if (!TryReadDaysWithoutSales(item, out var days))
                    {
                        continue;
                    }

                    if (result.TryGetValue(sku, out var existing))
                    {
                        if (days > existing)
                        {
                            result[sku] = days;
                        }
                    }
                    else
                    {
                        result[sku] = days;
                    }
                }
            }
            catch (Exception)
            {
                // Analytics stocks may be unavailable for some accounts.
            }
        }

        return result;
    }

    private static bool TryGetAnalyticsStocksItems(JsonElement root, out JsonElement items)
    {
        if (root.TryGetProperty("items", out items) && items.ValueKind == JsonValueKind.Array)
        {
            return true;
        }

        if (root.TryGetProperty("result", out var result) &&
            result.TryGetProperty("items", out items) &&
            items.ValueKind == JsonValueKind.Array)
        {
            return true;
        }

        items = default;
        return false;
    }

    private static bool TryReadAnalyticsStockSku(JsonElement item, out long sku)
    {
        sku = 0;
        if (!item.TryGetProperty("sku", out var skuProperty))
        {
            return false;
        }

        if (skuProperty.ValueKind == JsonValueKind.Number && skuProperty.TryGetInt64(out sku))
        {
            return sku > 0;
        }

        if (skuProperty.ValueKind == JsonValueKind.String &&
            long.TryParse(skuProperty.GetString(), out sku))
        {
            return sku > 0;
        }

        return false;
    }

    private static bool TryReadDaysWithoutSales(JsonElement item, out int days)
    {
        days = 0;
        if (item.TryGetProperty("days_without_sales", out var daysProperty))
        {
            if (daysProperty.ValueKind == JsonValueKind.Number && daysProperty.TryGetInt32(out days))
            {
                return true;
            }

            if (daysProperty.ValueKind == JsonValueKind.String &&
                int.TryParse(daysProperty.GetString(), out days))
            {
                return true;
            }
        }

        if (!item.TryGetProperty("days_without_sales_cluster", out var clusterProperty) ||
            clusterProperty.ValueKind != JsonValueKind.Array)
        {
            return false;
        }

        var maxDays = 0;
        var found = false;
        foreach (var cluster in clusterProperty.EnumerateArray())
        {
            if (cluster.ValueKind == JsonValueKind.Number && cluster.TryGetInt32(out var clusterDays))
            {
                maxDays = Math.Max(maxDays, clusterDays);
                found = true;
                continue;
            }

            if (cluster.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            if (cluster.TryGetProperty("days_without_sales", out var clusterDaysProperty) &&
                clusterDaysProperty.ValueKind == JsonValueKind.Number &&
                clusterDaysProperty.TryGetInt32(out clusterDays))
            {
                maxDays = Math.Max(maxDays, clusterDays);
                found = true;
            }
        }

        if (found)
        {
            days = maxDays;
            return true;
        }

        return false;
    }

    private static bool TryParseOzonSupplyCompletionDate(string? value, out DateOnly date)
    {
        date = default;
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        if (DateTimeOffset.TryParse(value, out var parsedDateTime))
        {
            var moscow = TimeZoneInfo.FindSystemTimeZoneById(
                OperatingSystem.IsWindows() ? "Russian Standard Time" : "Europe/Moscow");
            date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(parsedDateTime, moscow).DateTime);
            return true;
        }

        return DateOnly.TryParse(value, out date);
    }

    private static bool TryParseOzonDate(string? value, out DateOnly date)
    {
        date = default;
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        if (DateOnly.TryParse(value, out date))
        {
            return true;
        }

        if (DateTimeOffset.TryParse(value, out var parsedDateTime))
        {
            date = DateOnly.FromDateTime(parsedDateTime.UtcDateTime);
            return true;
        }

        return false;
    }

    private async Task<string> PostOzonJsonAsync(string path, object body, CancellationToken cancellationToken)
    {
        EnsureConfigured();

        const int maxAttempts = 6;
        for (var attempt = 0; attempt < maxAttempts; attempt++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, path);
            request.Headers.Add("Client-Id", _credentials.ClientId);
            request.Headers.Add("Api-Key", _credentials.ApiKey);
            request.Content = JsonContent.Create(body);

            using var response = await httpClient.SendAsync(request, cancellationToken);
            var content = await response.Content.ReadAsStringAsync(cancellationToken);

            var isRateLimited = response.StatusCode == HttpStatusCode.TooManyRequests ||
                                IsOzonRateLimitResponse(content);
            if (isRateLimited && attempt < maxAttempts - 1)
            {
                await Task.Delay(TimeSpan.FromSeconds(attempt + 1), cancellationToken);
                continue;
            }

            if (!response.IsSuccessStatusCode)
            {
                throw new HttpRequestException(
                    $"Ozon API returned {(int)response.StatusCode}: {content}",
                    null,
                    response.StatusCode);
            }

            return content;
        }

        throw new HttpRequestException("Ozon API request failed after retries.");
    }

    private static bool IsOzonRateLimitResponse(string content)
    {
        if (string.IsNullOrWhiteSpace(content))
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(content);
            return document.RootElement.TryGetProperty("code", out var code) &&
                   ((code.ValueKind == JsonValueKind.Number && code.TryGetInt32(out var number) && number == 8) ||
                    (code.ValueKind == JsonValueKind.String && code.GetString() == "8"));
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool IsCollectingStatus(string status)
    {
        var value = status.Trim().ToLowerInvariant();
        return value is "awaiting_deliver" or "awaiting_packaging"
            || value.Contains("awaiting_deliver", StringComparison.Ordinal)
            || value.Contains("packaging", StringComparison.Ordinal)
            || value.Contains("собир", StringComparison.Ordinal)
            || value.Contains("упаков", StringComparison.Ordinal);
    }

    private static List<OzonAnalyticsRow> BuildFinanceRows(IEnumerable<OzonFinanceOperation> financeOperations) =>
        financeOperations
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

    private static decimal SumCancelledOrderExpenses(IEnumerable<OzonAnalyticsRow> orderRows) =>
        orderRows
            .Where(row => row.Status.Equals("cancelled", StringComparison.OrdinalIgnoreCase))
            .Sum(row =>
            {
                var logisticsExpense = Math.Abs(row.LogisticsAmount);
                var payoutExpense = row.Payout < 0 ? Math.Abs(row.Payout) : 0m;
                return logisticsExpense + payoutExpense;
            });

    private static decimal SumCancelledMissedProfit(IEnumerable<OzonAnalyticsRow> orderRows)
    {
        var cancelledRows = orderRows
            .Where(row => row.Status.Equals("cancelled", StringComparison.OrdinalIgnoreCase))
            .ToList();

        if (cancelledRows.Count == 0)
        {
            return 0m;
        }

        var fallbackCommissionRate = CalculateAverageCommissionRate(
            orderRows.Where(row => !row.Status.Equals("cancelled", StringComparison.OrdinalIgnoreCase)));

        var totalRevenue = cancelledRows.Sum(row => row.Revenue);
        var totalRowLogistics = cancelledRows.Sum(row => Math.Abs(row.LogisticsAmount));
        var totalExpenses = SumCancelledOrderExpenses(cancelledRows);
        var extraLogisticsPool = Math.Max(0m, totalExpenses - totalRowLogistics);

        return cancelledRows.Sum(row =>
            CalculateCancelledMissedProfitRow(
                row,
                fallbackCommissionRate,
                totalRevenue,
                extraLogisticsPool));
    }

    private static decimal CalculateAverageCommissionRate(IEnumerable<OzonAnalyticsRow> rows)
    {
        var eligible = rows
            .Where(row => row.Revenue > 0 && row.CommissionAmount > 0)
            .ToList();
        if (eligible.Count == 0)
        {
            return 0m;
        }

        var totalRevenue = eligible.Sum(row => row.Revenue);
        var totalCommission = eligible.Sum(row => row.CommissionAmount);
        return totalRevenue > 0 ? Math.Round(totalCommission / totalRevenue * 100m, 2) : 0m;
    }

    private static decimal CalculateCancelledMissedProfitRow(
        OzonAnalyticsRow row,
        decimal fallbackCommissionRate,
        decimal totalCancelledRevenue,
        decimal extraLogisticsPool)
    {
        var revenue = row.Revenue;
        if (revenue <= 0)
        {
            return 0m;
        }

        if (row.Payout > 0)
        {
            return row.Payout;
        }

        var commission = row.CommissionAmount;
        if (commission <= 0 && fallbackCommissionRate > 0)
        {
            commission = Math.Round(revenue * fallbackCommissionRate / 100m, 2);
        }

        var logistics = Math.Abs(row.LogisticsAmount);
        if (logistics <= 0 && extraLogisticsPool > 0 && totalCancelledRevenue > 0)
        {
            logistics = Math.Round(extraLogisticsPool * revenue / totalCancelledRevenue, 2);
        }

        return Math.Max(0m, Math.Round(revenue - commission - logistics, 2));
    }

    private static List<OzonAnalyticsRow> BuildOrderRows(
        IReadOnlyList<OzonPosting> postings,
        IReadOnlyList<OzonAnalyticsRow> financeRows,
        TimeZoneInfo timeZone)
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
                    if (payout == 0 && postingFinance is { Payout: not 0 })
                    {
                        payout = Math.Round(postingFinance.Payout * revenueShare, 2);
                    }

                    var logisticsAmount = financeRow?.LogisticsAmount ?? 0m;
                    if (logisticsAmount == 0 && postingFinance is { LogisticsAmount: not 0 })
                    {
                        logisticsAmount = Math.Round(Math.Abs(postingFinance.LogisticsAmount) * revenueShare, 2);
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
                        ResolvePostingOperationDate(posting, financeRow?.OperationDate, timeZone));
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

    private static string ResolvePostingOperationDate(
        OzonPosting posting,
        string? financeOperationDate,
        TimeZoneInfo? timeZone = null)
    {
        var raw = ResolvePostingOperationDateRaw(posting, financeOperationDate);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return string.Empty;
        }

        var zone = timeZone ?? ResolveDefaultAnalyticsTimeZone();
        if (TryParseOperationDate(raw, zone, out var date))
        {
            return date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        return NormalizeOperationDate(raw);
    }

    private static string? ResolvePostingOperationDateRaw(OzonPosting posting, string? financeOperationDate)
    {
        if (!string.IsNullOrWhiteSpace(financeOperationDate))
        {
            return financeOperationDate.Trim();
        }

        var status = posting.Status.Trim().ToLowerInvariant();
        var cancellationDate = posting.Cancellation?.CancelledAt ?? posting.Cancellation?.CancelDate;

        return status switch
        {
            "cancelled" => FirstDateRaw(cancellationDate, posting.InProcessAt, posting.CreatedAt),
            "delivered" => FirstDateRaw(posting.DeliveringDate, posting.InProcessAt, posting.CreatedAt),
            "delivering" => FirstDateRaw(posting.InProcessAt, posting.CreatedAt, posting.ShipmentDate),
            "awaiting_deliver" => FirstDateRaw(posting.InProcessAt, posting.CreatedAt, posting.ShipmentDate),
            _ => FirstDateRaw(posting.InProcessAt, posting.DeliveringDate, posting.CreatedAt, posting.ShipmentDate)
        };
    }

    private static bool IsPostingInLocalDateRange(
        OzonPosting posting,
        DateOnly dateFrom,
        DateOnly dateTo,
        TimeZoneInfo timeZone) =>
        TryResolvePostingOrderDateOnly(posting, timeZone, out var date) &&
        date >= dateFrom &&
        date <= dateTo;

    private static bool TryResolvePostingOrderDateOnly(
        OzonPosting posting,
        TimeZoneInfo timeZone,
        out DateOnly date)
    {
        date = default;
        var orderDate = ResolvePostingOrderDate(posting, timeZone);
        return !string.IsNullOrWhiteSpace(orderDate) &&
               DateOnly.TryParse(orderDate, CultureInfo.InvariantCulture, out date);
    }

    private static string ResolvePostingOrderDate(OzonPosting posting, TimeZoneInfo timeZone)
    {
        var raw = ResolvePostingOrderDateRaw(posting);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return string.Empty;
        }

        if (TryParseOperationDate(raw, timeZone, out var date))
        {
            return date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        return NormalizeOperationDate(raw);
    }

    private static string? ResolvePostingOrderDateRaw(OzonPosting posting)
    {
        if (posting.Status.Equals("cancelled", StringComparison.OrdinalIgnoreCase))
        {
            var cancellationDate = posting.Cancellation?.CancelledAt ?? posting.Cancellation?.CancelDate;
            return FirstDateRaw(cancellationDate, posting.InProcessAt, posting.CreatedAt);
        }

        return FirstDateRaw(posting.InProcessAt, posting.CreatedAt, posting.ShipmentDate);
    }

    private static bool TryResolvePostingOperationDateOnly(
        OzonPosting posting,
        string? financeOperationDate,
        TimeZoneInfo timeZone,
        out DateOnly date)
    {
        date = default;
        var operationDate = ResolvePostingOperationDate(posting, financeOperationDate, timeZone);
        return !string.IsNullOrWhiteSpace(operationDate) &&
               DateOnly.TryParse(operationDate, CultureInfo.InvariantCulture, out date);
    }

    private static string? FirstDateRaw(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }
        }

        return null;
    }

    private static string FirstDate(params string?[] values)
    {
        var raw = FirstDateRaw(values);
        return string.IsNullOrWhiteSpace(raw) ? string.Empty : NormalizeOperationDate(raw);
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

    private static bool IsRecoverableOzonException(Exception exception) =>
        exception is InvalidOperationException or HttpRequestException or TaskCanceledException or TimeoutException;

    private static TimeZoneInfo ResolveDefaultAnalyticsTimeZone()
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Europe/Moscow");
        }
        catch (TimeZoneNotFoundException)
        {
        }
        catch (InvalidTimeZoneException)
        {
        }

        return TimeZoneInfo.Utc;
    }

    private static (string Since, string To) FormatAnalyticsDateRange(
        DateOnly dateFrom,
        DateOnly dateTo,
        TimeZoneInfo timeZone)
    {
        var startLocal = dateFrom.ToDateTime(TimeOnly.MinValue);
        var endLocal = dateTo.ToDateTime(new TimeOnly(23, 59, 59));
        var start = new DateTimeOffset(startLocal, timeZone.GetUtcOffset(startLocal));
        var end = new DateTimeOffset(endLocal, timeZone.GetUtcOffset(endLocal));
        return (
            start.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture),
            end.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture));
    }

    private static (string Since, string To) FormatFinanceDateRange(DateOnly dateFrom, DateOnly dateTo)
    {
        var start = new DateTimeOffset(dateFrom.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        var end = new DateTimeOffset(dateTo.ToDateTime(new TimeOnly(23, 59, 59)), TimeSpan.Zero);
        return (
            start.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture),
            end.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture));
    }

    private static bool TryParseOperationDate(string? value, TimeZoneInfo timeZone, out DateOnly date)
    {
        date = default;
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        if (DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed))
        {
            var local = TimeZoneInfo.ConvertTime(parsed, timeZone);
            date = DateOnly.FromDateTime(local.DateTime);
            return true;
        }

        var trimmed = value.Trim();
        if (trimmed.Length >= 10 && DateOnly.TryParse(trimmed.AsSpan(0, 10), CultureInfo.InvariantCulture, out date))
        {
            return true;
        }

        return false;
    }

    private static List<OzonSalesChartPoint> BuildSalesChartPoints(
        DateOnly dateFrom,
        DateOnly dateTo,
        string groupBy,
        IReadOnlyDictionary<string, (HashSet<string> Postings, decimal Revenue)> buckets)
    {
        var culture = CultureInfo.GetCultureInfo("ru-RU");
        var points = new List<OzonSalesChartPoint>();

        if (groupBy == "day")
        {
            for (var cursor = dateFrom; cursor <= dateTo; cursor = cursor.AddDays(1))
            {
                var key = cursor.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                var label = cursor.ToString("dd.MM", CultureInfo.InvariantCulture);
                var orders = buckets.TryGetValue(key, out var bucket) ? bucket.Postings.Count : 0;
                var revenue = buckets.TryGetValue(key, out bucket) ? bucket.Revenue : 0m;
                points.Add(new OzonSalesChartPoint(label, key, orders, revenue));
            }

            return points;
        }

        var monthCursor = new DateOnly(dateFrom.Year, dateFrom.Month, 1);
        var monthEnd = new DateOnly(dateTo.Year, dateTo.Month, 1);
        while (monthCursor <= monthEnd)
        {
            var key = monthCursor.ToString("yyyy-MM", CultureInfo.InvariantCulture);
            var label = monthCursor.ToString("MMM yy", culture);
            var orders = buckets.TryGetValue(key, out var bucket) ? bucket.Postings.Count : 0;
            var revenue = buckets.TryGetValue(key, out bucket) ? bucket.Revenue : 0m;
            points.Add(new OzonSalesChartPoint(label, key, orders, revenue));
            monthCursor = monthCursor.AddMonths(1);
        }

        return points;
    }

    private async Task<List<OzonFinanceOperation>> GetAllFinanceTransactionsAsync(
        DateOnly dateFrom,
        DateOnly dateTo,
        TimeZoneInfo timeZone,
        CancellationToken cancellationToken)
    {
        return await GetAllFinanceTransactionsAsync(dateFrom, dateTo, string.Empty, timeZone, cancellationToken);
    }

    private async Task<List<OzonFinanceOperation>> GetAllFinanceTransactionsAsync(
        DateOnly dateFrom,
        DateOnly dateTo,
        string postingNumber,
        TimeZoneInfo timeZone,
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
                timeZone,
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
        TimeZoneInfo timeZone,
        int page,
        CancellationToken cancellationToken)
    {
        EnsureConfigured();

        var (since, to) = FormatFinanceDateRange(dateFrom, dateTo);

        using var request = new HttpRequestMessage(HttpMethod.Post, "/v3/finance/transaction/list");
        request.Headers.Add("Client-Id", _credentials.ClientId);
        request.Headers.Add("Api-Key", _credentials.ApiKey);
        request.Content = JsonContent.Create(new OzonFinanceTransactionRequest(
            new OzonFinanceFilter(
                new OzonFinanceDateRange(
                    since,
                    to),
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
        TimeZoneInfo timeZone,
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
                    timeZone,
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
            .Select(group => group.OrderByDescending(ScorePostingCompleteness).First())
            .ToList();
    }

    private static int ScorePostingCompleteness(OzonPosting posting)
    {
        var score = 0;
        if (!string.IsNullOrWhiteSpace(posting.InProcessAt))
        {
            score += 20;
        }

        if (!string.IsNullOrWhiteSpace(posting.DeliveringDate))
        {
            score += 10;
        }

        if (!string.IsNullOrWhiteSpace(posting.ShipmentDate))
        {
            score += 5;
        }

        if (!string.IsNullOrWhiteSpace(posting.CreatedAt))
        {
            score += 2;
        }

        if (posting.Products.Count > 0)
        {
            score += 1;
        }

        return score;
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

    private async Task<OzonFinanceBalanceResponse> GetFinanceBalanceAsync(
        DateOnly dateFrom,
        DateOnly dateTo,
        CancellationToken cancellationToken)
    {
        EnsureConfigured();

        using var request = new HttpRequestMessage(HttpMethod.Post, "/v1/finance/balance");
        request.Headers.Add("Client-Id", _credentials.ClientId);
        request.Headers.Add("Api-Key", _credentials.ApiKey);
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
        string status,
        TimeZoneInfo timeZone,
        CancellationToken cancellationToken)
    {
        var response = await SendPostingRequestAsync(
            "/v2/posting/fbo/list",
            dateFrom,
            dateTo,
            status,
            timeZone,
            1000,
            0,
            cancellationToken);

        var data = JsonSerializer.Deserialize<OzonFboPostingListResponse>(response, JsonOptions)
            ?? throw new InvalidOperationException("Ozon API returned an empty response.");

        return data.Result.ToList();
    }

    private async Task<List<OzonPosting>> GetFbsPostingsAsync(
        DateOnly dateFrom,
        DateOnly dateTo,
        string status,
        TimeZoneInfo timeZone,
        CancellationToken cancellationToken)
    {
        var postings = new List<OzonPosting>();
        var offset = 0;
        const int limit = 1000;

        while (true)
        {
            var response = await SendPostingRequestAsync(
                "/v3/posting/fbs/list",
                dateFrom,
                dateTo,
                status,
                timeZone,
                limit,
                offset,
                cancellationToken);

            var data = JsonSerializer.Deserialize<OzonPostingListResponse>(response, JsonOptions)
                ?? throw new InvalidOperationException("Ozon API returned an empty response.");

            postings.AddRange(data.Result.Postings);
            if (!data.Result.HasNext)
            {
                break;
            }

            offset += limit;
        }

        return postings;
    }

    private async Task<string> SendPostingRequestAsync(
        string path,
        DateOnly dateFrom,
        DateOnly dateTo,
        string status,
        TimeZoneInfo timeZone,
        int limit,
        int offset,
        CancellationToken cancellationToken)
    {
        EnsureConfigured();

        var (since, to) = FormatAnalyticsDateRange(dateFrom, dateTo, timeZone);

        using var request = new HttpRequestMessage(HttpMethod.Post, path);
        request.Headers.Add("Client-Id", _credentials.ClientId);
        request.Headers.Add("Api-Key", _credentials.ApiKey);
        request.Content = JsonContent.Create(new OzonPostingListRequest(
            "ASC",
            new OzonPostingFilter(
                since,
                to,
                status),
            limit,
            offset,
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
        var distinctIds = productIds.Where(id => id > 0).Distinct().ToArray();
        if (distinctIds.Length == 0)
        {
            return [];
        }

        if (distinctIds.Length > 1000)
        {
            var result = new List<OzonProductSummary>();
            foreach (var batch in distinctIds.Chunk(1000))
            {
                result.AddRange(await GetProductInfoAsync(batch, cancellationToken));
            }

            return result;
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, "/v3/product/info/list");
        request.Headers.Add("Client-Id", _credentials.ClientId);
        request.Headers.Add("Api-Key", _credentials.ApiKey);
        request.Content = JsonContent.Create(new OzonProductInfoListRequest(distinctIds));

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

        return data.Items
            .GroupBy(item => item.Id)
            .Select(group =>
            {
                var item = group.First();
                var sku = item.Sku ?? item.Sources.FirstOrDefault()?.Sku;
                var createdAt = item.CreatedAt ?? item.Sources.FirstOrDefault()?.CreatedAt;
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
                    item.PrimaryImage.FirstOrDefault() ?? item.Images.FirstOrDefault() ?? string.Empty,
                    createdAt);
            })
            .ToList();
    }

    private static List<OzonFinanceOperation> DeduplicateFinanceOperations(IEnumerable<OzonFinanceOperation> operations) =>
        operations
            .GroupBy(operation => operation.OperationId)
            .Select(group => group.First())
            .ToList();

    private void EnsureConfigured()
    {
        if (string.IsNullOrWhiteSpace(_credentials.ClientId) || string.IsNullOrWhiteSpace(_credentials.ApiKey))
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
    [property: JsonPropertyName("statuses")] OzonProductStatuses? Statuses,
    [property: JsonPropertyName("created_at")] string? CreatedAt = null);

public record OzonProductSource(
    [property: JsonPropertyName("sku")] long Sku,
    [property: JsonPropertyName("created_at")] string? CreatedAt = null);

public record OzonProductStatuses(
    [property: JsonPropertyName("status_name")] string StatusName,
    [property: JsonPropertyName("status_updated_at")] string? StatusUpdatedAt = null);

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
    string ImageUrl,
    string? CreatedAt = null);

public sealed class OzonStockArrivalIndex
{
    private readonly Dictionary<long, DateOnly> _bySku;
    private readonly Dictionary<string, DateOnly> _byOfferId;
    private readonly Dictionary<long, DateOnly> _byProductId;

    public OzonStockArrivalIndex(
        Dictionary<long, DateOnly> bySku,
        Dictionary<string, DateOnly> byOfferId,
        Dictionary<long, DateOnly> byProductId)
    {
        _bySku = bySku;
        _byOfferId = byOfferId;
        _byProductId = byProductId;
    }

    public string? GetSkuDate(long sku) =>
        _bySku.TryGetValue(sku, out var date) ? date.ToString("yyyy-MM-dd") : null;

    public string? GetOfferDate(string offerId) =>
        _byOfferId.TryGetValue(offerId.Trim(), out var date) ? date.ToString("yyyy-MM-dd") : null;

    public string? GetProductDate(long productId) =>
        _byProductId.TryGetValue(productId, out var date) ? date.ToString("yyyy-MM-dd") : null;

    public OzonStockArrivalIndex MergeSupplemental(IReadOnlyDictionary<string, string> supplementalDates)
    {
        var bySku = new Dictionary<long, DateOnly>(_bySku);
        var byOfferId = new Dictionary<string, DateOnly>(_byOfferId, StringComparer.OrdinalIgnoreCase);
        var byProductId = new Dictionary<long, DateOnly>(_byProductId);

        foreach (var (key, rawDate) in supplementalDates)
        {
            if (!TryParseOzonDateStatic(rawDate, out var date))
            {
                continue;
            }

            if (key.StartsWith("sku:", StringComparison.OrdinalIgnoreCase) &&
                long.TryParse(key["sku:".Length..], out var sku) &&
                sku > 0)
            {
                MergeDate(bySku, sku, date);
                continue;
            }

            if (key.StartsWith("offer:", StringComparison.OrdinalIgnoreCase))
            {
                var offerId = key["offer:".Length..].Trim();
                if (!string.IsNullOrWhiteSpace(offerId))
                {
                    MergeOfferDate(byOfferId, offerId, date);
                }

                continue;
            }

            if (key.StartsWith("product:", StringComparison.OrdinalIgnoreCase) &&
                long.TryParse(key["product:".Length..], out var productId) &&
                productId > 0)
            {
                MergeDate(byProductId, productId, date);
            }
        }

        return new OzonStockArrivalIndex(bySku, byOfferId, byProductId);
    }

    public OzonStockArrivalIndex MergeSupplementalGaps(IReadOnlyDictionary<string, string> supplementalDates)
    {
        var bySku = new Dictionary<long, DateOnly>(_bySku);
        var byOfferId = new Dictionary<string, DateOnly>(_byOfferId, StringComparer.OrdinalIgnoreCase);
        var byProductId = new Dictionary<long, DateOnly>(_byProductId);

        foreach (var (key, rawDate) in supplementalDates)
        {
            if (!TryParseOzonDateStatic(rawDate, out var date))
            {
                continue;
            }

            if (key.StartsWith("sku:", StringComparison.OrdinalIgnoreCase) &&
                long.TryParse(key["sku:".Length..], out var sku) &&
                sku > 0 &&
                !bySku.ContainsKey(sku))
            {
                bySku[sku] = date;
                continue;
            }

            if (key.StartsWith("offer:", StringComparison.OrdinalIgnoreCase))
            {
                var offerId = key["offer:".Length..].Trim();
                if (!string.IsNullOrWhiteSpace(offerId) && !byOfferId.ContainsKey(offerId))
                {
                    byOfferId[offerId] = date;
                }

                continue;
            }

            if (key.StartsWith("product:", StringComparison.OrdinalIgnoreCase) &&
                long.TryParse(key["product:".Length..], out var productId) &&
                productId > 0 &&
                !byProductId.ContainsKey(productId))
            {
                byProductId[productId] = date;
            }
        }

        return new OzonStockArrivalIndex(bySku, byOfferId, byProductId);
    }

    private static void MergeDate(Dictionary<long, DateOnly> map, long key, DateOnly date)
    {
        if (!map.TryGetValue(key, out var existing) || date > existing)
        {
            map[key] = date;
        }
    }

    private static void MergeOfferDate(Dictionary<string, DateOnly> map, string offerId, DateOnly date)
    {
        if (!map.TryGetValue(offerId, out var existing) || date > existing)
        {
            map[offerId] = date;
        }
    }

    private static bool TryParseOzonDateStatic(string? value, out DateOnly date)
    {
        date = default;
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        if (DateOnly.TryParse(value, out date))
        {
            return true;
        }

        if (DateTimeOffset.TryParse(value, out var parsedDateTime))
        {
            date = DateOnly.FromDateTime(parsedDateTime.UtcDateTime);
            return true;
        }

        return false;
    }
}

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

public record OzonAnalyticsSnapshot(
    int TotalProductsCount,
    int SellingProductsCount,
    int ReadyForSaleProductsCount,
    int ArchivedProductsCount,
    decimal? AccountBalance,
    string AccountBalanceCurrency,
    string Timestamp);

public record OzonSalesChartPoint(string Label, string PeriodKey, int Orders, decimal Revenue);

public record OzonSalesChartResult(
    IReadOnlyList<OzonSalesChartPoint> Points,
    string CurrencyCode,
    int TotalOrders,
    decimal TotalRevenue);

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
    decimal AwaitingDeliverAmount,
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
    decimal CancelledMissedProfitTotal,
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

public record OzonUnsoldProductsResult(
    int Total,
    IReadOnlyList<OzonUnsoldProductRow> Items,
    string Timestamp);

public record OzonUnsoldProductRow(
    long Sku,
    string OfferId,
    string ProductName,
    decimal Price,
    string CurrencyCode,
    int StockTotal,
    string Status,
    string ImageUrl,
    string? OzonSellingSince = null,
    int? DaysWithoutSales = null);

public record OzonSupplyShipmentQuantity(
    long Sku,
    string OfferId,
    long ProductId,
    int Quantity,
    string ProductName);

internal record OzonSupplyBundleItemQuantity(
    long Sku,
    string OfferId,
    long ProductId,
    int Quantity,
    string ProductName);

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

