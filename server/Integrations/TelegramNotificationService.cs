using System.Net.Http.Json;
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

    public async Task<bool> SendMessageAsync(string chatId, string text, CancellationToken cancellationToken = default)
    {
        if (!IsBotConfigured || string.IsNullOrWhiteSpace(chatId))
        {
            return false;
        }

        var trimmed = text.Length > 3900 ? $"{text[..3900]}..." : text;

        using var client = httpClientFactory.CreateClient(nameof(TelegramNotificationService));
        using var response = await client.PostAsJsonAsync(
            $"https://api.telegram.org/bot{_options.BotToken}/sendMessage",
            new TelegramSendMessageRequest(chatId, trimmed),
            cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            logger.LogWarning("Telegram send failed: {Status} {Body}", response.StatusCode, body);
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
                user.TelegramChatId,
                user.TelegramNotifyEvents,
                user.TelegramNotifyEventsKz
            })
            .ToListAsync(cancellationToken);

        foreach (var recipient in recipients)
        {
            if (!IsEnabledForRecipient(recipient.TelegramNotifyEvents, recipient.TelegramNotifyEventsKz, eventId, normalizedRegion))
            {
                continue;
            }

            await SendMessageAsync(recipient.TelegramChatId!, message, cancellationToken);
        }
    }

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
    [property: JsonPropertyName("text")] string Text);

public record TelegramGetMeResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("result")] TelegramGetMeResult? Result);

public record TelegramGetMeResult(
    [property: JsonPropertyName("username")] string Username,
    [property: JsonPropertyName("first_name")] string FirstName);
