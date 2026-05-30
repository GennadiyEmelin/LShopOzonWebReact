using System.Security.Claims;
using System.Text;
using System.Xml.Linq;
using System.IO.Compression;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Hubs;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Ozon;
using LShopOzonWebReact.Api.Security;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Postgres")));
builder.Services.Configure<OzonOptions>(builder.Configuration.GetSection("Ozon"));
builder.Services.AddHttpClient<OzonApiClient>((serviceProvider, client) =>
{
    var options = serviceProvider.GetRequiredService<Microsoft.Extensions.Options.IOptions<OzonOptions>>().Value;
    client.BaseAddress = new Uri(options.BaseUrl);
});
builder.Services.AddScoped<JwtTokenService>();
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        var key = builder.Configuration["Jwt:Key"]
            ?? throw new InvalidOperationException("Jwt:Key is not configured.");

        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key))
        };
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrWhiteSpace(accessToken) && path.StartsWithSegments("/hubs/live"))
                {
                    context.Token = accessToken;
                }

                return Task.CompletedTask;
            }
        };
    });
builder.Services.AddAuthorization();
builder.Services.AddSignalR();
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});
builder.Services.AddCors(options =>
{
    options.AddPolicy("ReactDev", policy =>
        policy.WithOrigins("http://localhost:5173")
            .AllowAnyHeader()
            .AllowAnyMethod());
});

var app = builder.Build();

if (app.Configuration.GetValue<bool>("Database:ApplyMigrationsOnStartup"))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.Migrate();
}

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

var hasStaticClient = !string.IsNullOrWhiteSpace(app.Environment.WebRootPath)
    && Directory.Exists(app.Environment.WebRootPath);

app.UseForwardedHeaders();
if (app.Environment.IsDevelopment() || app.Configuration.GetValue<bool>("Https:UseRedirection"))
{
    app.UseHttpsRedirection();
}
if (hasStaticClient)
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
}
app.UseCors("ReactDev");
app.UseAuthentication();
app.UseAuthorization();

app.MapHub<AppHub>("/hubs/live").RequireAuthorization();

app.MapPost("/api/setup/admin", async (CreateInitialAdminRequest request, AppDbContext db) =>
{
    if (await db.Users.AnyAsync())
    {
        return Results.Conflict("Первый админ уже создан.");
    }

    if (string.IsNullOrWhiteSpace(request.UserName) || string.IsNullOrWhiteSpace(request.Password))
    {
        return Results.BadRequest("Логин и пароль обязательны.");
    }

    var admin = new AppUser
    {
        UserName = request.UserName.Trim(),
        DisplayName = request.DisplayName.Trim(),
        PasswordHash = PasswordHasher.Hash(request.Password),
        Role = UserRoles.Admin
    };

    db.Users.Add(admin);
    await db.SaveChangesAsync();

    return Results.Created("/api/admin/users", new CurrentUserResponse(
        admin.Id,
        admin.UserName,
        admin.DisplayName,
        admin.Role));
});

var products = new[]
{
    new Product(1, "Ozon карточка товара", "Готова к публикации", 1290),
    new Product(2, "Складской остаток", "12 единиц в наличии", 3490),
    new Product(3, "Заказ клиента", "Ожидает обработки", 780)
};

app.MapPost("/api/auth/login", async (
    LoginRequest request,
    AppDbContext db,
    JwtTokenService tokenService) =>
{
    var user = await db.Users
        .SingleOrDefaultAsync(item => item.UserName == request.UserName);

    if (user is null || !user.IsActive || !PasswordHasher.Verify(request.Password, user.PasswordHash))
    {
        return Results.Unauthorized();
    }

    user.LastSeenAt = DateTimeOffset.UtcNow;
    await db.SaveChangesAsync();

    return Results.Ok(new AuthResponse(
        tokenService.CreateToken(user),
        new CurrentUserResponse(user.Id, user.UserName, user.DisplayName, user.Role)));
});

app.MapPost("/api/auth/heartbeat", async (AppDbContext db, ClaimsPrincipal principal) =>
{
    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!Guid.TryParse(currentUserId, out var userId))
    {
        return Results.Unauthorized();
    }

    var user = await db.Users.FindAsync(userId);
    if (user is null || !user.IsActive)
    {
        return Results.Unauthorized();
    }

    user.LastSeenAt = DateTimeOffset.UtcNow;
    await db.SaveChangesAsync();

    return Results.NoContent();
}).RequireAuthorization();

app.MapPost("/api/auth/logout", async (AppDbContext db, ClaimsPrincipal principal) =>
{
    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (Guid.TryParse(currentUserId, out var userId))
    {
        var user = await db.Users.FindAsync(userId);
        if (user is not null)
        {
            user.LastSeenAt = null;
            await db.SaveChangesAsync();
        }
    }

    return Results.NoContent();
}).RequireAuthorization();

app.MapGet("/api/auth/me", (ClaimsPrincipal principal) =>
{
    var id = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    var userName = principal.FindFirstValue(ClaimTypes.Name) ?? string.Empty;
    var role = principal.FindFirstValue(ClaimTypes.Role) ?? string.Empty;

    return Results.Ok(new
    {
        id,
        userName,
        role
    });
}).RequireAuthorization();

