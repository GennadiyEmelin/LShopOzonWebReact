namespace LShopOzonWebReact.Api.Models;

public class AppUser
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserName { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Position { get; set; } = string.Empty;
    public string AvatarFileName { get; set; } = string.Empty;
    public string AllowedFeatures { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string Role { get; set; } = UserRoles.User;
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? LastSeenAt { get; set; }
    public string TelegramChatId { get; set; } = string.Empty;
    public string TelegramConnectToken { get; set; } = string.Empty;
    public string TelegramNotifyEvents { get; set; } = string.Empty;
    public DateTimeOffset? TelegramConnectedAt { get; set; }
}

public static class UserRoles
{
    public const string Admin = "Admin";
    public const string User = "User";
}
