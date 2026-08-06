using System.Diagnostics;
using System.Security.Claims;
using System.Text;
using LShopOzonWebReact.Api.Configuration;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Integrations;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Ozon;
using LShopOzonWebReact.Api.Production;
using LShopOzonWebReact.Api.Security;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using LShopOzonWebReact.Api.Contracts.Admin;
using LShopOzonWebReact.Api.Hubs;

namespace LShopOzonWebReact.Api.Endpoints;

public static class AdminEndpoints
{
    public static void MapAdminEndpoints(this WebApplication app)
    {
        app.MapPost("/api/accounting/export", async (
            AccountingExportRequest request,
            AppDbContext db,
            ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, "accounting"))
            {
                return Results.Forbid();
            }

            if (request.Rows is not { Count: > 0 })
            {
                return Results.BadRequest("Нет данных для выгрузки.");
            }

            var sheetName = string.IsNullOrWhiteSpace(request.SheetName) ? "Учет" : request.SheetName.Trim();
            var fileName = string.IsNullOrWhiteSpace(request.FileName)
                ? $"accounting-{DateTime.UtcNow:yyyyMMdd-HHmmss}.xlsx"
                : request.FileName.Trim();

            if (!fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase))
            {
                fileName += ".xlsx";
            }

            var rows = request.Rows
                .Select(row => row.Select(cell => cell ?? string.Empty).ToArray())
                .ToList();

