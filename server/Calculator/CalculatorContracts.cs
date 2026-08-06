using LShopOzonWebReact.Api.Models;

namespace LShopOzonWebReact.Api.Calculator;

/// <summary>
/// Полный набор входных данных для расчёта.
/// Собирается либо из снапшота тарифов (режим «по своим товарам»),
/// либо из формы ручного ввода — математика одна и та же.
/// </summary>
public record CalculationInput
{
    public string Scheme { get; init; } = CalculatorSchemes.Fbo;

    public decimal Price { get; init; }

    // --- Тарифы Ozon ---

    /// <summary>Комиссия за продажу, %.</summary>
    public decimal SalesPercent { get; init; }

    public decimal FulfillmentAmount { get; init; }

    public decimal FirstMileAmount { get; init; }

    public decimal DirectFlowTransMinAmount { get; init; }

    public decimal DirectFlowTransMaxAmount { get; init; }

    public decimal DelivToCustomerAmount { get; init; }

    public decimal ReturnFlowAmount { get; init; }

    // --- Настройки продавца ---

    public decimal AcquiringPercent { get; init; }

    public decimal AdvertisingPercent { get; init; }

    /// <summary>Себестоимость: закупка + упаковка + производство.</summary>
    public decimal CostPrice { get; init; }

    public decimal ExtraCostFixed { get; init; }

    public string TaxMode { get; init; } = CalculatorTaxModes.UsnIncome;

    public decimal TaxPercent { get; init; }

    /// <summary>Процент выкупа: определяет долю заказов, по которым платится обратная логистика.</summary>
    public decimal BuyoutRatePercent { get; init; } = 100m;
}

/// <summary>Одна строка разложения расходов. Source объясняет, откуда взялась цифра.</summary>
public record CalculationLine(
    string Key,
    string Label,
    decimal Amount,
    string Source);

/// <summary>Один сценарий расчёта (оптимистичный или пессимистичный по логистике).</summary>
public record CalculationScenario(
    IReadOnlyList<CalculationLine> Lines,
    decimal OzonPayout,
    decimal Profit,
    decimal MarginPercent,
    decimal RoiPercent);

/// <param name="Worst">Пессимистичный сценарий — логистика по верхней границе вилки Ozon.</param>
/// <param name="Best">Оптимистичный сценарий — логистика по нижней границе.</param>
/// <param name="BreakEvenPrice">Минимальная цена, при которой прибыль равна нулю. Считается по худшему сценарию.</param>
public record CalculationResult(
    decimal Price,
    string Scheme,
    CalculationScenario Worst,
    CalculationScenario Best,
    decimal? BreakEvenPrice,
    IReadOnlyList<string> Warnings);

public record ReverseCalculationResult(
    decimal TargetMarginPercent,
    decimal? RequiredPrice,
    CalculationResult? Calculation,
    string? Explanation);
