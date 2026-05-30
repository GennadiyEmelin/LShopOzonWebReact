namespace LShopOzonWebReact.Api.Models;

public class ChatMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SenderId { get; set; }
    public AppUser Sender { get; set; } = null!;
    public Guid ReceiverId { get; set; }
    public AppUser Receiver { get; set; } = null!;
    public string Text { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ReadAt { get; set; }
}
