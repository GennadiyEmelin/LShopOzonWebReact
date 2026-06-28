using LShopOzonWebReact.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Marketplaces;

public sealed class SatuCatalogWarmupHostedService(
    IServiceProvider services,
    ILogger<SatuCatalogWarmupHostedService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromSeconds(8), stoppingToken);

        try
        {
            using var scope = services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var credentials = scope.ServiceProvider.GetRequiredService<KzMarketplaceCredentials>();
            await credentials.LoadFromDatabaseAsync(db, stoppingToken);

            if (!credentials.Get(MarketplaceTypes.Satu).IsConfigured)
            {
                return;
            }

            logger.LogInformation("Прогрев кэша каталога Satu...");
            var marketplaceApi = scope.ServiceProvider.GetRequiredService<KzMarketplaceApiClient>();
            var summary = await marketplaceApi.GetCatalogSummaryAsync(MarketplaceTypes.Satu, stoppingToken);
            logger.LogInformation(
                "Кэш Satu готов: {Total} позиций ({Selling} в продаже).",
                summary.Total,
                summary.Selling);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "Не удалось прогреть кэш Satu при старте.");
        }
    }
}
