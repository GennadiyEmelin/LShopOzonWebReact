using System.Text.Json;
using LShopOzonWebReact.Api.Ozon;

namespace LShopOzonWebReact.Api.Marketplaces;

internal static class SatuAnalyticsBuilder
{
    internal static SatuCatalogStats ComputeStatsFromProducts(IReadOnlyList<OzonProductSummary> products)
    {
        var stats = new SatuCatalogStats { Total = products.Count };

        foreach (var product in products)
        {
            switch (product.Status.Trim().ToLowerInvariant())
            {
                case "selling":
                case "active":
                case "visible":
                case "on_display":
                case "on":
                case "published":
                    stats.Selling++;
                    break;
                case "archived":
                case "archive":
                case "deleted":
                case "off":
                    stats.Archived++;
                    break;
                default:
                    stats.Ready++;
                    break;
            }
        }

        return stats;
    }

    internal static async Task<OzonAnalyticsResult> BuildAnalyticsAsync(
        HttpClient httpClient,
        string apiKey,
        string merchantId,
        DateOnly from,
        DateOnly to,
        Func<CancellationToken, Task<SatuCatalogStats>> loadCatalogStats,
        Func<CancellationToken, Task<IReadOnlyList<JsonElement>>> loadOrders,
        CancellationToken cancellationToken)
    {
        _ = httpClient;
        _ = apiKey;
        _ = merchantId;

        var catalogStats = await loadCatalogStats(cancellationToken);
        var orders = await loadOrders(cancellationToken);

        var orderRows = new List<OzonAnalyticsRow>();
        var soldProductKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var topProductMap = new Dictionary<string, (long Sku, string OfferId, string Name, decimal Qty, decimal Revenue, string Currency)>(
            StringComparer.OrdinalIgnoreCase);

        decimal revenueTotal = 0;
        decimal commissionTotal = 0;
        decimal logisticsTotal = 0;
        decimal payoutTotal = 0;
        decimal salesAmountTotal = 0;
        decimal awaitingDeliverAmount = 0;
        decimal inTransitAmount = 0;
        decimal deliveredAmount = 0;
        decimal cancelledAmount = 0;

        var salesOrderIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var awaitingDeliverOrderIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var inTransitOrderIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var deliveredOrderIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        decimal awaitingDeliverCount = 0;
        decimal inTransitCount = 0;
        decimal deliveredProductCount = 0;
        decimal cancelledCount = 0;

        foreach (var order in orders)
        {
            var orderId = SatuApiClient.ReadString(order, "id") ?? string.Empty;
            var normalizedStatus = SatuApiClient.NormalizeOrderStatus(SatuApiClient.ReadString(order, "status"));
            var operationDate = SatuApiClient.ReadOrderDate(order)?.ToString("yyyy-MM-dd") ?? string.Empty;
            var currency = SatuApiClient.ReadString(order, "currency") ?? "KZT";
            var orderCommission = SatuApiClient.ReadDecimal(order, "cpa_commission", "commission") +
                                  SatuApiClient.ReadDecimal(order, "prosale_commission");
            var orderLogistics = SatuApiClient.ReadDecimal(order, "delivery_cost", "delivery_price", "delivery");
            var orderRevenue = SatuApiClient.ReadDecimal(order, "price", "full_price", "amount", "total_price");
            var orderProducts = SatuApiClient.EnumerateOrderProducts(order).ToList();

            if (orderProducts.Count == 0)
            {
                orderProducts.Add(order);
            }

            var productRevenueSum = orderProducts.Sum(product =>
                SatuApiClient.ReadDecimal(product, "total_price", "price") *
                Math.Max(1m, SatuApiClient.ReadDecimal(product, "quantity", "qty")));

            if (productRevenueSum <= 0 && orderRevenue > 0)
            {
                productRevenueSum = orderRevenue;
            }

            foreach (var product in orderProducts)
            {
                var offerId = SatuApiClient.ReadString(product, "sku", "external_id", "offer_id", "article") ?? string.Empty;
                var sku = SatuApiClient.ReadLong(product, "sku", "id", "product_id") ?? 0;
                var productName = SatuApiClient.ReadString(product, "name", "title") ?? offerId;
                var quantity = Math.Max(1m, SatuApiClient.ReadDecimal(product, "quantity", "qty"));
                var lineRevenue = SatuApiClient.ReadDecimal(product, "total_price", "price");
                if (lineRevenue <= 0 && productRevenueSum > 0)
                {
                    var orderQuantityTotal = orderProducts.Sum(item =>
                        Math.Max(1m, SatuApiClient.ReadDecimal(item, "quantity", "qty")));
                    lineRevenue = orderRevenue * (quantity / Math.Max(1m, orderQuantityTotal));
                }

                var share = productRevenueSum > 0 ? lineRevenue / productRevenueSum : 1m / orderProducts.Count;
                var lineCommission = orderCommission * share;
                var lineLogistics = orderLogistics * share;
                var linePayout = lineRevenue - lineCommission - lineLogistics;

                orderRows.Add(new OzonAnalyticsRow(
                    sku,
                    offerId,
                    productName,
                    normalizedStatus,
                    orderId,
                    quantity,
                    lineRevenue,
                    lineRevenue > 0 ? Math.Round(lineCommission / lineRevenue * 100m, 2) : 0,
                    lineCommission,
                    linePayout,
                    currency,
                    lineLogistics,
                    operationDate));

                if (normalizedStatus == "cancelled")
                {
                    cancelledCount += quantity;
                    cancelledAmount += lineRevenue;
                    continue;
                }

                soldProductKeys.Add(GetProductKey(sku, offerId));
                revenueTotal += lineRevenue;
                commissionTotal += lineCommission;
                logisticsTotal += lineLogistics;
                payoutTotal += linePayout;
                salesAmountTotal += lineRevenue;

                if (!string.IsNullOrWhiteSpace(orderId))
                {
                    salesOrderIds.Add(orderId);
                }

                switch (normalizedStatus)
                {
                    case "awaiting_deliver":
                        awaitingDeliverCount += quantity;
                        awaitingDeliverAmount += lineRevenue;
                        if (!string.IsNullOrWhiteSpace(orderId))
                        {
                            awaitingDeliverOrderIds.Add(orderId);
                        }

                        break;
                    case "delivering":
                        inTransitCount += quantity;
                        inTransitAmount += lineRevenue;
                        if (!string.IsNullOrWhiteSpace(orderId))
                        {
                            inTransitOrderIds.Add(orderId);
                        }

                        break;
                    case "delivered":
                        deliveredProductCount += quantity;
                        deliveredAmount += lineRevenue;
                        if (!string.IsNullOrWhiteSpace(orderId))
                        {
                            deliveredOrderIds.Add(orderId);
                        }

                        break;
                }

                var topKey = sku > 0 ? $"sku:{sku}" : $"offer:{offerId}";
                if (topProductMap.TryGetValue(topKey, out var existing))
                {
                    topProductMap[topKey] = existing with
                    {
                        Qty = existing.Qty + quantity,
                        Revenue = existing.Revenue + lineRevenue
                    };
                }
                else
                {
                    topProductMap[topKey] = (sku, offerId, productName, quantity, lineRevenue, currency);
                }
            }
        }

        var topProducts = topProductMap.Values
            .Select(item => new OzonTopProductRow(
                item.Sku,
                item.OfferId,
                item.Name,
                item.Qty,
                item.Revenue,
                item.Currency,
                0))
            .OrderByDescending(row => row.Quantity)
            .ThenByDescending(row => row.Revenue)
            .ToList();

        var salesTotalCount = salesOrderIds.Count;
        var cancelledLogisticsTotal = orderRows
            .Where(row => row.Status == "cancelled")
            .Sum(row => row.LogisticsAmount);
        var cancelledMissedProfitTotal = orderRows
            .Where(row => row.Status == "cancelled")
            .Sum(row => row.Revenue - row.CommissionAmount);

        return new OzonAnalyticsResult(
            orderRows,
            orderRows,
            topProducts,
            [],
            orderRows.Count(row => row.Revenue > 0 && row.Status != "cancelled"),
            revenueTotal,
            commissionTotal,
            payoutTotal,
            logisticsTotal,
            0,
            (int)awaitingDeliverCount,
            awaitingDeliverAmount,
            inTransitOrderIds.Count,
            deliveredOrderIds.Count,
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
            null,
            "KZT",
            catalogStats.Selling,
            catalogStats.Ready,
            catalogStats.Archived,
            DateTimeOffset.UtcNow.ToString("O"));
    }

