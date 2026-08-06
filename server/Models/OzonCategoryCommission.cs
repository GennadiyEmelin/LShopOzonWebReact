namespace LShopOzonWebReact.Api.Models;

/// <summary>
/// Справочник «категория → комиссия», собираемый агрегацией по собственному каталогу.
/// Нужен для ручного режима калькулятора, когда товара ещё нет в каталоге.
///
/// Внимание: покрывает только категории, в которых вы уже торгуете.
/// Публичного API комиссий по категориям у Ozon нет, поэтому для новых категорий
/// значение вводится вручную (IsManualOverride = true).
/// </summary>
public class OzonCategoryCommission
{
    public long DescriptionCategoryId { get; set; }

    public string CategoryName { get; set; } = string.Empty;

    public decimal AvgSalesPercentFbo { get; set; }

    public decimal AvgSalesPercentFbs { get; set; }

    /// <summary>
    /// По скольким товарам посчитано среднее. Показывается в UI:
    /// при SampleSize = 1 доверие к цифре ниже, чем при SampleSize = 40.
    /// </summary>
    public int SampleSize { get; set; }

    /// <summary>
    /// Значение задано человеком и не перетирается автосинхронизацией.
    /// </summary>
    public bool IsManualOverride { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
