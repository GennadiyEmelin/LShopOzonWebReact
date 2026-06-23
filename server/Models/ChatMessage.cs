namespace LShopOzonWebReact.Api.Models;

public class ChatMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? GroupId { get; set; }
    public ChatGroup? Group { get; set; }
    public Guid SenderId { get; set; }
    public AppUser Sender { get; set; } = null!;
    public Guid? ReceiverId { get; set; }
    public AppUser? Receiver { get; set; }
    public string Text { get; set; } = string.Empty;
    public string AttachmentFileName { get; set; } = string.Empty;
    public string AttachmentContentType { get; set; } = string.Empty;
    public byte[]? AttachmentContent { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ReadAt { get; set; }
    public bool IsHiddenForSender { get; set; }
}