app.MapGet("/api/admin/users", async (AppDbContext db) =>
{
    var onlineAfter = DateTimeOffset.UtcNow.AddMinutes(-2);
    return await db.Users
        .OrderBy(user => user.UserName)
        .Select(user => new UserListItem(
            user.Id,
            user.UserName,
            user.DisplayName,
            user.Role,
            user.IsActive,
            user.CreatedAt,
            user.LastSeenAt,
            user.LastSeenAt >= onlineAfter))
        .ToListAsync();
})
    .RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapPost("/api/admin/users", async (CreateUserRequest request, AppDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(request.UserName) || string.IsNullOrWhiteSpace(request.Password))
    {
        return Results.BadRequest("Логин и пароль обязательны.");
    }

    var exists = await db.Users.AnyAsync(user => user.UserName == request.UserName);
    if (exists)
    {
        return Results.Conflict("Пользователь с таким логином уже есть.");
    }

    var role = request.Role == UserRoles.Admin ? UserRoles.Admin : UserRoles.User;
    var user = new AppUser
    {
        UserName = request.UserName.Trim(),
        DisplayName = request.DisplayName.Trim(),
        PasswordHash = PasswordHasher.Hash(request.Password),
        Role = role
    };

    db.Users.Add(user);
    await db.SaveChangesAsync();

    return Results.Created($"/api/admin/users/{user.Id}", new UserListItem(
        user.Id,
        user.UserName,
        user.DisplayName,
        user.Role,
        user.IsActive,
        user.CreatedAt,
        user.LastSeenAt,
        false));
}).RequireAuthorization();

app.MapPut("/api/admin/users/{id:guid}/password", async (
    Guid id,
    ChangeUserPasswordRequest request,
    AppDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(request.Password))
    {
        return Results.BadRequest("Пароль обязателен.");
    }

    var user = await db.Users.FindAsync(id);
    if (user is null)
    {
        return Results.NotFound();
    }

    user.PasswordHash = PasswordHasher.Hash(request.Password);
    await db.SaveChangesAsync();

    return Results.NoContent();
}).RequireAuthorization();

app.MapDelete("/api/admin/users/{id:guid}", async (Guid id, AppDbContext db, ClaimsPrincipal principal) =>
{
    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (currentUserId == id.ToString())
    {
        return Results.BadRequest("Нельзя удалить самого себя.");
    }

    var user = await db.Users.FindAsync(id);
    if (user is null)
    {
        return Results.NotFound();
    }

    db.Users.Remove(user);
    await db.SaveChangesAsync();

    return Results.NoContent();
}).RequireAuthorization();

app.MapGet("/api/chat/users", async (AppDbContext db, ClaimsPrincipal principal) =>
{
    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!Guid.TryParse(currentUserId, out var userId))
    {
        return Results.Unauthorized();
    }

    var unreadCounts = await db.ChatMessages
        .AsNoTracking()
        .Where(message => message.ReceiverId == userId && message.ReadAt == null)
        .GroupBy(message => message.SenderId)
        .Select(group => new { UserId = group.Key, Count = group.Count() })
        .ToDictionaryAsync(item => item.UserId, item => item.Count);

    var onlineAfter = DateTimeOffset.UtcNow.AddMinutes(-2);
    var users = await db.Users
        .AsNoTracking()
        .Where(user => user.Id != userId && user.IsActive)
        .OrderBy(user => user.DisplayName)
        .Select(user => new
        {
            user.Id,
            user.UserName,
            user.DisplayName,
            user.Role,
            user.LastSeenAt,
            IsOnline = user.LastSeenAt >= onlineAfter
        })
        .ToListAsync();

    return Results.Ok(users.Select(user => new ChatUserListItem(
        user.Id,
        user.UserName,
        user.DisplayName,
        user.Role,
        user.LastSeenAt,
        user.IsOnline,
        unreadCounts.GetValueOrDefault(user.Id))));
}).RequireAuthorization();

app.MapGet("/api/chat/{userId:guid}/messages", async (
    Guid userId,
    AppDbContext db,
    ClaimsPrincipal principal) =>
{
    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!Guid.TryParse(currentUserId, out var parsedCurrentUserId))
    {
        return Results.Unauthorized();
    }

    var chatUserExists = await db.Users.AnyAsync(user => user.Id == userId && user.IsActive);
    if (!chatUserExists)
    {
        return Results.NotFound();
    }

    var unreadMessages = await db.ChatMessages
        .Where(message =>
            message.SenderId == userId &&
            message.ReceiverId == parsedCurrentUserId &&
            message.ReadAt == null)
        .ToListAsync();

    if (unreadMessages.Count > 0)
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var message in unreadMessages)
        {
            message.ReadAt = now;
        }

        await db.SaveChangesAsync();
    }

    var messages = await db.ChatMessages
        .AsNoTracking()
        .Where(message =>
            message.SenderId == parsedCurrentUserId && message.ReceiverId == userId ||
            message.SenderId == userId && message.ReceiverId == parsedCurrentUserId)
        .OrderBy(message => message.CreatedAt)
        .Select(message => new ChatMessageListItem(
            message.Id,
            message.SenderId,
            message.ReceiverId,
            message.Text,
            message.CreatedAt,
            message.SenderId == parsedCurrentUserId))
        .ToListAsync();

    return Results.Ok(messages);
}).RequireAuthorization();

