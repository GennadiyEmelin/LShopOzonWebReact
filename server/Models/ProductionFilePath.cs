namespace LShopOzonWebReact.Api.Models;

public class ProductionFilePath
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public long? OzonProductId { get; set; }
    public string OfferId { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public string ProductLink { get; set; } = string.Empty;
    public string Path { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
