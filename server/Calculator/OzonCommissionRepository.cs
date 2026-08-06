using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Ozon;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Calculator;

/// <summary>
/// Хранение тарифов Ozon и настроек калькулятора.
/// </summary>
public class OzonCommissionRepository(AppDbContext db)
{
    private static readonly Guid SettingsId = new("b7a1f6c2-0e4d-4a3b-9c58-1f2d3e4a5b6c");

    /// <summary>
    /// Записывает тарифы. Существующие товары обновляются, новые добавляются.
    /// </summary>
    public async Task<int> UpsertSnapshotsAsync(
        IReadOnlyList<OzonProductPriceInfo> prices,
        IReadOnlyDictionary<long, OzonProductCatalogInfo> catalog,
        CancellationToken cancellationToken)
    {
        if (prices.Count == 0)
        {
            return 0;
        }

        var productIds = prices.Select(price => price.ProductId).ToArray();
        var existing = await db.OzonCommissionSnapshots
            .Where(snapshot => productIds.Contains(snapshot.ProductId))
            .ToDictionaryAsync(snapshot => snapshot.ProductId, cancellationToken);

        var now = DateTimeOffset.UtcNow;

        foreach (var price in prices)
        {
            if (!existing.TryGetValue(price.ProductId, out var snapshot))
            {
                snapshot = new OzonCommissionSnapshot
                {
                    Id = Guid.NewGuid(),
                    ProductId = price.ProductId,
                };
                db.OzonCommissionSnapshots.Add(snapshot);
            }

            catalog.TryGetValue(price.ProductId, out var info);

            snapshot.OfferId = price.OfferId;
            snapshot.ProductName = info?.Name ?? snapshot.ProductName;
            snapshot.DescriptionCategoryId = info?.DescriptionCategoryId ?? snapshot.DescriptionCategoryId;
            snapshot.TypeId = info?.TypeId ?? snapshot.TypeId;

            snapshot.SalesPercentFbo = price.SalesPercentFbo;
            snapshot.SalesPercentFbs = price.SalesPercentFbs;

            snapshot.FboFulfillmentAmount = price.FboFulfillmentAmount;
            snapshot.FboDirectFlowTransMinAmount = price.FboDirectFlowTransMinAmount;
            snapshot.FboDirectFlowTransMaxAmount = price.FboDirectFlowTransMaxAmount;
            snapshot.FboDelivToCustomerAmount = price.FboDelivToCustomerAmount;
            snapshot.FboReturnFlowAmount = price.FboReturnFlowAmount;

            snapshot.FbsFirstMileMinAmount = price.FbsFirstMileMinAmount;
            snapshot.FbsFirstMileMaxAmount = price.FbsFirstMileMaxAmount;
            snapshot.FbsDirectFlowTransMinAmount = price.FbsDirectFlowTransMinAmount;
            snapshot.FbsDirectFlowTransMaxAmount = price.FbsDirectFlowTransMaxAmount;
            snapshot.FbsDelivToCustomerAmount = price.FbsDelivToCustomerAmount;
            snapshot.FbsReturnFlowAmount = price.FbsReturnFlowAmount;

            snapshot.AcquiringPercent = price.AcquiringPercent;
            snapshot.CurrentPrice = price.CurrentPrice;
            snapshot.OldPrice = price.OldPrice;
            snapshot.MarketingPrice = price.MarketingPrice;
            snapshot.MinPrice = price.MinPrice;
            snapshot.CurrencyCode = price.CurrencyCode;
            snapshot.RawCommissionsJson = price.RawCommissionsJson;
            snapshot.FetchedAt = now;
        }

        return await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Пересобирает справочник «категория → комиссия» по собственному каталогу.
    /// Строки с IsManualOverride не трогаются: их задал человек.
    /// </summary>
    public async Task<int> RebuildCategoryAggregateAsync(CancellationToken cancellationToken)
    {
        var aggregates = await db.OzonCommissionSnapshots
            .AsNoTracking()
            .Where(snapshot => snapshot.DescriptionCategoryId != null && snapshot.SalesPercentFbo > 0)
            .GroupBy(snapshot => snapshot.DescriptionCategoryId!.Value)
            .Select(group => new
            {
                CategoryId = group.Key,
                AvgFbo = group.Average(snapshot => snapshot.SalesPercentFbo),
                AvgFbs = group.Average(snapshot => snapshot.SalesPercentFbs),
                Count = group.Count(),
            })
            .ToListAsync(cancellationToken);

        if (aggregates.Count == 0)
        {
            return 0;
        }

        var categoryIds = aggregates.Select(item => item.CategoryId).ToArray();
        var existing = await db.OzonCategoryCommissions
            .Where(category => categoryIds.Contains(category.DescriptionCategoryId))
            .ToDictionaryAsync(category => category.DescriptionCategoryId, cancellationToken);

        var now = DateTimeOffset.UtcNow;
        var updated = 0;

        foreach (var item in aggregates)
        {
            if (!existing.TryGetValue(item.CategoryId, out var category))
            {
                category = new OzonCategoryCommission
                {
                    DescriptionCategoryId = item.CategoryId,
                };
                db.OzonCategoryCommissions.Add(category);
            }
            else if (category.IsManualOverride)
            {
                // Значение задано вручную — обновляем только размер выборки.
                category.SampleSize = item.Count;
                category.UpdatedAt = now;
                updated++;
                continue;
            }

            category.AvgSalesPercentFbo = Math.Round(item.AvgFbo, 2);
            category.AvgSalesPercentFbs = Math.Round(item.AvgFbs, 2);
            category.SampleSize = item.Count;
            category.UpdatedAt = now;
            updated++;
        }

        await db.SaveChangesAsync(cancellationToken);
        return updated;
    }

    public Task<OzonCommissionSnapshot?> GetSnapshotAsync(long productId, CancellationToken cancellationToken)
        => db.OzonCommissionSnapshots
            .AsNoTracking()
            .FirstOrDefaultAsync(snapshot => snapshot.ProductId == productId, cancellationToken);

    public async Task<IReadOnlyList<OzonCommissionSnapshot>> SearchSnapshotsAsync(
        string? search,
        int limit,
        CancellationToken cancellationToken)
    {
        var query = db.OzonCommissionSnapshots.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search.Trim()}%";
            query = query.Where(snapshot =>
                EF.Functions.ILike(snapshot.ProductName, pattern)
                || EF.Functions.ILike(snapshot.OfferId, pattern));
        }

