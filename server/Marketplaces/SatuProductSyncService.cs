using System.Text.Json;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Marketplaces;

public sealed class SatuProductSyncService(
    AppDbContext db,
    IHttpClientFactory httpClientFactory,
    ILogger<SatuProductSyncService> logger)
{
    private const int MaxRetries = 4;
    private static readonly TimeSpan RetryBaseDelay = TimeSpan.FromSeconds(2);

    public async Task SyncAsync(
        string shopId,
        string apiKey,
        bool fullSync,
        CancellationToken cancellationToken)
    {
        var normalizedShopId = shopId.Trim();
        var syncStartedAt = DateTimeOffset.UtcNow;
        var state = await EnsureSyncStateAsync(normalizedShopId, fullSync, syncStartedAt, cancellationToken);

        try
        {
            long? lastId = null;
            var seenProductIds = new HashSet<long>();
            var reachedEnd = false;

            while (!reachedEnd && !cancellationToken.IsCancellationRequested)
            {
                var page = await FetchPageWithRetryAsync(apiKey, lastId, cancellationToken);
                if (page.Count == 0)
                {
                    break;
                }

                await UpsertBatchAsync(
                    normalizedShopId,
                    page,
                    syncStartedAt,
                    seenProductIds,
                    cancellationToken);

                if (!SatuApiClient.TryReadLastProductId(page, out var nextLastId) || nextLastId == lastId)
                {
                    break;
                }

                if (page.Count < SatuApiClient.PageSize)
                {
                    reachedEnd = true;
                }
                else
                {
                    lastId = nextLastId;
                }

                state.SyncedProducts = seenProductIds.Count;
                state.TotalProducts = reachedEnd
                    ? seenProductIds.Count
                    : seenProductIds.Count + SatuApiClient.PageSize;
                state.LastSyncStartedAt = syncStartedAt;
                await db.SaveChangesAsync(cancellationToken);
                db.ChangeTracker.Clear();
                state = await db.SatuSyncStates
                    .FirstAsync(entry => entry.ShopId == normalizedShopId, cancellationToken);

                // Satu/Prom API allows about one request per second.
                await Task.Delay(TimeSpan.FromSeconds(1.1), cancellationToken);
            }

            var syncedCount = seenProductIds.Count;

            if (fullSync)
            {
                await db.SatuProducts
                    .Where(product =>
                        product.ShopId == normalizedShopId &&
                        product.IsActive &&
                        product.LastSyncedAt < syncStartedAt)
                    .ExecuteUpdateAsync(
                        setters => setters.SetProperty(product => product.IsActive, false),
                        cancellationToken);
            }

            state.Status = SatuSyncStatuses.Completed;
            state.SyncedProducts = syncedCount;
            state.TotalProducts = syncedCount;
            state.LastSyncCompletedAt = DateTimeOffset.UtcNow;
            state.ErrorMessage = null;
            await db.SaveChangesAsync(cancellationToken);

            logger.LogInformation(
                "Satu sync completed for shop {ShopId}: {Count} products ({Mode}).",
                normalizedShopId,
                syncedCount,
                fullSync ? "full" : "incremental");
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            state.Status = SatuSyncStatuses.Failed;
            state.ErrorMessage = exception.Message.Length <= 2000
                ? exception.Message
                : exception.Message[..2000];
            state.LastSyncCompletedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            logger.LogError(exception, "Satu sync failed for shop {ShopId}.", normalizedShopId);
            throw;
        }
    }

    private async Task<SatuSyncState> EnsureSyncStateAsync(
        string shopId,
        bool fullSync,
        DateTimeOffset syncStartedAt,
        CancellationToken cancellationToken)
    {
        var state = await db.SatuSyncStates.FirstOrDefaultAsync(entry => entry.ShopId == shopId, cancellationToken);
        if (state is null)
        {
            state = new SatuSyncState { ShopId = shopId };
            db.SatuSyncStates.Add(state);
        }

        state.Status = SatuSyncStatuses.InProgress;
        state.IsFullSync = fullSync;
        state.LastSyncStartedAt = syncStartedAt;
        state.LastSyncCompletedAt = null;
        state.ErrorMessage = null;
        state.SyncedProducts = 0;
        state.TotalProducts = 0;
        await db.SaveChangesAsync(cancellationToken);
        return state;
    }

    private async Task<List<JsonElement>> FetchPageWithRetryAsync(
        string apiKey,
        long? lastId,
        CancellationToken cancellationToken)
    {
        var attempt = 0;
        while (true)
        {
            try
            {
                return await SatuApiClient.GetProductsPageAfterIdAsync(
                    httpClientFactory.CreateClient(nameof(SatuProductSyncService)),
                    apiKey,
                    lastId,
                    cancellationToken);
            }
            catch (HttpRequestException exception) when (attempt < MaxRetries && IsTransient(exception))
            {
                attempt++;
                var delay = TimeSpan.FromMilliseconds(RetryBaseDelay.TotalMilliseconds * Math.Pow(2, attempt - 1));
                logger.LogWarning(
                    exception,
                    "Satu API transient error, retry {Attempt}/{MaxRetries} in {DelayMs}ms.",
                    attempt,
                    MaxRetries,
                    delay.TotalMilliseconds);
                await Task.Delay(delay, cancellationToken);
            }
        }
    }

    private static bool IsTransient(HttpRequestException exception)
    {
        if (exception.StatusCode is null)
        {
            return true;
        }

        var code = (int)exception.StatusCode.Value;
        return code is 408 or 429 or >= 500;
    }

    private async Task<int> UpsertBatchAsync(
        string shopId,
        IReadOnlyList<JsonElement> items,
        DateTimeOffset syncedAt,
        HashSet<long> seenProductIds,
        CancellationToken cancellationToken)
    {
        if (items.Count == 0)
        {
            return 0;
        }

        var productIds = items
            .Select(item => SatuApiClient.ReadLong(item, "id") ?? 0)
            .Where(id => id > 0)
            .Distinct()
            .ToList();

        var existing = await db.SatuProducts
            .Where(product => product.ShopId == shopId && productIds.Contains(product.SatuProductId))
            .ToDictionaryAsync(product => product.SatuProductId, cancellationToken);

        var newUniqueCount = 0;
        foreach (var item in items)
        {
            var productId = SatuApiClient.ReadLong(item, "id") ?? 0;
            if (productId <= 0)
            {
                continue;
            }

            if (seenProductIds.Add(productId))
            {
                newUniqueCount++;
            }

            if (existing.TryGetValue(productId, out var current))
            {
                SatuProductMapper.ApplyJson(current, item, syncedAt);
                continue;
            }

            var created = SatuProductMapper.MapFromJson(item, shopId, syncedAt);
            created.SatuProductId = productId;
            db.SatuProducts.Add(created);
            existing[productId] = created;
        }

        await db.SaveChangesAsync(cancellationToken);
        return newUniqueCount;
    }
}
