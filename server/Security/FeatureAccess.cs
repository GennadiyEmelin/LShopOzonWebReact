using System.Security.Claims;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Security;

public static class FeatureAccess
{
    public const string Production = "production";
    public const string Products = "products";
    public const string Analytics = "analytics";
    public const string Pooling = "pooling";
    public const string Supplies = "supplies";
    public const string Chats = "chats";
    public const string Home = "home";
    public const string Integrations = "integrations";

    public const string IntegrationsOzon = "integrations.ozon";
    public const string IntegrationsOzonEdit = "integrations.ozon.edit";
    public const string IntegrationsTelegram = "integrations.telegram";
    public const string IntegrationsTelegramConnect = "integrations.telegram.connect";
    public const string IntegrationsTelegramNotifications = "integrations.telegram.notifications";
    public const string IntegrationsTelegramNotificationsEdit = "integrations.telegram.notifications.edit";
    public const string IntegrationsTelegramReports = "integrations.telegram.reports";
    public const string IntegrationsTelegramReportsEdit = "integrations.telegram.reports.edit";

    public const string Users = "users";
    public const string UsersCreate = "users.create";
    public const string UsersEdit = "users.edit";
    public const string Settings = "settings";
    public const string SettingsEdit = "settings.edit";

    public static readonly string[] ProductionDefaults =
    [
        Home,
        Production,
        "production.products",
        "production.tasks",
        "production.inProgress",
        "production.cancelled",
        "production.completed",
        Products,
        Supplies,
        "supplies.create",
        "supplies.all",
        Chats,
        "chats.edit",
        Integrations,
        IntegrationsTelegram,
        IntegrationsTelegramConnect
    ];

    public static readonly string[] All =
    [
        Home,
        Production,
        "production.products",
        "production.tasks",
        "production.inProgress",
        "production.cancelled",
        "production.completed",
        "production.archive",
        "production.createTask",
        "production.editTasks",
        "production.cancelTasks",
        "production.editProducts",
        "production.deleteFiles",
        "production.deleteFilePaths",
        Products,
        "products.edit",
        Analytics,
        "analytics.summary",
        "analytics.topProducts",
        "analytics.noSales",
        "analytics.production",
        Pooling,
        "pooling.editPrices",
        Supplies,
        "supplies.create",
        "supplies.editor",
        "supplies.all",
        "supplies.archive",
        "supplies.analytics",
        "supplies.edit",
        Chats,
        "chats.edit",
        "chats.groups",
        Integrations,
        IntegrationsOzon,
        IntegrationsOzonEdit,
        IntegrationsTelegram,
        IntegrationsTelegramConnect,
        IntegrationsTelegramNotifications,
        IntegrationsTelegramNotificationsEdit,
        IntegrationsTelegramReports,
        IntegrationsTelegramReportsEdit,
        Users,
        UsersCreate,
        UsersEdit,
        Settings,
        SettingsEdit
    ];

    public static List<string> Parse(string value) =>
        value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(feature => All.Contains(feature))
            .Distinct()
            .ToList();

    public static string NormalizeForRole(
        string role,
        IReadOnlyCollection<string>? features,
        string? roleDefaultFeatures = null)
    {
        if (role == UserRoles.Admin)
        {
            return string.Join(',', All);
        }

        var fallback = !string.IsNullOrWhiteSpace(roleDefaultFeatures)
            ? Parse(roleDefaultFeatures)
            : ProductionDefaults.ToList();

        var selected = features is { Count: > 0 }
            ? features.Where(feature => All.Contains(feature)).Distinct().ToList()
            : fallback;

        return string.Join(',', selected);
    }

    public static void SyncTelegramConnectAllowed(AppUser user)
    {
        if (user.Role == UserRoles.Admin)
        {
            user.TelegramConnectAllowed = true;
            return;
        }

        user.TelegramConnectAllowed = Parse(user.AllowedFeatures).Contains(IntegrationsTelegramConnect);
    }

    public static bool AllowsTelegramConnect(AppUser user) =>
        user.Role == UserRoles.Admin || Parse(user.AllowedFeatures).Contains(IntegrationsTelegramConnect);

    public static async Task<bool> HasAnyAsync(AppDbContext db, ClaimsPrincipal principal, params string[] features)
    {
        if (UserRoleResolver.IsInRole(principal, UserRoles.Admin))
        {
            return true;
        }

        if (await UserRoleResolver.IsInRoleAsync(db, principal, UserRoles.Admin))
        {
            return true;
        }

        var userId = UserRoleResolver.GetUserId(principal);
        if (userId is null)
        {
            return false;
        }

        var allowedFeatures = await db.Users
            .AsNoTracking()
            .Where(user => user.Id == userId.Value && user.IsActive)
            .Select(user => user.AllowedFeatures)
            .FirstOrDefaultAsync();

        if (allowedFeatures is null)
        {
            return false;
        }

        var allowed = Parse(allowedFeatures);
        return features.Any(feature => allowed.Contains(feature));
    }
}
