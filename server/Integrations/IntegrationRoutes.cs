using System.Security.Claims;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Integrations;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Ozon;
using LShopOzonWebReact.Api.Security;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Integrations;

public static class IntegrationRoutes
{
    public static void MapIntegrationRoutes(this WebApplication app)
    {
        app.MapGet("/api/integrations/notification-events", () =>
            Results.Ok(TelegramNotificationEvents.All.Select(definition => new
            {
                definition.Id,
                definition.Group,
                definition.Label
            })))
            .RequireAuthorization();

        app.MapGet("/api/integrations/ozon", async (
            AppDbContext db,
            OzonRuntimeCredentials credentials,
            ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.IntegrationsOzon))
            {
                return Results.Forbid();
            }

            await credentials.LoadFromDatabaseAsync(db);
            var settings = await db.AppIntegrationSettings.AsNoTracking().FirstOrDefaultAsync(entry => entry.Id == 1);

            return Results.Ok(new OzonIntegrationSettingsResponse(
                credentials.IsConfigured,
                credentials.BaseUrl,
                AppPublicText.MaskSecret(credentials.ClientId),
                AppPublicText.MaskSecret(credentials.ApiKey),
                !string.IsNullOrWhiteSpace(settings?.OzonClientId),
                !string.IsNullOrWhiteSpace(settings?.OzonApiKey),
                settings?.UpdatedAt));
        }).RequireAuthorization();

        app.MapPut("/api/integrations/ozon", async (
            UpdateOzonIntegrationRequest request,
            AppDbContext db,
            OzonRuntimeCredentials credentials,
            TelegramNotificationService telegram,
            ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.IntegrationsOzonEdit))
            {
                return Results.Forbid();
            }

            var clientId = request.ClientId?.Trim() ?? string.Empty;
            var apiKey = request.ApiKey?.Trim() ?? string.Empty;
            var baseUrl = string.IsNullOrWhiteSpace(request.BaseUrl)
                ? credentials.BaseUrl
                : request.BaseUrl.Trim();

            var settings = await db.AppIntegrationSettings.FirstOrDefaultAsync(entry => entry.Id == 1);
            if (settings is null)
            {
                settings = new AppIntegrationSettings { Id = 1 };
                db.AppIntegrationSettings.Add(settings);
            }

            if (string.IsNullOrWhiteSpace(clientId))
            {
                clientId = settings.OzonClientId?.Trim() ?? credentials.ClientId;
            }

            if (string.IsNullOrWhiteSpace(apiKey))
            {
                apiKey = settings.OzonApiKey?.Trim() ?? credentials.ApiKey;
            }

            if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(apiKey))
            {
                return Results.BadRequest("Укажите Client ID и API Key.");
            }

            settings.OzonClientId = clientId;
            settings.OzonApiKey = apiKey;
            settings.OzonBaseUrl = baseUrl;
            settings.UpdatedAt = DateTimeOffset.UtcNow;
            credentials.Apply(settings);
            AuditLogWriter.Add(db, principal, "Ozon API", "Integration", "1", "Обновлены ключи Ozon");
            await db.SaveChangesAsync();

            await telegram.SendToUsersAsync(
                db,
                "ozon.integration.updated",
                "Настройки Ozon API обновлены в разделе «Интеграции».");

            return Results.Ok(new OzonIntegrationSettingsResponse(
                true,
                credentials.BaseUrl,
                AppPublicText.MaskSecret(credentials.ClientId),
                AppPublicText.MaskSecret(credentials.ApiKey),
                true,
                true,
                settings.UpdatedAt));
        }).RequireAuthorization();

        app.MapPost("/api/integrations/ozon/test", async (
            AppDbContext db,
            OzonApiClient ozonApi,
            OzonRuntimeCredentials credentials,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.IntegrationsOzon))
            {
                return Results.Forbid();
            }

            await credentials.LoadFromDatabaseAsync(db, cancellationToken);
            if (!credentials.IsConfigured)
            {
                return Results.BadRequest("Сначала сохраните Client ID и API Key.");
            }

            try
            {
                var result = await ozonApi.GetProductListAsync(1, cancellationToken);
                return Results.Ok(new OzonIntegrationTestResponse(
                    true,
                    $"Ozon API отвечает. Товаров в каталоге: {result.Total}"));
            }
            catch (Exception exception)
            {
                return Results.Ok(new OzonIntegrationTestResponse(
                    false,
                    AppPublicText.GetPublicOzonError(exception)));
            }
        }).RequireAuthorization();

        app.MapGet("/api/integrations/telegram", async (
            AppDbContext db,
            TelegramNotificationService telegram,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.IntegrationsTelegram))
            {
                return Results.Forbid();
            }

            var userId = GetCurrentUserId(principal);
            if (userId is null)
            {
                return Results.Unauthorized();
            }

            var user = await db.Users.FirstAsync(entry => entry.Id == userId.Value, cancellationToken);
            var botInfo = await telegram.GetBotInfoAsync(cancellationToken);
            var connected = !string.IsNullOrWhiteSpace(user.TelegramChatId);
            var connectAllowed = FeatureAccess.AllowsTelegramConnect(user);
            var connectUrl = connectAllowed && botInfo is not null && !string.IsNullOrWhiteSpace(user.TelegramConnectToken)
                ? telegram.BuildConnectUrl(botInfo.Username, user.TelegramConnectToken)
                : null;

            return Results.Ok(new TelegramIntegrationResponse(
                telegram.IsBotConfigured,
                botInfo?.Username,
                botInfo?.DisplayName,
                connected,
                AppPublicText.MaskSecret(user.TelegramChatId),
                user.TelegramConnectedAt,
                connectUrl,
                TelegramNotificationEvents.Parse(user.TelegramNotifyEvents).ToList(),
                TelegramNotificationEvents.All.Select(definition => definition.Id).ToList(),
                connectAllowed));
        }).RequireAuthorization();

        app.MapPost("/api/integrations/telegram/connect", async (
            AppDbContext db,
            TelegramNotificationService telegram,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.IntegrationsTelegramConnect))
            {
                return Results.Forbid();
            }

            var userId = GetCurrentUserId(principal);
            if (userId is null)
            {
                return Results.Unauthorized();
            }

            var user = await db.Users.FirstAsync(entry => entry.Id == userId.Value, cancellationToken);
            if (!FeatureAccess.AllowsTelegramConnect(user))
            {
                return Results.BadRequest("Администратор не разрешил вам подключение Telegram.");
            }

            if (!telegram.IsBotConfigured)
            {
                return Results.BadRequest("Telegram-бот не настроен на сервере. Добавьте TELEGRAM_BOT_TOKEN в .env.");
            }

            var botInfo = await telegram.GetBotInfoAsync(cancellationToken);
            if (botInfo is null)
            {
                return Results.BadRequest("Не удалось получить данные Telegram-бота.");
            }

            user.TelegramConnectToken = telegram.GenerateConnectToken();
            await db.SaveChangesAsync(cancellationToken);

            var connectUrl = telegram.BuildConnectUrl(botInfo.Username, user.TelegramConnectToken);
            return Results.Ok(new TelegramConnectResponse(connectUrl, user.TelegramConnectToken));
        }).RequireAuthorization();

        app.MapPut("/api/integrations/telegram/preferences", () =>
            Results.BadRequest("Оповещения Telegram настраивает администратор в разделе «Интеграции»."))
            .RequireAuthorization();

        app.MapPost("/api/integrations/telegram/test", async (
            AppDbContext db,
            TelegramNotificationService telegram,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.IntegrationsTelegram))
            {
                return Results.Forbid();
            }

            var userId = GetCurrentUserId(principal);
            if (userId is null)
            {
                return Results.Unauthorized();
            }

            var user = await db.Users.AsNoTracking().FirstAsync(entry => entry.Id == userId.Value, cancellationToken);
            if (string.IsNullOrWhiteSpace(user.TelegramChatId))
            {
                return Results.BadRequest("Telegram не подключён.");
            }

            var ok = await telegram.SendMessageAsync(
                user.TelegramChatId,
                "Тестовое оповещение LShop. Если вы видите это сообщение, Telegram подключён успешно.",
                cancellationToken);

            return ok
                ? Results.Ok(new { message = "Тестовое сообщение отправлено." })
                : Results.BadRequest("Не удалось отправить тестовое сообщение.");
        }).RequireAuthorization();

        app.MapDelete("/api/integrations/telegram", async (
            AppDbContext db,
            ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.IntegrationsTelegramConnect))
            {
                return Results.Forbid();
            }

            var userId = GetCurrentUserId(principal);
            if (userId is null)
            {
                return Results.Unauthorized();
            }

            var user = await db.Users.FirstAsync(entry => entry.Id == userId.Value);
            user.TelegramChatId = string.Empty;
            user.TelegramConnectToken = string.Empty;
            user.TelegramNotifyEvents = string.Empty;
            user.TelegramConnectedAt = null;
            await db.SaveChangesAsync();

            return Results.NoContent();
        }).RequireAuthorization();
    }

    private static Guid? GetCurrentUserId(ClaimsPrincipal principal) =>
        UserRoleResolver.GetUserId(principal);
}

