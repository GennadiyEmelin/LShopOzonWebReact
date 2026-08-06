using System.Security.Claims;
using LShopOzonWebReact.Api.Contracts.Common;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Ozon;
using LShopOzonWebReact.Api.Security;
using LShopOzonWebReact.Api.Supplies;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Endpoints;

public static class OzonEndpoints
{
    public static void MapOzonEndpoints(this WebApplication app)
    {
app.MapPost("/api/ozon/analytics/export", async (
    AnalyticsExportRequest request,
    AppDbContext db,
    ClaimsPrincipal principal) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Analytics))
    {
        return Results.Forbid();
    }

    if (request.Rows is not { Count: > 0 })
    {
        return Results.BadRequest("Нет данных для выгрузки.");
    }

    var sheetName = string.IsNullOrWhiteSpace(request.SheetName) ? "Аналитика" : request.SheetName.Trim();
    var fileName = string.IsNullOrWhiteSpace(request.FileName)
        ? $"analytics-{DateTime.UtcNow:yyyyMMdd-HHmmss}.xlsx"
        : request.FileName.Trim();

    if (!fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase))
    {
        fileName += ".xlsx";
    }

    var rows = request.Rows
        .Select(row => row.Select(cell => cell ?? string.Empty).ToArray())
        .ToList();

    var content = ExcelExport.CreateWorkbook(sheetName, rows);
    return Results.File(
        content,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileName);
}).RequireAuthorization();

app.MapGet("/api/ozon/products", async (OzonApiClient ozonApi, AppDbContext db, ClaimsPrincipal principal, CancellationToken cancellationToken) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Products, FeatureAccess.Production, FeatureAccess.Supplies))
    {
        return Results.Forbid();
    }

    try
    {
        var result = await ozonApi.GetProductSummariesAsync(100, cancellationToken);
        var productIds = result.Select(product => product.ProductId).ToArray();
        var costProfiles = await db.ProductCostProfiles
            .Include(profile => profile.CostType)
            .Where(profile => profile.Marketplace == "ozon" && productIds.Contains(profile.ProductId))
            .ToDictionaryAsync(profile => profile.ProductId, cancellationToken);

        return Results.Ok(result.Select(product =>
        {
            costProfiles.TryGetValue(product.ProductId, out var profile);
            return new OzonProductSummaryWithCost(
                product.ProductId,
                product.OfferId,
                product.Sku,
                product.Name,
                product.Price,
                product.OldPrice,
                product.MinPrice,
                product.CurrencyCode,
                product.Status,
                product.ProductUrl,
                product.ImageUrl,
                product.CreatedAt,
                profile is null ? null : CalculateCostTotal(profile),
                profile is not null && IsPurchasedProduct(profile));
        }));
    }
    catch (Exception exception) when (IsOzonApiException(exception))
    {
        return Results.Problem(exception.Message);
    }
}).RequireAuthorization();

app.MapGet("/api/ozon/products/{productId:long}/cost", async (
    long productId,
    AppDbContext db,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Products))
    {
        return Results.Forbid();
    }

    var profile = await db.ProductCostProfiles
        .Include(item => item.CostType)
        .FirstOrDefaultAsync(item => item.Marketplace == "ozon" && item.ProductId == productId, cancellationToken);

    if (profile is null)
    {
        return Results.Ok(new ProductCostProfileResponse(
            productId,
            string.Empty,
            string.Empty,
            false,
            null,
            null,
            true,
            null,
            null,
            null,
            null));
    }

    return Results.Ok(ToProductCostProfileResponse(profile));
}).RequireAuthorization();

app.MapGet("/api/ozon/product-cost-profiles", async (
    AppDbContext db,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Products, FeatureAccess.Analytics))
    {
        return Results.Forbid();
    }

    var profiles = await db.ProductCostProfiles
        .Include(item => item.CostType)
        .Where(item => item.Marketplace == "ozon")
        .OrderBy(item => item.ProductName)
        .ThenBy(item => item.OfferId)
        .ToListAsync(cancellationToken);

    return Results.Ok(profiles.Select(ToProductCostProfileResponse));
}).RequireAuthorization();

