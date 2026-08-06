namespace LShopOzonWebReact.Api.Models;

public class ProductionFile
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? ProductionTaskItemId { get; set; }
    public long? OzonProductId { get; set; }
    public string OfferId { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public string ProductLink { get; set; } = string.Empty;
    public string Notes { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string ContentType { get; set; } = "application/octet-stream";
    public byte[] Content { get; set; } = [];
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
