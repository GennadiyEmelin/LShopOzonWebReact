using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LShopOzonWebReact.Api.Ozon;

/// <summary>
/// Выплаты Ozon: /v1/finance/cash-flow-statement/list.
///
/// Метод проверен на боевом ключе 06.08.2026. Совпадение с кабинетом:
/// invoice_transfer = 145 601.32 ровно равен сумме на карточке «Стандартный график».
///
/// Периоды приходят готовыми — недельные (пн–вс) с разрезом на границе месяца.
/// Сами их не вычисляем: Ozon может изменить график, и любая своя формула отстанет.
/// </summary>
public partial class OzonApiClient
{
    private const int CashFlowPageSize = 100;

    /// <summary>
    /// Это не отдельная услуга, а то же самое вознаграждение за продажу,
    /// что приходит в commission_amount. Ozon дублирует его в блоке services.
    ///
    /// Сверено с кабинетом за 20–26 июля: продажи 81 769, вознаграждение 8 236,
    /// доставка 24 834, продвижение 4 741, к выплате 43 958. Если не исключить
    /// этот дубль, итог занижается ровно на сумму комиссии.
    /// </summary>
    private const string CommissionDuplicateService = "MarketplaceServiceProductPlacementKZ";

    /// <summary>
    /// Плановая дата выплаты: первый нужный день недели строго после конца
    /// периода плюс заданная задержка.
    ///
    /// Ozon плановую дату по API не отдаёт, а графики у кабинетов разные:
    /// в РФ это среда через 3 недели (сверено, 5 совпадений из 5),
    /// в KZ задержка короче и день недели плавает. Поэтому параметры
    /// вынесены в настройки, а не зашиты в код.
    /// </summary>
    private static DateOnly CalculatePayoutDate(DateOnly periodEnd, int delayWeeks, DayOfWeek payoutDay)
    {
        var daysUntilPayday = ((int)payoutDay - (int)periodEnd.DayOfWeek + 7) % 7;
        if (daysUntilPayday == 0)
        {
            daysUntilPayday = 7;
        }

        return periodEnd.AddDays(daysUntilPayday + Math.Max(0, delayWeeks) * 7);
    }

    private static DateOnly? CalculatePaidOutDate(
        DateOnly periodBegin,
        DateOnly periodEnd,
        DayOfWeek payoutDay)
    {
        var daysFromPeriodBegin = ((int)payoutDay - (int)periodBegin.DayOfWeek + 7) % 7;
        var paidOutDate = periodBegin.AddDays(daysFromPeriodBegin);
        return paidOutDate <= periodEnd ? paidOutDate : null;
    }

