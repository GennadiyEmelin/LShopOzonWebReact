using LShopOzonWebReact.Api.Models;

namespace LShopOzonWebReact.Api.Calculator;

/// <summary>
/// Юнит-экономика одной продажи. Чистая математика: ни обращений к API,
/// ни к базе — чтобы поведение было предсказуемым и покрывалось тестами.
/// </summary>
public class CalculatorService
{
    /// <summary>Прямой расчёт: цена известна, считаем прибыль.</summary>
    public CalculationResult Calculate(CalculationInput input)
    {
        var warnings = new List<string>();

        if (input.Price <= 0)
        {
            warnings.Add("Цена продажи не задана.");
        }

        if (input.CostPrice <= 0)
        {
            warnings.Add("Себестоимость не задана — показана только выплата Ozon, не прибыль.");
        }

        if (input.SalesPercent <= 0)
        {
            warnings.Add("Комиссия за продажу равна нулю — проверьте, синхронизированы ли тарифы.");
        }

        var worst = BuildScenario(input, useMaxTransport: true);
        var best = BuildScenario(input, useMaxTransport: false);

        return new CalculationResult(
            Round(input.Price),
            input.Scheme,
            worst,
            best,
            FindBreakEvenPrice(input),
            warnings);
    }

    /// <summary>
    /// Обратный расчёт: задана целевая маржа, ищем нужную цену.
    /// Именно этого не хватает в калькуляторе на сайте Ozon.
    /// </summary>
    public ReverseCalculationResult CalculateForTargetMargin(
        CalculationInput input,
        decimal targetMarginPercent)
    {
        var margin = targetMarginPercent / 100m;
        var fixedCosts = GetFixedCosts(input, useMaxTransport: true);
        var totalFixed = fixedCosts + input.CostPrice + input.ExtraCostFixed;

        var variableShare = GetVariableShare(input);
        var tax = input.TaxPercent / 100m;

        decimal denominator;
        decimal numerator;

        switch (input.TaxMode)
        {
            case CalculatorTaxModes.UsnIncomeMinusExpenses:
                // Налог берётся с прибыли до налога: profit = (P·(1−v) − F)·(1−t) = m·P
                numerator = totalFixed * (1m - tax);
                denominator = (1m - variableShare) * (1m - tax) - margin;
                break;

            case CalculatorTaxModes.None:
                numerator = totalFixed;
                denominator = 1m - variableShare - margin;
                break;

            default: // УСН «Доходы» — налог с выручки
                numerator = totalFixed;
                denominator = 1m - variableShare - tax - margin;
                break;
        }

        if (denominator <= 0m)
        {
            return new ReverseCalculationResult(
                targetMarginPercent,
                null,
                null,
                "Такая маржа недостижима: комиссия, налог и целевая маржа в сумме съедают всю цену. " +
                "Снизьте целевую маржу или себестоимость.");
        }

        var requiredPrice = Round(numerator / denominator);
        var calculation = Calculate(input with { Price = requiredPrice });

        return new ReverseCalculationResult(targetMarginPercent, requiredPrice, calculation, null);
    }

