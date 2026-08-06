using System.Threading.Channels;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LShopOzonWebReact.Api.Calculator;

public record OzonCommissionSyncStatusResponse(
    string Status,
    DateTimeOffset? LastSyncStartedAt,
    DateTimeOffset? LastSyncCompletedAt,
    int TotalProducts,
    int SyncedProducts,
    string? ErrorMessage,
    int LocalSnapshotCount);

public interface IOzonCommissionSyncCoordinator
{
    void RequestSync();

    Task<OzonCommissionSyncStatusResponse> GetStatusAsync(CancellationToken cancellationToken);
}

/// <summary>
/// Очередь запросов на синхронизацию тарифов.
/// По образцу SatuProductSyncCoordinator, чтобы в проекте был один подход.
/// </summary>
public sealed class OzonCommissionSyncCoordinator(IServiceScopeFactory scopeFactory) : IOzonCommissionSyncCoordinator
{
    private readonly Channel<bool> _queue = Channel.CreateUnbounded<bool>(new UnboundedChannelOptions
    {
        SingleReader = true,
        SingleWriter = false,
    });

    internal ChannelReader<bool> Reader => _queue.Reader;

    public void RequestSync() => _queue.Writer.TryWrite(true);

    public async Task<OzonCommissionSyncStatusResponse> GetStatusAsync(CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        try
        {
            var state = await db.OzonCommissionSyncStates
                .AsNoTracking()
                .FirstOrDefaultAsync(entry => entry.Key == OzonCommissionSyncState.DefaultKey, cancellationToken);

            var localCount = await db.OzonCommissionSnapshots.CountAsync(cancellationToken);

            if (state is null)
            {
                return new OzonCommissionSyncStatusResponse(
                    OzonCommissionSyncStatuses.NotStarted,
                    null,
                    null,
                    0,
                    0,
                    null,
                    localCount);
            }

            return new OzonCommissionSyncStatusResponse(
                state.Status,
                state.LastSyncStartedAt,
                state.LastSyncCompletedAt,
                state.TotalProducts,
                state.SyncedProducts,
                state.ErrorMessage,
                localCount);
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UndefinedTable)
        {
            // Та же ситуация, что ловилась в SATU: миграция ещё не применена.
            return new OzonCommissionSyncStatusResponse(
                OzonCommissionSyncStatuses.Failed,
                null,
                null,
                0,
                0,
                "Таблицы калькулятора ещё не созданы. Перезапустите приложение, чтобы применилась миграция.",
                0);
        }
    }
}
