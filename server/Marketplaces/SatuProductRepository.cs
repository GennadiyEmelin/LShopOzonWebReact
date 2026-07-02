using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Ozon;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Marketplaces;

public sealed class SatuProductRepository(AppDbContext db)
{
    public async Task<KzCatalogSummary> GetCatalogSummaryAsync(string shopId, CancellationToken cancellationToken)
    {
        var products = await db.SatuProducts
            .AsNoTracking()
            .Where(product => product.ShopId == shopId && product.IsActive)
            .Select(product => product.Status)
            .ToListAsync(cancellationToken);

        var summary = new KzCatalogSummary(products.Count, 0, 0, 0);
        foreach (var status in products)
        {
            summary = status.Trim().ToLowerInvariant() switch
            {
                "selling" or "active" or "visible" or "on_display" or "on" or "published" =>
                    summary with { Selling = summary.Selling + 1 },
                "archived" or "archive" or "deleted" or "off" =>
                    summary with { Archived = summary.Archived + 1 },
                _ => summary with { Ready = summary.Ready + 1 }
            };
        }

        return summary;
    }

    public async Task<KzProductsPage> GetProductsPageAsync(
        string shopId,
        string? status,
        string? search,
        int skip,
        int take,
        CancellationToken cancellationToken)
    {
        take = Math.Clamp(take, 1, 500);
        skip = Math.Max(0, skip);

        var query = db.SatuProducts
            .AsNoTracking()
            .Where(product => product.ShopId == shopId && product.IsActive);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(product =>
                EF.Functions.ILike(product.Name, $"%{term}%") ||
                EF.Functions.ILike(product.OfferId, $"%{term}%"));
        }

        if (!string.IsNullOrWhiteSpace(status) && !status.Equals("all", StringComparison.OrdinalIgnoreCase))
        {
            query = status.ToLowerInvariant() switch
            {
                "selling" => query.Where(product =>
                    product.Status == "selling" ||
                    product.Status == "active" ||
                    product.Status == "visible" ||
                    product.Status == "on_display" ||
                    product.Status == "on" ||
                    product.Status == "published"),
                "archived" => query.Where(product =>
                    product.Status == "archived" ||
                    product.Status == "archive" ||
                    product.Status == "deleted" ||
                    product.Status == "off"),
                "ready" => query.Where(product =>
                    product.Status != "selling" &&
                    product.Status != "active" &&
                    product.Status != "visible" &&
                    product.Status != "on_display" &&
                    product.Status != "on" &&
                    product.Status != "published" &&
                    product.Status != "archived" &&
                    product.Status != "archive" &&
                    product.Status != "deleted" &&
                    product.Status != "off"),
                _ => query
            };
        }

        var matchedTotal = await query.CountAsync(cancellationToken);
        var summary = await GetCatalogSummaryAsync(shopId, cancellationToken);
        var items = await query
            .OrderBy(product => product.Name)
            .ThenBy(product => product.SatuProductId)
            .Skip(skip)
            .Take(take)
            .Select(product => new OzonProductSummary(
                product.SatuProductId,
                product.OfferId,
                product.SatuProductId,
                product.Name,
                product.Price,
                product.OldPrice,
                0,
                product.CurrencyCode,
                product.Status,
                product.ProductUrl,
                product.ImageUrl))
            .ToListAsync(cancellationToken);

        return new KzProductsPage(
            summary.Total,
            summary.Selling,
            summary.Ready,
            summary.Archived,
            matchedTotal,
            items);
    }

    public async Task<IReadOnlyList<OzonProductSummary>> GetActiveProductsAsync(
        string shopId,
        CancellationToken cancellationToken) =>
        await db.SatuProducts
            .AsNoTracking()
            .Where(product => product.ShopId == shopId && product.IsActive)
            .OrderBy(product => product.Name)
            .Select(product => new OzonProductSummary(
                product.SatuProductId,
                product.OfferId,
                product.SatuProductId,
                product.Name,
                product.Price,
                product.OldPrice,
                0,
                product.CurrencyCode,
                product.Status,
                product.ProductUrl,
                product.ImageUrl))
            .ToListAsync(cancellationToken);

    public async Task<int> GetActiveProductCountAsync(string shopId, CancellationToken cancellationToken) =>
        await db.SatuProducts
            .AsNoTracking()
            .CountAsync(product => product.ShopId == shopId && product.IsActive, cancellationToken);

    public async Task<bool> HasProductsAsync(string shopId, CancellationToken cancellationToken) =>
        await db.SatuProducts.AsNoTracking().AnyAsync(product => product.ShopId == shopId, cancellationToken);
}
