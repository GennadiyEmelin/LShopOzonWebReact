namespace LShopOzonWebReact.Api.Models;

public static class OzonCommissionSyncStatuses
{
    public const string NotStarted = "NotStarted";
    public const string InProgress = "InProgress";
    public const string Completed = "Completed";
    public const string Failed = "Failed";
}

/// <summary>
/// Состояние синхронизации тарифов. По образцу SatuSyncState.
/// Одна строка, Key фиксирован — сделано так же, чтобы не плодить разные подходы.
/// </summary>
public class OzonCommissionSyncState
{
    public const string DefaultKey = "ozon";

    public string Key { get; set; } = DefaultKey;

    public string Status { get; set; } = OzonCommissionSyncStatuses.NotStarted;

    public DateTimeOffset? LastSyncStartedAt { get; set; }

    public DateTimeOffset? LastSyncCompletedAt { get; set; }

    public int TotalProducts { get; set; }

    public int SyncedProducts { get; set; }

    public string? ErrorMessage { get; set; }
}
