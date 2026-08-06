using LShopOzonWebReact.Api.Data;

namespace LShopOzonWebReact.Api.Marketplaces;

public sealed class KaspiProductSyncHostedService(
    IServiceProvider services,
    KaspiProductSyncCoordinator coordinator,
    ILogger<KaspiProductSyncHostedService> logger) : BackgroundService
{
    private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan SyncInterval = TimeSpan.FromMinutes(20);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(StartupDelay, stoppingToken);
        await TryScheduleConfiguredKaspiAsync(stoppingToken);

        var queueTask = ConsumeQueueAsync(stoppingToken);
        var timerTask = RunTimerAsync(stoppingToken);

        await Task.WhenAll(queueTask, timerTask);
    }

    private async Task ConsumeQueueAsync(CancellationToken cancellationToken)
    {
        await foreach (var merchantId in coordinator.Reader.ReadAllAsync(cancellationToken))
        {
            await RunSyncAsync(merchantId, cancellationToken);
        }
    }

    private async Task RunTimerAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(SyncInterval);

        while (await timer.WaitForNextTickAsync(cancellationToken))
        {
            await TryScheduleConfiguredKaspiAsync(cancellationToken);
        }
    }

    private async Task TryScheduleConfiguredKaspiAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var credentials = scope.ServiceProvider.GetRequiredService<KzMarketplaceCredentials>();
            await credentials.LoadFromDatabaseAsync(db, cancellationToken);

            var credentialSet = credentials.Get(MarketplaceTypes.Kaspi);
            if (credentialSet.IsConfigured)
            {
                coordinator.RequestSync(credentialSet.MerchantId);
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "Не удалось поставить синхронизацию Kaspi в очередь.");
        }
    }

    private async Task RunSyncAsync(string merchantId, CancellationToken cancellationToken)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var credentials = scope.ServiceProvider.GetRequiredService<KzMarketplaceCredentials>();
        var marketplaceApi = scope.ServiceProvider.GetRequiredService<KzMarketplaceApiClient>();

        await credentials.LoadFromDatabaseAsync(db, cancellationToken);
        var credentialSet = credentials.Get(MarketplaceTypes.Kaspi);
        if (!credentialSet.IsConfigured || !string.Equals(credentialSet.MerchantId, merchantId, StringComparison.Ordinal))
        {
            return;
        }

        coordinator.MarkRunning(merchantId);
        try
        {
            var summary = await marketplaceApi.RefreshKaspiProductCatalogAsync(cancellationToken);
            coordinator.MarkSucceeded(merchantId, summary.Total);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "Синхронизация каталога Kaspi завершилась с ошибкой.");
            coordinator.MarkFailed(merchantId, exception.Message);
        }
    }
}
