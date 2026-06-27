using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Marketplaces;

public sealed class KzMarketplaceCredentialSet
{
    public string MerchantId { get; set; } = string.Empty;
    public string ApiKey { get; set; } = string.Empty;
    public bool IsConfigured => !string.IsNullOrWhiteSpace(MerchantId) && !string.IsNullOrWhiteSpace(ApiKey);
}

public sealed class KzMarketplaceCredentials
{
    private readonly Dictionary<string, KzMarketplaceCredentialSet> _credentials = new(StringComparer.OrdinalIgnoreCase)
    {
        [MarketplaceTypes.Kaspi] = new(),
        [MarketplaceTypes.Satu] = new(),
        [MarketplaceTypes.Halyk] = new()
    };

    public KzMarketplaceCredentialSet Get(string marketplace)
    {
        var normalized = MarketplaceTypes.NormalizeKzMarketplace(marketplace);
        return _credentials[normalized];
    }

    public async Task LoadFromDatabaseAsync(AppDbContext db, CancellationToken cancellationToken = default)
    {
        var settings = await db.AppIntegrationSettings.AsNoTracking().FirstOrDefaultAsync(entry => entry.Id == 1, cancellationToken);
        if (settings is null)
        {
            return;
        }

        Apply(settings);
    }

    public void Apply(AppIntegrationSettings settings)
    {
        _credentials[MarketplaceTypes.Kaspi] = new KzMarketplaceCredentialSet
        {
            MerchantId = settings.KaspiMerchantId?.Trim() ?? string.Empty,
            ApiKey = settings.KaspiApiKey?.Trim() ?? string.Empty
        };
        _credentials[MarketplaceTypes.Satu] = new KzMarketplaceCredentialSet
        {
            MerchantId = settings.SatuMerchantId?.Trim() ?? string.Empty,
            ApiKey = settings.SatuApiKey?.Trim() ?? string.Empty
        };
        _credentials[MarketplaceTypes.Halyk] = new KzMarketplaceCredentialSet
        {
            MerchantId = settings.HalykMerchantId?.Trim() ?? string.Empty,
            ApiKey = settings.HalykApiKey?.Trim() ?? string.Empty
        };
    }
}
