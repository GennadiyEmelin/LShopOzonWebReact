using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Ozon;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Calculator;

/// <summary>
/// Один прогон синхронизации тарифов: выгрузка из Ozon, запись в БД,
/// пересборка справочника категорий.
/// </summary>
public class OzonCommissionSyncService(
    AppDbContext db,
    OzonApiClient ozonApiClient,
    OzonCommissionRepository repository,
    ILogger<OzonCommissionSyncService> logger)
{
    public async Task<int> RunAsync(CancellationToken cancellationToken)
    {
        var state = await GetOrCreateStateAsync(cancellationToken);

        state.Status = OzonCommissionSyncStatuses.InProgress;
        state.LastSyncStartedAt = DateTimeOffset.UtcNow;
        state.ErrorMessage = null;
        state.SyncedProducts = 0;
        await db.SaveChangesAsync(cancellationToken);

        try
        {
            logger.LogInformation("Синхронизация тарифов Ozon: старт");

            var prices = await ozonApiClient.GetAllProductPricesAsync(cancellationToken);
            state.TotalProducts = prices.Count;
            await db.SaveChangesAsync(cancellationToken);

            if (prices.Count == 0)
            {
                state.Status = OzonCommissionSyncStatuses.Completed;
                state.LastSyncCompletedAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync(cancellationToken);
                logger.LogWarning("Синхронизация тарифов Ozon: API не вернул ни одного товара");
                return 0;
            }

            // Названия и категории — отдельным запросом, тарифы их не содержат.
            var catalog = new Dictionary<long, OzonProductCatalogInfo>();
            try
            {
                var info = await ozonApiClient.GetProductCatalogInfoAsync(
                    prices.Select(price => price.ProductId).ToArray(),
                    cancellationToken);

                foreach (var item in info)
                {
                    catalog[item.ProductId] = item;
                }
            }
            catch (Exception exception)
            {
                // Названия — не критично: тарифы важнее, запишем их без имён.
                logger.LogWarning(exception, "Не удалось получить названия и категории товаров");
            }

            var synced = 0;
            foreach (var chunk in prices.Chunk(500))
            {
                await repository.UpsertSnapshotsAsync(chunk, catalog, cancellationToken);
                synced += chunk.Length;

                state.SyncedProducts = synced;
                await db.SaveChangesAsync(cancellationToken);
            }

            // Названия категорий — отдельный вызов. Если недоступен,
            // справочник останется с номерами, но расчёт не пострадает.
            var categoryNames = await ozonApiClient.GetCategoryNamesAsync(cancellationToken);
            if (categoryNames.Count == 0)
            {
                logger.LogWarning("Названия категорий Ozon получить не удалось — останутся номера");
            }

            var categories = await repository.RebuildCategoryAggregateAsync(categoryNames, cancellationToken);

            state.Status = OzonCommissionSyncStatuses.Completed;
            state.LastSyncCompletedAt = DateTimeOffset.UtcNow;
            state.SyncedProducts = synced;
            await db.SaveChangesAsync(cancellationToken);

            logger.LogInformation(
                "Синхронизация тарифов Ozon завершена: товаров {Synced}, категорий {Categories}",
                synced,
                categories);

            return synced;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Синхронизация тарифов Ozon завершилась ошибкой");

            state.Status = OzonCommissionSyncStatuses.Failed;
            state.ErrorMessage = exception.Message.Length > 2000
                ? exception.Message[..2000]
                : exception.Message;
            await db.SaveChangesAsync(CancellationToken.None);
            throw;
        }
    }

    private async Task<OzonCommissionSyncState> GetOrCreateStateAsync(CancellationToken cancellationToken)
    {
        var state = await db.OzonCommissionSyncStates
            .FirstOrDefaultAsync(entry => entry.Key == OzonCommissionSyncState.DefaultKey, cancellationToken);

        if (state is not null)
        {
            return state;
        }

        state = new OzonCommissionSyncState { Key = OzonCommissionSyncState.DefaultKey };
        db.OzonCommissionSyncStates.Add(state);
        await db.SaveChangesAsync(cancellationToken);
        return state;
    }
}
