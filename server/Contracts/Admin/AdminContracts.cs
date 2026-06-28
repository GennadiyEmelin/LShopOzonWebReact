using LShopOzonWebReact.Api.Models;

namespace LShopOzonWebReact.Api.Contracts.Admin;

record CreateUserRequest(
    string UserName,
    string DisplayName,
    string Position,
    string Password,
    string Role,
    List<string>? AllowedFeatures,
    List<HomeBlockConfig>? HomeBlocks);

record UpdateUserSettingsRequest(
    string DisplayName,
    string Position,
    string Role,
    List<string>? AllowedFeatures,
    List<HomeBlockConfig>? HomeBlocks,
    bool? TelegramConnectAllowed);

record ChangeUserPasswordRequest(string Password);

record AuditLogListItem(
    Guid Id,
    string UserName,
    string DisplayName,
    string Action,
    string EntityType,
    string EntityId,
    string Details,
    DateTimeOffset CreatedAt);

record SystemHealthResponse(
    bool DatabaseOk,
    DateTimeOffset ServerTime,
    string Uptime,
    string MachineName,
    string DotnetVersion,
    string? AdminerUrl);

record BackupFileResponse(string FileName, long SizeBytes, DateTimeOffset CreatedAt);

record OzonIntegrationStatusResponse(
    bool Configured,
    bool Success,
    string Message,
    string BaseUrl,
    string ClientIdMasked,
    string ApiKeyMasked,
    DateTimeOffset CheckedAt);