            var content = ExcelExport.CreateWorkbook(sheetName, rows);
            return Results.File(
                content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                fileName);
        }).RequireAuthorization();

        app.MapPost("/api/accounting/telegram/send", async (
            AccountingTelegramSendRequest request,
            AppDbContext db,
            TelegramNotificationService telegram,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, "accounting"))
            {
                return Results.Forbid();
            }

            if (request.Rows is not { Count: > 0 })
            {
                return Results.BadRequest("Нет данных для отправки.");
            }

            if (!telegram.IsBotConfigured)
            {
                return Results.BadRequest("Telegram-бот не настроен.");
            }

            var reportType = (request.ReportType ?? string.Empty).Trim().ToLowerInvariant();
            var sectionId = reportType == "sales"
                ? TelegramReportSections.AccountingSales
                : TelegramReportSections.AccountingMaterials;
            var reportName = reportType == "sales" ? "отчет продаж" : "отчет материалов";

            var sheetName = string.IsNullOrWhiteSpace(request.SheetName) ? "Учет" : request.SheetName.Trim();
            var fileName = string.IsNullOrWhiteSpace(request.FileName)
                ? $"accounting-{DateTime.UtcNow:yyyyMMdd-HHmmss}.xlsx"
                : request.FileName.Trim();

            if (!fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase))
            {
                fileName += ".xlsx";
            }

            var rows = request.Rows
                .Select(row => row.Select(cell => cell ?? string.Empty).ToArray())
                .ToList();
            var content = ExcelExport.CreateWorkbook(sheetName, rows);

            var recipients = await db.Users
                .AsNoTracking()
                .Where(user => user.IsActive && !string.IsNullOrWhiteSpace(user.TelegramChatId))
                .Select(user => new
                {
                    user.Id,
                    user.UserName,
                    user.TelegramChatId,
                    user.TelegramDailyReportSections
                })
                .ToListAsync(cancellationToken);

            var enabledRecipients = recipients
                .Where(user => TelegramReportSections.IsEnabled(user.TelegramDailyReportSections, sectionId))
                .ToList();

            var sent = 0;
            foreach (var recipient in enabledRecipients)
            {
                var ok = await telegram.SendDocumentAsync(
                    recipient.TelegramChatId!,
                    content,
                    fileName,
                    $"LShopWeb: {reportName}",
                    cancellationToken);

                if (ok)
                {
                    sent++;
                }
            }

            AuditLogWriter.Add(
                db,
                principal,
                "Отправка отчета в Telegram",
                "AccountingReport",
                sectionId,
                $"{reportName}: отправлено {sent} из {enabledRecipients.Count}");
            await db.SaveChangesAsync(cancellationToken);

            return Results.Ok(new
            {
                Sent = sent,
                Recipients = enabledRecipients.Count
            });
        }).RequireAuthorization();

        app.MapGet("/api/admin/users", async (AppDbContext db, ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Users, FeatureAccess.UsersCreate, FeatureAccess.UsersEdit))
            {
                return Results.Forbid();
            }

            var onlineAfter = DateTimeOffset.UtcNow.AddMinutes(-2);
            var users = await db.Users.OrderBy(user => user.UserName).ToListAsync();
            var profiles = await db.RoleProfiles.AsNoTracking().ToDictionaryAsync(profile => profile.Role);
            return Results.Ok(users.Select(user =>
                UserResponses.ToListItem(
                    user,
                    user.LastSeenAt >= onlineAfter,
                    user.Role == UserRoles.Admin ? null : profiles.GetValueOrDefault(user.Role))).ToList());
        }).RequireAuthorization();

        app.MapGet("/api/admin/role-profiles", async (AppDbContext db, ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Settings))
            {
                return Results.Forbid();
            }

            var profiles = await db.RoleProfiles.AsNoTracking().OrderBy(profile => profile.DisplayName).ToListAsync();
            return Results.Ok(profiles.Select(UserResponses.ToRoleProfileResponse).ToList());
        }).RequireAuthorization();

        app.MapPut("/api/admin/role-profiles/{role}", async (
            string role,
            UpdateRoleProfileRequest request,
            AppDbContext db,
            ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.SettingsEdit))
            {
                return Results.Forbid();
            }

            var normalizedRole = UserRoles.Normalize(role);
            if (!UserRoles.IsConfigurable(normalizedRole))
            {
                return Results.BadRequest("Роль недоступна для настройки.");
            }

            var profile = await db.RoleProfiles.FirstOrDefaultAsync(item => item.Role == normalizedRole);
            if (profile is null)
            {
                profile = new RoleProfile { Role = normalizedRole };
                db.RoleProfiles.Add(profile);
            }

            profile.DisplayName = string.IsNullOrWhiteSpace(request.DisplayName)
                ? normalizedRole
                : request.DisplayName.Trim();
            profile.AllowedFeatures = FeatureAccess.NormalizeForRole(normalizedRole, request.AllowedFeatures);
            profile.HomeBlocksJson = HomeBlocksCatalog.Serialize(request.HomeBlocks ?? []);
            profile.CanChangeOtherUserPasswords = request.CanChangeOtherUserPasswords;

            AuditLogWriter.Add(db, principal, "Настройка роли", "RoleProfile", profile.Role, profile.DisplayName);
            await db.SaveChangesAsync();

            return Results.Ok(UserResponses.ToRoleProfileResponse(profile));
        }).RequireAuthorization();

        app.MapPost("/api/admin/users", async (CreateUserRequest request, AppDbContext db, ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.UsersCreate, FeatureAccess.UsersEdit))
            {
                return Results.Forbid();
            }

            if (string.IsNullOrWhiteSpace(request.UserName) || string.IsNullOrWhiteSpace(request.Password))
            {
                return Results.BadRequest("Логин и пароль обязательны.");
            }

            var canManageUsers = await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.UsersEdit);
            var role = request.Role == UserRoles.Admin ? UserRoles.Admin : UserRoles.Normalize(request.Role);
            if (role == UserRoles.Admin && !canManageUsers)
            {
                return Results.Forbid();
            }

            var exists = await db.Users.AnyAsync(user => user.UserName == request.UserName);
            if (exists)
            {
                return Results.Conflict("Пользователь с таким логином уже есть.");
            }

            var profile = role == UserRoles.Admin
                ? null
                : await db.RoleProfiles.AsNoTracking().FirstOrDefaultAsync(item => item.Role == role);
            var user = new AppUser
            {
                UserName = request.UserName.Trim(),
                DisplayName = request.DisplayName.Trim(),
                Position = request.Position.Trim(),
                AllowedFeatures = FeatureAccess.NormalizeForRole(role, request.AllowedFeatures, profile?.AllowedFeatures),
                PasswordHash = PasswordHasher.Hash(request.Password),
                Role = role,
                HomeBlocksJson = role == UserRoles.Admin
                    ? string.Empty
                    : HomeBlocksCatalog.Serialize(request.HomeBlocks ?? [])
            };
            FeatureAccess.SyncTelegramConnectAllowed(user);

            db.Users.Add(user);
            AuditLogWriter.Add(db, principal, "Создание пользователя", "User", user.Id.ToString(), $"{user.UserName} ({user.Role})");
            await db.SaveChangesAsync();

            return Results.Created($"/api/admin/users/{user.Id}", UserResponses.ToListItem(user, false));
        }).RequireAuthorization();

        app.MapPut("/api/admin/users/{id:guid}/settings", async (
            Guid id,
            UpdateUserSettingsRequest request,
            AppDbContext db,
            ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.UsersEdit))
            {
                return Results.Forbid();
            }

            var user = await db.Users.FindAsync(id);
            if (user is null)
            {
                return Results.NotFound();
            }

            var role = request.Role == UserRoles.Admin ? UserRoles.Admin : UserRoles.Normalize(request.Role);
            var profile = role == UserRoles.Admin
                ? null
                : await db.RoleProfiles.AsNoTracking().FirstOrDefaultAsync(item => item.Role == role);
            user.DisplayName = request.DisplayName.Trim();
            user.Position = request.Position.Trim();
            user.Role = role;
            user.AllowedFeatures = FeatureAccess.NormalizeForRole(role, request.AllowedFeatures, profile?.AllowedFeatures);
            user.HomeBlocksJson = user.Role == UserRoles.Admin
                ? string.Empty
                : HomeBlocksCatalog.Serialize(request.HomeBlocks ?? []);
            FeatureAccess.SyncTelegramConnectAllowed(user);

            AuditLogWriter.Add(db, principal, "Настройки пользователя", "User", user.Id.ToString(), $"{user.UserName} ({user.Role})");
            await db.SaveChangesAsync();

            return Results.Ok(UserResponses.ToListItem(user, false, profile));
        }).RequireAuthorization();

        app.MapPut("/api/admin/users/{id:guid}/password", async (
            Guid id,
            ChangeUserPasswordRequest request,
            AppDbContext db,
            ClaimsPrincipal principal) =>
        {
            if (string.IsNullOrWhiteSpace(request.Password))
            {
                return Results.BadRequest("Пароль обязателен.");
            }

            var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
            if (!Guid.TryParse(currentUserId, out var actorId))
            {
                return Results.Unauthorized();
            }

            if (actorId == id)
            {
                return Results.BadRequest("Для смены своего пароля используйте профиль.");
            }

            var actor = await db.Users.AsNoTracking().FirstOrDefaultAsync(user => user.Id == actorId && user.IsActive);
            if (actor is null)
            {
                return Results.Unauthorized();
            }

            if (!await UserRoleResolver.IsInRoleAsync(db, principal, UserRoles.Admin))
            {
                var actorProfile = await db.RoleProfiles.AsNoTracking().FirstOrDefaultAsync(item => item.Role == actor.Role);
                if (actorProfile is null || !actorProfile.CanChangeOtherUserPasswords)
                {
                    return Results.Forbid();
                }
            }

            var user = await db.Users.FindAsync(id);
            if (user is null)
            {
                return Results.NotFound();
            }

            user.PasswordHash = PasswordHasher.Hash(request.Password);
            AuditLogWriter.Add(db, principal, "Смена пароля", "User", user.Id.ToString(), user.UserName);
            await db.SaveChangesAsync();

            return Results.NoContent();
        }).RequireAuthorization();

        app.MapGet("/api/admin/users/{id:guid}/telegram", async (
            Guid id,
            AppDbContext db,
            TelegramNotificationService telegram,
            ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.IntegrationsTelegramNotifications))
            {
                return Results.Forbid();
            }

            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(item => item.Id == id);
            if (user is null)
            {
                return Results.NotFound();
            }

            return Results.Ok(new AdminUserTelegramResponse(
                !string.IsNullOrWhiteSpace(user.TelegramChatId),
                AppPublicText.MaskSecret(user.TelegramChatId),
                user.TelegramConnectedAt,
                TelegramNotificationEvents.Parse(user.TelegramNotifyEvents).ToList(),
                TelegramNotificationEvents.ForShopRegion(TelegramNotificationEvents.ShopRegionRf)
                    .Select(definition => definition.Id)
                    .ToList(),
                TelegramNotificationEvents.Parse(user.TelegramNotifyEventsKz).ToList(),
                TelegramNotificationEvents.ForShopRegion(TelegramNotificationEvents.ShopRegionKz)
                    .Select(definition => definition.Id)
                    .ToList(),
                FeatureAccess.AllowsTelegramConnect(user)));
        }).RequireAuthorization();

        app.MapPut("/api/admin/users/{id:guid}/telegram/preferences", async (
            Guid id,
            UpdateTelegramPreferencesRequest request,
            AppDbContext db,
            ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.IntegrationsTelegramNotificationsEdit))
            {
                return Results.Forbid();
            }

            var user = await db.Users.FirstOrDefaultAsync(item => item.Id == id);
            if (user is null)
            {
                return Results.NotFound();
            }

            if (string.IsNullOrWhiteSpace(user.TelegramChatId))
            {
                return Results.BadRequest("Telegram у пользователя не подключён.");
            }

            var shopRegion = TelegramNotificationEvents.NormalizeShopRegion(request.ShopRegion);
            if (shopRegion == TelegramNotificationEvents.ShopRegionKz)
            {
                user.TelegramNotifyEventsKz = TelegramNotificationEvents.Serialize(request.Events ?? []);
            }
            else
            {
                user.TelegramNotifyEvents = TelegramNotificationEvents.Serialize(request.Events ?? []);
            }

            AuditLogWriter.Add(db, principal, "Telegram-оповещения", "User", user.Id.ToString(), user.UserName);
            await db.SaveChangesAsync();

            return Results.Ok(new AdminUserTelegramResponse(
                true,
                AppPublicText.MaskSecret(user.TelegramChatId),
                user.TelegramConnectedAt,
                TelegramNotificationEvents.Parse(user.TelegramNotifyEvents).ToList(),
                TelegramNotificationEvents.ForShopRegion(TelegramNotificationEvents.ShopRegionRf)
                    .Select(definition => definition.Id)
                    .ToList(),
                TelegramNotificationEvents.Parse(user.TelegramNotifyEventsKz).ToList(),
                TelegramNotificationEvents.ForShopRegion(TelegramNotificationEvents.ShopRegionKz)
                    .Select(definition => definition.Id)
                    .ToList(),
                FeatureAccess.AllowsTelegramConnect(user)));
        }).RequireAuthorization();

        app.MapGet("/api/admin/users/{id:guid}/telegram/report", async (
            Guid id,
            AppDbContext db,
            ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.IntegrationsTelegramReports))
            {
                return Results.Forbid();
            }

            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(item => item.Id == id);
            if (user is null)
            {
                return Results.NotFound();
            }

            return Results.Ok(new AdminUserReportResponse(
                user.TelegramDailyReportEnabled,
                user.TelegramDailyReportTime,
                user.TelegramDailyReportTimezone,
                TelegramReportSections.Parse(user.TelegramDailyReportSections).ToList(),
                TelegramReportSections.All.Select(section => section.Id).ToList(),
                user.TelegramDailyReportLastSentOn,
                user.TelegramMonthlyReportEnabled,
                user.TelegramMonthlyReportTime,
                user.TelegramMonthlyReportTimezone,
                TelegramReportSections.Parse(user.TelegramMonthlyReportSections).ToList(),
                user.TelegramMonthlyReportLastSentOn,
                !string.IsNullOrWhiteSpace(user.TelegramChatId)));
        }).RequireAuthorization();

        app.MapPut("/api/admin/users/{id:guid}/telegram/report", async (
            Guid id,
            UpdateAdminUserReportRequest request,
            AppDbContext db,
            ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.IntegrationsTelegramReportsEdit))
            {
                return Results.Forbid();
            }

            var user = await db.Users.FirstOrDefaultAsync(item => item.Id == id);
            if (user is null)
            {
                return Results.NotFound();
            }

            user.TelegramDailyReportEnabled = request.Enabled;
            user.TelegramDailyReportTime = DailyReportService.TryParseReportTime(request.ReportTime, out var parsedTime)
                ? parsedTime.ToString("HH:mm")
                : user.TelegramDailyReportTime;
            user.TelegramDailyReportTimezone = string.IsNullOrWhiteSpace(request.Timezone)
                ? user.TelegramDailyReportTimezone
                : request.Timezone.Trim();
            user.TelegramDailyReportSections = TelegramReportSections.Serialize(request.Sections ?? []);
            user.TelegramMonthlyReportEnabled = request.MonthlyEnabled;
            user.TelegramMonthlyReportTime = DailyReportService.TryParseReportTime(request.MonthlyReportTime, out var parsedMonthlyTime)
                ? parsedMonthlyTime.ToString("HH:mm")
                : user.TelegramMonthlyReportTime;
            user.TelegramMonthlyReportTimezone = string.IsNullOrWhiteSpace(request.MonthlyTimezone)
                ? user.TelegramMonthlyReportTimezone
                : request.MonthlyTimezone.Trim();
            user.TelegramMonthlyReportSections = TelegramReportSections.Serialize(request.MonthlySections ?? []);

            AuditLogWriter.Add(db, principal, "Настройка Telegram-отчёта", "User", user.Id.ToString(), user.UserName);
            await db.SaveChangesAsync();

            return Results.Ok(new AdminUserReportResponse(
                user.TelegramDailyReportEnabled,
                user.TelegramDailyReportTime,
                user.TelegramDailyReportTimezone,
                TelegramReportSections.Parse(user.TelegramDailyReportSections).ToList(),
                TelegramReportSections.All.Select(section => section.Id).ToList(),
                user.TelegramDailyReportLastSentOn,
                user.TelegramMonthlyReportEnabled,
                user.TelegramMonthlyReportTime,
                user.TelegramMonthlyReportTimezone,
                TelegramReportSections.Parse(user.TelegramMonthlyReportSections).ToList(),
                user.TelegramMonthlyReportLastSentOn,
                !string.IsNullOrWhiteSpace(user.TelegramChatId)));
        }).RequireAuthorization();

        app.MapPost("/api/admin/users/{id:guid}/telegram/report/test", async (
            Guid id,
            AppDbContext db,
            DailyReportService reportService,
            TelegramNotificationService telegram,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.IntegrationsTelegramReportsEdit))
            {
                return Results.Forbid();
            }

            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
            if (user is null)
            {
                return Results.NotFound();
            }

            if (string.IsNullOrWhiteSpace(user.TelegramChatId))
            {
                return Results.BadRequest("Telegram у пользователя не подключён.");
            }

            var timezone = DailyReportService.ResolveTimeZone(user.TelegramDailyReportTimezone);
            var localDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, timezone).DateTime);
            var message = await reportService.BuildReportAsync(user, localDate, cancellationToken);
            var sent = await telegram.SendMessageAsync(user.TelegramChatId, message, cancellationToken);

            return sent
                ? Results.Ok(new { message = "Тестовый отчёт отправлен." })
                : Results.BadRequest("Не удалось отправить отчёт.");
        }).RequireAuthorization();

        app.MapPost("/api/admin/users/{id:guid}/telegram/report/test-monthly", async (
            Guid id,
            AppDbContext db,
            DailyReportService reportService,
            TelegramNotificationService telegram,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.IntegrationsTelegramReportsEdit))
            {
                return Results.Forbid();
            }

            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
            if (user is null)
            {
                return Results.NotFound();
            }

            if (string.IsNullOrWhiteSpace(user.TelegramChatId))
            {
                return Results.BadRequest("Telegram у пользователя не подключён.");
            }

            var timezone = DailyReportService.ResolveTimeZone(user.TelegramMonthlyReportTimezone);
            var localDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, timezone).DateTime);
            var message = await reportService.BuildMonthlyReportAsync(user, localDate, cancellationToken);
            var sent = await telegram.SendMessageAsync(user.TelegramChatId, message, cancellationToken);

            return sent
                ? Results.Ok(new { message = "Тестовый ежемесячный отчёт отправлен." })
                : Results.BadRequest("Не удалось отправить отчёт.");
        }).RequireAuthorization();

        app.MapDelete("/api/admin/users/{id:guid}", async (Guid id, AppDbContext db, ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.UsersEdit))
            {
                return Results.Forbid();
            }

            var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
            if (currentUserId == id.ToString())
            {
                return Results.BadRequest("Нельзя удалить самого себя.");
            }

            if (id == SystemUser.Id)
            {
                return Results.BadRequest("Системного пользователя нельзя удалить.");
            }

            var user = await db.Users.FindAsync(id);
            if (user is null)
            {
                return Results.NotFound();
            }

            db.Users.Remove(user);
            AuditLogWriter.Add(db, principal, "Удаление пользователя", "User", user.Id.ToString(), user.UserName);
            await db.SaveChangesAsync();

            return Results.NoContent();
        }).RequireAuthorization();

        app.MapGet("/api/admin/audit-logs", async (HttpRequest request, AppDbContext db) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, request.HttpContext.User, FeatureAccess.Settings))
            {
                return Results.Forbid();
            }

            var search = request.Query["search"].ToString();
            var action = request.Query["action"].ToString();
            var entityType = request.Query["entityType"].ToString();
            var dateFrom = request.Query["dateFrom"].ToString();
            var dateTo = request.Query["dateTo"].ToString();
            var userId = request.Query["userId"].ToString();

            var auditQuery = AuditLogQueries.ApplyFilters(
                db.AuditLogs.AsNoTracking(),
                string.IsNullOrWhiteSpace(search) ? null : search,
                string.IsNullOrWhiteSpace(action) ? null : action,
                string.IsNullOrWhiteSpace(entityType) ? null : entityType,
                string.IsNullOrWhiteSpace(dateFrom) ? null : dateFrom,
                string.IsNullOrWhiteSpace(dateTo) ? null : dateTo,
                string.IsNullOrWhiteSpace(userId) ? null : userId);

            return Results.Ok(await auditQuery
                .OrderByDescending(log => log.CreatedAt)
                .Take(300)
                .Select(log => new AuditLogListItem(
                    log.Id,
                    log.UserName,
                    log.DisplayName,
                    log.Action,
                    log.EntityType,
                    log.EntityId,
                    log.Details,
                    log.CreatedAt))
                .ToListAsync());
        }).RequireAuthorization();

        app.MapGet("/api/admin/audit-logs/export", async (HttpRequest request, AppDbContext db) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, request.HttpContext.User, FeatureAccess.Settings))
            {
                return Results.Forbid();
            }

            var search = request.Query["search"].ToString();
            var action = request.Query["action"].ToString();
            var entityType = request.Query["entityType"].ToString();
            var dateFrom = request.Query["dateFrom"].ToString();
            var dateTo = request.Query["dateTo"].ToString();
            var userId = request.Query["userId"].ToString();

            var logs = await AuditLogQueries.ApplyFilters(
                    db.AuditLogs.AsNoTracking(),
                    string.IsNullOrWhiteSpace(search) ? null : search,
                    string.IsNullOrWhiteSpace(action) ? null : action,
                    string.IsNullOrWhiteSpace(entityType) ? null : entityType,
                    string.IsNullOrWhiteSpace(dateFrom) ? null : dateFrom,
                    string.IsNullOrWhiteSpace(dateTo) ? null : dateTo,
                    string.IsNullOrWhiteSpace(userId) ? null : userId)
                .OrderByDescending(log => log.CreatedAt)
                .Take(10000)
                .ToListAsync();

            var rows = new List<string[]>
            {
                new[] { "Дата", "Пользователь", "Имя", "Действие", "Объект", "ID", "Детали" }
            };
            rows.AddRange(logs.Select(log => new[]
            {
                log.CreatedAt.ToString("yyyy-MM-dd HH:mm:ss"),
                log.UserName,
                log.DisplayName,
                log.Action,
                log.EntityType,
                log.EntityId,
                log.Details
            }));

            var bytes = ExcelExport.CreateWorkbook("Журнал действий", rows);
            return Results.File(
                bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                $"audit-log-{DateTime.UtcNow:yyyyMMdd-HHmmss}.xlsx");
        }).RequireAuthorization();

        app.MapGet("/api/admin/report-sections", () =>
            Results.Ok(TelegramReportSections.All.Select(section => new
            {
                section.Id,
                section.Group,
                section.Label
            })))
            .RequireAuthorization();

        app.MapGet("/api/admin/system-health", async (AppDbContext db, ClaimsPrincipal principal, IOptions<AdminOptions> adminOptions) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Settings))
            {
                return Results.Forbid();
            }

            var process = Process.GetCurrentProcess();
            var dbOk = await db.Database.CanConnectAsync();

            var admin = adminOptions.Value;
            var adminerBaseUrl = admin.PublicAdminerUrl?.Trim();
            string? adminerUrl = null;
            if (!string.IsNullOrWhiteSpace(adminerBaseUrl))
            {
                adminerUrl = $"{adminerBaseUrl.TrimEnd('/')}/?pgsql=postgres&username={Uri.EscapeDataString(admin.PostgresUser)}&db={Uri.EscapeDataString(admin.PostgresDatabase)}";
            }

            return Results.Ok(new SystemHealthResponse(
                dbOk,
                DateTimeOffset.UtcNow,
                (DateTimeOffset.UtcNow - process.StartTime.ToUniversalTime()).ToString(),
                Environment.MachineName,
                Environment.Version.ToString(),
                adminerUrl));
        }).RequireAuthorization();

        app.MapGet("/api/admin/backups", async (IWebHostEnvironment environment, AppDbContext db, ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Settings))
            {
                return Results.Forbid();
            }

            var backupDirectory = AppPaths.GetBackupDirectory(environment);
            if (!Directory.Exists(backupDirectory))
            {
                return Results.Ok(Array.Empty<BackupFileResponse>());
            }

            var files = Directory
                .EnumerateFiles(backupDirectory, "*.sql.gz", SearchOption.TopDirectoryOnly)
                .Select(path =>
                {
                    var info = new FileInfo(path);
                    return new BackupFileResponse(
                        info.Name,
                        info.Length,
                        info.LastWriteTimeUtc);
                })
                .OrderByDescending(file => file.CreatedAt)
                .Take(30)
                .ToList();

            return Results.Ok(files);
        }).RequireAuthorization();

        app.MapGet("/api/admin/backups/{fileName}", async (string fileName, IWebHostEnvironment environment, AppDbContext db, ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Settings))
            {
                return Results.Forbid();
            }

            if (fileName != Path.GetFileName(fileName)
                || !fileName.EndsWith(".sql.gz", StringComparison.OrdinalIgnoreCase))
            {
                return Results.BadRequest("Некорректное имя файла.");
            }

            var backupDirectory = AppPaths.GetBackupDirectory(environment);
            var fullPath = Path.GetFullPath(Path.Combine(backupDirectory, fileName));
            if (!fullPath.StartsWith(Path.GetFullPath(backupDirectory), StringComparison.OrdinalIgnoreCase)
                || !System.IO.File.Exists(fullPath))
            {
                return Results.NotFound();
            }

            return Results.File(fullPath, "application/gzip", fileName);
        }).RequireAuthorization();

        app.MapGet("/api/admin/ozon-status", async (
            OzonApiClient ozonApi,
            Microsoft.Extensions.Options.IOptions<OzonOptions> options,
            CancellationToken cancellationToken) =>
        {
            var value = options.Value;
            var configured = !string.IsNullOrWhiteSpace(value.ClientId)
                && !string.IsNullOrWhiteSpace(value.ApiKey);

            if (!configured)
            {
                return Results.Ok(new OzonIntegrationStatusResponse(
                    false,
                    false,
                    "Ozon ClientId или ApiKey не заданы в .env",
                    value.BaseUrl,
                    AppPublicText.MaskSecret(value.ClientId),
                    AppPublicText.MaskSecret(value.ApiKey),
                    DateTimeOffset.UtcNow));
            }

            try
            {
                var result = await ozonApi.GetProductListAsync(1, cancellationToken);
                return Results.Ok(new OzonIntegrationStatusResponse(
                    true,
                    true,
                    $"Ozon API отвечает. Найдено товаров: {result.Total}",
                    value.BaseUrl,
                    AppPublicText.MaskSecret(value.ClientId),
                    AppPublicText.MaskSecret(value.ApiKey),
                    DateTimeOffset.UtcNow));
            }
            catch (Exception exception)
            {
                return Results.Ok(new OzonIntegrationStatusResponse(
                    true,
                    false,
                    AppPublicText.GetPublicOzonError(exception),
                    value.BaseUrl,
                    AppPublicText.MaskSecret(value.ClientId),
                    AppPublicText.MaskSecret(value.ApiKey),
                    DateTimeOffset.UtcNow));
            }
        }).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));
    }
}

public record AccountingExportRequest(string? SheetName, string? FileName, List<List<string?>>? Rows);

public record AccountingTelegramSendRequest(string? SheetName, string? FileName, List<List<string?>>? Rows, string? ReportType);

