namespace LShopOzonWebReact.Api.Contracts.Supplies;

record CreateSupplyRequest(List<CreateSupplyItemRequest> Items);
record CreateSupplyItemRequest(long? OzonProductId, string OfferId, string ProductName, int Quantity, bool IsReserve);
record UpdateSupplyRequest(List<CreateSupplyItemRequest> Items);
record ChangeSupplyStatusRequest(string Status);
record UpdateSupplyDatesRequest(DateTimeOffset? SentAt, DateTimeOffset? AcceptedAt);
record ReplaceReserveSupplyItemRequest(long OzonProductId, string OfferId, string ProductName);
record SupplyListItem(
    Guid Id,
    string Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset? SentAt,
    DateTimeOffset? AcceptedAt,
    bool IsArchived,
    DateTimeOffset? ArchivedAt,
    List<SupplyItemListItem> Items,
    List<SupplyHistoryItem> History);
record SupplyItemListItem(
    Guid Id,
    long? OzonProductId,
    string OfferId,
    string ProductName,
    int Quantity,
    bool IsReserve);
record SupplyHistoryItem(
    Guid Id,
    string UserName,
    string DisplayName,
    string Action,
    string Details,
    DateTimeOffset CreatedAt);
record SupplyAnalyticsItem(
    Guid Id,
    Guid SupplyId,
    long? OzonProductId,
    string OfferId,
    string ProductName,
    int Quantity,
    bool IsReserve,
    string Status,
    bool IsArchived,
    DateTimeOffset? ArchivedAt,
    DateTimeOffset CreatedAt,
    DateTimeOffset? SentAt,
    DateTimeOffset? AcceptedAt);
