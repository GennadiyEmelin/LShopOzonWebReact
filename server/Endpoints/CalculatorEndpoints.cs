using System.Security.Claims;
using LShopOzonWebReact.Api.Calculator;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Security;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Endpoints;

public static class CalculatorEndpoints
{
    public static void MapCalculatorEndpoints(this WebApplication app)
    {
        // ---------- Настройки ----------

        app.MapGet("/api/calculator/settings", async (
            AppDbContext db,
            OzonCommissionRepository repository,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.AnalyticsCalculator, FeatureAccess.Analytics))
            {
                return Results.Forbid();
            }

            var settings = await repository.GetSettingsAsync(cancellationToken);
            return Results.Ok(ToSettingsResponse(settings));
        }).RequireAuthorization();

        app.MapPut("/api/calculator/settings", async (
            CalculatorSettingsRequest request,
            AppDbContext db,
            OzonCommissionRepository repository,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.AnalyticsCalculatorEdit))
            {
                return Results.Forbid();
            }

            if (request.TaxPercent is < 0 or > 100)
            {
                return Results.BadRequest("Налог должен быть в диапазоне 0–100 %.");
            }

            if (request.AcquiringPercent is < 0 or > 100)
            {
                return Results.BadRequest("Эквайринг должен быть в диапазоне 0–100 %.");
            }

            var saved = await repository.SaveSettingsAsync(
                new CalculatorSettings
                {
                    AcquiringPercent = request.AcquiringPercent,
                    TaxMode = NormalizeTaxMode(request.TaxMode),
                    TaxPercent = request.TaxPercent,
                    BuyoutRatePercent = request.BuyoutRatePercent,
                    LogisticsRatePerLiter = request.LogisticsRatePerLiter,
                    LogisticsBaseAmount = request.LogisticsBaseAmount,
                    AdvertisingPercent = request.AdvertisingPercent,
                    ExtraCostFixed = request.ExtraCostFixed,
                    DefaultScheme = NormalizeScheme(request.DefaultScheme),
                    PayoutDelayWeeks = Math.Clamp(request.PayoutDelayWeeks, 0, 12),
                    PayoutDayOfWeek = Math.Clamp(request.PayoutDayOfWeek, 0, 6),
                },
                cancellationToken);

            return Results.Ok(ToSettingsResponse(saved));
        }).RequireAuthorization();

        // ---------- Товары с тарифами ----------

        app.MapGet("/api/calculator/products", async (
            string? search,
            int? limit,
            AppDbContext db,
            OzonCommissionRepository repository,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.AnalyticsCalculator, FeatureAccess.Analytics))
            {
                return Results.Forbid();
            }

            var snapshots = await repository.SearchSnapshotsAsync(search, limit ?? 100, cancellationToken);
            if (snapshots.Count == 0)
            {
                return Results.Ok(Array.Empty<CalculatorProductResponse>());
            }

            // Себестоимость одним запросом на всю выборку, не по одному товару.
            var productIds = snapshots.Select(snapshot => snapshot.ProductId).ToArray();
            var costProfiles = await db.ProductCostProfiles
                .AsNoTracking()
                .Include(profile => profile.CostType)
                .Where(profile => profile.Marketplace == "ozon" && productIds.Contains(profile.ProductId))
                .ToDictionaryAsync(profile => profile.ProductId, cancellationToken);

            var response = snapshots.Select(snapshot =>
            {
                costProfiles.TryGetValue(snapshot.ProductId, out var profile);
                return new CalculatorProductResponse(
                    snapshot.ProductId,
                    snapshot.OfferId,
                    snapshot.ProductName,
                    snapshot.CurrentPrice,
                    snapshot.MinPrice,
                    ResolveCostPrice(profile),
                    snapshot.SalesPercentFbo,
                    snapshot.SalesPercentFbs,
                    snapshot.FboFulfillmentAmount,
                    snapshot.FboDirectFlowTransMinAmount,
                    snapshot.FboDirectFlowTransMaxAmount,
                    snapshot.FboDelivToCustomerAmount,
                    snapshot.FboReturnFlowAmount,
                    snapshot.FbsFirstMileMinAmount,
                    snapshot.FbsDirectFlowTransMinAmount,
                    snapshot.FbsDirectFlowTransMaxAmount,
                    snapshot.FbsDelivToCustomerAmount,
                    snapshot.FbsReturnFlowAmount,
                    snapshot.AcquiringPercent,
                    snapshot.CurrencyCode,
                    snapshot.FetchedAt);
            }).ToArray();

            return Results.Ok(response);
        }).RequireAuthorization();

        // ---------- Расчёт ----------

        app.MapPost("/api/calculator/calculate", async (
            CalculateRequest request,
            AppDbContext db,
            OzonCommissionRepository repository,
            CalculatorService calculator,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.AnalyticsCalculator, FeatureAccess.Analytics))
            {
                return Results.Forbid();
            }

            var build = await BuildInputAsync(request, db, repository, cancellationToken);
            if (build.Error is not null)
            {
                return Results.BadRequest(build.Error);
            }

            return Results.Ok(calculator.Calculate(build.Input!));
        }).RequireAuthorization();

        app.MapPost("/api/calculator/reverse", async (
            ReverseCalculateRequest request,
            AppDbContext db,
            OzonCommissionRepository repository,
            CalculatorService calculator,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.AnalyticsCalculator, FeatureAccess.Analytics))
            {
                return Results.Forbid();
            }

            if (request.TargetMarginPercent is <= 0 or >= 100)
            {
                return Results.BadRequest("Целевая маржа должна быть больше 0 и меньше 100 %.");
            }

            var build = await BuildInputAsync(request.Input, db, repository, cancellationToken);
            if (build.Error is not null)
            {
                return Results.BadRequest(build.Error);
            }

            return Results.Ok(calculator.CalculateForTargetMargin(build.Input!, request.TargetMarginPercent));
        }).RequireAuthorization();

        // ---------- Справочник категорий (ручной режим) ----------

        app.MapGet("/api/calculator/categories", async (
            AppDbContext db,
            OzonCommissionRepository repository,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.AnalyticsCalculator, FeatureAccess.Analytics))
            {
                return Results.Forbid();
            }

            var categories = await repository.GetCategoriesAsync(cancellationToken);
            return Results.Ok(categories.Select(category => new CalculatorCategoryResponse(
                category.DescriptionCategoryId,
                category.CategoryName,
                category.AvgSalesPercentFbo,
                category.AvgSalesPercentFbs,
                category.SampleSize,
                category.IsManualOverride,
                category.UpdatedAt)));
        }).RequireAuthorization();

        app.MapPut("/api/calculator/categories/{categoryId:long}", async (
            long categoryId,
            CalculatorCategoryRequest request,
            AppDbContext db,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.AnalyticsCalculatorEdit))
            {
                return Results.Forbid();
            }

            if (request.SalesPercentFbo is < 0 or > 100 || request.SalesPercentFbs is < 0 or > 100)
            {
                return Results.BadRequest("Комиссия должна быть в диапазоне 0–100 %.");
            }

            var category = await db.OzonCategoryCommissions
                .FirstOrDefaultAsync(entry => entry.DescriptionCategoryId == categoryId, cancellationToken);

            if (category is null)
            {
                category = new OzonCategoryCommission { DescriptionCategoryId = categoryId };
                db.OzonCategoryCommissions.Add(category);
            }

            if (!string.IsNullOrWhiteSpace(request.CategoryName))
            {
                category.CategoryName = request.CategoryName.Trim();
            }

            category.AvgSalesPercentFbo = request.SalesPercentFbo;
            category.AvgSalesPercentFbs = request.SalesPercentFbs;
            // Помечаем как ручное — автосинхронизация больше не перетрёт значение.
            category.IsManualOverride = true;
            category.UpdatedAt = DateTimeOffset.UtcNow;

            await db.SaveChangesAsync(cancellationToken);

            return Results.Ok(new CalculatorCategoryResponse(
                category.DescriptionCategoryId,
                category.CategoryName,
                category.AvgSalesPercentFbo,
                category.AvgSalesPercentFbs,
                category.SampleSize,
                category.IsManualOverride,
                category.UpdatedAt));
        }).RequireAuthorization();

        // ---------- Синхронизация ----------

        app.MapGet("/api/calculator/sync-state", async (
            AppDbContext db,
            IOzonCommissionSyncCoordinator coordinator,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.AnalyticsCalculator, FeatureAccess.Analytics))
            {
                return Results.Forbid();
            }

            return Results.Ok(await coordinator.GetStatusAsync(cancellationToken));
        }).RequireAuthorization();

        app.MapPost("/api/calculator/sync", async (
            AppDbContext db,
            IOzonCommissionSyncCoordinator coordinator,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.AnalyticsCalculatorEdit))
            {
                return Results.Forbid();
            }

            coordinator.RequestSync();
            return Results.Accepted(value: await coordinator.GetStatusAsync(cancellationToken));
        }).RequireAuthorization();
    }

    /// <summary>
    /// Собирает входные данные расчёта: тарифы из снапшота либо из формы,
    /// себестоимость из карточки, остальное из настроек.
    /// </summary>
    private static async Task<(CalculationInput? Input, string? Error)> BuildInputAsync(
        CalculateRequest request,
        AppDbContext db,
        OzonCommissionRepository repository,
        CancellationToken cancellationToken)
    {
        var settings = await repository.GetSettingsAsync(cancellationToken);
        var scheme = NormalizeScheme(request.Scheme ?? settings.DefaultScheme);
        var isFbo = scheme == CalculatorSchemes.Fbo;

        var input = new CalculationInput
        {
            Scheme = scheme,
            Price = request.Price,
            AcquiringPercent = request.AcquiringPercent ?? settings.AcquiringPercent,
            AdvertisingPercent = request.AdvertisingPercent ?? settings.AdvertisingPercent,
            ExtraCostFixed = request.ExtraCostFixed ?? settings.ExtraCostFixed,
            // Налог из расчёта убран: ставка зависит от страны и формы
            // регистрации продавца, угадывать её нельзя. В базе может лежать
            // старое значение — намеренно его игнорируем.
            TaxMode = CalculatorTaxModes.None,
            TaxPercent = 0m,
            BuyoutRatePercent = request.BuyoutRatePercent ?? settings.BuyoutRatePercent,
            CostPrice = request.CostPrice ?? 0m,
        };

        if (request.ProductId is { } productId and > 0)
        {
            // Режим «по своим товарам»
            var snapshot = await repository.GetSnapshotAsync(productId, cancellationToken);
            if (snapshot is null)
            {
                return (null, "Тарифы по этому товару ещё не загружены. Запустите синхронизацию.");
            }

            input = input with
            {
                Price = request.Price > 0 ? request.Price : snapshot.CurrentPrice,
                SalesPercent = isFbo ? snapshot.SalesPercentFbo : snapshot.SalesPercentFbs,
                FulfillmentAmount = snapshot.FboFulfillmentAmount,
                FirstMileAmount = isFbo ? 0m : snapshot.FbsFirstMileMinAmount,
                DirectFlowTransMinAmount = isFbo
                    ? snapshot.FboDirectFlowTransMinAmount
                    : snapshot.FbsDirectFlowTransMinAmount,
                DirectFlowTransMaxAmount = isFbo
                    ? snapshot.FboDirectFlowTransMaxAmount
                    : snapshot.FbsDirectFlowTransMaxAmount,
                DelivToCustomerAmount = isFbo
                    ? snapshot.FboDelivToCustomerAmount
                    : snapshot.FbsDelivToCustomerAmount,
                ReturnFlowAmount = isFbo ? snapshot.FboReturnFlowAmount : snapshot.FbsReturnFlowAmount,
                AcquiringPercent = request.AcquiringPercent
                    ?? snapshot.AcquiringPercent
                    ?? settings.AcquiringPercent,
                CostPrice = request.CostPrice ?? await repository.GetCostPriceAsync(productId, cancellationToken),
            };

            return (input, null);
        }

        // Ручной режим: тарифы приходят из формы.
        if (request.SalesPercent is null && request.CategoryId is null)
        {
            return (null, "Укажите товар, категорию или процент комиссии.");
        }

        var salesPercent = request.SalesPercent;

        if (salesPercent is null && request.CategoryId is { } categoryId)
        {
            var category = await db.OzonCategoryCommissions
                .AsNoTracking()
                .FirstOrDefaultAsync(entry => entry.DescriptionCategoryId == categoryId, cancellationToken);

            if (category is null)
            {
                return (null, "По этой категории нет данных о комиссии. Введите процент вручную.");
            }

            salesPercent = isFbo ? category.AvgSalesPercentFbo : category.AvgSalesPercentFbs;
        }

        var logistics = request.LogisticsAmount ?? EstimateLogistics(request, settings);

        input = input with
        {
            SalesPercent = salesPercent ?? 0m,
            FulfillmentAmount = request.FulfillmentAmount ?? 0m,
            FirstMileAmount = request.FirstMileAmount ?? 0m,
            DirectFlowTransMinAmount = logistics,
            DirectFlowTransMaxAmount = logistics,
            DelivToCustomerAmount = request.DelivToCustomerAmount ?? 0m,
            ReturnFlowAmount = request.ReturnFlowAmount ?? 0m,
        };

        return (input, null);
    }

    /// <summary>
    /// Приблизительная логистика по объёмному весу — для ручного режима.
    /// Ставки берутся из настроек: Ozon их по API не отдаёт.
    /// </summary>
    private static decimal EstimateLogistics(CalculateRequest request, CalculatorSettings settings)
    {
        if (request.Depth is not { } depth
            || request.Width is not { } width
            || request.Height is not { } height
            || depth <= 0 || width <= 0 || height <= 0)
        {
            return 0m;
        }

        // Габариты в сантиметрах, объёмный вес — в литрах.
        var liters = depth * width * height / 1000m;
        return settings.LogisticsBaseAmount + liters * settings.LogisticsRatePerLiter;
    }

    private static decimal ResolveCostPrice(ProductCostProfile? profile)
    {
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

    private static string NormalizeScheme(string? scheme)
        => string.Equals(scheme, CalculatorSchemes.Fbs, StringComparison.OrdinalIgnoreCase)
            ? CalculatorSchemes.Fbs
            : CalculatorSchemes.Fbo;

    private static string NormalizeTaxMode(string? taxMode) => taxMode switch
    {
        CalculatorTaxModes.UsnIncomeMinusExpenses => CalculatorTaxModes.UsnIncomeMinusExpenses,
        CalculatorTaxModes.None => CalculatorTaxModes.None,
        _ => CalculatorTaxModes.UsnIncome,
    };

    private static CalculatorSettingsResponse ToSettingsResponse(CalculatorSettings settings)
        => new(
            settings.AcquiringPercent,
            settings.TaxMode,
            settings.TaxPercent,
            settings.BuyoutRatePercent,
            settings.LogisticsRatePerLiter,
            settings.LogisticsBaseAmount,
            settings.AdvertisingPercent,
            settings.ExtraCostFixed,
            settings.DefaultScheme,
            settings.PayoutDelayWeeks,
            settings.PayoutDayOfWeek,
            settings.UpdatedAt);
}