    private CalculationScenario BuildScenario(CalculationInput input, bool useMaxTransport)
    {
        var lines = new List<CalculationLine>();
        var isFbo = string.Equals(input.Scheme, CalculatorSchemes.Fbo, StringComparison.OrdinalIgnoreCase);

        var salesCommission = input.Price * input.SalesPercent / 100m;
        lines.Add(new CalculationLine(
            "salesCommission",
            $"Комиссия за продажу, {Round(input.SalesPercent)} %",
            -Round(salesCommission),
            "Ozon API"));

        if (isFbo && input.FulfillmentAmount > 0)
        {
            lines.Add(new CalculationLine(
                "fulfillment",
                "Фулфилмент",
                -Round(input.FulfillmentAmount),
                "Ozon API"));
        }

        if (!isFbo && input.FirstMileAmount > 0)
        {
            lines.Add(new CalculationLine(
                "firstMile",
                "Первая миля",
                -Round(input.FirstMileAmount),
                "Ozon API"));
        }

        var transport = useMaxTransport
            ? input.DirectFlowTransMaxAmount
            : input.DirectFlowTransMinAmount;

        if (transport > 0)
        {
            lines.Add(new CalculationLine(
                "logistics",
                useMaxTransport ? "Логистика (верхняя граница)" : "Логистика (нижняя граница)",
                -Round(transport),
                "Ozon API"));
        }

        if (input.DelivToCustomerAmount > 0)
        {
            lines.Add(new CalculationLine(
                "lastMile",
                "Последняя миля",
                -Round(input.DelivToCustomerAmount),
                "Ozon API"));
        }

        // Обратная логистика платится только по невыкупленным заказам.
        var notBuyoutShare = Math.Clamp((100m - input.BuyoutRatePercent) / 100m, 0m, 1m);
        var returnFlow = input.ReturnFlowAmount * notBuyoutShare;
        if (returnFlow > 0)
        {
            lines.Add(new CalculationLine(
                "returnFlow",
                $"Обратная логистика (выкуп {Round(input.BuyoutRatePercent)} %)",
                -Round(returnFlow),
                "Ozon API × настройки"));
        }

        var acquiring = input.Price * input.AcquiringPercent / 100m;
        if (acquiring > 0)
        {
            lines.Add(new CalculationLine(
                "acquiring",
                $"Эквайринг, {Round(input.AcquiringPercent)} %",
                -Round(acquiring),
                "Настройки"));
        }

        var ozonExpenses = salesCommission
            + (isFbo ? input.FulfillmentAmount : input.FirstMileAmount)
            + transport
            + input.DelivToCustomerAmount
            + returnFlow
            + acquiring;

        var payout = input.Price - ozonExpenses;

        var advertising = input.Price * input.AdvertisingPercent / 100m;
        if (advertising > 0)
        {
            lines.Add(new CalculationLine(
                "advertising",
                $"Реклама, {Round(input.AdvertisingPercent)} %",
                -Round(advertising),
                "Настройки"));
        }

        if (input.CostPrice > 0)
        {
            lines.Add(new CalculationLine(
                "costPrice",
                "Себестоимость",
                -Round(input.CostPrice),
                "Карточка себестоимости"));
        }

        if (input.ExtraCostFixed > 0)
        {
            lines.Add(new CalculationLine(
                "extraCost",
                "Прочие расходы",
                -Round(input.ExtraCostFixed),
                "Настройки"));
        }

        var profitBeforeTax = payout - advertising - input.CostPrice - input.ExtraCostFixed;
        var tax = CalculateTax(input, profitBeforeTax);

        if (tax > 0)
        {
            lines.Add(new CalculationLine(
                "tax",
                GetTaxLabel(input),
                -Round(tax),
                "Настройки"));
        }

        var profit = profitBeforeTax - tax;

        return new CalculationScenario(
            lines,
            Round(payout),
            Round(profit),
            input.Price > 0 ? Round(profit / input.Price * 100m) : 0m,
            input.CostPrice > 0 ? Round(profit / input.CostPrice * 100m) : 0m);
    }

    private static decimal CalculateTax(CalculationInput input, decimal profitBeforeTax) => input.TaxMode switch
    {
        CalculatorTaxModes.None => 0m,
        CalculatorTaxModes.UsnIncomeMinusExpenses => profitBeforeTax > 0
            ? profitBeforeTax * input.TaxPercent / 100m
            : 0m,
        _ => input.Price * input.TaxPercent / 100m,
    };

    private static string GetTaxLabel(CalculationInput input) => input.TaxMode switch
    {
        CalculatorTaxModes.UsnIncomeMinusExpenses => $"Налог с прибыли, {Round(input.TaxPercent)} %",
        CalculatorTaxModes.None => "Налог не учитывается",
        _ => $"Налог с оборота, {Round(input.TaxPercent)} %",
    };

    /// <summary>Расходы, не зависящие от цены (по пессимистичному сценарию логистики).</summary>
    private static decimal GetFixedCosts(CalculationInput input, bool useMaxTransport)
    {
        var isFbo = string.Equals(input.Scheme, CalculatorSchemes.Fbo, StringComparison.OrdinalIgnoreCase);
        var notBuyoutShare = Math.Clamp((100m - input.BuyoutRatePercent) / 100m, 0m, 1m);

        return (isFbo ? input.FulfillmentAmount : input.FirstMileAmount)
            + (useMaxTransport ? input.DirectFlowTransMaxAmount : input.DirectFlowTransMinAmount)
            + input.DelivToCustomerAmount
            + input.ReturnFlowAmount * notBuyoutShare;
    }

    /// <summary>Доля расходов, пропорциональных цене (комиссия + эквайринг + реклама).</summary>
    private static decimal GetVariableShare(CalculationInput input)
        => (input.SalesPercent + input.AcquiringPercent + input.AdvertisingPercent) / 100m;

    /// <summary>Цена, при которой прибыль обращается в ноль. Считается по худшему сценарию.</summary>
    private static decimal? FindBreakEvenPrice(CalculationInput input)
    {
        var totalFixed = GetFixedCosts(input, useMaxTransport: true)
            + input.CostPrice
            + input.ExtraCostFixed;

        var variableShare = GetVariableShare(input);
        var tax = input.TaxPercent / 100m;

        // При УСН «Доходы минус расходы» налог берётся с прибыли,
        // поэтому в нулевой точке он равен нулю и на результат не влияет.
        var denominator = input.TaxMode == CalculatorTaxModes.UsnIncome
            ? 1m - variableShare - tax
            : 1m - variableShare;

        if (denominator <= 0m)
        {
            return null;
        }

        return Round(totalFixed / denominator);
    }

    private static decimal Round(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);
}
