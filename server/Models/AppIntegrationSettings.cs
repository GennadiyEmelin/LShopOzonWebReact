namespace LShopOzonWebReact.Api.Models;

public class AppIntegrationSettings
{
    public int Id { get; set; } = 1;
    public string OzonClientId { get; set; } = string.Empty;
    public string OzonApiKey { get; set; } = string.Empty;
    public string OzonBaseUrl { get; set; } = "https://api-seller.ozon.ru";
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
