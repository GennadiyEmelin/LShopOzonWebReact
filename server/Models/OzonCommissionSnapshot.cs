namespace LShopOzonWebReact.Api.Models;

/// <summary>
/// Слепок тарифов Ozon по конкретному товару.
/// Обновляется фоновой службой из /v5/product/info/prices — вручную не редактируется.
/// </summary>
public class OzonCommissionSnapshot
{
    public Guid Id { get; set; }

    public long ProductId { get; set; }

    public string OfferId { get; set; } = string.Empty;

    public string ProductName { get; set; } = string.Empty;

    public long? DescriptionCategoryId { get; set; }

    public long? TypeId { get; set; }

    // --- Комиссия за продажу, % ---

    public decimal SalesPercentFbo { get; set; }

    public decimal SalesPercentFbs { get; set; }

    // --- FBO, суммы в валюте товара ---

    public decimal FboFulfillmentAmount { get; set; }

    public decimal FboDirectFlowTransMinAmount { get; set; }

    public decimal FboDirectFlowTransMaxAmount { get; set; }

    public decimal FboDelivToCustomerAmount { get; set; }

    public decimal FboReturnFlowAmount { get; set; }

    // --- FBS ---

    public decimal FbsFirstMileMinAmount { get; set; }

    public decimal FbsFirstMileMaxAmount { get; set; }

    public decimal FbsDirectFlowTransMinAmount { get; set; }

    public decimal FbsDirectFlowTransMaxAmount { get; set; }

    public decimal FbsDelivToCustomerAmount { get; set; }

    public decimal FbsReturnFlowAmount { get; set; }

    /// <summary>
    /// Эквайринг, %. Ozon отдаёт его не во всех версиях метода —
    /// если null, калькулятор берёт значение из CalculatorSettings.
    /// </summary>
    public decimal? AcquiringPercent { get; set; }

    // --- Цены на момент снимка ---

    public decimal CurrentPrice { get; set; }

    public decimal? OldPrice { get; set; }

    public decimal? MarketingPrice { get; set; }

    public decimal? MinPrice { get; set; }

    public string CurrencyCode { get; set; } = string.Empty;

    /// <summary>
    /// Сырой JSON блока commissions. Нужен, чтобы не потерять поля,
    /// которые Ozon добавит в будущих версиях метода, без миграции БД.
    /// </summary>
    public string RawCommissionsJson { get; set; } = string.Empty;

    public DateTimeOffset FetchedAt { get; set; }
}
