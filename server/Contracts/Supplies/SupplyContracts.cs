namespace LShopOzonWebReact.Api.Contracts.Supplies;

record CreateSupplyRequest(List<CreateSupplyItemRequest> Items);
record CreateSupplyItemRequest(long? OzonProductId, string OfferId, string ProductName, int Quantity, bool IsReserve, string? ItemKind);
record UpdateSupplyRequest(List<CreateSupplyItemRequest> Items, decimal? ShippingCost);
record ChangeSupplyStatusRequest(string Status, decimal? ShippingCost);
record UpdateSupplyDatesRequest(DateTimeOffset? SentAt, DateTimeOffset? AcceptedAt, decimal? ShippingCost);
record ReplaceReserveSupplyItemRequest(long OzonProductId, string OfferId, string ProductName);
record SupplyFboDefectRequest(string ProductKey, string OfferId, string ProductName, int Quantity);
record SupplyFboDefectItem(Guid Id, string ProductKey, string OfferId, string ProductName, int Quantity, DateTimeOffset CreatedAt);
record CreateSupplyExpenseRequest(string Name, decimal Amount, DateTimeOffset PurchasedAt);
record UpdateSupplyExpenseRequest(decimal Amount, DateTimeOffset PurchasedAt);
record SupplyExpenseItem(
    Guid Id,
    string Name,
    decimal Amount,
    DateTimeOffset PurchasedAt,
    DateTimeOffset CreatedAt,
    Guid CreatedByUserId,
    string CreatedByDisplayName);
record SupplyExpensesResponse(List<SupplyExpenseItem> Items, decimal TotalAmount);
record SupplyListItem(
    Guid Id,
    string Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset? SentAt,
    DateTimeOffset? AcceptedAt,
    decimal? ShippingCost,
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
    bool IsReserve,
    string ItemKind);
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
    string ItemKind,
    string Status,
    bool IsArchived,
    DateTimeOffset? ArchivedAt,
    DateTimeOffset CreatedAt,
    DateTimeOffset? SentAt,
    DateTimeOffset? AcceptedAt,
    decimal? ShippingCost);
