using System.Collections.Concurrent;
using System.Threading.Channels;

namespace LShopOzonWebReact.Api.Marketplaces;

public interface IKaspiProductSyncCoordinator
{
    void RequestSync(string merchantId);
    ChannelReader<string> Reader { get; }
    KaspiProductSyncStatus GetStatus(string merchantId);
    void MarkRunning(string merchantId);
    void MarkSucceeded(string merchantId, int productsCount);
    void MarkFailed(string merchantId, string message);
}

public sealed class KaspiProductSyncCoordinator : IKaspiProductSyncCoordinator
{
    private static readonly TimeSpan RetryAfterFailure = TimeSpan.FromMinutes(20);

    private readonly Channel<string> _queue = Channel.CreateUnbounded<string>();
    private readonly ConcurrentDictionary<string, KaspiProductSyncStatus> _statuses = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, byte> _queued = new(StringComparer.OrdinalIgnoreCase);

    public ChannelReader<string> Reader => _queue.Reader;

    public void RequestSync(string merchantId)
    {
        if (string.IsNullOrWhiteSpace(merchantId))
        {
            return;
        }

        if (_statuses.TryGetValue(merchantId, out var currentStatus))
        {
            if (currentStatus.Status == "Running")
            {
                return;
            }

            if (currentStatus.Status == "Failed" &&
                currentStatus.UpdatedAt is { } failedAt &&
                DateTimeOffset.UtcNow - failedAt < RetryAfterFailure)
            {
                return;
            }
        }

        if (!_queued.TryAdd(merchantId, 0))
        {
            return;
        }

        _statuses.AddOrUpdate(
            merchantId,
            _ => new KaspiProductSyncStatus("Queued", 0, "\u041a\u0430\u0442\u0430\u043b\u043e\u0433 Kaspi \u043f\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d \u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u044c.", DateTimeOffset.UtcNow),
            (_, current) => current with
            {
                Status = current.Status == "Running" ? "Running" : "Queued",
                Message = current.Status == "Running"
                    ? "\u041a\u0430\u0442\u0430\u043b\u043e\u0433 Kaspi \u0443\u0436\u0435 \u0441\u0438\u043d\u0445\u0440\u043e\u043d\u0438\u0437\u0438\u0440\u0443\u0435\u0442\u0441\u044f."
                    : "\u041a\u0430\u0442\u0430\u043b\u043e\u0433 Kaspi \u043f\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d \u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u044c.",
                UpdatedAt = DateTimeOffset.UtcNow
            });

        _queue.Writer.TryWrite(merchantId);
    }

    public KaspiProductSyncStatus GetStatus(string merchantId) =>
        _statuses.TryGetValue(merchantId, out var status)
            ? status
            : new KaspiProductSyncStatus("Idle", 0, string.Empty, null);

    public void MarkRunning(string merchantId)
    {
        _queued.TryRemove(merchantId, out _);
        _statuses[merchantId] = new KaspiProductSyncStatus(
            "Running",
            0,
            "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043c \u043f\u043e\u043b\u043d\u044b\u0439 \u043a\u0430\u0442\u0430\u043b\u043e\u0433 Kaspi...",
            DateTimeOffset.UtcNow);
    }

    public void MarkSucceeded(string merchantId, int productsCount)
    {
        _queued.TryRemove(merchantId, out _);
        _statuses[merchantId] = new KaspiProductSyncStatus(
            "Succeeded",
            productsCount,
            $"\u041a\u0430\u0442\u0430\u043b\u043e\u0433 Kaspi \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d: {productsCount} \u0442\u043e\u0432\u0430\u0440\u043e\u0432.",
            DateTimeOffset.UtcNow);
    }

    public void MarkFailed(string merchantId, string message)
    {
        _queued.TryRemove(merchantId, out _);
        _statuses[merchantId] = new KaspiProductSyncStatus(
            "Failed",
            0,
            message,
            DateTimeOffset.UtcNow);
    }
}

public record KaspiProductSyncStatus(
    string Status,
    int ProductsCount,
    string Message,
    DateTimeOffset? UpdatedAt);