app.MapGet("/api/ozon/product-cost-types", async (
    AppDbContext db,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Products, FeatureAccess.Analytics))
    {
        return Results.Forbid();
    }

    var types = await db.ProductCostTypes
        .Where(type => type.Marketplace == "ozon")
        .OrderBy(type => type.Name)
        .ToListAsync(cancellationToken);

    return Results.Ok(types.Select(ToProductCostTypeResponse));
}).RequireAuthorization();

app.MapPost("/api/ozon/product-cost-types", async (
    ProductCostTypeRequest request,
    AppDbContext db,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, "products.edit"))
    {
        return Results.Forbid();
    }

    var name = request.Name?.Trim() ?? string.Empty;
    if (string.IsNullOrWhiteSpace(name))
    {
        return Results.BadRequest("Укажите название типа себестоимости.");
    }

    var exists = await db.ProductCostTypes
        .AnyAsync(type => type.Marketplace == "ozon" && type.Name.ToLower() == name.ToLower(), cancellationToken);
    if (exists)
    {
        return Results.BadRequest("Такой тип себестоимости уже есть.");
    }

    var now = DateTimeOffset.UtcNow;
    var costType = new ProductCostType
    {
        Id = Guid.NewGuid(),
        Marketplace = "ozon",
        Name = name,
        IsPurchased = request.IsPurchased,
        PurchaseCost = NormalizeMoney(request.PurchaseCost),
        PackagingCost = request.IsPurchased ? null : NormalizeMoney(request.PackagingCost),
        ProductionCost = request.IsPurchased ? null : NormalizeMoney(request.ProductionCost),
        CreatedAt = now,
        UpdatedAt = now,
    };

    db.ProductCostTypes.Add(costType);
    AuditLogWriter.Add(
        db,
        principal,
        "Создание типа себестоимости",
        "ProductCostType",
        costType.Id.ToString(),
        $"{costType.Name}: {CalculateCostTotal(costType):0.##} KZT");
    await db.SaveChangesAsync(cancellationToken);

    return Results.Ok(ToProductCostTypeResponse(costType));
}).RequireAuthorization();

app.MapPut("/api/ozon/product-cost-types/{costTypeId:guid}", async (
    Guid costTypeId,
    ProductCostTypeRequest request,
    AppDbContext db,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, "products.edit"))
    {
        return Results.Forbid();
    }

    var name = request.Name?.Trim() ?? string.Empty;
    if (string.IsNullOrWhiteSpace(name))
    {
        return Results.BadRequest("Укажите название типа себестоимости.");
    }

    var costType = await db.ProductCostTypes
        .FirstOrDefaultAsync(type => type.Marketplace == "ozon" && type.Id == costTypeId, cancellationToken);
    if (costType is null)
    {
        return Results.NotFound("Тип себестоимости не найден.");
    }

    var exists = await db.ProductCostTypes
        .AnyAsync(type => type.Marketplace == "ozon"
            && type.Id != costTypeId
            && type.Name.ToLower() == name.ToLower(), cancellationToken);
    if (exists)
    {
        return Results.BadRequest("Такой тип себестоимости уже есть.");
    }

    costType.Name = name;
    costType.IsPurchased = request.IsPurchased;
    costType.PurchaseCost = NormalizeMoney(request.PurchaseCost);
    costType.PackagingCost = request.IsPurchased ? null : NormalizeMoney(request.PackagingCost);
    costType.ProductionCost = request.IsPurchased ? null : NormalizeMoney(request.ProductionCost);
    costType.UpdatedAt = DateTimeOffset.UtcNow;

    AuditLogWriter.Add(
        db,
        principal,
        "Изменение типа себестоимости",
        "ProductCostType",
        costType.Id.ToString(),
        $"{costType.Name}: {CalculateCostTotal(costType):0.##} KZT");
    await db.SaveChangesAsync(cancellationToken);

    return Results.Ok(ToProductCostTypeResponse(costType));
}).RequireAuthorization();

