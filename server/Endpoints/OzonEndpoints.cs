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
        return Results.Ok(result);
    }
    catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
    {
        return Results.Problem(exception.Message);
    }
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
    catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
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
    catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
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
    catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
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
    catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
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
    catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
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
    catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
    {
        return Results.Problem(exception.Message);
    }
}).RequireAuthorization();
    }
}
