using System.Security.Claims;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Ozon;
using LShopOzonWebReact.Api.Security;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Marketplaces;

public static class KzMarketplaceRoutes
{
    public static void MapKzMarketplaceRoutes(this WebApplication app)
    {
        app.MapGet("/api/kz/{marketplace}/integrations", async (
            string marketplace,
            AppDbContext db,
            KzMarketplaceCredentials credentials,
            ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.IntegrationsOzon))
            {
                return Results.Forbid();
            }

            var normalized = MarketplaceTypes.NormalizeKzMarketplace(marketplace);
            await credentials.LoadFromDatabaseAsync(db);
            var settings = await db.AppIntegrationSettings.AsNoTracking().FirstOrDefaultAsync(entry => entry.Id == 1);
            var credentialSet = credentials.Get(normalized);

            return Results.Ok(new KzMarketplaceIntegrationResponse(
                credentialSet.IsConfigured,
                AppPublicText.MaskSecret(credentialSet.MerchantId),
                AppPublicText.MaskSecret(credentialSet.ApiKey),
                HasStoredMerchantId(settings, normalized),
                HasStoredApiKey(settings, normalized),
                settings?.UpdatedAt,
                MarketplaceTypes.GetDisplayName(normalized)));
        }).RequireAuthorization();

        app.MapPut("/api/kz/{marketplace}/integrations", async (
            string marketplace,
            UpdateKzMarketplaceIntegrationRequest request,
            AppDbContext db,
            KzMarketplaceCredentials credentials,
            ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.IntegrationsOzonEdit))
            {
                return Results.Forbid();
            }

            var normalized = MarketplaceTypes.NormalizeKzMarketplace(marketplace);
            await credentials.LoadFromDatabaseAsync(db);
            var credentialSet = credentials.Get(normalized);

            var merchantId = request.MerchantId?.Trim() ?? string.Empty;
            var apiKey = request.ApiKey?.Trim() ?? string.Empty;

            if (string.IsNullOrWhiteSpace(merchantId))
            {
                merchantId = credentialSet.MerchantId;
            }

            if (string.IsNullOrWhiteSpace(apiKey))
            {
                apiKey = credentialSet.ApiKey;
            }

            if (string.IsNullOrWhiteSpace(merchantId) || string.IsNullOrWhiteSpace(apiKey))
            {
                return Results.BadRequest("Укажите ID и API Key.");
            }

            var settings = await db.AppIntegrationSettings.FirstOrDefaultAsync(entry => entry.Id == 1);
            if (settings is null)
            {
                settings = new AppIntegrationSettings { Id = 1 };
                db.AppIntegrationSettings.Add(settings);
            }

            ApplyMarketplaceSettings(settings, normalized, merchantId, apiKey);
            settings.UpdatedAt = DateTimeOffset.UtcNow;
            credentials.Apply(settings);
            AuditLogWriter.Add(
                db,
                principal,
                $"{MarketplaceTypes.GetDisplayName(normalized)} API",
                "Integration",
                normalized,
                $"Обновлены ключи {MarketplaceTypes.GetDisplayName(normalized)}");
            await db.SaveChangesAsync();

            return Results.Ok(new KzMarketplaceIntegrationResponse(
                true,
                AppPublicText.MaskSecret(merchantId),
                AppPublicText.MaskSecret(apiKey),
                true,
                true,
                settings.UpdatedAt,
                MarketplaceTypes.GetDisplayName(normalized)));
        }).RequireAuthorization();

        app.MapPost("/api/kz/{marketplace}/integrations/test", async (
            string marketplace,
            AppDbContext db,
            KzMarketplaceApiClient marketplaceApi,
            KzMarketplaceCredentials credentials,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.IntegrationsOzon))
            {
                return Results.Forbid();
            }

            await credentials.LoadFromDatabaseAsync(db, cancellationToken);
            var result = await marketplaceApi.TestConnectionAsync(marketplace, cancellationToken);
            return Results.Ok(result);
        }).RequireAuthorization();

        app.MapGet("/api/kz/{marketplace}/products", async (
            string marketplace,
            string? status,
            int? skip,
            int? take,
            AppDbContext db,
            KzMarketplaceApiClient marketplaceApi,
            KzMarketplaceCredentials credentials,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Products, FeatureAccess.Production, FeatureAccess.Supplies))
            {
                return Results.Forbid();
            }

            await credentials.LoadFromDatabaseAsync(db, cancellationToken);

            try
            {
                var result = await marketplaceApi.GetProductsPageAsync(
                    marketplace,
                    status,
                    skip ?? 0,
                    take ?? 200,
                    cancellationToken);
                return Results.Ok(result);
            }
            catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
            {
                return Results.Problem(exception.Message);
            }
        }).RequireAuthorization();

        app.MapGet("/api/kz/{marketplace}/catalog-summary", async (
            string marketplace,
            AppDbContext db,
            KzMarketplaceApiClient marketplaceApi,
            KzMarketplaceCredentials credentials,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Analytics, FeatureAccess.Products))
            {
                return Results.Forbid();
            }

            await credentials.LoadFromDatabaseAsync(db, cancellationToken);

            try
            {
                var result = await marketplaceApi.GetCatalogSummaryAsync(marketplace, cancellationToken);
                return Results.Ok(result);
            }
            catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
            {
                return Results.Problem(exception.Message);
            }
        }).RequireAuthorization();

        app.MapGet("/api/kz/{marketplace}/analytics/snapshot", async (
            string marketplace,
            AppDbContext db,
            KzMarketplaceApiClient marketplaceApi,
            KzMarketplaceCredentials credentials,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Analytics))
            {
                return Results.Forbid();
            }

            await credentials.LoadFromDatabaseAsync(db, cancellationToken);

            try
            {
                var result = await marketplaceApi.GetAnalyticsSnapshotAsync(marketplace, cancellationToken);
                return Results.Ok(result);
            }
            catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
            {
                return Results.Problem(exception.Message);
            }
        }).RequireAuthorization();

        app.MapGet("/api/kz/{marketplace}/analytics/unsold", async (
            string marketplace,
            string? dateFrom,
            string? dateTo,
            int? skip,
            int? take,
            AppDbContext db,
            KzMarketplaceApiClient marketplaceApi,
            KzMarketplaceCredentials credentials,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Analytics))
            {
                return Results.Forbid();
            }

            await credentials.LoadFromDatabaseAsync(db, cancellationToken);

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

            try
            {
                var result = await marketplaceApi.GetUnsoldProductsPageAsync(
                    marketplace,
                    from,
                    to,
                    skip ?? 0,
                    take ?? 200,
                    cancellationToken);
                return Results.Ok(result);
            }
            catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
            {
                return Results.Problem(exception.Message);
            }
        }).RequireAuthorization();

        app.MapGet("/api/kz/{marketplace}/analytics", async (
            string marketplace,
            string? dateFrom,
            string? dateTo,
            AppDbContext db,
            KzMarketplaceApiClient marketplaceApi,
            KzMarketplaceCredentials credentials,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Analytics))
            {
                return Results.Forbid();
            }

            await credentials.LoadFromDatabaseAsync(db, cancellationToken);

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

            try
            {
                var result = await marketplaceApi.GetAnalyticsAsync(marketplace, from, to, cancellationToken);
                return Results.Ok(result);
            }
            catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
            {
                return Results.Problem(exception.Message);
            }
        }).RequireAuthorization();

        app.MapGet("/api/kz/{marketplace}/stocks", async (
            string marketplace,
            AppDbContext db,
            KzMarketplaceApiClient marketplaceApi,
            KzMarketplaceCredentials credentials,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Pooling))
            {
                return Results.Forbid();
            }

            await credentials.LoadFromDatabaseAsync(db, cancellationToken);

            try
            {
                var result = await marketplaceApi.GetStocksAsync(marketplace, cancellationToken);
                return Results.Ok(result);
            }
            catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
            {
                return Results.Problem(exception.Message);
            }
        }).RequireAuthorization();

        app.MapPut("/api/kz/{marketplace}/prices", async (
            string marketplace,
            OzonPriceUpdateRequest request,
            AppDbContext db,
            KzMarketplaceApiClient marketplaceApi,
            KzMarketplaceCredentials credentials,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, "pooling.editPrices"))
            {
                return Results.Forbid();
            }

            await credentials.LoadFromDatabaseAsync(db, cancellationToken);

            try
            {
                var result = await marketplaceApi.UpdatePriceAsync(marketplace, request, cancellationToken);
                AuditLogWriter.Add(
                    db,
                    principal,
                    result.Success ? $"Изменение цены {MarketplaceTypes.GetDisplayName(marketplace)}" : $"Ошибка изменения цены {MarketplaceTypes.GetDisplayName(marketplace)}",
                    "MarketplaceProduct",
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
    }

    private static bool HasStoredMerchantId(AppIntegrationSettings? settings, string marketplace) =>
        marketplace switch
        {
            MarketplaceTypes.Satu => !string.IsNullOrWhiteSpace(settings?.SatuMerchantId),
            MarketplaceTypes.Halyk => !string.IsNullOrWhiteSpace(settings?.HalykMerchantId),
            _ => !string.IsNullOrWhiteSpace(settings?.KaspiMerchantId)
        };

    private static bool HasStoredApiKey(AppIntegrationSettings? settings, string marketplace) =>
        marketplace switch
        {
            MarketplaceTypes.Satu => !string.IsNullOrWhiteSpace(settings?.SatuApiKey),
            MarketplaceTypes.Halyk => !string.IsNullOrWhiteSpace(settings?.HalykApiKey),
            _ => !string.IsNullOrWhiteSpace(settings?.KaspiApiKey)
        };

    private static void ApplyMarketplaceSettings(
        AppIntegrationSettings settings,
        string marketplace,
        string merchantId,
        string apiKey)
    {
        switch (marketplace)
        {
            case MarketplaceTypes.Satu:
                settings.SatuMerchantId = merchantId;
                settings.SatuApiKey = apiKey;
                break;
            case MarketplaceTypes.Halyk:
                settings.HalykMerchantId = merchantId;
                settings.HalykApiKey = apiKey;
                break;
            default:
                settings.KaspiMerchantId = merchantId;
                settings.KaspiApiKey = apiKey;
                break;
        }
    }
}

public record KzMarketplaceIntegrationResponse(
    bool Configured,
    string MerchantIdMasked,
    string ApiKeyMasked,
    bool HasStoredMerchantId,
    bool HasStoredApiKey,
    DateTimeOffset? UpdatedAt,
    string MarketplaceLabel);

public record UpdateKzMarketplaceIntegrationRequest(string? MerchantId, string? ApiKey);
