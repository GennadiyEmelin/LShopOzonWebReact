using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Security;

public static class UserResponses
{
    public static async Task<CurrentUserResponse> BuildCurrentUserAsync(AppDbContext db, AppUser user)
    {
        RoleProfile? profile = null;
        if (user.Role != UserRoles.Admin)
        {
            profile = await db.RoleProfiles.AsNoTracking().FirstOrDefaultAsync(item => item.Role == user.Role);
        }

        return Current(user, profile);
    }

    public static CurrentUserResponse Current(AppUser user, RoleProfile? profile = null) =>
        new(
            user.Id,
            user.UserName,
            user.DisplayName,
            user.Position,
            user.Role,
            AvatarUrl(user),
            Features(user),
            ResolveHomeBlocks(user, profile),
            CanChangeOtherUserPasswords(user, profile));

    public static List<string> Features(AppUser user) =>
        user.Role == UserRoles.Admin ? FeatureAccess.All.ToList() : FeatureAccess.Parse(user.AllowedFeatures);

    public static string AvatarUrl(AppUser user) => AvatarUrl(user.AvatarFileName);

    public static string AvatarUrl(string avatarFileName) =>
        string.IsNullOrWhiteSpace(avatarFileName) ? string.Empty : $"/api/avatars/{Uri.EscapeDataString(avatarFileName)}";

    public static UserListItem ToListItem(AppUser user, bool isOnline, RoleProfile? profile = null) =>
        new(
            user.Id,
            user.UserName,
            user.DisplayName,
            user.Position,
            user.Role,
            AvatarUrl(user),
            Features(user),
            ResolveHomeBlocks(user, profile),
            user.IsActive,
            user.CreatedAt,
            user.LastSeenAt,
            isOnline,
            !string.IsNullOrWhiteSpace(user.TelegramChatId),
            user.TelegramConnectedAt,
            FeatureAccess.AllowsTelegramConnect(user));

    private static bool CanChangeOtherUserPasswords(AppUser user, RoleProfile? profile) =>
        user.Role == UserRoles.Admin || (profile?.CanChangeOtherUserPasswords ?? false);

    private static List<HomeBlockConfig> ResolveHomeBlocks(AppUser user, RoleProfile? profile)
    {
        if (user.Role == UserRoles.Admin)
        {
            return HomeBlocksCatalog.AllEnabled();
        }

        var userBlocks = HomeBlocksCatalog.Parse(user.HomeBlocksJson);
        if (userBlocks.Count > 0)
        {
            return userBlocks;
        }

        return HomeBlocksCatalog.Parse(profile?.HomeBlocksJson);
    }

    public static RoleProfileResponse ToRoleProfileResponse(RoleProfile profile) =>
        new(
            profile.Role,
            profile.DisplayName,
            FeatureAccess.Parse(profile.AllowedFeatures),
            HomeBlocksCatalog.Parse(profile.HomeBlocksJson),
            profile.CanChangeOtherUserPasswords);
}

public record CurrentUserResponse(
    Guid Id,
    string UserName,
    string DisplayName,
    string Position,
    string Role,
    string AvatarUrl,
    List<string> AllowedFeatures,
    List<HomeBlockConfig> HomeBlocks,
    bool CanChangeOtherUserPasswords);

public record UserListItem(
    Guid Id,
    string UserName,
    string DisplayName,
    string Position,
    string Role,
    string AvatarUrl,
    List<string> AllowedFeatures,
    List<HomeBlockConfig> HomeBlocks,
    bool IsActive,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastSeenAt,
    bool IsOnline,
    bool TelegramConnected,
    DateTimeOffset? TelegramConnectedAt,
    bool TelegramConnectAllowed);

public record RoleProfileResponse(
    string Role,
    string DisplayName,
    List<string> AllowedFeatures,
    List<HomeBlockConfig> HomeBlocks,
    bool CanChangeOtherUserPasswords);

public record UpdateRoleProfileRequest(
    string DisplayName,
    List<string>? AllowedFeatures,
    List<HomeBlockConfig>? HomeBlocks,
    bool CanChangeOtherUserPasswords);

public record ChangeOwnPasswordRequest(string CurrentPassword, string NewPassword);

public record AdminUserTelegramResponse(
    bool Connected,
    string ChatIdMasked,
    DateTimeOffset? ConnectedAt,
    List<string> EnabledEvents,
    List<string> AvailableEvents,
    bool ConnectAllowed);

public record AdminUserReportResponse(
    bool Enabled,
    string ReportTime,
    string Timezone,
    List<string> EnabledSections,
    List<string> AvailableSections,
    DateOnly? LastSentOn,
    bool TelegramConnected);

public record UpdateAdminUserReportRequest(
    bool Enabled,
    string? ReportTime,
    string? Timezone,
    List<string>? Sections);