public record OzonIntegrationSettingsResponse(
    bool Configured,
    string BaseUrl,
    string ClientIdMasked,
    string ApiKeyMasked,
    bool HasStoredClientId,
    bool HasStoredApiKey,
    DateTimeOffset? UpdatedAt);

public record UpdateOzonIntegrationRequest(string? ClientId, string? ApiKey, string? BaseUrl);
public record OzonIntegrationTestResponse(bool Success, string Message);

public record TelegramIntegrationResponse(
    bool BotConfigured,
    string? BotUsername,
    string? BotDisplayName,
    bool Connected,
    string ChatIdMasked,
    DateTimeOffset? ConnectedAt,
    string? ConnectUrl,
    IReadOnlyList<string> EnabledEvents,
    IReadOnlyList<string> AvailableEvents,
    bool ConnectAllowed);

public record TelegramConnectResponse(string ConnectUrl, string ConnectToken);
public record UpdateTelegramPreferencesRequest(List<string>? Events);
public record TelegramPreferencesResponse(IReadOnlyList<string> EnabledEvents);

public static class IntegrationNotificationPublisher
{
    public static Task PublishAsync(
        TelegramNotificationService telegram,
        AppDbContext db,
        string eventId,
        string message,
        IEnumerable<Guid>? onlyUserIds = null,
        Guid? excludeUserId = null) =>
        telegram.SendToUsersAsync(db, eventId, message, onlyUserIds, excludeUserId);
}

public static class ChatNotificationText
{
    public static string BuildPreview(string senderName, string text, bool hasAttachment)
    {
        var sender = string.IsNullOrWhiteSpace(senderName) ? "Пользователь" : senderName.Trim();
        var trimmedText = (text ?? string.Empty).Replace('\r', ' ').Replace('\n', ' ').Trim();
        if (trimmedText.Length > 180)
        {
            trimmedText = trimmedText[..177].TrimEnd() + "…";
        }

        if (hasAttachment && string.IsNullOrWhiteSpace(trimmedText))
        {
            return $"{sender}: [вложение]";
        }

        if (hasAttachment)
        {
            return $"{sender}: {trimmedText}\n[вложение]";
        }

        return $"{sender}: {trimmedText}";
    }
}
