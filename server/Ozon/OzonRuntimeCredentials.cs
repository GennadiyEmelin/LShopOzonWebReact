using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace LShopOzonWebReact.Api.Ozon;

public sealed class OzonRuntimeCredentials(IOptions<OzonOptions> envOptions)
{
    private readonly OzonOptions _envOptions = envOptions.Value;
    private OzonCredentialSnapshot _snapshot = OzonCredentialSnapshot.FromEnv(envOptions.Value);

    public string BaseUrl => _snapshot.BaseUrl;
    public string ClientId => _snapshot.ClientId;
    public string ApiKey => _snapshot.ApiKey;

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_snapshot.ClientId) &&
        !string.IsNullOrWhiteSpace(_snapshot.ApiKey);

    public async Task LoadFromDatabaseAsync(AppDbContext db, CancellationToken cancellationToken = default)
    {
        var settings = await db.AppIntegrationSettings
            .AsNoTracking()
            .FirstOrDefaultAsync(entry => entry.Id == 1, cancellationToken);

        if (settings is not null &&
            !string.IsNullOrWhiteSpace(settings.OzonClientId) &&
            !string.IsNullOrWhiteSpace(settings.OzonApiKey))
        {
            _snapshot = new OzonCredentialSnapshot(
                settings.OzonClientId.Trim(),
                settings.OzonApiKey.Trim(),
                string.IsNullOrWhiteSpace(settings.OzonBaseUrl)
                    ? _envOptions.BaseUrl
                    : settings.OzonBaseUrl.Trim());
            return;
        }

        _snapshot = OzonCredentialSnapshot.FromEnv(_envOptions);
    }

    public void Apply(AppIntegrationSettings settings)
    {
        _snapshot = new OzonCredentialSnapshot(
            settings.OzonClientId.Trim(),
            settings.OzonApiKey.Trim(),
            string.IsNullOrWhiteSpace(settings.OzonBaseUrl)
                ? _envOptions.BaseUrl
                : settings.OzonBaseUrl.Trim());
    }
}

internal readonly record struct OzonCredentialSnapshot(string ClientId, string ApiKey, string BaseUrl)
{
    public static OzonCredentialSnapshot FromEnv(OzonOptions options) =>
        new(
            options.ClientId?.Trim() ?? string.Empty,
            options.ApiKey?.Trim() ?? string.Empty,
            string.IsNullOrWhiteSpace(options.BaseUrl)
                ? "https://api-seller.ozon.ru"
                : options.BaseUrl.Trim());
}
