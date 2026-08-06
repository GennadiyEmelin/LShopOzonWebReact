namespace LShopOzonWebReact.Api.Models;

public class ProductCostType
{
    public Guid Id { get; set; }

    public string Marketplace { get; set; } = "ozon";

    public string Name { get; set; } = string.Empty;

    public bool IsPurchased { get; set; }

    public decimal? PurchaseCost { get; set; }

    public decimal? PackagingCost { get; set; }

    public decimal? ProductionCost { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
