namespace LShopOzonWebReact.Api.Marketplaces;

public record SatuSyncStatusResponse(
    string Status,
    DateTimeOffset? LastSyncStartedAt,
    DateTimeOffset? LastSyncCompletedAt,
    int TotalProducts,
    int SyncedProducts,
    string? ErrorMessage,
    bool IsFullSync,
    int LocalProductCount);
