namespace LShopOzonWebReact.Api.Models;

public class AppUser
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserName { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Position { get; set; } = string.Empty;
    public string AvatarFileName { get; set; } = string.Empty;
    public string AllowedFeatures { get; set; } = string.Empty;
    public string HomeBlocksJson { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string Role { get; set; } = UserRoles.Production;
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? LastSeenAt { get; set; }
    public string TelegramChatId { get; set; } = string.Empty;
    public string TelegramConnectToken { get; set; } = string.Empty;
    public string TelegramNotifyEvents { get; set; } = string.Empty;
    public DateTimeOffset? TelegramConnectedAt { get; set; }
    public bool TelegramConnectAllowed { get; set; }
    public bool TelegramDailyReportEnabled { get; set; }
    public string TelegramDailyReportTime { get; set; } = "19:00";
    public string TelegramDailyReportTimezone { get; set; } = "Asia/Almaty";
    public string TelegramDailyReportSections { get; set; } = string.Empty;
    public DateOnly? TelegramDailyReportLastSentOn { get; set; }
}

public static class UserRoles
{
    public const string Admin = "Admin";
    public const string Production = "Production";
    public const string Designer = "Designer";
    public const string Leadership = "Leadership";

    public static readonly string[] Configurable =
    [
        Production,
        Designer,
        Leadership
    ];

    public static string Normalize(string? role) =>
        role switch
        {
            Admin => Admin,
            Production => Production,
            Designer => Designer,
            Leadership => Leadership,
            "User" => Production,
            _ => Production
        };

    public static bool IsConfigurable(string role) =>
        Configurable.Contains(role);
}