app.MapPut("/api/ozon/products/{productId:long}/cost", async (
    long productId,
    ProductCostProfileRequest request,
    AppDbContext db,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, "products.edit"))
    {
        return Results.Forbid();
    }

    var now = DateTimeOffset.UtcNow;
    var offerId = request.OfferId?.Trim() ?? string.Empty;
    var productName = request.ProductName?.Trim() ?? string.Empty;
    ProductCostType? costType = null;

    if (!request.UseIndividualCost)
    {
        if (request.CostTypeId is null)
        {
            return Results.BadRequest("Выберите тип себестоимости.");
        }

        costType = await db.ProductCostTypes
            .FirstOrDefaultAsync(type => type.Marketplace == "ozon" && type.Id == request.CostTypeId, cancellationToken);
        if (costType is null)
        {
            return Results.BadRequest("Тип себестоимости не найден.");
        }
    }

    var profile = await db.ProductCostProfiles
        .Include(item => item.CostType)
        .FirstOrDefaultAsync(item => item.Marketplace == "ozon" && item.ProductId == productId, cancellationToken);

    if (profile is null)
    {
        profile = new ProductCostProfile
        {
            Id = Guid.NewGuid(),
            Marketplace = "ozon",
            ProductId = productId,
            CreatedAt = now,
        };
        db.ProductCostProfiles.Add(profile);
    }

    profile.OfferId = offerId;
    profile.ProductName = productName;
    profile.IsPurchased = request.IsPurchased;
    profile.UseIndividualCost = request.UseIndividualCost;
    profile.CostTypeId = request.UseIndividualCost ? null : costType?.Id;
    profile.CostType = request.UseIndividualCost ? null : costType;
    profile.PurchaseCost = NormalizeMoney(request.PurchaseCost);
    profile.PackagingCost = request.IsPurchased ? null : NormalizeMoney(request.PackagingCost);
    profile.ProductionCost = request.IsPurchased ? null : NormalizeMoney(request.ProductionCost);
    profile.UpdatedAt = now;

    AuditLogWriter.Add(
        db,
        principal,
        "Изменение себестоимости товара",
        "ProductCostProfile",
        productId.ToString(),
        $"{offerId}: {CalculateCostTotal(profile):0.##} KZT");
    await db.SaveChangesAsync(cancellationToken);

    return Results.Ok(ToProductCostProfileResponse(profile));
}).RequireAuthorization();

app.MapGet("/api/ozon/stocks", async (OzonApiClient ozonApi, AppDbContext db, ClaimsPrincipal principal, CancellationToken cancellationToken) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Pooling))
    {
        return Results.Forbid();
    }

    try
    {
        var result = await ozonApi.GetStockSummariesAsync(100, cancellationToken);
        return Results.Ok(result);
    }
    catch (Exception exception) when (IsOzonApiException(exception))
    {
        return Results.Problem(exception.Message);
    }
}).RequireAuthorization();

app.MapGet("/api/ozon/supply-shipments", async (
    OzonApiClient ozonApi,
    AppDbContext db,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Supplies, FeatureAccess.Analytics))
    {
        return Results.Forbid();
    }

    try
    {
        var result = await ozonApi.GetCompletedSupplyShipmentQuantitiesAsync(cancellationToken);
        return Results.Ok(result);
    }
    catch (Exception exception) when (IsOzonApiException(exception))
    {
        return Results.Problem(exception.Message);
    }
}).RequireAuthorization();

