using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Ozon;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Calculator;

/// <summary>
/// Фоновое обновление тарифов Ozon.
///
/// Тарифы меняются редко, поэтому полная синхронизация раз в сутки —
/// достаточно. Дёргать API чаще нет смысла и рискованно по лимитам.
/// </summary>
public sealed class OzonCommissionSyncHostedService(
    IServiceProvider services,
    OzonCommissionSyncCoordinator coordinator,
    ILogger<OzonCommissionSyncHostedService> logger) : BackgroundService
{
    private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan FullSyncInterval = TimeSpan.FromHours(24);

    /// <summary>Если данные старше этого срока — синхронизируем на старте.</summary>
    private static readonly TimeSpan StaleThreshold = TimeSpan.FromHours(20);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(StartupDelay, stoppingToken);

        await TryScheduleInitialSyncAsync(stoppingToken);

        using var fullSyncTimer = new PeriodicTimer(FullSyncInterval);
        var queueReader = coordinator.Reader;

        while (!stoppingToken.IsCancellationRequested)
        {
            var queueTask = queueReader.WaitToReadAsync(stoppingToken).AsTask();
            var timerTask = fullSyncTimer.WaitForNextTickAsync(stoppingToken).AsTask();

            var completed = await Task.WhenAny(queueTask, timerTask);

            if (completed == queueTask)
            {
                // Схлопываем накопившиеся запросы в один прогон.
                while (queueReader.TryRead(out _))
                {
                }

                await RunSyncAsync(stoppingToken);
            }
            else
            {
                await RunSyncAsync(stoppingToken);
            }
        }
    }

    /// <summary>
    /// На старте синхронизируем только если данных нет или они устарели —
    /// иначе каждый деплой дёргал бы Ozon без нужды.
    /// </summary>
    private async Task TryScheduleInitialSyncAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var credentials = scope.ServiceProvider.GetRequiredService<OzonRuntimeCredentials>();

            if (string.IsNullOrWhiteSpace(credentials.ClientId) || string.IsNullOrWhiteSpace(credentials.ApiKey))
            {
                logger.LogInformation("Тарифы Ozon: ключи не настроены, синхронизация пропущена");
                return;
            }

            var state = await db.OzonCommissionSyncStates
                .AsNoTracking()
                .FirstOrDefaultAsync(entry => entry.Key == OzonCommissionSyncState.DefaultKey, cancellationToken);

            var isStale = state?.LastSyncCompletedAt is null
                || DateTimeOffset.UtcNow - state.LastSyncCompletedAt.Value > StaleThreshold;

            if (isStale)
            {
                coordinator.RequestSync();
            }
        }
        catch (Exception exception)
        {
            // Таблиц может ещё не быть, если миграция не применилась — не роняем приложение.
            logger.LogWarning(exception, "Тарифы Ozon: не удалось проверить состояние синхронизации на старте");
        }
    }

    private async Task RunSyncAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = services.CreateScope();
            var credentials = scope.ServiceProvider.GetRequiredService<OzonRuntimeCredentials>();

            if (string.IsNullOrWhiteSpace(credentials.ClientId) || string.IsNullOrWhiteSpace(credentials.ApiKey))
            {
                logger.LogInformation("Тарифы Ozon: ключи не настроены, прогон пропущен");
                return;
            }

            var syncService = scope.ServiceProvider.GetRequiredService<OzonCommissionSyncService>();
            await syncService.RunAsync(cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Штатная остановка приложения.
        }
        catch (Exception exception)
        {
            // Ошибка уже записана в состояние синхронизации — служба продолжает работать.
            logger.LogError(exception, "Тарифы Ozon: прогон синхронизации не удался");
        }
    }
}
