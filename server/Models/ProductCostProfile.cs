namespace LShopOzonWebReact.Api.Models;

public class ProductCostProfile
{
    public Guid Id { get; set; }

    public string Marketplace { get; set; } = "ozon";

    public long ProductId { get; set; }

    public string OfferId { get; set; } = string.Empty;

    public string ProductName { get; set; } = string.Empty;

    public bool IsPurchased { get; set; }

    public Guid? CostTypeId { get; set; }

    public ProductCostType? CostType { get; set; }

    public bool UseIndividualCost { get; set; } = true;

    public decimal? PurchaseCost { get; set; }

    public decimal? PackagingCost { get; set; }

    public decimal? ProductionCost { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