app.MapPut("/api/ozon/prices", async (
    OzonPriceUpdateRequest request,
    OzonApiClient ozonApi,
    AppDbContext db,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, "pooling.editPrices"))
    {
        return Results.Forbid();
    }

    try
    {
        var result = await ozonApi.UpdatePriceAsync(request, cancellationToken);
        AuditLogWriter.Add(
            db,
            principal,
            result.Success ? "Изменение цены Ozon" : "Ошибка изменения цены Ozon",
            "OzonProduct",
            request.ProductId.ToString(),
            $"{request.OfferId}: {request.Price} {request.CurrencyCode}. {result.Message}");
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(result);
    }
    catch (Exception exception) when (IsOzonApiException(exception))
    {
        return Results.Problem(exception.Message);
    }
}).RequireAuthorization();

app.MapGet("/api/ozon/sales-chart", async (
    string? dateFrom,
    string? dateTo,
    string? groupBy,
    OzonApiClient ozonApi,
    AppDbContext db,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    if (!await UserRoleResolver.IsInRoleAsync(db, principal, UserRoles.Admin))
    {
        return Results.Forbid();
    }

    try
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var from = new DateOnly(today.Year, today.Month, 1);
        var to = today;

        if (!string.IsNullOrWhiteSpace(dateFrom) && !DateOnly.TryParse(dateFrom, out from))
        {
            return Results.BadRequest("Некорректная дата начала периода.");
        }

        if (!string.IsNullOrWhiteSpace(dateTo) && !DateOnly.TryParse(dateTo, out to))
        {
            return Results.BadRequest("Некорректная дата окончания периода.");
        }

        if (from > to)
        {
            return Results.BadRequest("Дата начала не может быть позже даты окончания.");
        }

        var normalizedGroupBy = string.Equals(groupBy, "day", StringComparison.OrdinalIgnoreCase) ? "day" : "month";
        var result = await ozonApi.GetSalesChartAsync(from, to, normalizedGroupBy, null, cancellationToken);
        return Results.Ok(result);
    }
    catch (Exception exception) when (IsOzonApiException(exception))
    {
        return Results.Problem(exception.Message);
    }
}).RequireAuthorization();

app.MapGet("/api/ozon/analytics", async (
    string? dateFrom,
    string? dateTo,
    OzonApiClient ozonApi,
    AppDbContext db,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Analytics))
    {
        return Results.Forbid();
    }

    try
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var from = new DateOnly(today.Year, today.Month, 1);
        var to = today;

        if (!string.IsNullOrWhiteSpace(dateFrom) && !DateOnly.TryParse(dateFrom, out from))
        {
            return Results.BadRequest("Некорректная дата начала периода.");
        }

        if (!string.IsNullOrWhiteSpace(dateTo) && !DateOnly.TryParse(dateTo, out to))
        {
            return Results.BadRequest("Некорректная дата окончания периода.");
        }

        if (from > to)
        {
            return Results.BadRequest("Дата начала не может быть позже даты окончания.");
        }

        var supplyArrivalDates = await SupplyAnalyticsHelper.BuildAcceptedSupplyArrivalDatesAsync(db);
        var result = await ozonApi.GetAnalyticsAsync(from, to, supplyArrivalDates, null, cancellationToken);
        return Results.Ok(result);
    }
    catch (Exception exception) when (IsOzonApiException(exception))
    {
        return Results.Problem(exception.Message);
    }
}).RequireAuthorization();

app.MapGet("/api/ozon/analytics/unsold", async (
    OzonApiClient ozonApi,
    AppDbContext db,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Analytics))
    {
        return Results.Forbid();
    }

    try
    {
        var supplyArrivalDates = await SupplyAnalyticsHelper.BuildAcceptedSupplyArrivalDatesAsync(db);
        var result = await ozonApi.GetUnsoldProductsAsync(supplyArrivalDates, null, cancellationToken);
        return Results.Ok(result);
    }
    catch (Exception exception) when (IsOzonApiException(exception))
    {
        return Results.Problem(exception.Message);
    }
}).RequireAuthorization();

