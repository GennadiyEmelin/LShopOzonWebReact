namespace LShopOzonWebReact.Api.Marketplaces;

public static class MarketplaceTypes
{
    public const string Kaspi = "kaspi";
    public const string Satu = "satu";
    public const string Halyk = "halyk";

    public static readonly IReadOnlyList<string> KzMarketplaces = [Kaspi, Satu, Halyk];

    public static bool IsKzMarketplace(string? value) =>
        !string.IsNullOrWhiteSpace(value) &&
        KzMarketplaces.Any(marketplace => marketplace.Equals(value.Trim(), StringComparison.OrdinalIgnoreCase));

    public static string NormalizeKzMarketplace(string? value) =>
        IsKzMarketplace(value) ? value!.Trim().ToLowerInvariant() : Kaspi;

    public static string GetDisplayName(string marketplace) =>
        NormalizeKzMarketplace(marketplace) switch
        {
            Satu => "Satu",
            Halyk => "Halyk",
            _ => "Kaspi"
        };
}