// ---------- Контракты ----------

public record CalculatorSettingsRequest(
    decimal AcquiringPercent,
    string? TaxMode,
    decimal TaxPercent,
    decimal BuyoutRatePercent,
    decimal LogisticsRatePerLiter,
    decimal LogisticsBaseAmount,
    decimal AdvertisingPercent,
    decimal ExtraCostFixed,
    string? DefaultScheme,
    int PayoutDelayWeeks,
    int PayoutDayOfWeek);

public record CalculatorSettingsResponse(
    decimal AcquiringPercent,
    string TaxMode,
    decimal TaxPercent,
    decimal BuyoutRatePercent,
    decimal LogisticsRatePerLiter,
    decimal LogisticsBaseAmount,
    decimal AdvertisingPercent,
    decimal ExtraCostFixed,
    string DefaultScheme,
    int PayoutDelayWeeks,
    int PayoutDayOfWeek,
    DateTimeOffset UpdatedAt);

/// <summary>
/// Товар с полным набором тарифов. Полный набор нужен, чтобы браузер
/// пересчитывал цифры мгновенно и ровно так же, как сервер, — без запроса на каждое
/// нажатие клавиши и без расхождений между предпросмотром и итогом.
/// </summary>
public record CalculatorProductResponse(
    long ProductId,
    string OfferId,
    string ProductName,
    decimal CurrentPrice,
    decimal? MinPrice,
    decimal CostPrice,
    decimal SalesPercentFbo,
    decimal SalesPercentFbs,
    decimal FboFulfillmentAmount,
    decimal FboDirectFlowTransMinAmount,
    decimal FboDirectFlowTransMaxAmount,
    decimal FboDelivToCustomerAmount,
    decimal FboReturnFlowAmount,
    decimal FbsFirstMileMinAmount,
    decimal FbsDirectFlowTransMinAmount,
    decimal FbsDirectFlowTransMaxAmount,
    decimal FbsDelivToCustomerAmount,
    decimal FbsReturnFlowAmount,
    decimal? AcquiringPercent,
    string CurrencyCode,
    DateTimeOffset FetchedAt);

