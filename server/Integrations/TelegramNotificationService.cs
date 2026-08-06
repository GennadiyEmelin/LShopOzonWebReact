using System.Net.Http.Json;
using System.Net.Http.Headers;
using System.Text.Json.Serialization;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace LShopOzonWebReact.Api.Integrations;

public class TelegramNotificationService(
    IHttpClientFactory httpClientFactory,
    IOptions<TelegramOptions> options,
    ILogger<TelegramNotificationService> logger)
{
    private readonly TelegramOptions _options = options.Value;

    public bool IsBotConfigured => !string.IsNullOrWhiteSpace(_options.BotToken);

    public async Task<TelegramBotInfo?> GetBotInfoAsync(CancellationToken cancellationToken = default)
    {
        if (!IsBotConfigured)
        {
            return null;
        }

        using var client = httpClientFactory.CreateClient(nameof(TelegramNotificationService));
        var response = await client.GetFromJsonAsync<TelegramGetMeResponse>(
            $"https://api.telegram.org/bot{_options.BotToken}/getMe",
            cancellationToken);

        if (response?.Ok != true || response.Result is null)
        {
            return null;
        }

        return new TelegramBotInfo(response.Result.Username, response.Result.FirstName);
    }

    public string BuildConnectUrl(string botUsername, string connectToken) =>
        $"https://t.me/{botUsername}?start={connectToken}";

    public string GenerateConnectToken() => Guid.NewGuid().ToString("N");

    public Task<bool> SendMessageAsync(string chatId, string text, CancellationToken cancellationToken = default) =>
        SendMessageAsync(chatId, text, null, cancellationToken);

    public async Task<bool> SendMessageAsync(
        string chatId,
        string text,
        object? replyMarkup = null,
        CancellationToken cancellationToken = default)
    {
        if (!IsBotConfigured || string.IsNullOrWhiteSpace(chatId))
        {
            return false;
        }

        var trimmed = text.Length > 3900 ? $"{text[..3900]}..." : text;

        using var client = httpClientFactory.CreateClient(nameof(TelegramNotificationService));
        using var response = await client.PostAsJsonAsync(
            $"https://api.telegram.org/bot{_options.BotToken}/sendMessage",
            new TelegramSendMessageRequest(chatId, trimmed, replyMarkup),
            cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            logger.LogWarning("Telegram send failed: {Status} {Body}", response.StatusCode, body);
            return false;
        }

        return true;
    }

    public async Task<bool> SendDocumentAsync(
        string chatId,
        byte[] content,
        string fileName,
        string caption,
        CancellationToken cancellationToken = default)
    {
        if (!IsBotConfigured || string.IsNullOrWhiteSpace(chatId) || content.Length == 0)
        {
            return false;
        }

        using var client = httpClientFactory.CreateClient(nameof(TelegramNotificationService));
        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(chatId), "chat_id");
        if (!string.IsNullOrWhiteSpace(caption))
        {
            form.Add(new StringContent(caption.Length > 1024 ? caption[..1024] : caption), "caption");
        }

        var fileContent = new ByteArrayContent(content);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        form.Add(fileContent, "document", fileName);

        using var response = await client.PostAsync(
            $"https://api.telegram.org/bot{_options.BotToken}/sendDocument",
            form,
            cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            logger.LogWarning("Telegram document send failed: {Status} {Body}", response.StatusCode, body);
            return false;
        }

        return true;
    }

    public async Task SendToUsersAsync(
        AppDbContext db,
        string eventId,
        string message,
        IEnumerable<Guid>? onlyUserIds = null,
        Guid? excludeUserId = null,
        string? shopRegion = null,
        CancellationToken cancellationToken = default)
    {
        if (!IsBotConfigured)
        {
            return;
        }

        var normalizedRegion = TelegramNotificationEvents.NormalizeShopRegion(shopRegion);
        var allowedIds = onlyUserIds?.ToHashSet();
        var recipients = await db.Users
            .AsNoTracking()
            .Where(user =>
                user.IsActive &&
                user.Id != excludeUserId &&
                !string.IsNullOrWhiteSpace(user.TelegramChatId) &&
                (allowedIds == null || allowedIds.Contains(user.Id)))
            .Select(user => new
            {
                user.Id,
                user.Role,
                user.TelegramChatId,
                user.TelegramNotifyEvents,
                user.TelegramNotifyEventsKz
            })
            .ToListAsync(cancellationToken);

        foreach (var recipient in recipients)
        {
            if (!IsAlwaysAllowedRecipient(recipient.Role, eventId) &&
                !IsEnabledForRecipient(recipient.TelegramNotifyEvents, recipient.TelegramNotifyEventsKz, eventId, normalizedRegion))
            {
                continue;
            }

            await SendMessageAsync(recipient.TelegramChatId!, message, cancellationToken: cancellationToken);
        }
    }

    private static bool IsAlwaysAllowedRecipient(string role, string eventId) =>
        false;

    private static bool IsEnabledForRecipient(
        string? rfEvents,
        string? kzEvents,
        string eventId,
        string shopRegion)
    {
        var definition = TelegramNotificationEvents.All
            .FirstOrDefault(item => string.Equals(item.Id, eventId, StringComparison.OrdinalIgnoreCase));

        if (definition is null)
        {
            return false;
        }

        return definition.ShopRegion switch
        {
            TelegramNotificationEvents.ShopRegionKz =>
                TelegramNotificationEvents.IsEnabled(kzEvents, eventId),
            TelegramNotificationEvents.ShopRegionRf =>
                TelegramNotificationEvents.IsEnabled(rfEvents, eventId),
            _ when shopRegion == TelegramNotificationEvents.ShopRegionKz =>
                TelegramNotificationEvents.IsEnabled(kzEvents, eventId),
            _ when shopRegion == TelegramNotificationEvents.ShopRegionRf =>
                TelegramNotificationEvents.IsEnabled(rfEvents, eventId),
            _ =>
                TelegramNotificationEvents.IsEnabled(rfEvents, eventId) ||
                TelegramNotificationEvents.IsEnabled(kzEvents, eventId)
        };
    }

    public async Task SendToUserAsync(
        AppDbContext db,
        Guid userId,
        string eventId,
        string message,
        string? shopRegion = null,
        CancellationToken cancellationToken = default)
    {
        await SendToUsersAsync(db, eventId, message, [userId], null, shopRegion, cancellationToken);
    }
}

public record TelegramBotInfo(string Username, string DisplayName);

public record TelegramSendMessageRequest(
    [property: JsonPropertyName("chat_id")] string ChatId,
    [property: JsonPropertyName("text")] string Text,
    [property: JsonPropertyName("reply_markup")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    object? ReplyMarkup = null);

public record TelegramReplyKeyboardMarkup(
    [property: JsonPropertyName("keyboard")] IReadOnlyList<IReadOnlyList<TelegramKeyboardButton>> Keyboard,
    [property: JsonPropertyName("resize_keyboard")] bool ResizeKeyboard = true,
    [property: JsonPropertyName("one_time_keyboard")] bool OneTimeKeyboard = false);

public record TelegramKeyboardButton(
    [property: JsonPropertyName("text")] string Text);

public record TelegramGetMeResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("result")] TelegramGetMeResult? Result);

public record TelegramGetMeResult(
    [property: JsonPropertyName("username")] string Username,
    [property: JsonPropertyName("first_name")] string FirstName);