app.MapPost("/api/chat/{userId:guid}/messages", async (
    Guid userId,
    CreateChatMessageRequest request,
    AppDbContext db,
    ClaimsPrincipal principal,
    IHubContext<AppHub> hub) =>
{
    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!Guid.TryParse(currentUserId, out var parsedCurrentUserId))
    {
        return Results.Unauthorized();
    }

    if (parsedCurrentUserId == userId)
    {
        return Results.BadRequest("Нельзя отправить сообщение самому себе.");
    }

    var text = request.Text.Trim();
    if (string.IsNullOrWhiteSpace(text))
    {
        return Results.BadRequest("Сообщение не может быть пустым.");
    }

    if (text.Length > 2000)
    {
        return Results.BadRequest("Сообщение слишком длинное.");
    }

    var receiverExists = await db.Users.AnyAsync(user => user.Id == userId && user.IsActive);
    if (!receiverExists)
    {
        return Results.NotFound();
    }

    var message = new ChatMessage
    {
        SenderId = parsedCurrentUserId,
        ReceiverId = userId,
        Text = text
    };

    db.ChatMessages.Add(message);
    await db.SaveChangesAsync();

    var result = new ChatMessageListItem(
        message.Id,
        message.SenderId,
        message.ReceiverId,
        message.Text,
        message.CreatedAt,
        true);

    await hub.Clients.All.SendAsync("ChatMessagesChanged", message.SenderId, message.ReceiverId);

    return Results.Created($"/api/chat/{userId}/messages/{message.Id}", result);
}).RequireAuthorization();

app.MapDelete("/api/chat/messages/{id:guid}", async (
    Guid id,
    AppDbContext db,
    ClaimsPrincipal principal,
    IHubContext<AppHub> hub) =>
{
    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!Guid.TryParse(currentUserId, out var parsedCurrentUserId))
    {
        return Results.Unauthorized();
    }

    var message = await db.ChatMessages.FindAsync(id);
    if (message is null)
    {
        return Results.NotFound();
    }

    var isAdmin = principal.IsInRole(UserRoles.Admin);
    if (message.SenderId != parsedCurrentUserId && !isAdmin)
    {
        return Results.Forbid();
    }

    db.ChatMessages.Remove(message);
    await db.SaveChangesAsync();
    await hub.Clients.All.SendAsync("ChatMessagesChanged", message.SenderId, message.ReceiverId);

    return Results.NoContent();
}).RequireAuthorization();

app.MapGet("/api/products", () => products)
    .WithName("GetProducts")
    .RequireAuthorization();

app.MapGet("/api/ozon/products", async (OzonApiClient ozonApi, CancellationToken cancellationToken) =>
{
    try
    {
        var result = await ozonApi.GetProductSummariesAsync(100, cancellationToken);
        return Results.Ok(result);
    }
    catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
    {
        return Results.Problem(exception.Message);
    }
}).RequireAuthorization();

app.MapGet("/api/ozon/stocks", async (OzonApiClient ozonApi, CancellationToken cancellationToken) =>
{
    try
    {
        var result = await ozonApi.GetStockSummariesAsync(100, cancellationToken);
        return Results.Ok(result);
    }
    catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
    {
        return Results.Problem(exception.Message);
    }
}).RequireAuthorization();

