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
using LShopOzonWebReact.Api.Contracts.Supplies;
using LShopOzonWebReact.Api.Hubs;
using LShopOzonWebReact.Api.Supplies;
using System.Globalization;
using System.IO.Compression;
using System.Xml.Linq;

namespace LShopOzonWebReact.Api.Endpoints;

public static class SuppliesEndpoints
{
    public static void MapSuppliesEndpoints(this WebApplication app)
    {
        app.MapGet("/api/supplies", async (AppDbContext db, ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Supplies))
            {
                return Results.Forbid();
            }

            var supplies = await db.Supplies
                .AsNoTracking()
                .Include(supply => supply.Items)
                .OrderByDescending(supply => supply.CreatedAt)
                .ToListAsync();

            var staleReserveItems = await db.SupplyItems
                .Where(item => item.IsReserve && item.OfferId == string.Empty)
                .ToListAsync();
            if (staleReserveItems.Count > 0)
            {
                foreach (var item in staleReserveItems)
                {
                    item.OfferId = ProductionTaskResponses.BuildNovinkaOfferId(item.Id);
                }

                await db.SaveChangesAsync();
                supplies = await db.Supplies
                    .AsNoTracking()
                    .Include(supply => supply.Items)
                    .OrderByDescending(supply => supply.CreatedAt)
                    .ToListAsync();
            }

            var supplyIds = supplies.Select(supply => supply.Id.ToString()).ToList();
            var histories = await db.AuditLogs
                .AsNoTracking()
                .Where(log => log.EntityType == "Supply" && supplyIds.Contains(log.EntityId))
                .OrderByDescending(log => log.CreatedAt)
                .Select(log => new
                {
                    log.EntityId,
                    Item = new SupplyHistoryItem(
                        log.Id,
                        log.UserName,
                        log.DisplayName,
                        log.Action,
                        log.Details,
                        log.CreatedAt)
                })
                .ToListAsync();

            var historiesBySupplyId = histories
                .GroupBy(log => log.EntityId)
                .ToDictionary(group => group.Key, group => group.Select(log => log.Item).ToList());

            return Results.Ok(supplies
                .Select(supply => new SupplyListItem(
                    supply.Id,
                    supply.Status,
                    supply.CreatedAt,
                    supply.SentAt,
                    supply.AcceptedAt,
                    supply.ShippingCost,
                    supply.IsArchived,
                    supply.ArchivedAt,
                    supply.Items
                        .OrderBy(item => item.ProductName)
                        .Select(item => new SupplyItemListItem(
                            item.Id,
                            item.OzonProductId,
                            item.OfferId,
                            item.ProductName,
                            item.Quantity,
                            item.IsReserve,
                            item.ItemKind))
                        .ToList(),
                    historiesBySupplyId.GetValueOrDefault(supply.Id.ToString()) ?? []))
                .ToList());
        }).RequireAuthorization();

        app.MapPost("/api/supplies", async (
            CreateSupplyRequest request,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub,
            TelegramNotificationService telegram) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Supplies))
            {
                return Results.Forbid();
            }

            if (request.Items.Count == 0)
            {
                return Results.BadRequest("Добавьте хотя бы один товар в поставку.");
            }

            var supply = new Supply
            {
                Status = SupplyStatuses.Created,
                Items = request.Items.Select(SupplyItemFactory.Create).ToList()
            };

            if (supply.Items.Any(item => item.Quantity <= 0 || string.IsNullOrWhiteSpace(item.ProductName)))
            {
                return Results.BadRequest("Укажите название и количество больше нуля для каждой строки.");
            }

            db.Supplies.Add(supply);
            await LinkPackedProductionItemsToSupplyAsync(db, supply);
            AuditLogWriter.Add(db, principal, "Создание поставки", "Supply", supply.Id.ToString(), $"Товаров: {supply.Items.Count}");
            await db.SaveChangesAsync();
            await hub.Clients.All.SendAsync("SuppliesChanged");
            await hub.Clients.All.SendAsync("ProductionTasksChanged");
            await IntegrationNotificationPublisher.PublishAsync(
                telegram,
                db,
                "supply.created",
                $"Создана поставка: {supply.Items.Count} поз.");

            return Results.Created($"/api/supplies/{supply.Id}", new SupplyListItem(
                supply.Id,
                supply.Status,
                supply.CreatedAt,
                supply.SentAt,
                supply.AcceptedAt,
                supply.ShippingCost,
                supply.IsArchived,
                supply.ArchivedAt,
                supply.Items.Select(item => new SupplyItemListItem(
                    item.Id,
                    item.OzonProductId,
                    item.OfferId,
                    item.ProductName,
                    item.Quantity,
                    item.IsReserve,
                    item.ItemKind)).ToList(),
                []));
        }).RequireAuthorization();

        app.MapGet("/api/supplies/import-template", () =>
        {
            var content = ExcelSupplyImport.CreateTemplate();
            return Results.File(
                content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "supply-template.xlsx");
        }).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

        app.MapPost("/api/supplies/import", async (
            HttpRequest request,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub,
            TelegramNotificationService telegram,
            CancellationToken cancellationToken) =>
        {
            if (!request.HasFormContentType)
            {
                return Results.BadRequest("Ожидается multipart/form-data.");
            }

            var form = await request.ReadFormAsync(cancellationToken);
            var file = form.Files.GetFile("file");
            if (file is null || file.Length == 0)
            {
                return Results.BadRequest("Выберите Excel-файл.");
            }

            await using var stream = file.OpenReadStream();
            List<CreateSupplyItemRequest> importedItems;
            try
            {
                importedItems = ExcelSupplyImport.ReadSupplyItems(stream);
            }
            catch (InvalidOperationException exception)
            {
                return Results.BadRequest(exception.Message);
            }

            if (importedItems.Count == 0)
            {
                return Results.BadRequest("В файле нет строк для импорта.");
            }

            var supply = new Supply
            {
                Status = SupplyStatuses.Created,
                Items = importedItems.Select(SupplyItemFactory.Create).ToList()
            };

            if (supply.Items.Any(item => item.Quantity <= 0 || string.IsNullOrWhiteSpace(item.ProductName)))
            {
                return Results.BadRequest("Проверьте название и количество в Excel-файле.");
            }

            db.Supplies.Add(supply);
            await LinkPackedProductionItemsToSupplyAsync(db, supply);
            AuditLogWriter.Add(db, principal, "Импорт поставки из Excel", "Supply", supply.Id.ToString(), $"Товаров: {supply.Items.Count}");
            await db.SaveChangesAsync(cancellationToken);
            await hub.Clients.All.SendAsync("SuppliesChanged");
            await hub.Clients.All.SendAsync("ProductionTasksChanged", cancellationToken);

            await IntegrationNotificationPublisher.PublishAsync(
                telegram,
                db,
                "supply.imported",
                $"Импортирована поставка из Excel: {supply.Items.Count} поз.");

            return Results.Ok(new { supply.Id, Items = supply.Items.Count });
        }).DisableAntiforgery().RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

        app.MapPut("/api/supplies/{id:guid}/status", async (
            Guid id,
            ChangeSupplyStatusRequest request,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub,
            TelegramNotificationService telegram) =>
        {
            var supply = await db.Supplies
                .Include(item => item.Items)
                .SingleOrDefaultAsync(item => item.Id == id);
            if (supply is null)
            {
                return Results.NotFound();
            }

            if (supply.IsArchived)
            {
                return Results.BadRequest("Архивную поставку нельзя менять.");
            }

            var now = DateTimeOffset.UtcNow;
            if (request.Status == SupplyStatuses.Sent)
            {
                if (supply.Status != SupplyStatuses.Created)
                {
                    return Results.BadRequest("Отправить можно только поставку в статусе создано.");
                }

                if (request.ShippingCost is null || request.ShippingCost <= 0)
                {
                    return Results.BadRequest("Укажите сумму отправки поставки.");
                }

                supply.Status = SupplyStatuses.Sent;
                supply.SentAt ??= now;
                supply.ShippingCost = decimal.Round(request.ShippingCost.Value, 2);
                await LinkPackedProductionItemsToSupplyAsync(db, supply);
                await ArchiveCompletedPackedTasksForSentSupplyAsync(db, principal, supply);
            }
            else if (request.Status == SupplyStatuses.Accepted)
            {
                if (!await UserRoleResolver.IsInRoleAsync(db, principal, UserRoles.Admin))
                {
                    return Results.Forbid();
                }

                supply.Status = SupplyStatuses.Accepted;
                supply.AcceptedAt ??= now;
            }
            else
            {
                return Results.BadRequest("Можно поставить только статус отправлено или принято.");
            }

            AuditLogWriter.Add(db, principal, $"Статус поставки: {request.Status}", "Supply", supply.Id.ToString(), supply.Status);
            await db.SaveChangesAsync();
            await hub.Clients.All.SendAsync("SuppliesChanged");
            await hub.Clients.All.SendAsync("ProductionTasksChanged");

            var statusEventId = request.Status == SupplyStatuses.Sent
                ? "supply.sent"
                : "supply.accepted";
            var statusLabel = request.Status == SupplyStatuses.Sent ? "отправлена" : "принята";
            await IntegrationNotificationPublisher.PublishAsync(
                telegram,
                db,
                statusEventId,
                $"Поставка {statusLabel}: {supply.Id.ToString()[..8]}…");

            return Results.NoContent();
        }).RequireAuthorization();

        app.MapPatch("/api/supplies/{id:guid}/dates", async (
            Guid id,
            UpdateSupplyDatesRequest request,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub) =>
        {
            if (!await UserRoleResolver.IsInRoleAsync(db, principal, UserRoles.Admin))
            {
                return Results.Forbid();
            }

            var supply = await db.Supplies.FindAsync(id);
            if (supply is null)
            {
                return Results.NotFound();
            }

            if (supply.IsArchived)
            {
                return Results.BadRequest("Архивную поставку нельзя менять.");
            }

            supply.SentAt = request.SentAt;
            supply.AcceptedAt = request.AcceptedAt;
            supply.ShippingCost = request.ShippingCost is { } shippingCost && shippingCost > 0
                ? decimal.Round(shippingCost, 2)
                : null;
            AuditLogWriter.Add(
                db,
                principal,
                "Изменение дат поставки",
                "Supply",
                supply.Id.ToString(),
                $"Отправка: {request.SentAt?.ToString("O") ?? "-"}, приемка: {request.AcceptedAt?.ToString("O") ?? "-"}, сумма отправки: {supply.ShippingCost?.ToString("0.##") ?? "-"}");
            await db.SaveChangesAsync();
            await hub.Clients.All.SendAsync("SuppliesChanged");

            return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

        app.MapPut("/api/supplies/{id:guid}", async (
            Guid id,
            UpdateSupplyRequest request,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub,
            TelegramNotificationService telegram) =>
        {
            var supply = await db.Supplies
                .Include(item => item.Items)
                .SingleOrDefaultAsync(item => item.Id == id);
            if (supply is null)
            {
                return Results.NotFound();
            }

            if (supply.IsArchived)
            {
                return Results.BadRequest("Архивную поставку нельзя редактировать.");
            }

            var isAdmin = await UserRoleResolver.IsInRoleAsync(db, principal, UserRoles.Admin);
            if (!isAdmin && supply.Status != SupplyStatuses.Created)
            {
                return Results.Forbid();
            }

            if (request.Items.Count == 0)
            {
                return Results.BadRequest("В поставке должен быть хотя бы один товар.");
            }

            var updatedItems = request.Items.Select(item => SupplyItemFactory.Create(item)).ToList();
            foreach (var item in updatedItems)
            {
                item.SupplyId = supply.Id;
            }

            if (updatedItems.Any(item => item.Quantity <= 0 || string.IsNullOrWhiteSpace(item.ProductName)))
            {
                return Results.BadRequest("Укажите название и количество больше нуля для каждой строки.");
            }

            await ClearPackedProductionItemsFromSupplyAsync(db, supply.Id);
            db.SupplyItems.RemoveRange(supply.Items);
            db.SupplyItems.AddRange(updatedItems);
            supply.Items = updatedItems;
            supply.ShippingCost = request.ShippingCost is { } shippingCost && shippingCost > 0
                ? decimal.Round(shippingCost, 2)
                : null;
            await LinkPackedProductionItemsToSupplyAsync(db, supply);
            AuditLogWriter.Add(
                db,
                principal,
                "Редактирование поставки",
                "Supply",
                supply.Id.ToString(),
                $"Товаров: {updatedItems.Count}, сумма отправки: {supply.ShippingCost?.ToString("0.##") ?? "-"}");
            await db.SaveChangesAsync();
            await hub.Clients.All.SendAsync("SuppliesChanged");
            await hub.Clients.All.SendAsync("ProductionTasksChanged");

            await IntegrationNotificationPublisher.PublishAsync(
                telegram,
                db,
                "supply.updated",
                $"Поставка изменена: {updatedItems.Count} поз.");

            return Results.NoContent();
        }).RequireAuthorization();

        app.MapPut("/api/supplies/{id:guid}/archive", async (
            Guid id,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub,
            TelegramNotificationService telegram) =>
        {
            var supply = await db.Supplies.FindAsync(id);
            if (supply is null)
            {
                return Results.NotFound();
            }

            supply.IsArchived = true;
            supply.ArchivedAt = DateTimeOffset.UtcNow;
            AuditLogWriter.Add(db, principal, "Поставка архивирована", "Supply", supply.Id.ToString(), supply.Status);
            await db.SaveChangesAsync();
            await hub.Clients.All.SendAsync("SuppliesChanged");

            await IntegrationNotificationPublisher.PublishAsync(
                telegram,
                db,
                "supply.archived",
                $"Поставка отправлена в архив: {supply.Status}");

            return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

        app.MapDelete("/api/supplies/{id:guid}", async (Guid id, AppDbContext db, ClaimsPrincipal principal) =>
        {
            var supply = await db.Supplies.FindAsync(id);
            if (supply is null)
            {
                return Results.NotFound();
            }

            if (!supply.IsArchived)
            {
                return Results.BadRequest("Удалить поставку можно только из архива.");
            }

            db.Supplies.Remove(supply);
            AuditLogWriter.Add(db, principal, "Удаление поставки", "Supply", supply.Id.ToString(), supply.Status);
            await db.SaveChangesAsync();

            return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

        app.MapPut("/api/supplies/items/{id:guid}/replace-reserve", async (
            Guid id,
            ReplaceReserveSupplyItemRequest request,
            AppDbContext db,
            ClaimsPrincipal principal) =>
        {
            var item = await db.SupplyItems.FindAsync(id);
            if (item is null)
            {
                return Results.NotFound();
            }

            if (!item.IsReserve)
            {
                return Results.BadRequest("Эта строка уже привязана к постоянному товару.");
            }

            if (request.OzonProductId <= 0 || string.IsNullOrWhiteSpace(request.ProductName))
            {
                return Results.BadRequest("Выберите постоянный товар.");
            }

            item.OzonProductId = request.OzonProductId;
            item.OfferId = request.OfferId.Trim();
            item.ProductName = request.ProductName.Trim();
            item.IsReserve = false;
            AuditLogWriter.Add(db, principal, "Замена нового товара", "SupplyItem", item.Id.ToString(), item.ProductName);
            AuditLogWriter.Add(db, principal, "Замена нового товара", "Supply", item.SupplyId.ToString(), item.ProductName);
            await db.SaveChangesAsync();

            return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

        app.MapGet("/api/supplies/analytics", async (AppDbContext db, ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Supplies))
            {
                return Results.Forbid();
            }

            var items = await db.SupplyItems
                .AsNoTracking()
                .Include(item => item.Supply)
                .ToListAsync();

            return Results.Ok(items
                .GroupBy(item => new
                {
                    item.SupplyId,
                    ProductKey = item.OzonProductId.HasValue
                        ? item.OzonProductId.Value.ToString()
                        : item.OfferId != string.Empty
                            ? item.OfferId
                            : item.ProductName.ToLower(),
                    item.OzonProductId,
                    item.OfferId,
                    item.ProductName,
                    item.IsReserve,
                    item.ItemKind,
                    item.Supply.Status,
                    item.Supply.IsArchived,
                    item.Supply.ArchivedAt,
                    item.Supply.CreatedAt,
                    item.Supply.SentAt,
                    item.Supply.AcceptedAt,
                    item.Supply.ShippingCost
                })
                .OrderByDescending(group => group.Key.CreatedAt)
                .Select(group => new SupplyAnalyticsItem(
                    group.Min(item => item.Id),
                    group.Key.SupplyId,
                    group.Key.OzonProductId,
                    group.Key.OfferId,
                    group.Key.ProductName,
                    group.Sum(item => item.Quantity),
                    group.Key.IsReserve,
                    group.Key.ItemKind,
                    group.Key.Status,
                    group.Key.IsArchived,
                    group.Key.ArchivedAt,
                    group.Key.CreatedAt,
                    group.Key.SentAt,
                    group.Key.AcceptedAt,
                    group.Key.ShippingCost))
                .ToList());
        })
            .RequireAuthorization();

        app.MapGet("/api/supplies/expenses", async (
            string? search,
            string? from,
            string? to,
            AppDbContext db,
            ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Supplies))
            {
                return Results.Forbid();
            }

            var query = db.SupplyExpenses
                .AsNoTracking()
                .Include(expense => expense.CreatedByUser)
                .AsQueryable();

            if (!string.IsNullOrWhiteSpace(search))
            {
                var normalizedSearch = search.Trim().ToLower();
                query = query.Where(expense => expense.Name.ToLower().Contains(normalizedSearch));
            }

            var fromDate = ParseSupplyExpenseBoundary(from, false);
            if (fromDate is not null)
            {
                query = query.Where(expense => expense.PurchasedAt >= fromDate.Value);
            }

            var toDate = ParseSupplyExpenseBoundary(to, true);
            if (toDate is not null)
            {
                query = query.Where(expense => expense.PurchasedAt <= toDate.Value);
            }

            var expenses = await query
                .OrderByDescending(expense => expense.PurchasedAt)
                .ThenByDescending(expense => expense.CreatedAt)
                .ToListAsync();
            var rows = expenses.Select(MapSupplyExpense).ToList();

            return Results.Ok(new SupplyExpensesResponse(rows, rows.Sum(row => row.Amount)));
        })
            .RequireAuthorization();

        app.MapPost("/api/supplies/expenses", async (
            CreateSupplyExpenseRequest request,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Supplies))
            {
                return Results.Forbid();
            }

            var name = request.Name.Trim();
            if (string.IsNullOrWhiteSpace(name))
            {
                return Results.BadRequest("Укажите что купили.");
            }

            if (request.Amount <= 0)
            {
                return Results.BadRequest("Укажите сумму покупки больше 0.");
            }

            var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
            if (!Guid.TryParse(currentUserId, out var userId))
            {
                return Results.Forbid();
            }

            var expense = new SupplyExpense
            {
                Name = name,
                Amount = request.Amount,
                PurchasedAt = request.PurchasedAt,
                CreatedByUserId = userId
            };

            db.SupplyExpenses.Add(expense);
            AuditLogWriter.Add(
                db,
                principal,
                "Добавлен расходник",
                "SupplyExpense",
                expense.Id.ToString(),
                $"{name}: {request.Amount:0.##}");
            await db.SaveChangesAsync();
            await db.Entry(expense).Reference(item => item.CreatedByUser).LoadAsync();
            await hub.Clients.All.SendAsync("SuppliesChanged");

            return Results.Ok(MapSupplyExpense(expense));
        })
            .RequireAuthorization();

        app.MapPut("/api/supplies/expenses/{id:guid}", async (
            Guid id,
            UpdateSupplyExpenseRequest request,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Supplies))
            {
                return Results.Forbid();
            }

            if (request.Amount <= 0)
            {
                return Results.BadRequest("Укажите сумму покупки больше 0.");
            }

            var expense = await db.SupplyExpenses
                .Include(item => item.CreatedByUser)
                .FirstOrDefaultAsync(item => item.Id == id);
            if (expense is null)
            {
                return Results.NotFound();
            }

            expense.Amount = request.Amount;
            expense.PurchasedAt = request.PurchasedAt;

            AuditLogWriter.Add(
                db,
                principal,
                "Обновлен расходник",
                "SupplyExpense",
                expense.Id.ToString(),
                $"{expense.Name}: {request.Amount:0.##}");

            await db.SaveChangesAsync();
            await hub.Clients.All.SendAsync("SuppliesChanged");

            return Results.Ok(MapSupplyExpense(expense));
        })
            .RequireAuthorization();

        app.MapDelete("/api/supplies/expenses/{id:guid}", async (
            Guid id,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Supplies))
            {
                return Results.Forbid();
            }

            var expense = await db.SupplyExpenses.FirstOrDefaultAsync(item => item.Id == id);
            if (expense is null)
            {
                return Results.NotFound();
            }

            db.SupplyExpenses.Remove(expense);
            AuditLogWriter.Add(
                db,
                principal,
                "Удален расходник",
                "SupplyExpense",
                expense.Id.ToString(),
                $"{expense.Name}: {expense.Amount:0.##}");

            await db.SaveChangesAsync();
            await hub.Clients.All.SendAsync("SuppliesChanged");

            return Results.NoContent();
        })
            .RequireAuthorization();

        app.MapGet("/api/supplies/fbo-defects", async (AppDbContext db, ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Supplies))
            {
                return Results.Forbid();
            }

            var defects = await db.SupplyFboDefects
                .AsNoTracking()
                .OrderByDescending(defect => defect.CreatedAt)
                .Select(defect => new SupplyFboDefectItem(
                    defect.Id,
                    defect.ProductKey,
                    defect.OfferId,
                    defect.ProductName,
                    defect.Quantity,
                    defect.CreatedAt))
                .ToListAsync();

            return Results.Ok(defects);
        })
            .RequireAuthorization();

        app.MapPost("/api/supplies/fbo-defects", async (
            SupplyFboDefectRequest request,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Supplies))
            {
                return Results.Forbid();
            }

            var productKey = request.ProductKey.Trim();
            if (string.IsNullOrWhiteSpace(productKey))
            {
                return Results.BadRequest("Не удалось определить товар для отметки брака.");
            }

            var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
            if (!Guid.TryParse(currentUserId, out var userId))
            {
                return Results.Forbid();
            }

            var existing = await db.SupplyFboDefects.FirstOrDefaultAsync(
                defect => defect.ProductKey == productKey);
            if (existing is not null)
            {
                existing.OfferId = request.OfferId.Trim();
                existing.ProductName = request.ProductName.Trim();
                existing.Quantity = Math.Max(0, request.Quantity);
                existing.CreatedAt = DateTimeOffset.UtcNow;
                existing.CreatedByUserId = userId;
            }
            else
            {
                db.SupplyFboDefects.Add(new SupplyFboDefect
                {
                    ProductKey = productKey,
                    OfferId = request.OfferId.Trim(),
                    ProductName = request.ProductName.Trim(),
                    Quantity = Math.Max(0, request.Quantity),
                    CreatedByUserId = userId
                });
            }

            AuditLogWriter.Add(db, principal, "Товар отмечен браком", "SupplyFboDefect", productKey, request.ProductName);
            await db.SaveChangesAsync();
            await hub.Clients.All.SendAsync("SuppliesChanged");

            return Results.NoContent();
        })
            .RequireAuthorization();

        app.MapDelete("/api/supplies/fbo-defects/{productKey}", async (
            string productKey,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Supplies))
            {
                return Results.Forbid();
            }

            var normalizedProductKey = Uri.UnescapeDataString(productKey).Trim();
            var defect = await db.SupplyFboDefects.FirstOrDefaultAsync(item => item.ProductKey == normalizedProductKey);
            if (defect is null)
            {
                return Results.NotFound();
            }

            db.SupplyFboDefects.Remove(defect);
            AuditLogWriter.Add(db, principal, "Товар возвращен в остаток отгрузки", "SupplyFboDefect", defect.ProductKey, defect.ProductName);
            await db.SaveChangesAsync();
            await hub.Clients.All.SendAsync("SuppliesChanged");

            return Results.NoContent();
        })
            .RequireAuthorization();

        app.MapGet("/api/supplies/analytics/export", async (AppDbContext db) =>
        {
            var items = await db.SupplyItems
                .AsNoTracking()
                .Include(item => item.Supply)
                .ToListAsync();

            var rows = items
                .GroupBy(item => new
                {
                    item.SupplyId,
                    item.OzonProductId,
                    item.OfferId,
                    item.ProductName,
                    item.IsReserve,
                    item.ItemKind,
                    item.Supply.Status,
                    item.Supply.IsArchived,
                    item.Supply.CreatedAt,
                    item.Supply.SentAt,
                    item.Supply.AcceptedAt,
                    item.Supply.ShippingCost
                })
                .OrderByDescending(group => group.Key.CreatedAt)
                .ThenBy(group => group.Key.ProductName)
                .ToList();

            var builder = new StringBuilder();
            builder.AppendLine("Дата создания;Дата отправки;Дата приемки;Сумма отправки;Статус;Товар;Артикул;Количество;Тип;Новый товар;ID поставки");
            foreach (var row in rows)
            {
                builder.AppendLine(string.Join(';', [
                    CsvExport.Cell(row.Key.CreatedAt.ToString("yyyy-MM-dd HH:mm:ss")),
                    CsvExport.Cell(row.Key.SentAt?.ToString("yyyy-MM-dd HH:mm:ss") ?? string.Empty),
                    CsvExport.Cell(row.Key.AcceptedAt?.ToString("yyyy-MM-dd HH:mm:ss") ?? string.Empty),
                    CsvExport.Cell(row.Key.ShippingCost?.ToString("0.##") ?? string.Empty),
                    CsvExport.Cell(row.Key.IsArchived ? "Архив" : row.Key.Status),
                    CsvExport.Cell(row.Key.ProductName),
                    CsvExport.Cell(row.Key.OfferId),
                    CsvExport.Cell(row.Sum(item => item.Quantity).ToString()),
                    CsvExport.Cell(row.Key.ItemKind),
                    CsvExport.Cell(row.Key.IsReserve ? "Да" : "Нет"),
                    CsvExport.Cell(row.Key.SupplyId.ToString())
                ]));
            }

            return Results.File(
                Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(builder.ToString())).ToArray(),
                "text/csv; charset=utf-8",
                $"supplies-analytics-{DateTime.UtcNow:yyyyMMdd-HHmmss}.csv");
        }).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));
    }

    private static async Task ClearPackedProductionItemsFromSupplyAsync(AppDbContext db, Guid supplyId)
    {
        var linkedItems = await db.ProductionTaskItems
            .Where(item => item.PackedSupplyId == supplyId)
            .ToListAsync();

        foreach (var item in linkedItems)
        {
            item.PackedSupplyId = null;
        }
    }

    private static DateTimeOffset? ParseSupplyExpenseBoundary(string? value, bool endOfDay)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        if (DateOnly.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
        {
            var time = endOfDay ? new TimeOnly(23, 59, 59, 999) : TimeOnly.MinValue;
            return new DateTimeOffset(date.ToDateTime(time), TimeSpan.Zero);
        }

        if (DateTimeOffset.TryParse(
                value,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal,
                out var parsed))
        {
            return parsed;
        }

        return null;
    }

    private static SupplyExpenseItem MapSupplyExpense(SupplyExpense expense) =>
        new(
            expense.Id,
            expense.Name,
            expense.Amount,
            expense.PurchasedAt,
            expense.CreatedAt,
            expense.CreatedByUserId,
            expense.CreatedByUser.DisplayName);

    private static async Task LinkPackedProductionItemsToSupplyAsync(AppDbContext db, Supply supply)
    {
        var offerIds = supply.Items
            .Where(item => item.ItemKind == SupplyItemKinds.Product)
            .Select(item => item.OfferId.Trim())
            .Where(item => item.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (offerIds.Count == 0)
        {
            return;
        }

        var packedItems = await db.ProductionTaskItems
            .Include(item => item.ProductionTask)
            .Where(item =>
                item.PackedAt != null &&
                (item.PackedSupplyId == null || item.PackedSupplyId == supply.Id) &&
                item.ProductionTask.Status == ProductionTaskStatuses.Completed &&
                item.ProductionTask.TaskType != ProductionTaskTypes.Novinka)
            .ToListAsync();

        foreach (var item in packedItems)
        {
            if (offerIds.Contains(item.OfferId, StringComparer.OrdinalIgnoreCase))
            {
                item.PackedSupplyId = supply.Id;
            }
        }
    }

    private static async Task ArchiveCompletedPackedTasksForSentSupplyAsync(
        AppDbContext db,
        ClaimsPrincipal principal,
        Supply supply)
    {
        var tasks = await db.ProductionTasks
            .Include(task => task.Items)
            .Where(task =>
                !task.IsArchived &&
                task.Status == ProductionTaskStatuses.Completed &&
                task.TaskType != ProductionTaskTypes.Novinka &&
                task.Items.Any(item => item.PackedSupplyId == supply.Id))
            .ToListAsync();

        var now = DateTimeOffset.UtcNow;
        foreach (var task in tasks)
        {
            if (task.Items.Count == 0 ||
                task.Items.Any(item => item.PackedAt == null || item.PackedSupplyId == null))
            {
                continue;
            }

            task.IsArchived = true;
            task.ArchivedAt ??= now;
            AuditLogWriter.Add(
                db,
                principal,
                "Автоархив после отправки поставки",
                "ProductionTask",
                task.Id.ToString(),
                $"Поставка: {supply.Id}");
        }
    }
}

