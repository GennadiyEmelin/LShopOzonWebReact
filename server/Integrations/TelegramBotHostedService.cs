using System.Text.Json.Serialization;
using LShopOzonWebReact.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace LShopOzonWebReact.Api.Integrations;

public class TelegramBotHostedService(
    IServiceScopeFactory scopeFactory,
    IHttpClientFactory httpClientFactory,
    IOptions<TelegramOptions> options,
    ILogger<TelegramBotHostedService> logger) : BackgroundService
{
    private readonly TelegramOptions _options = options.Value;
    private int _offset;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (string.IsNullOrWhiteSpace(_options.BotToken))
        {
            logger.LogInformation("Telegram bot token is not configured. Bot polling disabled.");
            return;
        }

        logger.LogInformation("Telegram bot polling started.");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await PollOnceAsync(stoppingToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.LogWarning(exception, "Telegram polling iteration failed.");
            }

            await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
        }
    }

    private async Task PollOnceAsync(CancellationToken cancellationToken)
    {
        using var client = httpClientFactory.CreateClient(nameof(TelegramBotHostedService));
        var url =
            $"https://api.telegram.org/bot{_options.BotToken}/getUpdates?timeout=20&offset={_offset + 1}";

        using var response = await client.GetAsync(url, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            return;
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        var payload = await System.Text.Json.JsonSerializer.DeserializeAsync<TelegramUpdatesResponse>(
            stream,
            cancellationToken: cancellationToken);

        if (payload?.Ok != true || payload.Result is null)
        {
            return;
        }

        foreach (var update in payload.Result)
        {
            _offset = Math.Max(_offset, update.UpdateId);
            await HandleUpdateAsync(update, cancellationToken);
        }
    }

    private async Task HandleUpdateAsync(TelegramUpdate update, CancellationToken cancellationToken)
    {
        var message = update.Message;
        if (message?.Text is null || message.Chat?.Id is null)
        {
            return;
        }

        var text = message.Text.Trim();
        if (!text.StartsWith("/start", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        var parts = text.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length < 2)
        {
            await SendDirectAsync(
                message.Chat.Id,
                "Откройте ссылку подключения из раздела «Интеграции» в приложении LShop.",
                cancellationToken);
            return;
        }

        var token = parts[1].Trim();
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = await db.Users.FirstOrDefaultAsync(
            entry => entry.TelegramConnectToken == token && entry.IsActive,
            cancellationToken);

        if (user is null)
        {
            await SendDirectAsync(
                message.Chat.Id,
                "Ссылка подключения недействительна или устарела. Сгенерируйте новую в разделе «Интеграции».",
                cancellationToken);
            return;
        }

        user.TelegramChatId = message.Chat.Id.ToString();
        user.TelegramConnectedAt = DateTimeOffset.UtcNow;
        user.TelegramConnectToken = string.Empty;
        if (string.IsNullOrWhiteSpace(user.TelegramNotifyEvents))
        {
            user.TelegramNotifyEvents = TelegramNotificationEvents.Serialize(
                TelegramNotificationEvents.All.Select(definition => definition.Id));
        }

        await db.SaveChangesAsync(cancellationToken);

        await SendDirectAsync(
            message.Chat.Id,
            $"Подключено к аккаунту {(string.IsNullOrWhiteSpace(user.DisplayName) ? user.UserName : user.DisplayName)}. Настройте типы оповещений в разделе «Интеграции».",
            cancellationToken);
    }

    private async Task SendDirectAsync(long chatId, string text, CancellationToken cancellationToken)
    {
        using var client = httpClientFactory.CreateClient(nameof(TelegramBotHostedService));
        await client.PostAsJsonAsync(
            $"https://api.telegram.org/bot{_options.BotToken}/sendMessage",
            new { chat_id = chatId.ToString(), text },
            cancellationToken);
    }
}

public record TelegramUpdatesResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("result")] IReadOnlyList<TelegramUpdate>? Result);

public record TelegramUpdate(
    [property: JsonPropertyName("update_id")] int UpdateId,
    [property: JsonPropertyName("message")] TelegramUpdateMessage? Message);

public record TelegramUpdateMessage(
    [property: JsonPropertyName("text")] string? Text,
    [property: JsonPropertyName("chat")] TelegramUpdateChat? Chat);

public record TelegramUpdateChat(
    [property: JsonPropertyName("id")] long Id);