    private static string GetProductKey(long sku, string offerId) =>
        sku > 0 ? $"sku:{sku}" : $"offer:{offerId}";

    internal static async Task<(int Total, IReadOnlyList<OzonUnsoldProductRow> Items)> BuildUnsoldPageAsync(
        IReadOnlyList<OzonProductSummary> products,
        IReadOnlyList<JsonElement> orders,
        int skip,
        int take)
    {
        var soldProductKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var order in orders)
        {
            if (SatuApiClient.NormalizeOrderStatus(SatuApiClient.ReadString(order, "status")) == "cancelled")
            {
                continue;
            }

            foreach (var product in SatuApiClient.EnumerateOrderProducts(order))
            {
                var offerId = SatuApiClient.ReadString(product, "sku", "external_id", "offer_id", "article") ?? string.Empty;
                var sku = SatuApiClient.ReadLong(product, "sku", "id", "product_id") ?? 0;
                soldProductKeys.Add(GetProductKey(sku, offerId));
            }
        }

        var unsold = products
            .Where(product => !soldProductKeys.Contains(GetProductKey(product.Sku ?? 0, product.OfferId)))
            .OrderBy(row => row.OfferId, StringComparer.OrdinalIgnoreCase)
            .ThenBy(row => row.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var page = unsold
            .Skip(Math.Max(0, skip))
            .Take(Math.Clamp(take, 1, 500))
            .Select(product => new OzonUnsoldProductRow(
                product.Sku ?? 0,
                product.OfferId,
                product.Name,
                product.Price,
                product.CurrencyCode,
                0,
                product.Status,
                product.ImageUrl))
            .ToList();

        return (unsold.Count, page);
    }
}