        return await query
            .OrderBy(snapshot => snapshot.ProductName)
            .Take(Math.Clamp(limit, 1, 500))
            .ToListAsync(cancellationToken);
    }

    public Task<int> GetSnapshotCountAsync(CancellationToken cancellationToken)
        => db.OzonCommissionSnapshots.CountAsync(cancellationToken);

    public async Task<IReadOnlyList<OzonCategoryCommission>> GetCategoriesAsync(CancellationToken cancellationToken)
        => await db.OzonCategoryCommissions
            .AsNoTracking()
            .OrderBy(category => category.CategoryName)
            .ToListAsync(cancellationToken);

    /// <summary>Настройки калькулятора. При первом обращении создаются со значениями по умолчанию.</summary>
    public async Task<CalculatorSettings> GetSettingsAsync(CancellationToken cancellationToken)
    {
        var settings = await db.CalculatorSettings
            .FirstOrDefaultAsync(entry => entry.Id == SettingsId, cancellationToken);

        if (settings is not null)
        {
            return settings;
        }

        settings = new CalculatorSettings
        {
            Id = SettingsId,
            UpdatedAt = DateTimeOffset.UtcNow,
        };

        db.CalculatorSettings.Add(settings);
        await db.SaveChangesAsync(cancellationToken);
        return settings;
    }

    public async Task<CalculatorSettings> SaveSettingsAsync(
        CalculatorSettings incoming,
        CancellationToken cancellationToken)
    {
        var settings = await GetSettingsAsync(cancellationToken);

        settings.AcquiringPercent = incoming.AcquiringPercent;
        settings.TaxMode = incoming.TaxMode;
        settings.TaxPercent = incoming.TaxPercent;
        settings.BuyoutRatePercent = Math.Clamp(incoming.BuyoutRatePercent, 0m, 100m);
        settings.LogisticsRatePerLiter = incoming.LogisticsRatePerLiter;
        settings.LogisticsBaseAmount = incoming.LogisticsBaseAmount;
        settings.AdvertisingPercent = incoming.AdvertisingPercent;
        settings.ExtraCostFixed = incoming.ExtraCostFixed;
        settings.DefaultScheme = incoming.DefaultScheme;
        settings.PayoutDelayWeeks = incoming.PayoutDelayWeeks;
        settings.PayoutDayOfWeek = incoming.PayoutDayOfWeek;
        settings.UpdatedAt = DateTimeOffset.UtcNow;

        await db.SaveChangesAsync(cancellationToken);
        return settings;
    }

    /// <summary>
    /// Себестоимость товара с учётом того, берётся она индивидуально
    /// или из общего типа себестоимости.
    /// </summary>
    public async Task<decimal> GetCostPriceAsync(long productId, CancellationToken cancellationToken)
    {
        var profile = await db.ProductCostProfiles
            .AsNoTracking()
            .Include(entry => entry.CostType)
            .FirstOrDefaultAsync(
                entry => entry.ProductId == productId && entry.Marketplace == "ozon",
                cancellationToken);

        if (profile is null)
        {
            return 0m;
        }

        if (!profile.UseIndividualCost && profile.CostType is not null)
        {
            return (profile.CostType.PurchaseCost ?? 0m)
                + (profile.CostType.PackagingCost ?? 0m)
                + (profile.CostType.ProductionCost ?? 0m);
        }

        return (profile.PurchaseCost ?? 0m)
            + (profile.PackagingCost ?? 0m)
            + (profile.ProductionCost ?? 0m);
    }
}
