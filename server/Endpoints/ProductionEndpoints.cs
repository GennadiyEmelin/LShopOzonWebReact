using System.Security.Claims;
using System.Text;
using LShopOzonWebReact.Api.Contracts.Production;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Hubs;
using LShopOzonWebReact.Api.Integrations;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Ozon;
using LShopOzonWebReact.Api.Production;
using LShopOzonWebReact.Api.Security;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Endpoints;

public static class ProductionEndpoints
{
    public static void MapProductionEndpoints(this WebApplication app)
    {
        app.MapGet("/api/production/files", async (string? search, AppDbContext db, ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Production))
            {
                return Results.Forbid();
            }

            var query = db.ProductionFiles.AsNoTracking();

            if (!string.IsNullOrWhiteSpace(search))
            {
                var value = search.Trim().ToLower();
                query = query.Where(file =>
                    file.OfferId.ToLower().Contains(value) ||
                    file.ProductName.ToLower().Contains(value) ||
                    file.Notes.ToLower().Contains(value));
            }

            var files = await query
                .OrderByDescending(file => file.CreatedAt)
                .Select(file => new ProductionFileListItem(
                    file.Id,
                    file.ProductionTaskItemId,
                    file.OzonProductId,
                    file.OfferId,
                    file.ProductName,
                    file.ProductLink,
                    file.Notes,
                    file.FileName,
                    file.ContentType,
                    file.CreatedAt))
                .ToListAsync();

            return Results.Ok(files);
        }).RequireAuthorization();

        app.MapGet("/api/production/file-paths", async (string? search, AppDbContext db, ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Production))
            {
                return Results.Forbid();
            }

            var query = db.ProductionFilePaths.AsNoTracking();

            if (!string.IsNullOrWhiteSpace(search))
            {
                var value = search.Trim().ToLower();
                query = query.Where(path =>
                    path.OfferId.ToLower().Contains(value) ||
                    path.ProductName.ToLower().Contains(value) ||
                    path.Path.ToLower().Contains(value));
            }

            var paths = await query
                .OrderByDescending(path => path.CreatedAt)
                .Select(path => new ProductionFilePathListItem(
                    path.Id,
                    path.OzonProductId,
                    path.OfferId,
                    path.ProductName,
                    path.ProductLink,
                    path.Path,
                    path.CreatedAt))
                .ToListAsync();

            return Results.Ok(paths);
        }).RequireAuthorization();

        app.MapGet("/api/production/catalog", async (string? type, AppDbContext db, ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Production))
            {
                return Results.Forbid();
            }

            var catalog = await ProductionTaskResponses.BuildCatalogAsync(db, type ?? ProductionTaskTypes.Ozon);
            return Results.Ok(catalog);
        }).RequireAuthorization();

        app.MapGet("/api/production/designers", async (AppDbContext db, ClaimsPrincipal principal) =>
        {
            if (!await CanWorkWithDesignerTasksAsync(db, principal))
            {
                return Results.Forbid();
            }

            var users = await db.Users
                .AsNoTracking()
                .Where(user => user.IsActive)
                .OrderBy(user => user.DisplayName)
                .ToListAsync();

            var designers = users
                .Where(user => user.Role == UserRoles.Designer)
                .Select(user => new
                {
                    user.Id,
                    user.UserName,
                    DisplayName = user.DisplayName ?? user.UserName,
                    Position = user.Position ?? string.Empty,
                    user.Role,
                    AvatarUrl = string.Empty,
                    AllowedFeatures = FeatureAccess.Parse(user.AllowedFeatures ?? string.Empty)
                })
                .ToList();

            return Results.Ok(designers);
        }).RequireAuthorization();

        app.MapPut("/api/production/catalog/convert-to-ozon", async (
            ConvertNovinkaToOzonRequest request,
            AppDbContext db,
            OzonApiClient ozonApi,
            ClaimsPrincipal principal,
            CancellationToken cancellationToken) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, "production.editProducts"))
            {
                return Results.Forbid();
            }

            if (request.TargetOzonProductId <= 0)
            {
                return Results.BadRequest("Выберите товар Ozon.");
            }

            var sourceOfferId = request.SourceOfferId?.Trim() ?? string.Empty;
            var sourceProductName = request.SourceProductName?.Trim() ?? string.Empty;
            var sourceProductLink = request.SourceProductLink?.Trim() ?? string.Empty;

            if (string.IsNullOrWhiteSpace(sourceOfferId) && string.IsNullOrWhiteSpace(sourceProductName))
            {
                return Results.BadRequest("Выберите новинку.");
            }

            OzonProductSummary targetProduct;
            try
            {
                targetProduct = await ozonApi.GetProductSummaryByIdAsync(request.TargetOzonProductId, cancellationToken)
                    ?? throw new InvalidOperationException("Товар не найден в Ozon.");
            }
            catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
            {
                return Results.BadRequest(exception.Message);
            }

            var allFiles = await db.ProductionFiles.ToListAsync(cancellationToken);
            var filesToUpdate = ProductionTaskResponses.FindNovinkaCatalogFiles(
                allFiles,
                sourceOfferId,
                sourceProductName,
                sourceProductLink);

            if (filesToUpdate.Count == 0)
            {
                return Results.BadRequest("Не найдено превью для выбранной новинки.");
            }

            foreach (var file in filesToUpdate)
            {
                file.OzonProductId = targetProduct.ProductId;
                file.OfferId = targetProduct.OfferId;
                file.ProductName = targetProduct.Name;
                file.ProductLink = targetProduct.ProductUrl;
            }

            AuditLogWriter.Add(
                db,
                principal,
                "Конвертация новинки в Ozon",
                "ProductionCatalog",
                targetProduct.ProductId.ToString(),
                $"Новинка: {sourceProductName}, превью: {filesToUpdate.Count}, артикул: {targetProduct.OfferId}");

            await db.SaveChangesAsync(cancellationToken);

            return Results.Ok(new ConvertNovinkaToOzonResponse(
                filesToUpdate.Count,
                targetProduct.ProductId,
                targetProduct.OfferId,
                targetProduct.Name,
                targetProduct.ProductUrl));
        }).RequireAuthorization();

        app.MapPut("/api/production/catalog/file-path", async (
            UpsertCatalogFilePathRequest request,
            AppDbContext db,
            ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, "production.editProducts"))
            {
                return Results.Forbid();
            }

            var path = request.Path?.Trim() ?? string.Empty;
            if (path.Length < 3)
            {
                return Results.BadRequest("Укажите путь к файлу (минимум 3 символа).");
            }

            var offerId = request.OfferId?.Trim() ?? string.Empty;
            var productName = request.ProductName?.Trim() ?? string.Empty;
            var productLink = request.ProductLink?.Trim() ?? string.Empty;
            var ozonProductId = request.OzonProductId is > 0 ? request.OzonProductId : null;

            if (string.IsNullOrWhiteSpace(offerId) && ozonProductId is null)
            {
                return Results.BadRequest("Выберите товар.");
            }

            if (string.IsNullOrWhiteSpace(productName))
            {
                return Results.BadRequest("Укажите название товара.");
            }

            var existingPath = await db.ProductionFilePaths.FirstOrDefaultAsync(entry =>
                entry.Path == path &&
                ((!string.IsNullOrWhiteSpace(offerId) && entry.OfferId == offerId) ||
                 (ozonProductId.HasValue && entry.OzonProductId == ozonProductId)));

            ProductionFilePath savedPath;
            if (existingPath is null)
            {
                savedPath = new ProductionFilePath
                {
                    OzonProductId = ozonProductId,
                    OfferId = offerId,
                    ProductName = productName,
                    ProductLink = productLink,
                    Path = path
                };
                db.ProductionFilePaths.Add(savedPath);
            }
            else
            {
                savedPath = existingPath;
            }

            AuditLogWriter.Add(
                db,
                principal,
                "Путь к файлу в каталоге",
                "ProductionCatalog",
                offerId != string.Empty ? offerId : ozonProductId?.ToString() ?? productName,
                $"{productName}: {path}");
            await db.SaveChangesAsync();

            return Results.Ok(new ProductionFilePathListItem(
                savedPath.Id,
                savedPath.OzonProductId,
                savedPath.OfferId,
                savedPath.ProductName,
                savedPath.ProductLink,
                savedPath.Path,
                savedPath.CreatedAt));
        }).RequireAuthorization();

        app.MapDelete("/api/production/catalog/file-path/{id:guid}", async (
            Guid id,
            AppDbContext db,
            ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, "production.editProducts"))
            {
                return Results.Forbid();
            }

            var path = await db.ProductionFilePaths.FindAsync(id);
            if (path is null)
            {
                return Results.NotFound();
            }

            db.ProductionFilePaths.Remove(path);
            AuditLogWriter.Add(
                db,
                principal,
                "Удаление пути в каталоге",
                "ProductionCatalog",
                path.Id.ToString(),
                $"{path.ProductName}: {path.Path}");
            await db.SaveChangesAsync();

            return Results.NoContent();
        }).RequireAuthorization();
        app.MapPost("/api/production/files", async (
            HttpRequest request,
            AppDbContext db,
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
                return Results.BadRequest("Файл обязателен.");
            }

            if (!file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            {
                return Results.BadRequest("Загрузите изображение-превью.");
            }

            await using var stream = file.OpenReadStream();
            using var memory = new MemoryStream();
            await stream.CopyToAsync(memory, cancellationToken);

            var productionFile = new ProductionFile
            {
                ProductionTaskItemId = Guid.TryParse(form["taskItemId"], out var taskItemId) ? taskItemId : null,
                OzonProductId = long.TryParse(form["ozonProductId"], out var productId) ? productId : null,
                OfferId = form["offerId"].ToString().Trim(),
                ProductName = form["productName"].ToString().Trim(),
                ProductLink = form["productLink"].ToString().Trim(),
                Notes = form["notes"].ToString().Trim(),
                FileName = Path.GetFileName(file.FileName),
                ContentType = string.IsNullOrWhiteSpace(file.ContentType)
                    ? "application/octet-stream"
                    : file.ContentType,
                Content = memory.ToArray()
            };

            db.ProductionFiles.Add(productionFile);
            await db.SaveChangesAsync(cancellationToken);

            await IntegrationNotificationPublisher.PublishAsync(
                telegram,
                db,
                "production.file.added",
                $"Добавлено превью: {productionFile.ProductName.Trim()} · {productionFile.FileName}");

            return Results.Created($"/api/production/files/{productionFile.Id}", new ProductionFileListItem(
                productionFile.Id,
                productionFile.ProductionTaskItemId,
                productionFile.OzonProductId,
                productionFile.OfferId,
                productionFile.ProductName,
                productionFile.ProductLink,
                productionFile.Notes,
                productionFile.FileName,
                productionFile.ContentType,
                productionFile.CreatedAt));
        }).DisableAntiforgery().RequireAuthorization();

        app.MapGet("/api/production/files/{id:guid}/download", async (Guid id, AppDbContext db) =>
        {
            var file = await db.ProductionFiles.FindAsync(id);
            if (file is null)
            {
                return Results.NotFound();
            }

            return Results.File(file.Content, file.ContentType, file.FileName);
        }).RequireAuthorization();

        app.MapPut("/api/production/tasks/{taskId:guid}/items/{itemId:guid}/file-path", async (
            Guid taskId,
            Guid itemId,
            UpdateProductionTaskItemFilePathRequest request,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Production))
            {
                return Results.Forbid();
            }

            var path = request.Path?.Trim() ?? string.Empty;
            if (path.Length < 3)
            {
                return Results.BadRequest("Укажите путь к файлу (минимум 3 символа).");
            }

            var task = await db.ProductionTasks
                .Include(entry => entry.Items)
                .FirstOrDefaultAsync(entry => entry.Id == taskId);
            if (task is null)
            {
                return Results.NotFound();
            }

            if (task.Status != ProductionTaskStatuses.InProgress)
            {
                return Results.BadRequest("Путь к файлу можно указать только для задачи в работе.");
            }

            if (ProductionTaskResponses.NormalizeTaskType(task.TaskType) != ProductionTaskTypes.Novinka)
            {
                return Results.BadRequest("Путь к файлу доступен только для задач новинок.");
            }

            var taskItem = task.Items.FirstOrDefault(item => item.Id == itemId);
            if (taskItem is null)
            {
                return Results.NotFound();
            }

            taskItem.FilePath = path;

            var existingPath = await db.ProductionFilePaths.FirstOrDefaultAsync(entry =>
                entry.Path == path &&
                ((!string.IsNullOrWhiteSpace(taskItem.OfferId) && entry.OfferId == taskItem.OfferId) ||
                 (taskItem.OzonProductId > 0 && entry.OzonProductId == taskItem.OzonProductId)));

            if (existingPath is null)
            {
                db.ProductionFilePaths.Add(new ProductionFilePath
                {
                    OzonProductId = taskItem.OzonProductId > 0 ? taskItem.OzonProductId : null,
                    OfferId = taskItem.OfferId.Trim(),
                    ProductName = taskItem.ProductName.Trim(),
                    ProductLink = taskItem.ProductLink.Trim(),
                    Path = path
                });
            }

            AuditLogWriter.Add(
                db,
                principal,
                "Путь к файлу в задаче",
                "ProductionTaskItem",
                taskItem.Id.ToString(),
                $"{taskItem.ProductName}: {path}");
            await db.SaveChangesAsync();
            await hub.Clients.All.SendAsync("ProductionTasksChanged");

            return Results.Ok(new ProductionTaskItemListItem(
                taskItem.Id,
                taskItem.OzonProductId,
                taskItem.OfferId,
                taskItem.ProductName,
                taskItem.ProductLink,
                taskItem.RequiredQuantity,
                taskItem.ActualQuantity,
                taskItem.EnforceMinimumQuantity,
                taskItem.FilePath,
                taskItem.PackedAt,
                taskItem.PackedByUserId,
                taskItem.PackedByDisplayName,
                taskItem.PackedSupplyId));
        }).RequireAuthorization();

        app.MapPut("/api/production/tasks/{taskId:guid}/items/{itemId:guid}/actual-quantity", async (
            Guid taskId,
            Guid itemId,
            UpdateProductionTaskItemActualQuantityRequest request,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Production))
            {
                return Results.Forbid();
            }

            if (request.ActualQuantity < 0)
            {
                return Results.BadRequest("Фактическое количество не может быть меньше нуля.");
            }

            var task = await db.ProductionTasks
                .Include(entry => entry.Items)
                .FirstOrDefaultAsync(entry => entry.Id == taskId);
            if (task is null)
            {
                return Results.NotFound();
            }

            if (task.Status != ProductionTaskStatuses.InProgress)
            {
                return Results.BadRequest("Факт можно сохранить только для задачи в работе.");
            }

            if (ProductionTaskResponses.NormalizeTaskType(task.TaskType) == ProductionTaskTypes.Novinka)
            {
                return Results.BadRequest("Для задач новинок фактическое количество не требуется.");
            }

            ProductionTaskItem? taskItem;
            if (task.Items.Count == 0 && task.Id == itemId)
            {
                task.ActualQuantity = request.ActualQuantity;
                taskItem = new ProductionTaskItem
                {
                    Id = task.Id,
                    OzonProductId = task.OzonProductId,
                    OfferId = task.OfferId,
                    ProductName = task.ProductName,
                    RequiredQuantity = task.RequiredQuantity,
                    ActualQuantity = request.ActualQuantity
                };
            }
            else
            {
                taskItem = task.Items.FirstOrDefault(item => item.Id == itemId);
                if (taskItem is null)
                {
                    return Results.NotFound();
                }

                taskItem.ActualQuantity = request.ActualQuantity;
                task.ActualQuantity = task.Items.Sum(item => item.ActualQuantity ?? 0);
            }

            AuditLogWriter.Add(
                db,
                principal,
                "Факт по товару в задаче",
                "ProductionTaskItem",
                taskItem.Id.ToString(),
                $"{taskItem.ProductName}: {request.ActualQuantity} шт.");
            await db.SaveChangesAsync();
            await hub.Clients.All.SendAsync("ProductionTasksChanged");

            return Results.Ok(new ProductionTaskItemListItem(
                taskItem.Id,
                taskItem.OzonProductId,
                taskItem.OfferId,
                taskItem.ProductName,
                taskItem.ProductLink,
                taskItem.RequiredQuantity,
                taskItem.ActualQuantity,
                taskItem.EnforceMinimumQuantity,
                taskItem.FilePath,
                taskItem.PackedAt,
                taskItem.PackedByUserId,
                taskItem.PackedByDisplayName,
                taskItem.PackedSupplyId));
        }).RequireAuthorization();

        app.MapPut("/api/production/tasks/{taskId:guid}/items/{itemId:guid}/pack", async (
            Guid taskId,
            Guid itemId,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.ProductionPackItems))
            {
                return Results.Forbid();
            }

            var task = await db.ProductionTasks
                .Include(entry => entry.Items)
                .FirstOrDefaultAsync(entry => entry.Id == taskId);
            if (task is null)
            {
                return Results.NotFound();
            }

            if (task.Status != ProductionTaskStatuses.Completed)
            {
                return Results.BadRequest("Упаковать можно только товар из выполненной задачи.");
            }

            if (ProductionTaskResponses.NormalizeTaskType(task.TaskType) == ProductionTaskTypes.Novinka)
            {
                return Results.BadRequest("Задачи дизайна не упаковываются.");
            }

            var taskItem = task.Items.FirstOrDefault(item => item.Id == itemId);
            if (taskItem is null)
            {
                return Results.NotFound();
            }

            if (taskItem.PackedSupplyId.HasValue)
            {
                return Results.BadRequest("Товар уже добавлен в поставку.");
            }

            var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
            var currentUser = Guid.TryParse(currentUserId, out var parsedUserId)
                ? await db.Users.AsNoTracking().FirstOrDefaultAsync(user => user.Id == parsedUserId)
                : null;

            taskItem.PackedAt ??= DateTimeOffset.UtcNow;
            taskItem.PackedByUserId ??= currentUser?.Id;
            taskItem.PackedByDisplayName ??=
                currentUser?.DisplayName
                ?? principal.FindFirstValue("display_name")
                ?? principal.FindFirstValue(ClaimTypes.Name);

            AuditLogWriter.Add(
                db,
                principal,
                "Товар упакован",
                "ProductionTaskItem",
                taskItem.Id.ToString(),
                $"{taskItem.ProductName}: {taskItem.ActualQuantity ?? taskItem.RequiredQuantity} шт.");
            await db.SaveChangesAsync();
            await hub.Clients.All.SendAsync("ProductionTasksChanged");

            return Results.Ok(new ProductionTaskItemListItem(
                taskItem.Id,
                taskItem.OzonProductId,
                taskItem.OfferId,
                taskItem.ProductName,
                taskItem.ProductLink,
                taskItem.RequiredQuantity,
                taskItem.ActualQuantity,
                taskItem.EnforceMinimumQuantity,
                taskItem.FilePath,
                taskItem.PackedAt,
                taskItem.PackedByUserId,
                taskItem.PackedByDisplayName,
                taskItem.PackedSupplyId));
        }).RequireAuthorization();

        app.MapDelete("/api/production/tasks/{taskId:guid}/items/{itemId:guid}/file-path", async (
            Guid taskId,
            Guid itemId,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Production))
            {
                return Results.Forbid();
            }

            var task = await db.ProductionTasks
                .Include(entry => entry.Items)
                .FirstOrDefaultAsync(entry => entry.Id == taskId);
            if (task is null)
            {
                return Results.NotFound();
            }

            if (task.Status != ProductionTaskStatuses.InProgress)
            {
                return Results.BadRequest("Путь к файлу можно удалить только для задачи в работе.");
            }

            if (ProductionTaskResponses.NormalizeTaskType(task.TaskType) != ProductionTaskTypes.Novinka)
            {
                return Results.BadRequest("Путь к файлу доступен только для задач новинок.");
            }

            var taskItem = task.Items.FirstOrDefault(item => item.Id == itemId);
            if (taskItem is null)
            {
                return Results.NotFound();
            }

            var removedPath = taskItem.FilePath.Trim();
            taskItem.FilePath = string.Empty;

            if (!string.IsNullOrWhiteSpace(removedPath))
            {
                var catalogPath = await db.ProductionFilePaths.FirstOrDefaultAsync(entry =>
                    entry.Path == removedPath &&
                    ((!string.IsNullOrWhiteSpace(taskItem.OfferId) && entry.OfferId == taskItem.OfferId) ||
                     (taskItem.OzonProductId > 0 && entry.OzonProductId == taskItem.OzonProductId)));

                if (catalogPath is not null)
                {
                    db.ProductionFilePaths.Remove(catalogPath);
                }
            }

            AuditLogWriter.Add(
                db,
                principal,
                "Удаление пути к файлу",
                "ProductionTaskItem",
                taskItem.Id.ToString(),
                taskItem.ProductName);
            await db.SaveChangesAsync();
            await hub.Clients.All.SendAsync("ProductionTasksChanged");

            return Results.Ok(new ProductionTaskItemListItem(
                taskItem.Id,
                taskItem.OzonProductId,
                taskItem.OfferId,
                taskItem.ProductName,
                taskItem.ProductLink,
                taskItem.RequiredQuantity,
                taskItem.ActualQuantity,
                taskItem.EnforceMinimumQuantity,
                taskItem.FilePath,
                taskItem.PackedAt,
                taskItem.PackedByUserId,
                taskItem.PackedByDisplayName,
                taskItem.PackedSupplyId));
        }).RequireAuthorization();

        app.MapDelete("/api/production/files/{id:guid}", async (
            Guid id,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub,
            TelegramNotificationService telegram) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, "production.deleteFiles"))
            {
                return Results.Forbid();
            }

            var file = await db.ProductionFiles.FindAsync(id);
            if (file is null)
            {
                return Results.NotFound();
            }

            var isNovinkaFile = ProductionTaskResponses.IsNovinkaProductionFile(file);
            var offerId = file.OfferId;
            var productName = file.ProductName;
            var productLink = file.ProductLink;

            db.ProductionFiles.Remove(file);
            await db.SaveChangesAsync();

            await IntegrationNotificationPublisher.PublishAsync(
                telegram,
                db,
                "production.file.deleted",
                $"Удалено превью: {productName.Trim()}");

            ProductionTaskListItem? reworkTask = null;
            if (isNovinkaFile)
            {
                var remainingInCatalog = ProductionTaskResponses.FindNovinkaCatalogFiles(
                    await db.ProductionFiles.AsNoTracking().ToListAsync(),
                    offerId,
                    productName,
                    productLink);

                if (remainingInCatalog.Count == 0)
                {
                    try
                    {
                        reworkTask = await ProductionTaskResponses.TryCreateNovinkaReworkTaskAsync(
                            db,
                            principal,
                            productName,
                            productLink,
                            offerId);
                    }
                    catch
                    {
                        // Файл уже удалён — сбой автосоздания задачи не должен отменять удаление.
                    }
                }
            }

            if (reworkTask is not null)
            {
                await hub.Clients.All.SendAsync("ProductionTasksChanged");

                var reworkEntity = await db.ProductionTasks
                    .AsNoTracking()
                    .Include(task => task.Items)
                    .FirstOrDefaultAsync(task => task.Id == reworkTask.Id);
                if (reworkEntity is not null)
                {
                    await IntegrationNotificationPublisher.PublishTaskAsync(
                        telegram,
                        db,
                        reworkEntity,
                        "production.rework.created",
                        ProductionTaskResponses.BuildReworkTaskTelegramMessage(reworkEntity));
                }
            }

            return Results.Ok(new DeleteProductionFileResponse(reworkTask is not null, reworkTask?.Id));
        }).RequireAuthorization();

        app.MapGet("/api/production/tasks", async (string? status, AppDbContext db, ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Production))
            {
                return Results.Forbid();
            }

            IQueryable<ProductionTask> query = db.ProductionTasks
                .AsNoTracking()
                .Include(task => task.Items);

            IQueryable<ProductionTask> summaryQuery = db.ProductionTasks
                .AsNoTracking()
                .Include(task => task.Items);

            if (!string.IsNullOrWhiteSpace(status))
            {
                query = query.Where(task => task.Status == status);
            }

            query = await ProductionTaskRoleFilter.ApplyAsync(query, db, principal);
            summaryQuery = await ProductionTaskRoleFilter.ApplyAsync(summaryQuery, db, principal);

            var tasks = await query
                .OrderByDescending(task => task.CreatedAt)
                .ToListAsync();

            var summaryTasks = await summaryQuery
                .Where(task => !task.IsArchived)
                .ToListAsync();

            var productionSummaries = ProductionTaskResponses.BuildProductionSummaries(tasks, summaryTasks);
            var canSeeDeadlines = await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.ProductionTaskDeadline);
            return Results.Ok(tasks.Select(task => ProductionTaskResponses.ToListItem(task, canSeeDeadlines, productionSummaries)));
        }).RequireAuthorization();

        app.MapGet("/api/production/analytics/assignees", async (AppDbContext db, ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Analytics, "analytics.production"))
            {
                return Results.Forbid();
            }

            var allowedRoles = new[] { UserRoles.Production, UserRoles.Designer, UserRoles.Leadership };
            var assignees = await db.Users.AsNoTracking()
                .Where(user => user.IsActive && user.Id != SystemUser.Id && allowedRoles.Contains(user.Role))
                .OrderBy(user => user.DisplayName)
                .ThenBy(user => user.UserName)
                .Select(user => new ProductionAnalyticsAssigneeItem(
                    user.Id,
                    user.DisplayName,
                    user.UserName,
                    user.Role,
                    UserResponses.AvatarUrl(user.AvatarFileName)))
                .ToListAsync();

            return Results.Ok(assignees);
        }).RequireAuthorization();

        app.MapGet("/api/production/analytics/report", async (
            string? dateFrom,
            string? dateTo,
            Guid? userId,
            AppDbContext db,
            ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Analytics, "analytics.production"))
            {
                return Results.Forbid();
            }

            var (from, to) = ProductionAnalyticsQueries.ResolveDateRange(dateFrom, dateTo);
            var query = ProductionAnalyticsStore.BuildRecordsQuery(db, from, to);

            if (userId.HasValue)
            {
                var assignee = await db.Users.AsNoTracking()
                    .Where(user => user.Id == userId.Value && user.IsActive)
                    .Select(user => new { user.Id, user.DisplayName })
                    .FirstOrDefaultAsync();

                if (assignee is not null)
                {
                    query = query.Where(record =>
                        record.AssignedUserId == assignee.Id ||
                        record.AssignedUserName == assignee.DisplayName);
                }
            }

            var records = await query
                .OrderByDescending(record => record.CompletedAt)
                .ToListAsync();

            var summary = await ProductionAnalyticsStore.BuildSummaryAsync(db, records);

            return Results.Ok(new ProductionAnalyticsReportResponse(
                summary,
                records.Select(ProductionAnalyticsStore.ToListItem).ToList()));
        }).RequireAuthorization();

        app.MapPut("/api/production/analytics/records/{id:guid}", async (
            Guid id,
            UpdateProductionAnalyticsRecordRequest request,
            AppDbContext db,
            ClaimsPrincipal principal) =>
        {
            if (!await UserRoleResolver.IsInRoleAsync(db, principal, UserRoles.Admin))
            {
                return Results.Forbid();
            }

            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Analytics, "analytics.production"))
            {
                return Results.Forbid();
            }

            var record = await db.ProductionAnalyticsTaskRecords.FirstOrDefaultAsync(entry => entry.Id == id);
            if (record is null)
            {
                return Results.NotFound();
            }

            Guid? updatedByUserId = UserRoleResolver.GetUserId(principal);
            ProductionAnalyticsStore.ApplyUpdate(record, request, updatedByUserId);

            if (request.AssignedUserName is not null && !request.AssignedUserId.HasValue)
            {
                var normalized = request.AssignedUserName.Trim();
                record.AssignedUserId = await db.Users.AsNoTracking()
                    .Where(user => user.IsActive && (user.DisplayName == normalized || user.UserName == normalized))
                    .Select(user => (Guid?)user.Id)
                    .FirstOrDefaultAsync();
            }

            AuditLogWriter.Add(
                db,
                principal,
                "Изменение аналитики производства",
                "ProductionAnalyticsTaskRecord",
                record.Id.ToString(),
                record.ProductName);
            await db.SaveChangesAsync();

            return Results.Ok(ProductionAnalyticsStore.ToListItem(record));
        }).RequireAuthorization();

        app.MapGet("/api/production/analytics/export", async (
            HttpRequest request,
            AppDbContext db,
            ClaimsPrincipal principal) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Analytics, "analytics.production"))
            {
                return Results.Forbid();
            }

            var dateFrom = request.Query["dateFrom"].ToString();
            var dateTo = request.Query["dateTo"].ToString();
            var userIdRaw = request.Query["userId"].ToString();
            Guid? userId = Guid.TryParse(userIdRaw, out var parsedUserId) ? parsedUserId : null;

            var (from, to) = ProductionAnalyticsQueries.ResolveDateRange(dateFrom, dateTo);
            var query = ProductionAnalyticsStore.BuildRecordsQuery(db, from, to);

            if (userId.HasValue)
            {
                var assignee = await db.Users.AsNoTracking()
                    .Where(user => user.Id == userId.Value && user.IsActive)
                    .Select(user => new { user.Id, user.DisplayName })
                    .FirstOrDefaultAsync();

                if (assignee is not null)
                {
                    query = query.Where(record =>
                        record.AssignedUserId == assignee.Id ||
                        record.AssignedUserName == assignee.DisplayName);
                }
            }

            var records = await query
                .OrderByDescending(record => record.CompletedAt)
                .ToListAsync();

            var rows = new List<string[]>
            {
                new[]
                {
                    "Завершена",
                    "Исполнитель",
                    "Тип",
                    "Статус",
                    "Срочно",
                    "Товар",
                    "Артикул",
                    "План",
                    "Факт",
                    "Создана",
                    "Создатель"
                }
            };

            foreach (var record in records)
            {
                var task = ProductionAnalyticsStore.ToListItem(record);
                var items = task.Items.Count == 0
                    ? [new ProductionTaskItemListItem(task.Id, task.OzonProductId, task.OfferId, task.ProductName, string.Empty, task.RequiredQuantity, task.ActualQuantity, false, string.Empty, null, null, null, null)]
                    : task.Items;

                foreach (var item in items)
                {
                    rows.Add([
                        task.CompletedAt?.ToString("yyyy-MM-dd HH:mm:ss") ?? string.Empty,
                        task.AssignedUserName ?? string.Empty,
                        task.TaskType,
                        task.Status,
                        task.IsUrgent ? "Да" : "Нет",
                        item.ProductName,
                        item.OfferId,
                        item.RequiredQuantity.ToString(),
                        (item.ActualQuantity ?? 0).ToString(),
                        task.CreatedAt.ToString("yyyy-MM-dd HH:mm:ss"),
                        task.CreatedByDisplayName ?? string.Empty
                    ]);
                }
            }

            var bytes = ExcelExport.CreateWorkbook("Производство", rows);
            return Results.File(
                bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                $"production-analytics-{DateTime.UtcNow:yyyyMMdd-HHmmss}.xlsx");
        }).RequireAuthorization();

        app.MapGet("/api/production/tasks/archive/export", async (AppDbContext db) =>
        {
            var tasks = await db.ProductionTasks
                .AsNoTracking()
                .Include(task => task.Items)
                .Where(task => task.IsArchived)
                .OrderByDescending(task => task.CompletedAt ?? task.CreatedAt)
                .ToListAsync();

            var builder = new StringBuilder();
            builder.AppendLine("ID задачи;Создана;Создатель;Срочно;Взята в работу;Завершена;Архивирована;Исполнитель;Статус;Товар;Артикул;План;Факт");

            foreach (var task in tasks)
            {
                var items = task.Items.Count == 0
                    ? [new ProductionTaskItem
                    {
                        OzonProductId = task.OzonProductId,
                        OfferId = task.OfferId,
                        ProductName = task.ProductName,
                        RequiredQuantity = task.RequiredQuantity,
                        ActualQuantity = task.ActualQuantity
                    }]
                    : task.Items.OrderBy(item => item.ProductName).ToList();

                foreach (var item in items)
                {
                    builder.AppendLine(string.Join(';', [
                        CsvExport.Cell(task.Id.ToString()),
                        CsvExport.Cell(task.CreatedAt.ToString("yyyy-MM-dd HH:mm:ss")),
                        CsvExport.Cell(task.CreatedByDisplayName ?? string.Empty),
                        CsvExport.Cell(task.IsUrgent ? "Да" : "Нет"),
                        CsvExport.Cell(task.StartedAt?.ToString("yyyy-MM-dd HH:mm:ss") ?? string.Empty),
                        CsvExport.Cell(task.CompletedAt?.ToString("yyyy-MM-dd HH:mm:ss") ?? string.Empty),
                        CsvExport.Cell(task.ArchivedAt?.ToString("yyyy-MM-dd HH:mm:ss") ?? string.Empty),
                        CsvExport.Cell(task.AssignedUserName ?? string.Empty),
                        CsvExport.Cell(task.Status),
                        CsvExport.Cell(item.ProductName),
                        CsvExport.Cell(item.OfferId),
                        CsvExport.Cell(item.RequiredQuantity.ToString()),
                        CsvExport.Cell((item.ActualQuantity ?? 0).ToString())
                    ]));
                }
            }

            return Results.File(
                Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(builder.ToString())).ToArray(),
                "text/csv; charset=utf-8",
                $"production-task-archive-{DateTime.UtcNow:yyyyMMdd-HHmmss}.csv");
        }).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

        app.MapPost("/api/production/tasks", async (
            CreateProductionTaskRequest request,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub,
            IServiceScopeFactory scopeFactory) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, "production.createTask"))
            {
                return Results.Forbid();
            }

            var canSetDeadline = await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.ProductionTaskDeadline);
            if (!canSetDeadline && request.DueAt.HasValue)
            {
                return Results.Forbid();
            }

            var taskType = ProductionTaskResponses.NormalizeTaskType(request.TaskType);
            var requestItems = request.Items is { Count: > 0 }
                ? request.Items
                : [new CreateProductionTaskItemRequest(
                    request.OzonProductId,
                    request.OfferId,
                    request.ProductName,
                    request.RequiredQuantity,
                    false,
                    null)];

            if (taskType == ProductionTaskTypes.Novinka)
            {
                if (requestItems.Any(item => string.IsNullOrWhiteSpace(item.ProductName) || item.RequiredQuantity <= 0))
                {
                    return Results.BadRequest("Укажите наименование и количество для каждой новинки.");
                }
            }
            else if (requestItems.Any(item => !ProductionTaskResponses.IsValidOzonTaskItemRequest(item)))
            {
                return Results.BadRequest("Выберите товар и укажите количество больше нуля.");
            }

            var builtItems = ProductionTaskResponses.BuildTaskItems(taskType, requestItems);
            await CopySourceNovinkaPathsAsync(db, requestItems, builtItems);
            var firstItem = builtItems[0];
            var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
            var currentUser = Guid.TryParse(currentUserId, out var parsedUserId)
                ? await db.Users.AsNoTracking().FirstOrDefaultAsync(user => user.Id == parsedUserId)
                : null;
            var task = new ProductionTask
            {
                TaskType = taskType,
                OzonProductId = firstItem.OzonProductId,
                OfferId = firstItem.OfferId.Trim(),
                ProductName = builtItems.Count == 1
                    ? firstItem.ProductName.Trim()
                    : taskType == ProductionTaskTypes.Novinka
                        ? $"Новинки · {builtItems.Count} товаров"
                        : $"Задача на {builtItems.Count} товаров",
                RequiredQuantity = builtItems.Sum(item => item.RequiredQuantity),
                IsUrgent = request.IsUrgent,
                DueAt = request.DueAt,
                CreatedByUserId = currentUser?.Id,
                CreatedByDisplayName = currentUser?.DisplayName
                    ?? principal.FindFirstValue("display_name")
                    ?? principal.FindFirstValue(ClaimTypes.Name),
                Items = builtItems
            };

            db.ProductionTasks.Add(task);
            AuditLogWriter.Add(db, principal, "Создание задачи", "ProductionTask", task.Id.ToString(), task.ProductName);
            await db.SaveChangesAsync();
            await CopySourceNovinkaPreviewsAsync(db, requestItems, builtItems);
            if (requestItems.Any(item => item.SourceTaskItemId.HasValue))
            {
                await db.SaveChangesAsync();
            }

            var result = ProductionTaskResponses.ToListItem(task);

            await hub.Clients.All.SendAsync("ProductionTasksChanged", result);

            var createdEventId = ProductionTaskResponses.ResolveNewTaskEventId(task);
            NotificationBackgroundPublisher.PublishTask(
                scopeFactory,
                task,
                createdEventId,
                ProductionTaskResponses.BuildNewTaskTelegramMessage(task),
                excludeUserId: task.CreatedByUserId);

            return Results.Created($"/api/production/tasks/{task.Id}", result);
        }).RequireAuthorization();

        app.MapPut("/api/production/tasks/{id:guid}", async (
            Guid id,
            UpdateProductionTaskRequest request,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub,
            TelegramNotificationService telegram) =>
        {
            if (!await FeatureAccess.HasAnyAsync(db, principal, "production.editTasks"))
            {
                return Results.Forbid();
            }

            var canSetDeadline = await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.ProductionTaskDeadline);
            var requestItems = request.Items is { Count: > 0 }
                ? request.Items
                : [];

            if (requestItems.Count == 0)
            {
                return Results.BadRequest("Добавьте товары в задачу.");
            }

            var task = await db.ProductionTasks
                .Include(entry => entry.Items)
                .FirstOrDefaultAsync(entry => entry.Id == id);
            if (task is null)
            {
                return Results.NotFound();
            }

            var isAdmin = await UserRoleResolver.IsInRoleAsync(db, principal, UserRoles.Admin);
            if (task.Status != ProductionTaskStatuses.New &&
                !(isAdmin && task.Status == ProductionTaskStatuses.InProgress))
            {
                return Results.BadRequest("Редактировать можно новую задачу, а администраторам — также задачу в работе.");
            }

            var previousTaskType = ProductionTaskResponses.NormalizeTaskType(task.TaskType);
            var requestedTaskType = string.IsNullOrWhiteSpace(request.TaskType)
                ? previousTaskType
                : ProductionTaskResponses.NormalizeTaskType(request.TaskType);
            if (requestedTaskType != previousTaskType &&
                !await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.ProductionChangeTaskType))
            {
                return Results.Forbid();
            }

            var isNovinka = requestedTaskType == ProductionTaskTypes.Novinka;
            if (isNovinka)
            {
                if (requestItems.Any(item => string.IsNullOrWhiteSpace(item.ProductName) || item.RequiredQuantity <= 0))
                {
                    return Results.BadRequest("Укажите наименование и количество для каждой новинки.");
                }
            }
            else if (requestItems.Any(item => !ProductionTaskResponses.IsValidOzonTaskItemRequest(item)))
            {
                return Results.BadRequest("Добавьте товары и укажите количество больше нуля.");
            }

            List<ProductionTaskItem> builtItems;
            if (isNovinka)
            {
                builtItems = ProductionTaskResponses.ReconcileNovinkaTaskItems(task, requestItems);
            }
            else
            {
                builtItems = ProductionTaskResponses.ReconcileTaskItems(task, requestItems);
            }
            task.TaskType = requestedTaskType;

            foreach (var item in builtItems)
            {
                var entry = db.Entry(item);
                if (entry.State == EntityState.Detached)
                {
                    item.ProductionTaskId = task.Id;
                    task.Items.Add(item);
                }
                else if (entry.State == EntityState.Modified
                         && !await db.ProductionTaskItems.AsNoTracking().AnyAsync(existing => existing.Id == item.Id))
                {
                    entry.State = EntityState.Added;
                }
            }

            var firstItem = builtItems[0];
            task.OzonProductId = firstItem.OzonProductId;
            task.OfferId = (firstItem.OfferId ?? string.Empty).Trim();
            task.ProductName = builtItems.Count == 1
                ? (firstItem.ProductName ?? string.Empty).Trim()
                : isNovinka
                    ? $"Новинки · {builtItems.Count} товаров"
                    : $"Задача на {builtItems.Count} товаров";
            task.RequiredQuantity = builtItems.Sum(item => item.RequiredQuantity);
            task.IsUrgent = request.IsUrgent;
            if (canSetDeadline && task.DueAt != request.DueAt)
            {
                task.DueAt = request.DueAt;
                task.OverdueNotifiedAt = null;
            }

            AuditLogWriter.Add(db, principal, "Редактирование задачи", "ProductionTask", task.Id.ToString(), task.ProductName);
            try
            {
                await db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                return Results.BadRequest("Не удалось сохранить задачу. Проверьте длину названия и ссылки.");
            }
            await hub.Clients.All.SendAsync("ProductionTasksChanged");

            await IntegrationNotificationPublisher.PublishTaskAsync(
                telegram,
                db,
                task,
                "production.task.updated",
                ProductionTaskResponses.BuildUpdatedTaskTelegramMessage(task));

            return Results.NoContent();
        }).RequireAuthorization();

        app.MapPut("/api/production/tasks/{id:guid}/start", async (
            Guid id,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub,
            TelegramNotificationService telegram) =>
        {
            var task = await db.ProductionTasks
                .Include(entry => entry.Items)
                .FirstOrDefaultAsync(entry => entry.Id == id);
            if (task is null)
            {
                return Results.NotFound();
            }

            if (task.Status == ProductionTaskStatuses.Completed)
            {
                return Results.BadRequest("Выполненную задачу нельзя взять в работу.");
            }

            if (task.Status == ProductionTaskStatuses.Cancelled)
            {
                return Results.BadRequest("Отменённую задачу нельзя взять в работу.");
            }

            var role = await UserRoleResolver.GetRoleAsync(db, principal);
            var allowedFeatures = await FeatureAccess.GetAllowedFeaturesAsync(db, principal);
            var isNovinkaTask = ProductionTaskResponses.NormalizeTaskType(task.TaskType) == ProductionTaskTypes.Novinka;
            var canStartTask = isNovinkaTask
                ? FeatureAccess.CanSeeNovinkaProductionTasks(role ?? string.Empty, allowedFeatures)
                : FeatureAccess.CanSeeOzonProductionTasks(role ?? string.Empty, allowedFeatures);
            if (!canStartTask)
            {
                return Results.Forbid();
            }

            task.Status = ProductionTaskStatuses.InProgress;
            var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
            var currentUser = Guid.TryParse(currentUserId, out var parsedUserId)
                ? await db.Users.AsNoTracking().FirstOrDefaultAsync(user => user.Id == parsedUserId)
                : null;
            task.AssignedUserName = currentUser?.DisplayName
                ?? principal.FindFirstValue("display_name")
                ?? principal.FindFirstValue(ClaimTypes.Name)
                ?? task.AssignedUserName;
            task.StartedAt ??= DateTimeOffset.UtcNow;
            AuditLogWriter.Add(db, principal, "Задача взята в работу", "ProductionTask", task.Id.ToString(), task.ProductName);
            await db.SaveChangesAsync();
            await hub.Clients.All.SendAsync("ProductionTasksChanged");

            var startedByName = task.AssignedUserName ?? "—";
            await IntegrationNotificationPublisher.PublishTaskAsync(
                telegram,
                db,
                task,
                "production.task.started",
                ProductionTaskResponses.BuildStartedTaskTelegramMessage(task, startedByName));

            return Results.NoContent();
        }).RequireAuthorization();

        app.MapPut("/api/production/tasks/{taskId:guid}/items/{itemId:guid}/quantity", async (
            Guid taskId,
            Guid itemId,
            UpdateProductionTaskItemRequest request,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub) =>
        {
            if (!await UserRoleResolver.IsInRoleAsync(db, principal, UserRoles.Admin) &&
                !await FeatureAccess.HasAnyAsync(db, principal, "production.editTasks"))
            {
                return Results.Forbid();
            }

            if (request.RequiredQuantity <= 0)
            {
                return Results.BadRequest("Количество должно быть больше нуля.");
            }

            var task = await db.ProductionTasks
                .Include(task => task.Items)
                .FirstOrDefaultAsync(task => task.Id == taskId);
            if (task is null)
            {
                return Results.NotFound();
            }

            if (task.Status is not (ProductionTaskStatuses.New or ProductionTaskStatuses.InProgress))
            {
                return Results.BadRequest("Количество можно менять только у новой или активной задачи.");
            }

            if (task.Items.Count == 0 && task.Id == itemId)
            {
                task.RequiredQuantity = request.RequiredQuantity;
            }
            else
            {
                var item = task.Items.FirstOrDefault(entry => entry.Id == itemId);
                if (item is null)
                {
                    return Results.NotFound();
                }

                item.RequiredQuantity = request.RequiredQuantity;
                task.RequiredQuantity = task.Items.Sum(entry => entry.RequiredQuantity);
            }

            AuditLogWriter.Add(db, principal, "Изменение количества в задаче", "ProductionTask", task.Id.ToString(), $"{task.ProductName}. План: {task.RequiredQuantity}");
            await db.SaveChangesAsync();
            await hub.Clients.All.SendAsync("ProductionTasksChanged");

            return Results.NoContent();
        }).RequireAuthorization();

        app.MapPut("/api/production/tasks/{taskId:guid}/items/{itemId:guid}/take-designer", async (
            Guid taskId,
            Guid itemId,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub) =>
        {
            if (!await CanWorkWithDesignerTasksAsync(db, principal))
            {
                return Results.Forbid();
            }

            var userId = UserRoleResolver.GetUserId(principal);
            if (userId is null)
            {
                return Results.Unauthorized();
            }

            return await MoveDesignerTaskItemAsync(db, principal, hub, taskId, itemId, userId.Value, false);
        }).RequireAuthorization();

        app.MapPut("/api/production/tasks/{taskId:guid}/items/{itemId:guid}/transfer-designer", async (
            Guid taskId,
            Guid itemId,
            TransferDesignerTaskItemRequest request,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub) =>
        {
            if (!await CanWorkWithDesignerTasksAsync(db, principal))
            {
                return Results.Forbid();
            }

            var userId = UserRoleResolver.GetUserId(principal);
            if (userId is null)
            {
                return Results.Unauthorized();
            }

            return await MoveDesignerTaskItemAsync(db, principal, hub, taskId, itemId, request.TargetUserId, true);
        }).RequireAuthorization();

        app.MapPut("/api/production/tasks/{id:guid}/cancel", async (
            Guid id,
            CancelProductionTaskRequest request,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub,
            TelegramNotificationService telegram) =>
        {
            var comment = request.Comment?.Trim() ?? string.Empty;
            if (comment.Length < 3)
            {
                return Results.BadRequest("Укажите причину отмены задачи (минимум 3 символа).");
            }

            var task = await db.ProductionTasks.FindAsync(id);
            if (task is null)
            {
                return Results.NotFound();
            }

            if (task.Status == ProductionTaskStatuses.Completed)
            {
                return Results.BadRequest("Выполненную задачу нельзя отменить.");
            }

            if (task.Status == ProductionTaskStatuses.Cancelled)
            {
                return Results.BadRequest("Задача уже отменена.");
            }

            if (task.Status is not (ProductionTaskStatuses.New or ProductionTaskStatuses.InProgress))
            {
                return Results.BadRequest("Отменить можно только новую задачу или задачу в работе.");
            }

            if (!await UserRoleResolver.IsInRoleAsync(db, principal, UserRoles.Admin)
                && !await FeatureAccess.HasAnyAsync(db, principal, "production.cancelTasks"))
            {
                return Results.Forbid();
            }

            var userId = UserRoleResolver.GetUserId(principal);
            if (userId is null)
            {
                return Results.Unauthorized();
            }

            var currentUser = await db.Users.AsNoTracking().FirstOrDefaultAsync(user => user.Id == userId.Value);
            var cancelledByName = currentUser?.DisplayName
                ?? principal.FindFirstValue("display_name")
                ?? principal.FindFirstValue(ClaimTypes.Name)
                ?? "Администратор";

            task.Status = ProductionTaskStatuses.Cancelled;
            task.CancelledAt = DateTimeOffset.UtcNow;
            task.CancelledByUserId = userId.Value;
            task.CancelledByDisplayName = cancelledByName;
            task.CancellationComment = comment;
            AuditLogWriter.Add(db, principal, "Задача отменена", "ProductionTask", task.Id.ToString(), $"{task.ProductName}. Причина: {comment}");

            if (task.CreatedByUserId is Guid creatorId && creatorId != userId.Value)
            {
                var notificationText = $"Задача «{task.ProductName}» отменена пользователем {cancelledByName}.\n\nПричина: {comment}";
                var message = new ChatMessage
                {
                    SenderId = SystemUser.Id,
                    ReceiverId = creatorId,
                    Text = notificationText
                };
                db.ChatMessages.Add(message);
            }

            await db.SaveChangesAsync();

            if (task.CreatedByUserId is Guid notifiedUserId && notifiedUserId != userId.Value)
            {
                await hub.Clients.All.SendAsync("ChatMessagesChanged", SystemUser.Id, notifiedUserId, null);
                await telegram.SendToUserAsync(
                    db,
                    notifiedUserId,
                    "chat.system.notification",
                    $"Задача «{task.ProductName}» отменена пользователем {cancelledByName}.\n\nПричина: {comment}");
            }

            await hub.Clients.All.SendAsync("ProductionTasksChanged");

            await IntegrationNotificationPublisher.PublishTaskAsync(
                telegram,
                db,
                task,
                "production.task.cancelled",
                ProductionTaskResponses.BuildCancelledTaskTelegramMessage(task, cancelledByName, comment));

            return Results.NoContent();
        }).RequireAuthorization();

        app.MapPut("/api/production/tasks/{id:guid}/complete", async (
            Guid id,
            CompleteProductionTaskRequest request,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub,
            TelegramNotificationService telegram) =>
        {
            var task = await db.ProductionTasks
                .Include(task => task.Items)
                .FirstOrDefaultAsync(task => task.Id == id);
            if (task is null)
            {
                return Results.NotFound();
            }

            if (task.Status != ProductionTaskStatuses.InProgress)
            {
                return Results.BadRequest("Завершить можно только задачу, которая уже в работе.");
            }

            var isNovinkaTask = ProductionTaskResponses.NormalizeTaskType(task.TaskType) == ProductionTaskTypes.Novinka;

            if (isNovinkaTask)
            {
                var files = await db.ProductionFiles.AsNoTracking().ToListAsync();
                var filePaths = await db.ProductionFilePaths.AsNoTracking().ToListAsync();
                foreach (var taskItem in task.Items.Count == 0
                             ? [new ProductionTaskItem { OfferId = task.OfferId, OzonProductId = task.OzonProductId, ProductName = task.ProductName }]
                             : task.Items)
                {
                    var hasFiles = files.Any(file =>
                        file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) &&
                        ProductionTaskResponses.MatchesProductionFile(file, taskItem));

                    if (!hasFiles)
                    {
                        return Results.BadRequest($"Добавьте превью для «{taskItem.ProductName}» перед завершением задачи.");
                    }

                    var savedPath = filePaths.FirstOrDefault(path =>
                        !string.IsNullOrWhiteSpace(path.Path) &&
                        ProductionTaskResponses.MatchesProductionFilePath(path, taskItem));

                    if (string.IsNullOrWhiteSpace(taskItem.FilePath) && savedPath is not null)
                    {
                        taskItem.FilePath = savedPath.Path;
                    }

                    if (string.IsNullOrWhiteSpace(taskItem.FilePath))
                    {
                        return Results.BadRequest($"Укажите путь к файлу для «{taskItem.ProductName}» перед завершением задачи.");
                    }
                }

                task.ActualQuantity = 0;
                foreach (var taskItem in task.Items)
                {
                    taskItem.ActualQuantity = null;
                }
            }
            else if (request.ActualQuantity < 0 || request.Items?.Any(item => item.ActualQuantity < 0) == true)
            {
                return Results.BadRequest("Фактическое количество не может быть меньше нуля.");
            }
            else if (request.Items is { Count: > 0 })
            {
                var taskItems = task.Items.ToDictionary(item => item.Id);
                foreach (var requestItem in request.Items)
                {
                    if (!taskItems.TryGetValue(requestItem.Id, out var taskItem))
                    {
                        return Results.BadRequest("В задаче есть неизвестный товар.");
                    }

                    taskItem.ActualQuantity = requestItem.ActualQuantity;
                }

                foreach (var taskItem in task.Items)
                {
                    if (taskItem.EnforceMinimumQuantity && (taskItem.ActualQuantity ?? 0) < taskItem.RequiredQuantity)
                    {
                        return Results.BadRequest(
                            $"Фактическое количество по «{taskItem.ProductName}» не может быть меньше {taskItem.RequiredQuantity}.");
                    }

                    if (taskItem.ActualQuantity is null)
                    {
                        return Results.BadRequest(
                            $"Сохраните фактическое количество по «{taskItem.ProductName}» перед завершением задачи.");
                    }
                }

                task.ActualQuantity = task.Items.Sum(item => item.ActualQuantity ?? 0);
            }
            else
            {
                task.ActualQuantity = request.ActualQuantity;
                if (task.Items.Count == 1)
                {
                    var singleItem = task.Items[0];
                    if (singleItem.EnforceMinimumQuantity && request.ActualQuantity < singleItem.RequiredQuantity)
                    {
                        return Results.BadRequest(
                            $"Фактическое количество по «{singleItem.ProductName}» не может быть меньше {singleItem.RequiredQuantity}.");
                    }

                    singleItem.ActualQuantity = request.ActualQuantity;
                }
            }

            task.Status = ProductionTaskStatuses.Completed;
            var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
            var currentUser = Guid.TryParse(currentUserId, out var parsedUserId)
                ? await db.Users.AsNoTracking().FirstOrDefaultAsync(user => user.Id == parsedUserId)
                : null;
            task.AssignedUserName ??= currentUser?.DisplayName ?? principal.FindFirstValue("display_name") ?? principal.FindFirstValue(ClaimTypes.Name);
            task.CompletedAt = DateTimeOffset.UtcNow;
            AuditLogWriter.Add(db, principal, "Задача завершена", "ProductionTask", task.Id.ToString(), $"{task.ProductName}. Факт: {task.ActualQuantity}");
            await db.SaveChangesAsync();
            await ProductionAnalyticsStore.UpsertFromTaskAsync(db, task);
            await hub.Clients.All.SendAsync("ProductionTasksChanged");

            var completedEventId = ProductionTaskResponses.ResolveCompletedTaskEventId(task);
            await IntegrationNotificationPublisher.PublishTaskAsync(
                telegram,
                db,
                task,
                completedEventId,
                ProductionTaskResponses.BuildCompletedTaskTelegramMessage(task));

            return Results.NoContent();
        }).RequireAuthorization();

        app.MapPut("/api/production/tasks/{id:guid}/archive", async (
            Guid id,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub,
            TelegramNotificationService telegram) =>
        {
            var task = await db.ProductionTasks
                .Include(entry => entry.Items)
                .FirstOrDefaultAsync(entry => entry.Id == id);
            if (task is null)
            {
                return Results.NotFound();
            }

            if (task.Status != ProductionTaskStatuses.Completed && task.Status != ProductionTaskStatuses.Cancelled)
            {
                return Results.BadRequest("В архив можно отправить только выполненную или отменённую задачу.");
            }

            if (!await UserRoleResolver.IsInRoleAsync(db, principal, UserRoles.Admin)
                && !await FeatureAccess.HasAnyAsync(db, principal, "production.archive"))
            {
                return Results.Forbid();
            }

            task.IsArchived = true;
            task.ArchivedAt = DateTimeOffset.UtcNow;
            AuditLogWriter.Add(db, principal, "Задача архивирована", "ProductionTask", task.Id.ToString(), task.ProductName);
            await db.SaveChangesAsync();
            await hub.Clients.All.SendAsync("ProductionTasksChanged");

            await IntegrationNotificationPublisher.PublishTaskAsync(
                telegram,
                db,
                task,
                "production.task.archived",
                ProductionTaskResponses.BuildArchivedTaskTelegramMessage(task));

            return Results.NoContent();
        }).RequireAuthorization();

        app.MapPut("/api/production/tasks/{id:guid}/restore", async (
            Guid id,
            RestoreProductionTaskRequest request,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub) =>
        {
            var task = await db.ProductionTasks
                .Include(entry => entry.Items)
                .FirstOrDefaultAsync(entry => entry.Id == id);
            if (task is null)
            {
                return Results.NotFound();
            }

            var targetStatus = string.IsNullOrWhiteSpace(request.Status)
                ? ProductionTaskStatuses.New
                : request.Status.Trim();
            if (targetStatus is not (ProductionTaskStatuses.New or
                ProductionTaskStatuses.InProgress or
                ProductionTaskStatuses.Completed or
                ProductionTaskStatuses.Cancelled))
            {
                return Results.BadRequest("Выберите допустимый статус для восстановления задачи.");
            }

            if (!task.IsArchived && task.Status != ProductionTaskStatuses.Cancelled)
            {
                return Results.BadRequest("Восстановить можно архивированную или отменённую задачу.");
            }

            task.Status = targetStatus;
            task.IsArchived = false;
            task.ArchivedAt = null;

            if (targetStatus != ProductionTaskStatuses.Cancelled)
            {
                task.CancelledAt = null;
                task.CancelledByUserId = null;
                task.CancelledByDisplayName = null;
                task.CancellationComment = null;
            }

            if (targetStatus != ProductionTaskStatuses.Completed)
            {
                task.CompletedAt = null;
            }

            if (targetStatus == ProductionTaskStatuses.New)
            {
                task.StartedAt = null;
                task.AssignedUserName = null;
                task.ActualQuantity = null;
                foreach (var item in task.Items)
                {
                    item.ActualQuantity = null;
                }
            }
            else if (targetStatus == ProductionTaskStatuses.InProgress)
            {
                task.StartedAt ??= DateTimeOffset.UtcNow;
            }
            else if (targetStatus == ProductionTaskStatuses.Completed)
            {
                task.CompletedAt ??= DateTimeOffset.UtcNow;
            }
            else
            {
                task.CancelledAt ??= DateTimeOffset.UtcNow;
            }

            AuditLogWriter.Add(db, principal, $"Задача восстановлена со статусом {targetStatus}", "ProductionTask", task.Id.ToString(), task.ProductName);
            await db.SaveChangesAsync();
            await hub.Clients.All.SendAsync("ProductionTasksChanged");

            return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

        app.MapDelete("/api/production/tasks/{id:guid}", async (
            Guid id,
            AppDbContext db,
            ClaimsPrincipal principal,
            IHubContext<AppHub> hub) =>
        {
            var task = await db.ProductionTasks.FindAsync(id);
            if (task is null)
            {
                return Results.NotFound();
            }

            if (!task.IsArchived)
            {
                return Results.BadRequest("Удалить задачу можно только из архива.");
            }

            db.ProductionTasks.Remove(task);
            AuditLogWriter.Add(db, principal, "Удаление задачи", "ProductionTask", task.Id.ToString(), task.ProductName);
            await db.SaveChangesAsync();
            await hub.Clients.All.SendAsync("ProductionTasksChanged");

            return Results.NoContent();
        }).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));
    }

    private static void RefreshProductionTaskSummary(ProductionTask task)
    {
        var normalizedTaskType = ProductionTaskResponses.NormalizeTaskType(task.TaskType);
        if (task.Items.Count == 0)
        {
            task.OzonProductId = 0;
            task.OfferId = string.Empty;
            task.ProductName = normalizedTaskType == ProductionTaskTypes.Novinka ? "Новинки · 0 товаров" : "Задача на 0 товаров";
            task.RequiredQuantity = 0;
            task.ActualQuantity = null;
            return;
        }

        var firstItem = task.Items[0];
        task.OzonProductId = firstItem.OzonProductId;
        task.OfferId = firstItem.OfferId;
        task.ProductName = task.Items.Count == 1
            ? firstItem.ProductName
            : normalizedTaskType == ProductionTaskTypes.Novinka
                ? $"Новинки · {task.Items.Count} товаров"
                : $"Задача на {task.Items.Count} товаров";
        task.RequiredQuantity = task.Items.Sum(item => item.RequiredQuantity);
        task.ActualQuantity = normalizedTaskType == ProductionTaskTypes.Novinka
            ? 0
            : task.Items.Any(item => item.ActualQuantity is null)
                ? null
                : task.Items.Sum(item => item.ActualQuantity ?? 0);
    }

    private static async Task CopySourceNovinkaPathsAsync(
        AppDbContext db,
        IReadOnlyCollection<CreateProductionTaskItemRequest> requestItems,
        IReadOnlyList<ProductionTaskItem> builtItems)
    {
        var indexedRequests = requestItems.ToList();
        var sourceItemIds = indexedRequests
            .Select(item => item.SourceTaskItemId)
            .Where(id => id.HasValue)
            .Select(id => id!.Value)
            .Distinct()
            .ToList();

        if (sourceItemIds.Count == 0)
        {
            return;
        }

        var sourceItems = await db.ProductionTaskItems
            .AsNoTracking()
            .Where(item => sourceItemIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id);

        for (var index = 0; index < indexedRequests.Count && index < builtItems.Count; index++)
        {
            var sourceItemId = indexedRequests[index].SourceTaskItemId;
            if (!sourceItemId.HasValue ||
                !sourceItems.TryGetValue(sourceItemId.Value, out var sourceItem) ||
                string.IsNullOrWhiteSpace(sourceItem.FilePath) ||
                !string.IsNullOrWhiteSpace(builtItems[index].FilePath))
            {
                continue;
            }

            builtItems[index].FilePath = sourceItem.FilePath;
        }
    }

    private static async Task CopySourceNovinkaPreviewsAsync(
        AppDbContext db,
        IReadOnlyCollection<CreateProductionTaskItemRequest> requestItems,
        IReadOnlyList<ProductionTaskItem> builtItems)
    {
        var indexedRequests = requestItems.ToList();
        var sourceItemIds = indexedRequests
            .Select(item => item.SourceTaskItemId)
            .Where(id => id.HasValue)
            .Select(id => id!.Value)
            .Distinct()
            .ToList();

        if (sourceItemIds.Count == 0)
        {
            return;
        }

        var sourceFiles = await db.ProductionFiles
            .AsNoTracking()
            .Where(file =>
                file.ProductionTaskItemId.HasValue &&
                sourceItemIds.Contains(file.ProductionTaskItemId.Value) &&
                file.ContentType.ToLower().StartsWith("image/"))
            .ToListAsync();

        for (var index = 0; index < indexedRequests.Count && index < builtItems.Count; index++)
        {
            var sourceItemId = indexedRequests[index].SourceTaskItemId;
            if (!sourceItemId.HasValue)
            {
                continue;
            }

            var targetItem = builtItems[index];
            foreach (var sourceFile in sourceFiles.Where(file => file.ProductionTaskItemId == sourceItemId.Value))
            {
                db.ProductionFiles.Add(new ProductionFile
                {
                    ProductionTaskItemId = targetItem.Id,
                    OzonProductId = targetItem.OzonProductId > 0 ? targetItem.OzonProductId : sourceFile.OzonProductId,
                    OfferId = targetItem.OfferId,
                    ProductName = targetItem.ProductName,
                    ProductLink = targetItem.ProductLink,
                    Notes = sourceFile.Notes,
                    FileName = sourceFile.FileName,
                    ContentType = sourceFile.ContentType,
                    Content = sourceFile.Content.ToArray(),
                    CreatedAt = DateTimeOffset.UtcNow
                });
            }
        }
    }

    private static async Task<bool> CanWorkWithDesignerTasksAsync(AppDbContext db, ClaimsPrincipal principal)
    {
        var role = await UserRoleResolver.GetRoleAsync(db, principal) ?? string.Empty;
        if (role == UserRoles.Admin || role == UserRoles.Designer)
        {
            return true;
        }

        var userId = UserRoleResolver.GetUserId(principal);
        var allowedFeatures = userId is Guid id
            ? await db.Users
                .AsNoTracking()
                .Where(user => user.Id == id && user.IsActive)
                .Select(user => user.AllowedFeatures)
                .FirstOrDefaultAsync()
            : null;

        return FeatureAccess.CanSeeNovinkaProductionTasks(
            role,
            FeatureAccess.Parse(allowedFeatures ?? string.Empty));
    }

    private static async Task<IResult> MoveDesignerTaskItemAsync(
        AppDbContext db,
        ClaimsPrincipal principal,
        IHubContext<AppHub> hub,
        Guid taskId,
        Guid itemId,
        Guid targetUserId,
        bool requireCurrentAssignee)
    {
        var currentUserId = UserRoleResolver.GetUserId(principal);
        if (currentUserId is null)
        {
            return Results.Unauthorized();
        }

        var currentUser = await db.Users.AsNoTracking().FirstOrDefaultAsync(user => user.Id == currentUserId.Value);
        var currentUserNames = new[]
            {
                currentUser?.DisplayName,
                currentUser?.UserName,
                principal.FindFirstValue("display_name"),
                principal.FindFirstValue(ClaimTypes.Name)
            }
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name!.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var currentDisplayName = currentUserNames.FirstOrDefault() ?? string.Empty;

        var targetUser = await db.Users.AsNoTracking().FirstOrDefaultAsync(user => user.Id == targetUserId && user.IsActive);
        if (targetUser is null)
        {
            return Results.BadRequest("Выберите активного дизайнера.");
        }

        if (requireCurrentAssignee && targetUser.Role != UserRoles.Designer)
        {
            return Results.BadRequest("Выберите дизайнера.");
        }

        if (!requireCurrentAssignee && targetUser.Id != currentUserId.Value && targetUser.Role != UserRoles.Designer)
        {
            return Results.BadRequest("Выберите дизайнера.");
        }

        var targetDisplayName = targetUser.DisplayName
            ?? targetUser.UserName
            ?? string.Empty;
        if (string.IsNullOrWhiteSpace(targetDisplayName))
        {
            return Results.BadRequest("Не удалось определить получателя.");
        }

        var targetUserNames = new[]
            {
                targetUser.DisplayName,
                targetUser.UserName,
                targetDisplayName
            }
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name!.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var sourceTask = await db.ProductionTasks
            .Include(task => task.Items)
            .FirstOrDefaultAsync(task => task.Id == taskId);
        if (sourceTask is null)
        {
            return Results.NotFound();
        }

        if (ProductionTaskResponses.NormalizeTaskType(sourceTask.TaskType) != ProductionTaskTypes.Novinka)
        {
            return Results.BadRequest("Переносить можно только товар из дизайнерской задачи.");
        }

        if (sourceTask.Status is not (ProductionTaskStatuses.New or ProductionTaskStatuses.InProgress) || sourceTask.IsArchived)
        {
            return Results.BadRequest("Перенести товар можно только из новой дизайнерской задачи или задачи в работе.");
        }

        var isAdmin = await UserRoleResolver.IsInRoleAsync(db, principal, UserRoles.Admin);
        if (requireCurrentAssignee)
        {
            if (targetUser.Id == currentUserId.Value)
            {
                return Results.BadRequest("Выберите другого дизайнера.");
            }

            if (!isAdmin &&
                !currentUserNames.Any(name =>
                    string.Equals(sourceTask.AssignedUserName?.Trim(), name, StringComparison.OrdinalIgnoreCase)))
            {
                return Results.Forbid();
            }
        }
        else if (sourceTask.Status == ProductionTaskStatuses.InProgress &&
                 string.Equals(sourceTask.AssignedUserName, targetDisplayName, StringComparison.OrdinalIgnoreCase))
        {
            return Results.BadRequest("Этот товар уже находится в вашей задаче.");
        }

        var activeTargetTasks = await db.ProductionTasks
            .Include(task => task.Items)
            .Where(task =>
                task.Id != sourceTask.Id &&
                !task.IsArchived &&
                task.Status == ProductionTaskStatuses.InProgress &&
                task.TaskType == ProductionTaskTypes.Novinka)
            .OrderByDescending(task => task.StartedAt ?? task.CreatedAt)
            .ThenByDescending(task => task.CreatedAt)
            .ToListAsync();
        var activeTargetTask = activeTargetTasks.FirstOrDefault(task =>
            targetUserNames.Any(name =>
                string.Equals(task.AssignedUserName?.Trim(), name, StringComparison.OrdinalIgnoreCase)));

        var sourceItem = sourceTask.Items.FirstOrDefault(item => item.Id == itemId);
        if (sourceItem is null)
        {
            return Results.NotFound();
        }

        var preservedCreatorUserId = sourceTask.CreatedByUserId ?? currentUser?.Id;
        var preservedCreatorDisplayName = string.IsNullOrWhiteSpace(sourceTask.CreatedByDisplayName)
            ? currentDisplayName
            : sourceTask.CreatedByDisplayName.Trim();

        var targetItem = new ProductionTaskItem
        {
            OzonProductId = sourceItem.OzonProductId,
            OfferId = sourceItem.OfferId,
            ProductName = sourceItem.ProductName,
            ProductLink = sourceItem.ProductLink,
            RequiredQuantity = sourceItem.RequiredQuantity,
            ActualQuantity = sourceItem.ActualQuantity,
            EnforceMinimumQuantity = sourceItem.EnforceMinimumQuantity,
            FilePath = sourceItem.FilePath
        };

        var targetTask = activeTargetTask ?? new ProductionTask
        {
            TaskType = ProductionTaskTypes.Novinka,
            OzonProductId = sourceItem.OzonProductId,
            OfferId = sourceItem.OfferId,
            ProductName = sourceItem.ProductName,
            RequiredQuantity = 0,
            Status = ProductionTaskStatuses.InProgress,
            IsUrgent = sourceTask.IsUrgent,
            DueAt = sourceTask.DueAt,
            CreatedByUserId = preservedCreatorUserId,
            CreatedByDisplayName = preservedCreatorDisplayName,
            AssignedUserName = targetDisplayName,
            StartedAt = DateTimeOffset.UtcNow,
            Items = []
        };

        targetTask.Items.Add(targetItem);
        targetItem.ProductionTaskId = targetTask.Id;
        RefreshProductionTaskSummary(targetTask);
        if (activeTargetTask is null)
        {
            db.ProductionTasks.Add(targetTask);
        }

        db.ProductionTaskItems.Remove(sourceItem);
        sourceTask.Items.Remove(sourceItem);
        RefreshProductionTaskSummary(sourceTask);

        if (sourceTask.Items.Count == 0)
        {
            db.ProductionTasks.Remove(sourceTask);
        }

        AuditLogWriter.Add(
            db,
            principal,
            requireCurrentAssignee ? "Товар передан дизайнеру" : "Товар забран дизайнером",
            "ProductionTask",
            targetTask.Id.ToString(),
            $"{sourceItem.ProductName}. Из задачи: {sourceTask.Id}. Кому: {targetDisplayName}");

        await db.SaveChangesAsync();
        await hub.Clients.All.SendAsync("ProductionTasksChanged");

        return Results.Ok(ProductionTaskResponses.ToListItem(targetTask));
    }
}

