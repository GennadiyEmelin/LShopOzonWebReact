namespace LShopOzonWebReact.Api.Models;

public class AppIntegrationSettings
{
    public int Id { get; set; } = 1;
    public string OzonClientId { get; set; } = string.Empty;
    public string OzonApiKey { get; set; } = string.Empty;
    public string OzonBaseUrl { get; set; } = "https://api-seller.ozon.ru";
    public string KaspiMerchantId { get; set; } = string.Empty;
    public string KaspiApiKey { get; set; } = string.Empty;
    public string SatuMerchantId { get; set; } = string.Empty;
    public string SatuApiKey { get; set; } = string.Empty;
    public string HalykMerchantId { get; set; } = string.Empty;
    public string HalykApiKey { get; set; } = string.Empty;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
