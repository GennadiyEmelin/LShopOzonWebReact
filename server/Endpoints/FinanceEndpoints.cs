using System.Globalization;
using System.Security.Claims;
using LShopOzonWebReact.Api.Calculator;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Ozon;
using LShopOzonWebReact.Api.Security;

namespace LShopOzonWebReact.Api.Endpoints;

public static class FinanceEndpoints
{
    public static void MapFinanceEndpoints(this WebApplication app)
    {
        app.MapGet("/api/ozon/finance/payouts", async (
            string? dateFrom,
            string? dateTo,
            OzonApiClient ozonApi,
            OzonCommissionRepository repository,
            AppDbContext db,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.AnalyticsFinances, FeatureAccess.Analytics))
            {
                return Results.Forbid();
            }

            var today = DateOnly.FromDateTime(DateTime.UtcNow);

            if (!TryParseDate(dateTo, out var to))
            {
                to = today;
            }

            if (!TryParseDate(dateFrom, out var from))
            {
                from = to.AddMonths(-3);
            }

            if (from > to)
            {
                return Results.BadRequest("Дата начала больше даты окончания.");
            }

            try
            {
                // График выплат берём из настроек: у РФ и KZ он разный,
                // а Ozon плановую дату по API не отдаёт.
                var settings = await repository.GetSettingsAsync(cancellationToken);
                var payoutDay = (DayOfWeek)Math.Clamp(settings.PayoutDayOfWeek, 0, 6);

                var report = await ozonApi.GetPayoutReportAsync(
                    from,
                    to,
                    settings.PayoutDelayWeeks,
                    payoutDay,
                    cancellationToken);
                return Results.Ok(report);
            }
            catch (InvalidOperationException exception)
            {
                return Results.BadRequest(exception.Message);
            }
            catch (HttpRequestException exception)
            {
                return Results.Problem(
                    detail: exception.Message,
                    title: "Ozon API недоступен",
                    statusCode: StatusCodes.Status502BadGateway);
            }
        }).RequireAuthorization();
    }

    private static bool TryParseDate(string? value, out DateOnly date)
        => DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date);
}
