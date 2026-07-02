using System.Threading.Channels;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Marketplaces;

public interface ISatuProductSyncCoordinator
{
    void RequestSync(string shopId, bool fullSync);

    Task<SatuSyncStatusResponse> GetStatusAsync(string shopId, CancellationToken cancellationToken);
}

public sealed class SatuProductSyncCoordinator(IServiceScopeFactory scopeFactory) : ISatuProductSyncCoordinator
{
    private readonly Channel<(string ShopId, bool FullSync)> _queue =
        Channel.CreateUnbounded<(string ShopId, bool FullSync)>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false
        });

    internal ChannelReader<(string ShopId, bool FullSync)> Reader => _queue.Reader;

    public void RequestSync(string shopId, bool fullSync)
    {
        if (string.IsNullOrWhiteSpace(shopId))
        {
            return;
        }

        _queue.Writer.TryWrite((shopId.Trim(), fullSync));
    }

    public async Task<SatuSyncStatusResponse> GetStatusAsync(string shopId, CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var repository = scope.ServiceProvider.GetRequiredService<SatuProductRepository>();
        var normalizedShopId = shopId.Trim();

        var state = await db.SatuSyncStates
            .AsNoTracking()
            .FirstOrDefaultAsync(entry => entry.ShopId == normalizedShopId, cancellationToken);

        var localCount = await repository.GetActiveProductCountAsync(normalizedShopId, cancellationToken);

        if (state is null)
        {
            return new SatuSyncStatusResponse(
                SatuSyncStatuses.NotStarted,
                null,
                null,
                0,
                0,
                null,
                false,
                localCount);
        }

        return new SatuSyncStatusResponse(
            state.Status,
            state.LastSyncStartedAt,
            state.LastSyncCompletedAt,
            state.TotalProducts,
            state.SyncedProducts,
            state.ErrorMessage,
            state.IsFullSync,
            localCount);
    }
}
