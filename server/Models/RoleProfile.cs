using System.Text.Json;
using LShopOzonWebReact.Api.Security;

namespace LShopOzonWebReact.Api.Models;

public class RoleProfile
{
    public string Role { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string AllowedFeatures { get; set; } = string.Empty;
    public string HomeBlocksJson { get; set; } = "[]";
    public bool CanChangeOtherUserPasswords { get; set; }
}

public record HomeBlockConfig(string Id, bool Enabled, List<string> Actions);

public static class HomeBlocksCatalog
{
    public static readonly HomeBlockDefinition[] Blocks =
    [
        new("production", "Производство",
        [
            "production.tasks",
            "production.inProgress",
            "production.cancelled",
            "production.completed",
            "production.createTask"
        ]),
        new("analytics", "Аналитика",
        [
            "analytics.summary",
            "analytics.topProducts",
            "analytics.noSales",
            "analytics.production"
        ]),
        new("supplies", "Поставки",
        [
            "supplies.create",
            "supplies.all",
            "supplies.editor",
            "supplies.analytics"
        ]),
        new("products", "Товары", ["products"])
    ];

    public static List<HomeBlockConfig> AllEnabled() =>
        Blocks.Select(block => new HomeBlockConfig(block.Id, true, block.Actions.ToList())).ToList();

    public static List<HomeBlockConfig> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return [];
        }

        try
        {
            var parsed = JsonSerializer.Deserialize<List<HomeBlockConfig>>(json, JsonOptions);
            if (parsed is null)
            {
                return [];
            }

            return parsed
                .Where(block => Blocks.Any(definition => definition.Id == block.Id))
                .Select(block =>
                {
                    var definition = Blocks.First(item => item.Id == block.Id);
                    var actions = (block.Actions ?? [])
                        .Where(definition.Actions.Contains)
                        .Distinct()
                        .ToList();
                    return new HomeBlockConfig(block.Id, block.Enabled, actions);
                })
                .ToList();
        }
        catch (JsonException)
        {
            return [];
        }
    }

    public static string Serialize(IEnumerable<HomeBlockConfig> blocks) =>
        JsonSerializer.Serialize(blocks, JsonOptions);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };
}

public record HomeBlockDefinition(string Id, string Label, string[] Actions);

public static class RoleProfileDefaults
{
    public static IEnumerable<RoleProfile> All =>
    [
        new RoleProfile
        {
            Role = UserRoles.Production,
            DisplayName = "Производство",
            AllowedFeatures = string.Join(',', FeatureAccess.ProductionDefaults),
            HomeBlocksJson = HomeBlocksCatalog.Serialize(
            [
                new HomeBlockConfig("production", true,
                [
                    "production.tasks",
                    "production.inProgress",
                    "production.cancelled",
                    "production.completed"
                ]),
                new HomeBlockConfig("supplies", true, ["supplies.create", "supplies.all"]),
                new HomeBlockConfig("products", true, ["products"])
            ]),
            CanChangeOtherUserPasswords = false
        },
        new RoleProfile
        {
            Role = UserRoles.Designer,
            DisplayName = "Дизайнер",
            AllowedFeatures = string.Join(',',
            [
                FeatureAccess.Home,
                FeatureAccess.Production,
                "production.products",
                "production.tasks",
                "production.inProgress",
                "production.completed",
                "production.createTask",
                FeatureAccess.Chats,
                "chats.edit",
                "integrations",
                FeatureAccess.IntegrationsTelegram,
                FeatureAccess.IntegrationsTelegramConnect
            ]),
            HomeBlocksJson = HomeBlocksCatalog.Serialize(
            [
                new HomeBlockConfig("production", true,
                [
                    "production.tasks",
                    "production.inProgress",
                    "production.completed",
                    "production.createTask"
                ])
            ]),
            CanChangeOtherUserPasswords = false
        },
        new RoleProfile
        {
            Role = UserRoles.Leadership,
            DisplayName = "Руководство",
            AllowedFeatures = string.Join(',',
            [
                FeatureAccess.Home,
                FeatureAccess.Products,
                FeatureAccess.Analytics,
                "analytics.summary",
                "analytics.topProducts",
                "analytics.noSales",
                "analytics.production",
                FeatureAccess.Supplies,
                "supplies.all",
                "supplies.analytics",
                FeatureAccess.Pooling,
                FeatureAccess.Chats
            ]),
            HomeBlocksJson = HomeBlocksCatalog.Serialize(
            [
                new HomeBlockConfig("analytics", true,
                [
                    "analytics.summary",
                    "analytics.topProducts",
                    "analytics.noSales",
                    "analytics.production"
                ]),
                new HomeBlockConfig("supplies", true, ["supplies.all", "supplies.analytics"]),
                new HomeBlockConfig("products", true, ["products"])
            ]),
            CanChangeOtherUserPasswords = true
        }
    ];
}