app.MapPut("/api/ozon/prices", async (
    OzonPriceUpdateRequest request,
    OzonApiClient ozonApi,
    CancellationToken cancellationToken) =>
{
    try
    {
        var result = await ozonApi.UpdatePriceAsync(request, cancellationToken);
        return Results.Ok(result);
    }
    catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
    {
        return Results.Problem(exception.Message);
    }
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapGet("/api/ozon/analytics", async (OzonApiClient ozonApi, CancellationToken cancellationToken) =>
{
    try
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var result = await ozonApi.GetAnalyticsAsync(today.AddDays(-27), today, cancellationToken);
        return Results.Ok(result);
    }
    catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
    {
        return Results.Problem(exception.Message);
    }
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapGet("/api/production/files", async (string? search, AppDbContext db) =>
{
    var query = db.ProductionFiles.AsNoTracking();

    if (!string.IsNullOrWhiteSpace(search))
    {
        var value = search.Trim().ToLower();
        query = query.Where(file =>
            file.OfferId.ToLower().Contains(value) ||
            file.ProductName.ToLower().Contains(value) ||
            file.Notes.ToLower().Contains(value));
    }

    return await query
        .OrderByDescending(file => file.CreatedAt)
        .Select(file => new ProductionFileListItem(
            file.Id,
            file.OzonProductId,
            file.OfferId,
            file.ProductName,
            file.Notes,
            file.FileName,
            file.ContentType,
            file.CreatedAt))
        .ToListAsync();
}).RequireAuthorization();

app.MapPost("/api/production/files", async (
    HttpRequest request,
    AppDbContext db,
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

    await using var stream = file.OpenReadStream();
    using var memory = new MemoryStream();
    await stream.CopyToAsync(memory, cancellationToken);

    var productionFile = new ProductionFile
    {
        OzonProductId = long.TryParse(form["ozonProductId"], out var productId) ? productId : null,
        OfferId = form["offerId"].ToString().Trim(),
        ProductName = form["productName"].ToString().Trim(),
        Notes = form["notes"].ToString().Trim(),
        FileName = Path.GetFileName(file.FileName),
        ContentType = string.IsNullOrWhiteSpace(file.ContentType)
            ? "application/octet-stream"
            : file.ContentType,
        Content = memory.ToArray()
    };

    db.ProductionFiles.Add(productionFile);
    await db.SaveChangesAsync(cancellationToken);

    return Results.Created($"/api/production/files/{productionFile.Id}", new ProductionFileListItem(
        productionFile.Id,
        productionFile.OzonProductId,
        productionFile.OfferId,
        productionFile.ProductName,
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

app.MapDelete("/api/production/files/{id:guid}", async (Guid id, AppDbContext db) =>
{
    var file = await db.ProductionFiles.FindAsync(id);
    if (file is null)
    {
        return Results.NotFound();
    }

    db.ProductionFiles.Remove(file);
    await db.SaveChangesAsync();

    return Results.NoContent();
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapGet("/api/production/tasks", async (string? status, AppDbContext db) =>
{
    IQueryable<ProductionTask> query = db.ProductionTasks
        .AsNoTracking()
        .Include(task => task.Items);

    if (!string.IsNullOrWhiteSpace(status))
    {
        query = query.Where(task => task.Status == status);
    }

    return await query
        .OrderByDescending(task => task.CreatedAt)
        .Select(task => new ProductionTaskListItem(
            task.Id,
            task.OzonProductId,
            task.OfferId,
            task.ProductName,
            task.RequiredQuantity,
            task.ActualQuantity,
            task.Status,
            task.AssignedUserName,
            task.CreatedAt,
            task.StartedAt,
            task.DeferredAt,
            task.CompletedAt,
            task.IsArchived,
            task.ArchivedAt,
            task.Items.Count == 0
                ? new List<ProductionTaskItemListItem>
                {
                    new(task.Id, task.OzonProductId, task.OfferId, task.ProductName, task.RequiredQuantity, task.ActualQuantity)
                }
                : task.Items
                    .OrderBy(item => item.ProductName)
                    .Select(item => new ProductionTaskItemListItem(
                        item.Id,
                        item.OzonProductId,
                        item.OfferId,
                        item.ProductName,
                        item.RequiredQuantity,
                        item.ActualQuantity))
                    .ToList()))
        .ToListAsync();
}).RequireAuthorization();

app.MapPost("/api/production/tasks", async (
    CreateProductionTaskRequest request,
    AppDbContext db,
    IHubContext<AppHub> hub) =>
{
    var requestItems = request.Items is { Count: > 0 }
        ? request.Items
        : [new CreateProductionTaskItemRequest(
            request.OzonProductId,
            request.OfferId,
            request.ProductName,
            request.RequiredQuantity)];

    if (requestItems.Any(item => item.OzonProductId <= 0 || item.RequiredQuantity <= 0))
    {
        return Results.BadRequest("Выберите товар и укажите количество больше нуля.");
    }

    var firstItem = requestItems[0];
    var task = new ProductionTask
    {
        OzonProductId = firstItem.OzonProductId,
        OfferId = firstItem.OfferId.Trim(),
        ProductName = requestItems.Count == 1
            ? firstItem.ProductName.Trim()
            : $"Задача на {requestItems.Count} товаров",
        RequiredQuantity = requestItems.Sum(item => item.RequiredQuantity),
        Items = requestItems.Select(item => new ProductionTaskItem
        {
            OzonProductId = item.OzonProductId,
            OfferId = item.OfferId.Trim(),
            ProductName = item.ProductName.Trim(),
            RequiredQuantity = item.RequiredQuantity
        }).ToList()
    };

    db.ProductionTasks.Add(task);
    await db.SaveChangesAsync();

    var result = new ProductionTaskListItem(
        task.Id,
        task.OzonProductId,
        task.OfferId,
        task.ProductName,
        task.RequiredQuantity,
        task.ActualQuantity,
        task.Status,
        task.AssignedUserName,
        task.CreatedAt,
        task.StartedAt,
        task.DeferredAt,
        task.CompletedAt,
        task.IsArchived,
        task.ArchivedAt,
        task.Items.Select(item => new ProductionTaskItemListItem(
            item.Id,
            item.OzonProductId,
            item.OfferId,
            item.ProductName,
            item.RequiredQuantity,
            item.ActualQuantity)).ToList());

    await hub.Clients.All.SendAsync("ProductionTasksChanged", result);

    return Results.Created($"/api/production/tasks/{task.Id}", result);
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapPut("/api/production/tasks/{id:guid}/start", async (
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

    if (task.Status == ProductionTaskStatuses.Completed)
    {
        return Results.BadRequest("Выполненную задачу нельзя взять в работу.");
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
    await db.SaveChangesAsync();
    await hub.Clients.All.SendAsync("ProductionTasksChanged");

    return Results.NoContent();
}).RequireAuthorization();

app.MapPut("/api/production/tasks/{id:guid}/defer", async (
    Guid id,
    AppDbContext db,
    IHubContext<AppHub> hub) =>
{
    var task = await db.ProductionTasks.FindAsync(id);
    if (task is null)
    {
        return Results.NotFound();
    }

    if (task.Status == ProductionTaskStatuses.Completed)
    {
        return Results.BadRequest("Выполненную задачу нельзя отложить.");
    }

    task.Status = ProductionTaskStatuses.Deferred;
    task.DeferredAt = DateTimeOffset.UtcNow;
    await db.SaveChangesAsync();
    await hub.Clients.All.SendAsync("ProductionTasksChanged");

    return Results.NoContent();
}).RequireAuthorization();

app.MapPut("/api/production/tasks/{id:guid}/complete", async (
    Guid id,
    CompleteProductionTaskRequest request,
    AppDbContext db,
    ClaimsPrincipal principal,
    IHubContext<AppHub> hub) =>
{
    if (request.ActualQuantity < 0 || request.Items?.Any(item => item.ActualQuantity < 0) == true)
    {
        return Results.BadRequest("Фактическое количество не может быть меньше нуля.");
    }

    var task = await db.ProductionTasks
        .Include(task => task.Items)
        .FirstOrDefaultAsync(task => task.Id == id);
    if (task is null)
    {
        return Results.NotFound();
    }

    if (request.Items is { Count: > 0 })
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

        task.ActualQuantity = task.Items.Sum(item => item.ActualQuantity ?? 0);
    }
    else
    {
        task.ActualQuantity = request.ActualQuantity;
        if (task.Items.Count == 1)
        {
            task.Items[0].ActualQuantity = request.ActualQuantity;
        }
    }

    task.Status = ProductionTaskStatuses.Completed;
    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    var currentUser = Guid.TryParse(currentUserId, out var parsedUserId)
        ? await db.Users.AsNoTracking().FirstOrDefaultAsync(user => user.Id == parsedUserId)
        : null;
    task.AssignedUserName ??= currentUser?.DisplayName ?? principal.FindFirstValue("display_name") ?? principal.FindFirstValue(ClaimTypes.Name);
    task.CompletedAt = DateTimeOffset.UtcNow;
    await db.SaveChangesAsync();
    await hub.Clients.All.SendAsync("ProductionTasksChanged");

    return Results.NoContent();
}).RequireAuthorization();

app.MapPut("/api/production/tasks/{id:guid}/archive", async (
    Guid id,
    AppDbContext db,
    IHubContext<AppHub> hub) =>
{
    var task = await db.ProductionTasks.FindAsync(id);
    if (task is null)
    {
        return Results.NotFound();
    }

    if (task.Status != ProductionTaskStatuses.Completed)
    {
        return Results.BadRequest("В архив можно отправить только выполненную задачу.");
    }

    task.IsArchived = true;
    task.ArchivedAt = DateTimeOffset.UtcNow;
    await db.SaveChangesAsync();
    await hub.Clients.All.SendAsync("ProductionTasksChanged");

    return Results.NoContent();
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapDelete("/api/production/tasks/{id:guid}", async (
    Guid id,
    AppDbContext db,
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
    await db.SaveChangesAsync();
    await hub.Clients.All.SendAsync("ProductionTasksChanged");

    return Results.NoContent();
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapGet("/api/supplies", async (AppDbContext db) =>
    await db.Supplies
        .AsNoTracking()
        .Include(supply => supply.Items)
        .OrderByDescending(supply => supply.CreatedAt)
        .Select(supply => new SupplyListItem(
            supply.Id,
            supply.Status,
            supply.CreatedAt,
            supply.SentAt,
            supply.AcceptedAt,
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
                    item.IsReserve))
                .ToList()))
        .ToListAsync())
    .RequireAuthorization();

app.MapPost("/api/supplies", async (CreateSupplyRequest request, AppDbContext db) =>
{
    if (request.Items.Count == 0)
    {
        return Results.BadRequest("Добавьте хотя бы один товар в поставку.");
    }

    var supply = new Supply
    {
        Status = SupplyStatuses.Created,
        Items = request.Items.Select(item => new SupplyItem
        {
            OzonProductId = item.IsReserve ? null : item.OzonProductId,
            OfferId = item.IsReserve ? string.Empty : item.OfferId.Trim(),
            ProductName = item.ProductName.Trim(),
            Quantity = item.Quantity,
            IsReserve = item.IsReserve
        }).ToList()
    };

    if (supply.Items.Any(item => item.Quantity <= 0 || string.IsNullOrWhiteSpace(item.ProductName)))
    {
        return Results.BadRequest("Укажите название и количество больше нуля для каждой строки.");
    }

    db.Supplies.Add(supply);
    await db.SaveChangesAsync();

    return Results.Created($"/api/supplies/{supply.Id}", new SupplyListItem(
        supply.Id,
        supply.Status,
        supply.CreatedAt,
        supply.SentAt,
        supply.AcceptedAt,
        supply.IsArchived,
        supply.ArchivedAt,
        supply.Items.Select(item => new SupplyItemListItem(
            item.Id,
            item.OzonProductId,
            item.OfferId,
            item.ProductName,
            item.Quantity,
            item.IsReserve)).ToList()));
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
        Items = importedItems.Select(item => new SupplyItem
        {
            OzonProductId = item.IsReserve ? null : item.OzonProductId,
            OfferId = item.IsReserve ? string.Empty : item.OfferId.Trim(),
            ProductName = item.ProductName.Trim(),
            Quantity = item.Quantity,
            IsReserve = item.IsReserve
        }).ToList()
    };

    if (supply.Items.Any(item => item.Quantity <= 0 || string.IsNullOrWhiteSpace(item.ProductName)))
    {
        return Results.BadRequest("Проверьте название и количество в Excel-файле.");
    }

    db.Supplies.Add(supply);
    await db.SaveChangesAsync(cancellationToken);

    return Results.Ok(new { supply.Id, Items = supply.Items.Count });
}).DisableAntiforgery().RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapPut("/api/supplies/{id:guid}/status", async (
    Guid id,
    ChangeSupplyStatusRequest request,
    AppDbContext db,
    ClaimsPrincipal principal) =>
{
    var supply = await db.Supplies.FindAsync(id);
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

        supply.Status = SupplyStatuses.Sent;
        supply.SentAt ??= now;
    }
    else if (request.Status == SupplyStatuses.Accepted)
    {
        if (!principal.IsInRole(UserRoles.Admin))
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

    await db.SaveChangesAsync();
    return Results.NoContent();
}).RequireAuthorization();

app.MapPut("/api/supplies/{id:guid}", async (
    Guid id,
    UpdateSupplyRequest request,
    AppDbContext db,
    ClaimsPrincipal principal) =>
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

    var isAdmin = principal.IsInRole(UserRoles.Admin);
    if (!isAdmin && supply.Status != SupplyStatuses.Created)
    {
        return Results.Forbid();
    }

    if (request.Items.Count == 0)
    {
        return Results.BadRequest("В поставке должен быть хотя бы один товар.");
    }

    var updatedItems = request.Items.Select(item => new SupplyItem
    {
        SupplyId = supply.Id,
        OzonProductId = item.IsReserve ? null : item.OzonProductId,
        OfferId = item.IsReserve ? string.Empty : item.OfferId.Trim(),
        ProductName = item.ProductName.Trim(),
        Quantity = item.Quantity,
        IsReserve = item.IsReserve
    }).ToList();

    if (updatedItems.Any(item => item.Quantity <= 0 || string.IsNullOrWhiteSpace(item.ProductName)))
    {
        return Results.BadRequest("Укажите название и количество больше нуля для каждой строки.");
    }

    db.SupplyItems.RemoveRange(supply.Items);
    db.SupplyItems.AddRange(updatedItems);
    await db.SaveChangesAsync();

    return Results.NoContent();
}).RequireAuthorization();

app.MapPut("/api/supplies/{id:guid}/archive", async (Guid id, AppDbContext db) =>
{
    var supply = await db.Supplies.FindAsync(id);
    if (supply is null)
    {
        return Results.NotFound();
    }

    supply.IsArchived = true;
    supply.ArchivedAt = DateTimeOffset.UtcNow;
    await db.SaveChangesAsync();

    return Results.NoContent();
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapDelete("/api/supplies/{id:guid}", async (Guid id, AppDbContext db) =>
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
    await db.SaveChangesAsync();

    return Results.NoContent();
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapPut("/api/supplies/items/{id:guid}/replace-reserve", async (
    Guid id,
    ReplaceReserveSupplyItemRequest request,
    AppDbContext db) =>
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
    await db.SaveChangesAsync();

    return Results.NoContent();
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapGet("/api/supplies/analytics", async (AppDbContext db) =>
{
    var items = await db.SupplyItems
        .AsNoTracking()
        .Include(item => item.Supply)
        .ToListAsync();

    return items
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
            item.Supply.Status,
            item.Supply.CreatedAt,
            item.Supply.SentAt,
            item.Supply.AcceptedAt
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
            group.Key.Status,
            group.Key.CreatedAt,
            group.Key.SentAt,
            group.Key.AcceptedAt))
        .ToList();
})
    .RequireAuthorization();

if (hasStaticClient)
{
    app.MapFallbackToFile("index.html");
}

app.Run();

record Product(int Id, string Name, string Status, decimal Price);
record CreateInitialAdminRequest(string UserName, string DisplayName, string Password);
record LoginRequest(string UserName, string Password);
record AuthResponse(string Token, CurrentUserResponse User);
record CurrentUserResponse(Guid Id, string UserName, string DisplayName, string Role);
record CreateUserRequest(string UserName, string DisplayName, string Password, string Role);
record ChangeUserPasswordRequest(string Password);
record UserListItem(
    Guid Id,
    string UserName,
    string DisplayName,
    string Role,
    bool IsActive,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastSeenAt,
    bool IsOnline);
record ChatUserListItem(
    Guid Id,
    string UserName,
    string DisplayName,
    string Role,
    DateTimeOffset? LastSeenAt,
    bool IsOnline,
    int UnreadCount);
record CreateChatMessageRequest(string Text);
record ChatMessageListItem(
    Guid Id,
    Guid SenderId,
    Guid ReceiverId,
    string Text,
    DateTimeOffset CreatedAt,
    bool IsOwn);
record ProductionFileListItem(
    Guid Id,
    long? OzonProductId,
    string OfferId,
    string ProductName,
    string Notes,
    string FileName,
    string ContentType,
    DateTimeOffset CreatedAt);
record CreateProductionTaskRequest(long OzonProductId, string OfferId, string ProductName, int RequiredQuantity, List<CreateProductionTaskItemRequest>? Items);
record CreateProductionTaskItemRequest(long OzonProductId, string OfferId, string ProductName, int RequiredQuantity);
record CompleteProductionTaskRequest(int ActualQuantity, List<CompleteProductionTaskItemRequest>? Items);
record CompleteProductionTaskItemRequest(Guid Id, int ActualQuantity);
record ProductionTaskListItem(
    Guid Id,
    long OzonProductId,
    string OfferId,
    string ProductName,
    int RequiredQuantity,
    int? ActualQuantity,
    string Status,
    string? AssignedUserName,
    DateTimeOffset CreatedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? DeferredAt,
    DateTimeOffset? CompletedAt,
    bool IsArchived,
    DateTimeOffset? ArchivedAt,
    List<ProductionTaskItemListItem> Items);
record ProductionTaskItemListItem(Guid Id, long OzonProductId, string OfferId, string ProductName, int RequiredQuantity, int? ActualQuantity);
record CreateSupplyRequest(List<CreateSupplyItemRequest> Items);
record CreateSupplyItemRequest(long? OzonProductId, string OfferId, string ProductName, int Quantity, bool IsReserve);
record UpdateSupplyRequest(List<CreateSupplyItemRequest> Items);
record ChangeSupplyStatusRequest(string Status);
record ReplaceReserveSupplyItemRequest(long OzonProductId, string OfferId, string ProductName);
record SupplyListItem(
    Guid Id,
    string Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset? SentAt,
    DateTimeOffset? AcceptedAt,
    bool IsArchived,
    DateTimeOffset? ArchivedAt,
    List<SupplyItemListItem> Items);
record SupplyItemListItem(
    Guid Id,
    long? OzonProductId,
    string OfferId,
    string ProductName,
    int Quantity,
    bool IsReserve);
record SupplyAnalyticsItem(
    Guid Id,
    Guid SupplyId,
    long? OzonProductId,
    string OfferId,
    string ProductName,
    int Quantity,
    bool IsReserve,
    string Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset? SentAt,
    DateTimeOffset? AcceptedAt);

static class ExcelSupplyImport
{
    private static readonly XNamespace Spreadsheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private static readonly XNamespace Relationships = "http://schemas.openxmlformats.org/package/2006/relationships";

    public static byte[] CreateTemplate()
    {
        using var memory = new MemoryStream();
        using (var archive = new ZipArchive(memory, ZipArchiveMode.Create, true))
        {
            WriteEntry(archive, "[Content_Types].xml", """
                <?xml version="1.0" encoding="UTF-8"?>
                <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
                  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
                  <Default Extension="xml" ContentType="application/xml"/>
                  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
                  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
                </Types>
                """);
            WriteEntry(archive, "_rels/.rels", """
                <?xml version="1.0" encoding="UTF-8"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
                </Relationships>
                """);
            WriteEntry(archive, "xl/_rels/workbook.xml.rels", """
                <?xml version="1.0" encoding="UTF-8"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
                </Relationships>
                """);
            WriteEntry(archive, "xl/workbook.xml", """
                <?xml version="1.0" encoding="UTF-8"?>
                <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
                  <sheets><sheet name="Поставка" sheetId="1" r:id="rId1"/></sheets>
                </workbook>
                """);

            var rows = new[]
            {
                new[] { "Название товара", "Артикул", "ProductId", "Количество", "Резервный" },
                new[] { "Пример постоянного товара", "OFFER-001", "123456789", "10", "нет" },
                new[] { "Пример резервного товара", "", "", "5", "да" }
            };
            WriteEntry(archive, "xl/worksheets/sheet1.xml", CreateWorksheet(rows));
        }

        return memory.ToArray();
    }

    public static List<CreateSupplyItemRequest> ReadSupplyItems(Stream stream)
    {
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
        var sharedStrings = ReadSharedStrings(archive);
        var sheetEntry = archive.GetEntry("xl/worksheets/sheet1.xml")
            ?? throw new InvalidOperationException("В Excel-файле не найден первый лист.");

        using var sheetStream = sheetEntry.Open();
        var sheet = XDocument.Load(sheetStream);
        var rows = sheet.Descendants(Spreadsheet + "row")
            .Skip(1)
            .Select(row => ReadRow(row, sharedStrings))
            .Where(values => values.Any(value => !string.IsNullOrWhiteSpace(value)))
            .ToList();

        return rows.Select((values, index) =>
        {
            var productName = GetValue(values, 0);
            var offerId = GetValue(values, 1);
            var productIdText = GetValue(values, 2);
            var quantityText = GetValue(values, 3);
            var reserveText = GetValue(values, 4);

            if (!int.TryParse(quantityText, out var quantity) || quantity <= 0)
            {
                throw new InvalidOperationException($"Строка {index + 2}: количество должно быть больше нуля.");
            }

            var isReserve = IsTrue(reserveText) || string.IsNullOrWhiteSpace(offerId);
            long? productId = long.TryParse(productIdText, out var parsedProductId) ? parsedProductId : null;

            if (!isReserve && string.IsNullOrWhiteSpace(offerId))
            {
                throw new InvalidOperationException($"Строка {index + 2}: для постоянного товара нужен артикул.");
            }

            return new CreateSupplyItemRequest(productId, offerId, productName, quantity, isReserve);
        }).ToList();
    }

    private static string CreateWorksheet(IReadOnlyList<string[]> rows)
    {
        var builder = new StringBuilder();
        builder.Append("""<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>""");
        for (var rowIndex = 0; rowIndex < rows.Count; rowIndex++)
        {
            builder.Append($"""<row r="{rowIndex + 1}">""");
            for (var columnIndex = 0; columnIndex < rows[rowIndex].Length; columnIndex++)
            {
                var cellRef = $"{ColumnName(columnIndex)}{rowIndex + 1}";
                var value = System.Security.SecurityElement.Escape(rows[rowIndex][columnIndex]) ?? string.Empty;
                builder.Append($"""<c r="{cellRef}" t="inlineStr"><is><t>{value}</t></is></c>""");
            }
            builder.Append("</row>");
        }
        builder.Append("</sheetData></worksheet>");
        return builder.ToString();
    }

    private static List<string> ReadSharedStrings(ZipArchive archive)
    {
        var entry = archive.GetEntry("xl/sharedStrings.xml");
        if (entry is null)
        {
            return [];
        }

        using var stream = entry.Open();
        var document = XDocument.Load(stream);
        return document.Descendants(Spreadsheet + "si")
            .Select(item => string.Concat(item.Descendants(Spreadsheet + "t").Select(text => text.Value)))
            .ToList();
    }

    private static List<string> ReadRow(XElement row, IReadOnlyList<string> sharedStrings)
    {
        var values = new List<string>();
        foreach (var cell in row.Elements(Spreadsheet + "c"))
        {
            var reference = cell.Attribute("r")?.Value ?? string.Empty;
            var index = ColumnIndex(reference);
            while (values.Count <= index)
            {
                values.Add(string.Empty);
            }

            values[index] = ReadCell(cell, sharedStrings);
        }

        return values;
    }

    private static string ReadCell(XElement cell, IReadOnlyList<string> sharedStrings)
    {
        var type = cell.Attribute("t")?.Value;
        if (type == "s")
        {
            var indexText = cell.Element(Spreadsheet + "v")?.Value ?? "0";
            return int.TryParse(indexText, out var index) && index >= 0 && index < sharedStrings.Count
                ? sharedStrings[index]
                : string.Empty;
        }

        if (type == "inlineStr")
        {
            return string.Concat(cell.Descendants(Spreadsheet + "t").Select(text => text.Value));
        }

        return cell.Element(Spreadsheet + "v")?.Value ?? string.Empty;
    }

    private static void WriteEntry(ZipArchive archive, string path, string content)
    {
        var entry = archive.CreateEntry(path);
        using var writer = new StreamWriter(entry.Open(), Encoding.UTF8);
        writer.Write(content.Trim());
    }

    private static string GetValue(IReadOnlyList<string> values, int index) =>
        index < values.Count ? values[index].Trim() : string.Empty;

    private static bool IsTrue(string value) =>
        value.Equals("да", StringComparison.OrdinalIgnoreCase)
        || value.Equals("true", StringComparison.OrdinalIgnoreCase)
        || value.Equals("1", StringComparison.OrdinalIgnoreCase);

    private static string ColumnName(int index)
    {
        var dividend = index + 1;
        var name = string.Empty;
        while (dividend > 0)
        {
            var modulo = (dividend - 1) % 26;
            name = Convert.ToChar('A' + modulo) + name;
            dividend = (dividend - modulo) / 26;
        }
        return name;
    }

    private static int ColumnIndex(string cellReference)
    {
        var letters = new string(cellReference.TakeWhile(char.IsLetter).ToArray());
        return letters.Aggregate(0, (sum, letter) => sum * 26 + letter - 'A' + 1) - 1;
    }
}