    /// <summary>
    /// Перевод только для имён, смысл которых очевиден из самого названия.
    ///
    /// Остальные показываем как есть: придуманный перевод уже один раз ввёл
    /// в заблуждение — MarketplaceServiceProductPlacementKZ был подписан как
    /// «Размещение товаров», хотя платного размещения в кабинете нет.
    /// Сырое имя хотя бы можно найти поиском в кабинете и в документации.
    /// </summary>
    private static readonly Dictionary<string, string> ServiceNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ["MarketplaceServiceItemDirectFlowLogisticSum"] = "Логистика до покупателя",
        ["MarketplaceServiceItemReturnFlowLogistic"] = "Обратная логистика",
        ["OperationCashToTheSellersAccount"] = "Перевод на счёт продавца",
    };

    public async Task<OzonPayoutReport> GetPayoutReportAsync(
        DateOnly dateFrom,
        DateOnly dateTo,
        int payoutDelayWeeks,
        DayOfWeek payoutDayOfWeek,
        CancellationToken cancellationToken)
    {
        EnsureConfigured();

        var flows = new List<CashFlowEntry>();
        var details = new List<CashFlowDetailEntry>();
        var currency = "KZT";

        var page = 1;
        var pageCount = 1;

        while (page <= pageCount && page <= 50)
        {
            var content = await SendCashFlowRequestAsync(dateFrom, dateTo, page, cancellationToken);

            using var document = JsonDocument.Parse(content);
            if (!document.RootElement.TryGetProperty("result", out var result))
            {
                break;
            }

            pageCount = result.TryGetProperty("page_count", out var pageCountElement)
                && pageCountElement.TryGetInt32(out var parsedPageCount)
                    ? Math.Max(parsedPageCount, 1)
                    : 1;

            if (result.TryGetProperty("cash_flows", out var flowsElement)
                && flowsElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var element in flowsElement.EnumerateArray())
                {
                    var entry = MapCashFlow(element);
                    if (entry is not null)
                    {
                        flows.Add(entry);
                        if (!string.IsNullOrWhiteSpace(entry.CurrencyCode))
                        {
                            currency = entry.CurrencyCode;
                        }
                    }
                }
            }

            if (result.TryGetProperty("details", out var detailsElement)
                && detailsElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var element in detailsElement.EnumerateArray())
                {
                    var entry = MapCashFlowDetail(element);
                    if (entry is not null)
                    {
                        details.Add(entry);
                    }
                }
            }

            page++;
        }

        var detailsByPeriod = details
            .GroupBy(detail => detail.PeriodBegin)
            .ToDictionary(group => group.Key, group => group.First());

        var periods = new List<OzonPayoutPeriod>();

        foreach (var flow in flows.OrderByDescending(entry => entry.PeriodBegin))
        {
            detailsByPeriod.TryGetValue(flow.PeriodBegin, out var detail);

            // payments приходит отрицательным: деньги ушли со счёта Ozon продавцу.
            var paid = detail is null ? 0m : Math.Abs(detail.Payments);
            var pending = detail?.InvoiceTransfer ?? 0m;

            periods.Add(new OzonPayoutPeriod(
                flow.PeriodBegin,
                flow.PeriodEnd,
                FormatPeriodLabel(flow.PeriodBegin, flow.PeriodEnd),
                flow.OrdersAmount,
                flow.ReturnsAmount,
                Math.Abs(flow.CommissionAmount),
                Math.Abs(flow.ItemDeliveryAndReturnAmount),
                // Из услуг вычитаем дубль комиссии, иначе она уходит в расходы дважды.
                // Скобки обязательны: без них «-» связывает сильнее «??»,
                // и при отсутствии детализации услуги обнулялись бы целиком.
                Math.Max(0m, Math.Abs(flow.ServicesAmount) - (detail?.CommissionDuplicate ?? 0m)),
                paid,
                pending,
                paid > 0m
                    ? CalculatePaidOutDate(flow.PeriodBegin, flow.PeriodEnd, payoutDayOfWeek)
                    : null,
                CalculatePayoutDate(flow.PeriodEnd, payoutDelayWeeks, payoutDayOfWeek),
                detail?.BeginBalance ?? 0m,
                detail?.EndBalance ?? 0m,
                detail?.ServiceItems ?? Array.Empty<OzonPayoutServiceItem>()));
        }

        // Ozon отражает начисление invoice_transfer в периоде, за который оно рассчитано,
        // а фактический payments — в более позднем периоде, когда деньги перечислены.
        // Сопоставляем одинаковые суммы, чтобы уже перечисленная выплата не оставалась
        // одновременно в блоке «Ожидают выплаты».
        var unmatchedPayments = periods
            .Where(period => period.PaidOut > 0m)
            .Select(period => new PendingPayment(period.PeriodBegin, period.PaidOut))
            .ToList();

        for (var index = 0; index < periods.Count; index++)
        {
            var period = periods[index];
            if (period.PendingPayout <= 0m)
            {
                continue;
            }

            var paymentIndex = unmatchedPayments.FindIndex(payment =>
                payment.PeriodBegin > period.PeriodBegin &&
                Math.Abs(payment.Amount - period.PendingPayout) < 0.01m);
            if (paymentIndex < 0)
            {
                continue;
            }

            periods[index] = period with { PendingPayout = 0m };
            unmatchedPayments.RemoveAt(paymentIndex);
        }

        var pendingTotal = periods.Sum(period => period.PendingPayout);
        var paidTotal = periods.Sum(period => period.PaidOut);
        var currentBalance = periods.FirstOrDefault()?.EndBalance;

        return new OzonPayoutReport(
            periods,
            Math.Round(paidTotal, 2),
            Math.Round(pendingTotal, 2),
            currentBalance,
            currency,
            periods.Count);
    }

    private async Task<string> SendCashFlowRequestAsync(
        DateOnly dateFrom,
        DateOnly dateTo,
        int page,
        CancellationToken cancellationToken)
    {
        var payload = new
        {
            date = new
            {
                from = $"{dateFrom:yyyy-MM-dd}T00:00:00.000Z",
                to = $"{dateTo:yyyy-MM-dd}T23:59:59.999Z",
            },
            page,
            page_size = CashFlowPageSize,
            with_details = true,
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, "/v1/finance/cash-flow-statement/list");
        request.Headers.Add("Client-Id", _credentials.ClientId);
        request.Headers.Add("Api-Key", _credentials.ApiKey);
        request.Content = new StringContent(
            JsonSerializer.Serialize(payload),
            System.Text.Encoding.UTF8,
            "application/json");

        using var response = await httpClient.SendAsync(request, cancellationToken);
        var content = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"Ozon API returned {(int)response.StatusCode} for cash-flow-statement: {content}",
                null,
                response.StatusCode);
        }

        return content;
    }

    private static CashFlowEntry? MapCashFlow(JsonElement element)
    {
        if (!TryReadPeriod(element, out var begin, out var end))
        {
            return null;
        }

        return new CashFlowEntry(
            begin,
            end,
            ReadDecimal(element, "orders_amount"),
            ReadDecimal(element, "returns_amount"),
            ReadDecimal(element, "commission_amount"),
            ReadDecimal(element, "services_amount"),
            ReadDecimal(element, "item_delivery_and_return_amount"),
            element.TryGetProperty("currency_code", out var currency)
                ? currency.GetString() ?? string.Empty
                : string.Empty);
    }

    private static CashFlowDetailEntry? MapCashFlowDetail(JsonElement element)
    {
        if (!TryReadPeriod(element, out var begin, out _))
        {
            return null;
        }

        var payments = 0m;
        if (element.TryGetProperty("payments", out var paymentsElement)
            && paymentsElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var payment in paymentsElement.EnumerateArray())
            {
                payments += ReadDecimal(payment, "payment");
            }
        }

        var commissionDuplicate = 0m;
        if (element.TryGetProperty("services", out var servicesBlock)
            && servicesBlock.ValueKind == JsonValueKind.Object
            && servicesBlock.TryGetProperty("items", out var servicesItems)
            && servicesItems.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in servicesItems.EnumerateArray())
            {
                var name = item.TryGetProperty("name", out var nameElement)
                    ? nameElement.GetString() ?? string.Empty
                    : string.Empty;

                if (string.Equals(name, CommissionDuplicateService, StringComparison.OrdinalIgnoreCase))
                {
                    commissionDuplicate += Math.Abs(ReadDecimal(item, "price"));
                }
            }
        }

        var serviceItems = new List<OzonPayoutServiceItem>();
        // Ozon раскладывает расходы по четырём блокам. Собираем все,
        // иначе в детализации видно только услуги, а логистики нет.
        CollectServiceItems(element, "services", serviceItems);
        CollectServiceItems(element, "others", serviceItems);
        CollectNestedServiceItems(element, "delivery", "delivery_services", serviceItems);
        CollectNestedServiceItems(element, "return", "return_services", serviceItems);

        return new CashFlowDetailEntry(
            begin,
            ReadDecimal(element, "begin_balance_amount"),
            ReadDecimal(element, "end_balance_amount"),
            ReadDecimal(element, "invoice_transfer"),
            payments,
            commissionDuplicate,
            serviceItems);
    }

    /// <summary>
    /// Логистика лежит на уровень глубже: delivery.delivery_services.items
    /// и return.return_services.items.
    /// </summary>
    private static void CollectNestedServiceItems(
        JsonElement parent,
        string outerName,
        string innerName,
        List<OzonPayoutServiceItem> target)
    {
        if (parent.TryGetProperty(outerName, out var outer) && outer.ValueKind == JsonValueKind.Object)
        {
            CollectServiceItems(outer, innerName, target);
        }
    }

    private static void CollectServiceItems(
        JsonElement parent,
        string propertyName,
        List<OzonPayoutServiceItem> target)
    {
        if (!parent.TryGetProperty(propertyName, out var container)
            || container.ValueKind != JsonValueKind.Object
            || !container.TryGetProperty("items", out var items)
            || items.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        foreach (var item in items.EnumerateArray())
        {
            var rawName = item.TryGetProperty("name", out var name)
                ? name.GetString() ?? string.Empty
                : string.Empty;

            if (string.IsNullOrWhiteSpace(rawName))
            {
                continue;
            }

            if (string.Equals(rawName, CommissionDuplicateService, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            target.Add(new OzonPayoutServiceItem(
                ServiceNames.TryGetValue(rawName, out var readable) ? readable : rawName,
                ReadDecimal(item, "price")));
        }
    }

    private static bool TryReadPeriod(JsonElement element, out DateOnly begin, out DateOnly end)
    {
        begin = default;
        end = default;

        if (!element.TryGetProperty("period", out var period) || period.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        return TryReadDate(period, "begin", out begin) && TryReadDate(period, "end", out end);
    }

    private static bool TryReadDate(JsonElement parent, string propertyName, out DateOnly date)
    {
        date = default;

        if (!parent.TryGetProperty(propertyName, out var value) || value.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        if (DateTimeOffset.TryParse(
                value.GetString(),
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var parsed))
        {
            date = DateOnly.FromDateTime(parsed.UtcDateTime);
            return true;
        }

        return false;
    }

    private static decimal ReadDecimal(JsonElement parent, string propertyName)
    {
        if (parent.ValueKind != JsonValueKind.Object || !parent.TryGetProperty(propertyName, out var value))
        {
            return 0m;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number => value.TryGetDecimal(out var number) ? number : 0m,
            JsonValueKind.String => decimal.TryParse(
                value.GetString(),
                NumberStyles.Any,
                CultureInfo.InvariantCulture,
                out var parsed)
                    ? parsed
                    : 0m,
            _ => 0m,
        };
    }

    private static string FormatPeriodLabel(DateOnly begin, DateOnly end)
    {
        var culture = CultureInfo.GetCultureInfo("ru-RU");
        var beginMonth = culture.DateTimeFormat.GetMonthName(begin.Month);
        var endMonth = culture.DateTimeFormat.GetMonthName(end.Month);

        return begin.Month == end.Month
            ? $"{begin.Day}–{end.Day} {endMonth}"
            : $"{begin.Day} {beginMonth} – {end.Day} {endMonth}";
    }

    private sealed record CashFlowEntry(
        DateOnly PeriodBegin,
        DateOnly PeriodEnd,
        decimal OrdersAmount,
        decimal ReturnsAmount,
        decimal CommissionAmount,
        decimal ServicesAmount,
        decimal ItemDeliveryAndReturnAmount,
        string CurrencyCode);

    private sealed record CashFlowDetailEntry(
        DateOnly PeriodBegin,
        decimal BeginBalance,
        decimal EndBalance,
        decimal InvoiceTransfer,
        decimal Payments,
        decimal CommissionDuplicate,
        IReadOnlyList<OzonPayoutServiceItem> ServiceItems);

    private sealed record PendingPayment(DateOnly PeriodBegin, decimal Amount);
}

public record OzonPayoutServiceItem(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("amount")] decimal Amount);

public record OzonPayoutPeriod(
    DateOnly PeriodBegin,
    DateOnly PeriodEnd,
    string Label,
    decimal OrdersAmount,
    decimal ReturnsAmount,
    decimal Commission,
    decimal Logistics,
    decimal Services,
    /// <summary>Фактически перечислено продавцу в этом периоде.</summary>
    decimal PaidOut,
    /// <summary>Начислено к выплате — деньги, которые ещё придут.</summary>
    decimal PendingPayout,
    /// <summary>День фактической выплаты внутри периода, рассчитанный по графику кабинета.</summary>
    DateOnly? PaidOutDate,
    /// <summary>Ориентировочная дата выплаты. Расчётная: API её не отдаёт.</summary>
    DateOnly? EstimatedPayoutDate,
    decimal BeginBalance,
    decimal EndBalance,
    IReadOnlyList<OzonPayoutServiceItem> ServiceItems);

public record OzonPayoutReport(
    IReadOnlyList<OzonPayoutPeriod> Periods,
    decimal PaidTotal,
    decimal PendingTotal,
    decimal? CurrentBalance,
    string CurrencyCode,
    int PeriodCount);
