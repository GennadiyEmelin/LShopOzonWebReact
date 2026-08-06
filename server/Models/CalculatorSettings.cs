namespace LShopOzonWebReact.Api.Models;

public static class CalculatorTaxModes
{
    /// <summary>УСН «Доходы» — налог с выручки.</summary>
    public const string UsnIncome = "usn_income";

    /// <summary>УСН «Доходы минус расходы» — налог с прибыли до налога.</summary>
    public const string UsnIncomeMinusExpenses = "usn_income_minus_expenses";

    /// <summary>Без налога в расчёте.</summary>
    public const string None = "none";
}

public static class CalculatorSchemes
{
    public const string Fbo = "fbo";
    public const string Fbs = "fbs";
}

/// <summary>
/// Настройки калькулятора. Одна строка на инсталляцию.
/// Здесь лежит только то, чего Ozon не отдаёт по API.
/// </summary>
public class CalculatorSettings
{
    public Guid Id { get; set; }

    /// <summary>Эквайринг, %. Используется, если Ozon не вернул его по товару.</summary>
    public decimal AcquiringPercent { get; set; } = 1.5m;

    public string TaxMode { get; set; } = CalculatorTaxModes.UsnIncome;

    public decimal TaxPercent { get; set; } = 6m;

    /// <summary>
    /// Процент выкупа. Обратная логистика применяется к невыкупленной доле:
    /// при 90 % выкупа возвратный тариф умножается на 0.1.
    /// </summary>
    public decimal BuyoutRatePercent { get; set; } = 90m;

    /// <summary>Ставка логистики за литр объёмного веса — для ручного режима.</summary>
    public decimal LogisticsRatePerLiter { get; set; }

    /// <summary>Базовая часть логистики за первый литр — для ручного режима.</summary>
    public decimal LogisticsBaseAmount { get; set; }

    /// <summary>Реклама, % от цены.</summary>
    public decimal AdvertisingPercent { get; set; }

    /// <summary>Прочие фиксированные расходы на единицу.</summary>
    public decimal ExtraCostFixed { get; set; }

    /// <summary>Схема по умолчанию в интерфейсе.</summary>
    public string DefaultScheme { get; set; } = CalculatorSchemes.Fbo;

    public DateTimeOffset UpdatedAt { get; set; }
}
