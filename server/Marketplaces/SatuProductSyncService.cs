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
            var offset = 0;
            var syncedCount = 0;
            var totalEstimate = 0;
            var reachedEnd = false;

            while (!reachedEnd && !cancellationToken.IsCancellationRequested)
            {
                var batchOffsets = Enumerable.Range(0, SatuApiClient.ParallelPages)
                    .Select(index => offset + index * SatuApiClient.PageSize)
                    .ToArray();

                var pages = await FetchPagesWithRetryAsync(apiKey, batchOffsets, cancellationToken);
                var batchItems = new List<JsonElement>();
                var addedInBatch = false;

                foreach (var page in pages)
                {
                    if (page.Count == 0)
                    {
                        continue;
                    }

                    addedInBatch = true;
                    batchItems.AddRange(page);

                    if (page.Count < SatuApiClient.PageSize)
                    {
                        reachedEnd = true;
                    }
                }

                if (!addedInBatch)
                {
                    break;
                }

                syncedCount += await UpsertBatchAsync(normalizedShopId, batchItems, syncStartedAt, cancellationToken);
                totalEstimate = Math.Max(totalEstimate, syncedCount + (reachedEnd ? 0 : SatuApiClient.PageSize));

                state.SyncedProducts = syncedCount;
                state.TotalProducts = reachedEnd ? syncedCount : Math.Max(syncedCount + SatuApiClient.PageSize, totalEstimate);
                state.LastSyncStartedAt = syncStartedAt;
                await db.SaveChangesAsync(cancellationToken);

                if (!reachedEnd)
                {
                    offset += SatuApiClient.ParallelPages * SatuApiClient.PageSize;
                }
            }

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

    private async Task<List<List<JsonElement>>> FetchPagesWithRetryAsync(
        string apiKey,
        IReadOnlyList<int> offsets,
        CancellationToken cancellationToken)
    {
        var attempt = 0;
        while (true)
        {
            try
            {
                var pages = await Task.WhenAll(
                    offsets.Select(offset =>
                        SatuApiClient.GetProductsPageAsync(
                            httpClientFactory.CreateClient(nameof(SatuProductSyncService)),
                            apiKey,
                            offset,
                            cancellationToken)));
                return pages.ToList();
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

        foreach (var item in items)
        {
            var productId = SatuApiClient.ReadLong(item, "id") ?? 0;
            if (productId <= 0)
            {
                continue;
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
        return items.Count;
    }
}
