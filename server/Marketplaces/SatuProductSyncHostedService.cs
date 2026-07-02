using LShopOzonWebReact.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Marketplaces;

public sealed class SatuProductSyncHostedService(
    IServiceProvider services,
    SatuProductSyncCoordinator coordinator,
    ILogger<SatuProductSyncHostedService> logger) : BackgroundService
{
    private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan IncrementalInterval = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan FullSyncInterval = TimeSpan.FromHours(24);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(StartupDelay, stoppingToken);

        var incrementalTimer = new PeriodicTimer(IncrementalInterval);
        var fullSyncTimer = new PeriodicTimer(FullSyncInterval);
        var queueReader = coordinator.Reader;

        await TryScheduleInitialSyncAsync(stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            var queueTask = queueReader.WaitToReadAsync(stoppingToken).AsTask();
            var incrementalTask = incrementalTimer.WaitForNextTickAsync(stoppingToken).AsTask();
            var fullSyncTask = fullSyncTimer.WaitForNextTickAsync(stoppingToken).AsTask();

            var completed = await Task.WhenAny(queueTask, incrementalTask, fullSyncTask);
            if (completed == queueTask)
            {
                while (queueReader.TryRead(out var request))
                {
                    await RunSyncAsync(request.ShopId, request.FullSync, stoppingToken);
                }
            }
            else if (completed == incrementalTask)
            {
                await RunScheduledSyncAsync(fullSync: false, stoppingToken);
            }
            else if (completed == fullSyncTask)
            {
                await RunScheduledSyncAsync(fullSync: true, stoppingToken);
            }
        }
    }

    private async Task TryScheduleInitialSyncAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var credentials = scope.ServiceProvider.GetRequiredService<KzMarketplaceCredentials>();
            var repository = scope.ServiceProvider.GetRequiredService<SatuProductRepository>();

            await credentials.LoadFromDatabaseAsync(db, cancellationToken);
            var credentialSet = credentials.Get(MarketplaceTypes.Satu);
            if (!credentialSet.IsConfigured)
            {
                return;
            }

            var hasProducts = await repository.HasProductsAsync(credentialSet.MerchantId, cancellationToken);
            coordinator.RequestSync(credentialSet.MerchantId, fullSync: !hasProducts);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "Не удалось запланировать начальную синхронизацию Satu.");
        }
    }

    private async Task RunScheduledSyncAsync(bool fullSync, CancellationToken cancellationToken)
    {
        try
        {
            using var scope = services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var credentials = scope.ServiceProvider.GetRequiredService<KzMarketplaceCredentials>();
            await credentials.LoadFromDatabaseAsync(db, cancellationToken);

            var credentialSet = credentials.Get(MarketplaceTypes.Satu);
            if (!credentialSet.IsConfigured)
            {
                return;
            }

            await RunSyncAsync(credentialSet.MerchantId, fullSync, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "Плановая синхронизация Satu завершилась с ошибкой.");
        }
    }

    private async Task RunSyncAsync(string shopId, bool fullSync, CancellationToken cancellationToken)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var credentials = scope.ServiceProvider.GetRequiredService<KzMarketplaceCredentials>();
        var syncService = scope.ServiceProvider.GetRequiredService<SatuProductSyncService>();

        await credentials.LoadFromDatabaseAsync(db, cancellationToken);
        var credentialSet = credentials.Get(MarketplaceTypes.Satu);
        if (!credentialSet.IsConfigured || !string.Equals(credentialSet.MerchantId, shopId, StringComparison.Ordinal))
        {
            return;
        }

        try
        {
            await syncService.SyncAsync(shopId, credentialSet.ApiKey, fullSync, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "Синхронизация Satu для {ShopId} завершилась с ошибкой.", shopId);
        }
    }
}