app.MapGet("/api/ozon/analytics/snapshot", async (
    OzonApiClient ozonApi,
    AppDbContext db,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Analytics))
    {
        return Results.Forbid();
    }

    try
    {
        var result = await ozonApi.GetAnalyticsSnapshotAsync(cancellationToken);
        return Results.Ok(result);
    }
    catch (Exception exception) when (IsOzonApiException(exception))
    {
        return Results.Problem(exception.Message);
    }
}).RequireAuthorization();
    }

    private static decimal? NormalizeMoney(decimal? value) =>
        value is { } amount && amount > 0 ? decimal.Round(amount, 2) : null;

    private static decimal? CalculateOwnCostTotal(
        bool isPurchased,
        decimal? purchaseCost,
        decimal? packagingCost,
        decimal? productionCost)
    {
        var total = isPurchased
            ? purchaseCost
            : (packagingCost ?? 0) + (productionCost ?? 0);

        return total is > 0 ? decimal.Round(total.Value, 2) : null;
    }

    private static decimal? CalculateCostTotal(ProductCostType type) =>
        CalculateOwnCostTotal(type.IsPurchased, type.PurchaseCost, type.PackagingCost, type.ProductionCost);

    private static decimal? CalculateCostTotal(ProductCostProfile profile) =>
        !profile.UseIndividualCost && profile.CostType is not null
            ? CalculateCostTotal(profile.CostType)
            : CalculateOwnCostTotal(profile.IsPurchased, profile.PurchaseCost, profile.PackagingCost, profile.ProductionCost);

    private static bool IsPurchasedProduct(ProductCostProfile profile) =>
        !profile.UseIndividualCost && profile.CostType is not null
            ? profile.CostType.IsPurchased
            : profile.IsPurchased;

    private static ProductCostTypeResponse ToProductCostTypeResponse(ProductCostType type) =>
        new(
            type.Id,
            type.Name,
            type.IsPurchased,
            type.PurchaseCost,
            type.PackagingCost,
            type.ProductionCost,
            CalculateCostTotal(type));

    private static ProductCostProfileResponse ToProductCostProfileResponse(ProductCostProfile profile) =>
        new(
            profile.ProductId,
            profile.OfferId,
            profile.ProductName,
            profile.IsPurchased,
            profile.CostTypeId,
            profile.CostType?.Name,
            profile.UseIndividualCost,
            profile.PurchaseCost,
            profile.PackagingCost,
            profile.ProductionCost,
            CalculateCostTotal(profile));

    private static bool IsOzonApiException(Exception exception) =>
        exception is InvalidOperationException or HttpRequestException or TaskCanceledException or TimeoutException;
}

record ProductCostProfileRequest(
    string? OfferId,
    string? ProductName,
    bool IsPurchased,
    Guid? CostTypeId,
    bool UseIndividualCost,
    decimal? PurchaseCost,
    decimal? PackagingCost,
    decimal? ProductionCost);

record ProductCostProfileResponse(
    long ProductId,
    string OfferId,
    string ProductName,
    bool IsPurchased,
    Guid? CostTypeId,
    string? CostTypeName,
    bool UseIndividualCost,
    decimal? PurchaseCost,
    decimal? PackagingCost,
    decimal? ProductionCost,
    decimal? CostTotal);

record ProductCostTypeRequest(
    string? Name,
    bool IsPurchased,
    decimal? PurchaseCost,
    decimal? PackagingCost,
    decimal? ProductionCost);

record ProductCostTypeResponse(
    Guid Id,
    string Name,
    bool IsPurchased,
    decimal? PurchaseCost,
    decimal? PackagingCost,
    decimal? ProductionCost,
    decimal? CostTotal);

record OzonProductSummaryWithCost(
    long ProductId,
    string OfferId,
    long? Sku,
    string Name,
    decimal Price,
    decimal OldPrice,
    decimal MinPrice,
    string CurrencyCode,
    string Status,
    string ProductUrl,
    string ImageUrl,
    string? CreatedAt,
    decimal? CostTotal,
    bool IsPurchased);