public record CalculatorCategoryResponse(
    long CategoryId,
    string CategoryName,
    decimal SalesPercentFbo,
    decimal SalesPercentFbs,
    int SampleSize,
    bool IsManualOverride,
    DateTimeOffset UpdatedAt);

public record CalculatorCategoryRequest(
    string? CategoryName,
    decimal SalesPercentFbo,
    decimal SalesPercentFbs);

/// <summary>
/// Единый контракт для обоих режимов.
/// Задан ProductId — тарифы берутся из снапшота; иначе из полей запроса.
/// </summary>
public record CalculateRequest(
    long? ProductId,
    long? CategoryId,
    string? Scheme,
    decimal Price,
    decimal? SalesPercent,
    decimal? FulfillmentAmount,
    decimal? FirstMileAmount,
    decimal? LogisticsAmount,
    decimal? DelivToCustomerAmount,
    decimal? ReturnFlowAmount,
    decimal? AcquiringPercent,
    decimal? AdvertisingPercent,
    decimal? CostPrice,
    decimal? ExtraCostFixed,
    string? TaxMode,
    decimal? TaxPercent,
    decimal? BuyoutRatePercent,
    decimal? Depth,
    decimal? Width,
    decimal? Height);

public record ReverseCalculateRequest(
    CalculateRequest Input,
    decimal TargetMarginPercent);
