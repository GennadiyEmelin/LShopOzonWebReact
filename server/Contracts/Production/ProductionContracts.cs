namespace LShopOzonWebReact.Api.Contracts.Production;

record ProductionFileListItem(
    Guid Id,
    Guid? ProductionTaskItemId,
    long? OzonProductId,
    string OfferId,
    string ProductName,
    string ProductLink,
    string Notes,
    string FileName,
    string ContentType,
    DateTimeOffset CreatedAt);
record ProductionFilePathListItem(
    Guid Id,
    long? OzonProductId,
    string OfferId,
    string ProductName,
    string ProductLink,
    string Path,
    DateTimeOffset CreatedAt);
record UpdateProductionTaskItemFilePathRequest(string Path);
record UpsertCatalogFilePathRequest(
    string? OfferId,
    long? OzonProductId,
    string ProductName,
    string? ProductLink,
    string Path);
record DeleteProductionFileResponse(bool ReworkTaskCreated, Guid? TaskId);
record CreateProductionTaskRequest(string? TaskType, long OzonProductId, string OfferId, string ProductName, int RequiredQuantity, bool IsUrgent, DateTimeOffset? DueAt, List<CreateProductionTaskItemRequest>? Items);
record CreateProductionTaskItemRequest(long OzonProductId, string OfferId, string ProductName, int RequiredQuantity, bool EnforceMinimumQuantity, string? ProductLink, Guid? SourceTaskItemId = null);
record UpdateProductionTaskRequest(string? TaskType, bool IsUrgent, DateTimeOffset? DueAt, List<CreateProductionTaskItemRequest>? Items);
record UpdateProductionTaskItemRequest(int RequiredQuantity);
record UpdateProductionTaskItemActualQuantityRequest(int ActualQuantity);
record TransferDesignerTaskItemRequest(Guid TargetUserId);
record CancelProductionTaskRequest(string Comment);
public record ProductionAnalyticsSummaryRow(
    Guid? UserId,
    string UserName,
    string Role,
    string AvatarUrl,
    int TaskCount,
    int ItemCount);
record ProductionAnalyticsAssigneeItem(
    Guid Id,
    string DisplayName,
    string UserName,
    string Role,
    string AvatarUrl);
record ProductionAnalyticsReportResponse(
    List<ProductionAnalyticsSummaryRow> Summary,
    List<ProductionTaskListItem> Tasks);
public record UpdateProductionAnalyticsRecordRequest(
    DateTimeOffset? CompletedAt,
    string? AssignedUserName,
    Guid? AssignedUserId,
    long? OzonProductId,
    string? OfferId,
    string? ProductName,
    int? RequiredQuantity,
    int? ActualQuantity,
    string? TaskType,
    bool? IsUrgent,
    string? CreatedByDisplayName,
    DateTimeOffset? CreatedAt,
    DateTimeOffset? StartedAt,
    List<ProductionTaskItemListItem>? Items);
record CompleteProductionTaskRequest(int ActualQuantity, List<CompleteProductionTaskItemRequest>? Items);
record CompleteProductionTaskItemRequest(Guid Id, int ActualQuantity);
record ProductionCatalogItem(
    string OfferId,
    long? OzonProductId,
    string ProductName,
    string ProductLink,
    int FileCount,
    DateTimeOffset? CompletedAt);
record ConvertNovinkaToOzonRequest(
    string SourceOfferId,
    string SourceProductName,
    string SourceProductLink,
    long TargetOzonProductId);
record ConvertNovinkaToOzonResponse(
    int UpdatedFileCount,
    long OzonProductId,
    string OfferId,
    string ProductName,
    string ProductUrl);
public record ProductionTaskListItem(
    Guid Id,
    long OzonProductId,
    string OfferId,
    string ProductName,
    int RequiredQuantity,
    int? ActualQuantity,
    string Status,
    string TaskType,
    bool IsUrgent,
    string? AssignedUserName,
    Guid? CreatedByUserId,
    string? CreatedByDisplayName,
    DateTimeOffset CreatedAt,
    DateTimeOffset? DueAt,
    DateTimeOffset? OverdueNotifiedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CancelledAt,
    Guid? CancelledByUserId,
    string? CancelledByDisplayName,
    string? CancellationComment,
    DateTimeOffset? CompletedAt,
    bool IsArchived,
    DateTimeOffset? ArchivedAt,
    List<ProductionTaskItemListItem> Items);
public record ProductionTaskItemListItem(
    Guid Id,
    long OzonProductId,
    string OfferId,
    string ProductName,
    string ProductLink,
    int RequiredQuantity,
    int? ActualQuantity,
    bool EnforceMinimumQuantity,
    string FilePath,
    DateTimeOffset? PackedAt,
    Guid? PackedByUserId,
    string? PackedByDisplayName,
    Guid? PackedSupplyId,
    ProductionTaskItemProductionSummary? ProductionSummary = null);

public record ProductionTaskItemProductionSummary(
    int CreatedQuantity,
    int InProgressQuantity,
    int CompletedQuantity);

