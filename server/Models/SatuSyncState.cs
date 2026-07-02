namespace LShopOzonWebReact.Api.Models;

public static class SatuSyncStatuses
{
    public const string NotStarted = "NotStarted";
    public const string InProgress = "InProgress";
    public const string Completed = "Completed";
    public const string Failed = "Failed";
}

public class SatuSyncState
{
    public string ShopId { get; set; } = string.Empty;

    public string Status { get; set; } = SatuSyncStatuses.NotStarted;

    public DateTimeOffset? LastSyncStartedAt { get; set; }

    public DateTimeOffset? LastSyncCompletedAt { get; set; }

    public int TotalProducts { get; set; }

    public int SyncedProducts { get; set; }

    public string? ErrorMessage { get; set; }

    public bool IsFullSync { get; set; }
}
