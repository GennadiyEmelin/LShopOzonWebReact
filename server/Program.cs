using System.Net;
using System.Security.Claims;
using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using System.IO.Compression;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Hubs;
using LShopOzonWebReact.Api.Integrations;
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
builder.Services.Configure<TelegramOptions>(builder.Configuration.GetSection("Telegram"));
builder.Services.AddSingleton<OzonRuntimeCredentials>();
builder.Services.AddHttpClient(nameof(TelegramNotificationService));
builder.Services.AddHttpClient(nameof(TelegramBotHostedService));
builder.Services.AddSingleton<TelegramNotificationService>();
builder.Services.AddHostedService<TelegramBotHostedService>();
builder.Services.AddHttpClient<OzonApiClient>((serviceProvider, client) =>
{
    var credentials = serviceProvider.GetRequiredService<OzonRuntimeCredentials>();
    client.BaseAddress = new Uri(string.IsNullOrWhiteSpace(credentials.BaseUrl)
        ? "https://api-seller.ozon.ru"
        : credentials.BaseUrl);
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
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
});
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
    await SystemUserBootstrap.EnsureExistsAsync(db);
    var credentials = scope.ServiceProvider.GetRequiredService<OzonRuntimeCredentials>();
    await credentials.LoadFromDatabaseAsync(db);
}
else
{
    using var scope = app.Services.CreateScope();
    var credentials = scope.ServiceProvider.GetRequiredService<OzonRuntimeCredentials>();
    await credentials.LoadFromDatabaseAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>());
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
app.MapIntegrationRoutes();

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

    return Results.Created("/api/admin/users", UserResponses.Current(admin));
});

var products = new[]
{
    new Product(1, "Ozon карточка товара", "Готова к публикации", 1290),
    new Product(2, "Складской остаток", "12 единиц в наличии", 3490),
    new Product(3, "Заказ клиента", "Ожидает обработки", 780)
};

app.MapGet("/api/avatars/{fileName}", (string fileName, IWebHostEnvironment environment) =>
{
    if (fileName != Path.GetFileName(fileName))
    {
        return Results.BadRequest();
    }

    var avatarPath = Path.Combine(AppPaths.GetAvatarDirectory(environment), fileName);
    if (!System.IO.File.Exists(avatarPath))
    {
        return Results.NotFound();
    }

    var extension = Path.GetExtension(fileName).ToLowerInvariant();
    var contentType = extension switch
    {
        ".png" => "image/png",
        ".webp" => "image/webp",
        ".gif" => "image/gif",
        _ => "image/jpeg"
    };

    return Results.File(avatarPath, contentType);
});

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

    if (user.Role != UserRoles.Admin && string.IsNullOrWhiteSpace(user.AllowedFeatures))
    {
        user.AllowedFeatures = FeatureAccess.NormalizeForRole(user.Role, FeatureAccess.UserDefaults);
    }

    user.LastSeenAt = DateTimeOffset.UtcNow;
    await db.SaveChangesAsync();

    return Results.Ok(new AuthResponse(
        tokenService.CreateToken(user),
        UserResponses.Current(user)));
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

app.MapGet("/api/auth/me", async (AppDbContext db, ClaimsPrincipal principal) =>
{
    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!Guid.TryParse(currentUserId, out var userId))
    {
        return Results.Unauthorized();
    }

    var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(item => item.Id == userId && item.IsActive);
    return user is null ? Results.Unauthorized() : Results.Ok(UserResponses.Current(user));
}).RequireAuthorization();

app.MapPut("/api/profile", async (
    UpdateProfileRequest request,
    AppDbContext db,
    ClaimsPrincipal principal) =>
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

    user.DisplayName = request.DisplayName.Trim();
    await db.SaveChangesAsync();

    return Results.Ok(UserResponses.Current(user));
}).RequireAuthorization();

app.MapPost("/api/profile/avatar", async (
    HttpRequest request,
    IWebHostEnvironment environment,
    AppDbContext db,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!Guid.TryParse(currentUserId, out var userId))
    {
        return Results.Unauthorized();
    }

    if (!request.HasFormContentType)
    {
        return Results.BadRequest("Ожидается файл изображения.");
    }

    var user = await db.Users.FindAsync(new object[] { userId }, cancellationToken);
    if (user is null || !user.IsActive)
    {
        return Results.Unauthorized();
    }

    var form = await request.ReadFormAsync(cancellationToken);
    var file = form.Files.GetFile("avatar");
    if (file is null || file.Length == 0)
    {
        return Results.BadRequest("Выберите фотографию.");
    }

    if (file.Length > 3 * 1024 * 1024)
    {
        return Results.BadRequest("Фотография должна быть меньше 3 МБ.");
    }

    var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
    var allowedExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ".jpg", ".jpeg", ".png", ".webp", ".gif" };
    if (!allowedExtensions.Contains(extension))
    {
        return Results.BadRequest("Поддерживаются jpg, png, webp и gif.");
    }

    var avatarDirectory = AppPaths.GetAvatarDirectory(environment);
    Directory.CreateDirectory(avatarDirectory);
    if (!string.IsNullOrWhiteSpace(user.AvatarFileName))
    {
        var oldPath = Path.Combine(avatarDirectory, user.AvatarFileName);
        if (System.IO.File.Exists(oldPath))
        {
            System.IO.File.Delete(oldPath);
        }
    }

    var fileName = $"{user.Id:N}{extension}";
    var fullPath = Path.Combine(avatarDirectory, fileName);
    await using (var stream = System.IO.File.Create(fullPath))
    {
        await file.CopyToAsync(stream, cancellationToken);
    }

    user.AvatarFileName = fileName;
    await db.SaveChangesAsync(cancellationToken);

    return Results.Ok(UserResponses.Current(user));
}).DisableAntiforgery().RequireAuthorization();

app.MapGet("/api/admin/users", async (AppDbContext db) =>
{
    var onlineAfter = DateTimeOffset.UtcNow.AddMinutes(-2);
    return await db.Users
        .OrderBy(user => user.UserName)
        .Select(user => new UserListItem(
            user.Id,
            user.UserName,
            user.DisplayName,
            user.Position,
            user.Role,
            UserResponses.AvatarUrl(user),
            UserResponses.Features(user),
            user.IsActive,
            user.CreatedAt,
            user.LastSeenAt,
            user.LastSeenAt >= onlineAfter))
        .ToListAsync();
})
    .RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapPost("/api/admin/users", async (CreateUserRequest request, AppDbContext db, ClaimsPrincipal principal) =>
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
        Position = request.Position.Trim(),
        AllowedFeatures = FeatureAccess.NormalizeForRole(role, request.AllowedFeatures),
        PasswordHash = PasswordHasher.Hash(request.Password),
        Role = role
    };

    db.Users.Add(user);
    AuditLogWriter.Add(db, principal, "Создание пользователя", "User", user.Id.ToString(), $"{user.UserName} ({user.Role})");
    await db.SaveChangesAsync();

    return Results.Created($"/api/admin/users/{user.Id}", new UserListItem(
        user.Id,
        user.UserName,
        user.DisplayName,
        user.Position,
        user.Role,
        UserResponses.AvatarUrl(user),
        UserResponses.Features(user),
        user.IsActive,
        user.CreatedAt,
        user.LastSeenAt,
        false));
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapPut("/api/admin/users/{id:guid}/settings", async (
    Guid id,
    UpdateUserSettingsRequest request,
    AppDbContext db,
    ClaimsPrincipal principal) =>
{
    var user = await db.Users.FindAsync(id);
    if (user is null)
    {
        return Results.NotFound();
    }

    var role = request.Role == UserRoles.Admin ? UserRoles.Admin : UserRoles.User;
    user.DisplayName = request.DisplayName.Trim();
    user.Position = request.Position.Trim();
    user.Role = role;
    user.AllowedFeatures = FeatureAccess.NormalizeForRole(role, request.AllowedFeatures);

    AuditLogWriter.Add(db, principal, "Настройки пользователя", "User", user.Id.ToString(), $"{user.UserName} ({user.Role})");
    await db.SaveChangesAsync();

    return Results.Ok(new UserListItem(
        user.Id,
        user.UserName,
        user.DisplayName,
        user.Position,
        user.Role,
        UserResponses.AvatarUrl(user),
        UserResponses.Features(user),
        user.IsActive,
        user.CreatedAt,
        user.LastSeenAt,
        false));
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

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

    var user = await db.Users.FindAsync(id);
    if (user is null)
    {
        return Results.NotFound();
    }

    user.PasswordHash = PasswordHasher.Hash(request.Password);
    AuditLogWriter.Add(db, principal, "Смена пароля", "User", user.Id.ToString(), user.UserName);
    await db.SaveChangesAsync();

    return Results.NoContent();
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapDelete("/api/admin/users/{id:guid}", async (Guid id, AppDbContext db, ClaimsPrincipal principal) =>
{
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
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapGet("/api/admin/audit-logs", async (
    string? search,
    string? action,
    string? entityType,
    string? dateFrom,
    string? dateTo,
    string? userId,
    AppDbContext db) =>
{
    var query = db.AuditLogs.AsNoTracking();

    if (!string.IsNullOrWhiteSpace(search))
    {
        var value = search.Trim().ToLower();
        query = query.Where(log =>
            log.UserName.ToLower().Contains(value)
            || log.DisplayName.ToLower().Contains(value)
            || log.Action.ToLower().Contains(value)
            || log.EntityType.ToLower().Contains(value)
            || log.EntityId.ToLower().Contains(value)
            || log.Details.ToLower().Contains(value));
    }

    if (!string.IsNullOrWhiteSpace(action))
    {
        query = query.Where(log => log.Action == action);
    }

    if (!string.IsNullOrWhiteSpace(entityType))
    {
        query = query.Where(log => log.EntityType == entityType);
    }

    if (!string.IsNullOrWhiteSpace(dateFrom) && DateOnly.TryParse(dateFrom, out var parsedDateFrom))
    {
        var from = new DateTimeOffset(parsedDateFrom.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        query = query.Where(log => log.CreatedAt >= from);
    }

    if (!string.IsNullOrWhiteSpace(dateTo) && DateOnly.TryParse(dateTo, out var parsedDateTo))
    {
        var toExclusive = new DateTimeOffset(parsedDateTo.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        query = query.Where(log => log.CreatedAt < toExclusive);
    }

    if (Guid.TryParse(userId, out var parsedUserId))
    {
        query = query.Where(log => log.UserId == parsedUserId);
    }

    return await query
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
        .ToListAsync();
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapGet("/api/admin/audit-logs/export", async (AppDbContext db) =>
{
    var logs = await db.AuditLogs
        .AsNoTracking()
        .OrderByDescending(log => log.CreatedAt)
        .Take(5000)
        .ToListAsync();

    var builder = new StringBuilder();
    builder.AppendLine("Дата;Пользователь;Имя;Действие;Объект;ID;Детали");
    foreach (var log in logs)
    {
        builder.AppendLine(string.Join(';', [
            CsvExport.Cell(log.CreatedAt.ToString("yyyy-MM-dd HH:mm:ss")),
            CsvExport.Cell(log.UserName),
            CsvExport.Cell(log.DisplayName),
            CsvExport.Cell(log.Action),
            CsvExport.Cell(log.EntityType),
            CsvExport.Cell(log.EntityId),
            CsvExport.Cell(log.Details)
        ]));
    }

    return Results.File(
        Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(builder.ToString())).ToArray(),
        "text/csv; charset=utf-8",
        $"audit-log-{DateTime.UtcNow:yyyyMMdd-HHmmss}.csv");
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapGet("/api/admin/system-health", async (AppDbContext db) =>
{
    var process = Process.GetCurrentProcess();
    var dbOk = await db.Database.CanConnectAsync();

    return Results.Ok(new SystemHealthResponse(
        dbOk,
        DateTimeOffset.UtcNow,
        (DateTimeOffset.UtcNow - process.StartTime.ToUniversalTime()).ToString(),
        Environment.MachineName,
        Environment.Version.ToString()));
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapGet("/api/admin/backups", (IWebHostEnvironment environment) =>
{
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
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapGet("/api/admin/backups/{fileName}", (string fileName, IWebHostEnvironment environment) =>
{
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
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

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

app.MapGet("/api/chat/threads", async (AppDbContext db, ClaimsPrincipal principal) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Chats))
    {
        return Results.Forbid();
    }

    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!Guid.TryParse(currentUserId, out var userId))
    {
        return Results.Unauthorized();
    }

    var unreadDirectCounts = await db.ChatMessages
        .AsNoTracking()
        .Where(message => message.GroupId == null && message.ReceiverId == userId && message.ReadAt == null)
        .GroupBy(message => message.SenderId)
        .Select(group => new { UserId = group.Key, Count = group.Count() })
        .ToDictionaryAsync(item => item.UserId, item => item.Count);

    var onlineAfter = DateTimeOffset.UtcNow.AddMinutes(-2);
    var users = await db.Users
        .AsNoTracking()
        .Where(user => user.Id != userId && user.Id != SystemUser.Id && user.IsActive)
        .OrderBy(user => user.DisplayName)
        .Select(user => new ChatThreadListItem(
            "user",
            user.Id,
            user.DisplayName,
            user.Position,
            UserResponses.AvatarUrl(user.AvatarFileName),
            user.LastSeenAt >= onlineAfter,
            unreadDirectCounts.GetValueOrDefault(user.Id),
            0,
            null,
            null))
        .ToListAsync();

    var memberships = await db.ChatGroupMembers
        .AsNoTracking()
        .Where(member => member.UserId == userId)
        .Select(member => new
        {
            member.GroupId,
            member.LastReadAt,
            member.Group.Name,
            member.Group.CreatedByUserId,
            MemberCount = member.Group.Members.Count
        })
        .ToListAsync();

    var groupIds = memberships.Select(member => member.GroupId).ToList();
    var membersByGroup = groupIds.Count == 0
        ? new Dictionary<Guid, List<ChatGroupMemberListItem>>()
        : (await db.ChatGroupMembers
            .AsNoTracking()
            .Where(member => groupIds.Contains(member.GroupId))
            .Join(
                db.Users.AsNoTracking(),
                member => member.UserId,
                user => user.Id,
                (member, user) => new
                {
                    member.GroupId,
                    Member = new ChatGroupMemberListItem(
                        user.Id,
                        user.UserName,
                        user.DisplayName,
                        user.Position,
                        UserResponses.AvatarUrl(user.AvatarFileName))
                })
            .ToListAsync())
            .GroupBy(entry => entry.GroupId)
            .ToDictionary(
                group => group.Key,
                group => group.Select(entry => entry.Member).OrderBy(member => member.DisplayName).ToList());
    var groupMessages = groupIds.Count == 0
        ? []
        : await db.ChatMessages
            .AsNoTracking()
            .Where(message => message.GroupId != null && groupIds.Contains(message.GroupId.Value))
            .Select(message => new { message.GroupId, message.SenderId, message.CreatedAt })
            .ToListAsync();

    var groups = memberships
        .Select(member =>
        {
            var lastReadAt = member.LastReadAt ?? DateTimeOffset.MinValue;
            var unreadCount = groupMessages.Count(message =>
                message.GroupId == member.GroupId
                && message.SenderId != userId
                && message.CreatedAt > lastReadAt);
            return new ChatThreadListItem(
                "group",
                member.GroupId,
                member.Name,
                $"{member.MemberCount} участников",
                string.Empty,
                false,
                unreadCount,
                member.MemberCount,
                member.CreatedByUserId,
                membersByGroup.GetValueOrDefault(member.GroupId));
        })
        .OrderBy(thread => thread.Title)
        .ToList();

    return Results.Ok(users.Concat(groups).OrderByDescending(thread => thread.UnreadCount).ThenBy(thread => thread.Title));
}).RequireAuthorization();

app.MapGet("/api/chat/users", async (AppDbContext db, ClaimsPrincipal principal) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Chats))
    {
        return Results.Forbid();
    }

    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!Guid.TryParse(currentUserId, out var userId))
    {
        return Results.Unauthorized();
    }

    var unreadCounts = await db.ChatMessages
        .AsNoTracking()
        .Where(message => message.GroupId == null && message.ReceiverId == userId && message.ReadAt == null)
        .GroupBy(message => message.SenderId)
        .Select(group => new { UserId = group.Key, Count = group.Count() })
        .ToDictionaryAsync(item => item.UserId, item => item.Count);

    var onlineAfter = DateTimeOffset.UtcNow.AddMinutes(-2);
    var users = await db.Users
        .AsNoTracking()
        .Where(user => user.Id != userId && user.Id != SystemUser.Id && user.IsActive)
        .OrderBy(user => user.DisplayName)
        .Select(user => new
        {
            user.Id,
            user.UserName,
            user.DisplayName,
            user.Position,
            user.AvatarFileName,
            user.Role,
            user.LastSeenAt,
            IsOnline = user.LastSeenAt >= onlineAfter
        })
        .ToListAsync();

    return Results.Ok(users.Select(user => new ChatUserListItem(
        user.Id,
        user.UserName,
        user.DisplayName,
        user.Position,
        UserResponses.AvatarUrl(user.AvatarFileName),
        user.Role,
        user.LastSeenAt,
        user.IsOnline,
        unreadCounts.GetValueOrDefault(user.Id))));
}).RequireAuthorization();

app.MapPost("/api/chat/groups", async (
    CreateChatGroupRequest request,
    AppDbContext db,
    ClaimsPrincipal principal,
    IHubContext<AppHub> hub) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Chats))
    {
        return Results.Forbid();
    }

    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!Guid.TryParse(currentUserId, out var userId))
    {
        return Results.Unauthorized();
    }

    var name = request.Name?.Trim() ?? string.Empty;
    if (name.Length < 2)
    {
        return Results.BadRequest("Укажите название группы.");
    }

    var parsedMemberIds = new List<Guid>();
    foreach (var rawMemberId in request.MemberIds ?? [])
    {
        if (string.IsNullOrWhiteSpace(rawMemberId) || !Guid.TryParse(rawMemberId, out var memberId))
        {
            continue;
        }

        if (memberId != userId && memberId != SystemUser.Id)
        {
            parsedMemberIds.Add(memberId);
        }
    }

    var memberIds = parsedMemberIds.Distinct().ToList();
    var validMembers = await db.Users
        .AsNoTracking()
        .Where(user => memberIds.Contains(user.Id) && user.IsActive && user.Id != SystemUser.Id)
        .OrderBy(user => user.DisplayName)
        .ThenBy(user => user.UserName)
        .Select(user => new ChatGroupMemberListItem(
            user.Id,
            user.UserName,
            user.DisplayName,
            user.Position,
            UserResponses.AvatarUrl(user.AvatarFileName)))
        .ToListAsync();

    if (validMembers.Count + 1 < 3)
    {
        return Results.BadRequest("В группе должно быть минимум 3 участника.");
    }

    var creatorProfile = await db.Users
        .AsNoTracking()
        .Where(user => user.Id == userId && user.IsActive)
        .Select(user => new ChatGroupMemberListItem(
            user.Id,
            user.UserName,
            user.DisplayName,
            user.Position,
            UserResponses.AvatarUrl(user.AvatarFileName)))
        .FirstOrDefaultAsync();

    if (creatorProfile is null)
    {
        return Results.Unauthorized();
    }

    try
    {
        var group = new ChatGroup
        {
            Name = name,
            CreatedByUserId = userId,
            Members =
            [
                new ChatGroupMember { UserId = userId },
                ..validMembers.Select(member => new ChatGroupMember { UserId = member.UserId })
            ]
        };

        db.ChatGroups.Add(group);
        await db.SaveChangesAsync();

        var responseMembers = new List<ChatGroupMemberListItem> { creatorProfile };
        responseMembers.AddRange(validMembers);

        var detail = new ChatGroupDetailResponse(
            group.Id,
            group.Name,
            group.CreatedByUserId,
            responseMembers.Count,
            responseMembers);

        _ = ChatHub.NotifyThreadsChangedAsync(hub);

        return Results.Ok(detail);
    }
    catch (Exception exception)
    {
        return Results.BadRequest($"Не удалось создать группу: {exception.Message}");
    }
}).RequireAuthorization();

app.MapPost("/api/chat/groups/{id:guid}/members", async (
    Guid id,
    UpdateChatGroupMembersRequest request,
    AppDbContext db,
    ClaimsPrincipal principal,
    IHubContext<AppHub> hub) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Chats))
    {
        return Results.Forbid();
    }

    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!Guid.TryParse(currentUserId, out var userId))
    {
        return Results.Unauthorized();
    }

    if (!await ChatAccess.IsGroupMemberAsync(db, id, userId))
    {
        return Results.Forbid();
    }

    var memberIds = request.MemberIds?.Distinct().Where(memberId => memberId != userId).ToList() ?? [];
    if (memberIds.Count == 0)
    {
        return Results.BadRequest("Выберите участников для добавления.");
    }

    var existingMemberIds = await db.ChatGroupMembers
        .AsNoTracking()
        .Where(member => member.GroupId == id)
        .Select(member => member.UserId)
        .ToListAsync();

    var newMemberIds = await db.Users
        .AsNoTracking()
        .Where(user => memberIds.Contains(user.Id) && user.IsActive && user.Id != SystemUser.Id && !existingMemberIds.Contains(user.Id))
        .Select(user => user.Id)
        .ToListAsync();

    if (newMemberIds.Count == 0)
    {
        return Results.BadRequest("Новых участников для добавления не найдено.");
    }

    foreach (var memberId in newMemberIds)
    {
        db.ChatGroupMembers.Add(new ChatGroupMember
        {
            GroupId = id,
            UserId = memberId
        });
    }

    await db.SaveChangesAsync();
    await ChatHub.NotifyThreadsChangedAsync(hub);

    var groupDetail = await ChatResponses.BuildGroupDetailAsync(db, id);
    return groupDetail is null ? Results.NotFound() : Results.Ok(groupDetail);
}).RequireAuthorization();

app.MapDelete("/api/chat/groups/{id:guid}/members/{memberUserId:guid}", async (
    Guid id,
    Guid memberUserId,
    AppDbContext db,
    ClaimsPrincipal principal,
    IHubContext<AppHub> hub) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Chats))
    {
        return Results.Forbid();
    }

    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!Guid.TryParse(currentUserId, out var userId))
    {
        return Results.Unauthorized();
    }

    if (!await ChatAccess.IsGroupMemberAsync(db, id, userId))
    {
        return Results.Forbid();
    }

    var group = await db.ChatGroups
        .Include(entry => entry.Members)
        .FirstOrDefaultAsync(entry => entry.Id == id);
    if (group is null)
    {
        return Results.NotFound();
    }

    var isSelf = memberUserId == userId;
    var isCreator = group.CreatedByUserId == userId;
    if (!isSelf && !isCreator)
    {
        return Results.Forbid();
    }

    var membership = group.Members.FirstOrDefault(member => member.UserId == memberUserId);
    if (membership is null)
    {
        return Results.NotFound();
    }

    if (group.CreatedByUserId == memberUserId)
    {
        db.ChatGroups.Remove(group);
        await db.SaveChangesAsync();
        await ChatHub.NotifyThreadsChangedAsync(hub);
        return Results.Ok(new ChatGroupDeleteMemberResponse(true, id, null));
    }

    var remainingCount = group.Members.Count - 1;
    if (remainingCount < 3)
    {
        db.ChatGroups.Remove(group);
        await db.SaveChangesAsync();
        await ChatHub.NotifyThreadsChangedAsync(hub);
        return Results.Ok(new ChatGroupDeleteMemberResponse(true, id, null));
    }

    db.ChatGroupMembers.Remove(membership);
    await db.SaveChangesAsync();
    await ChatHub.NotifyThreadsChangedAsync(hub);

    var groupDetail = await ChatResponses.BuildGroupDetailAsync(db, id);
    return groupDetail is null
        ? Results.Ok(new ChatGroupDeleteMemberResponse(true, id, null))
        : Results.Ok(new ChatGroupDeleteMemberResponse(false, id, groupDetail));
}).RequireAuthorization();

app.MapDelete("/api/chat/groups/{id:guid}", async (
    Guid id,
    AppDbContext db,
    ClaimsPrincipal principal,
    IHubContext<AppHub> hub) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Chats))
    {
        return Results.Forbid();
    }

    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!Guid.TryParse(currentUserId, out var userId))
    {
        return Results.Unauthorized();
    }

    var groupToDelete = await db.ChatGroups.FirstOrDefaultAsync(entry => entry.Id == id);
    if (groupToDelete is null)
    {
        return Results.NotFound();
    }

    if (groupToDelete.CreatedByUserId != userId)
    {
        return Results.Forbid();
    }

    if (!await ChatAccess.IsGroupMemberAsync(db, id, userId))
    {
        return Results.Forbid();
    }

    db.ChatGroups.Remove(groupToDelete);
    await db.SaveChangesAsync();
    await hub.Clients.All.SendAsync("ChatThreadsChanged");

    return Results.NoContent();
}).RequireAuthorization();

app.MapGet("/api/chat/groups/{id:guid}", async (Guid id, AppDbContext db, ClaimsPrincipal principal) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Chats))
    {
        return Results.Forbid();
    }

    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!Guid.TryParse(currentUserId, out var userId))
    {
        return Results.Unauthorized();
    }

    if (!await ChatAccess.IsGroupMemberAsync(db, id, userId))
    {
        return Results.Forbid();
    }

    var updatedGroupDetail = await ChatResponses.BuildGroupDetailAsync(db, id);
    return updatedGroupDetail is null ? Results.NotFound() : Results.Ok(updatedGroupDetail);
}).RequireAuthorization();

app.MapGet("/api/chat/groups/{id:guid}/messages", async (
    Guid id,
    AppDbContext db,
    ClaimsPrincipal principal) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Chats))
    {
        return Results.Forbid();
    }

    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!Guid.TryParse(currentUserId, out var parsedCurrentUserId))
    {
        return Results.Unauthorized();
    }

    var membership = await db.ChatGroupMembers.FirstOrDefaultAsync(member => member.GroupId == id && member.UserId == parsedCurrentUserId);
    if (membership is null)
    {
        return Results.Forbid();
    }

    var now = DateTimeOffset.UtcNow;
    membership.LastReadAt = now;
    await db.SaveChangesAsync();

    var messages = await db.ChatMessages
        .AsNoTracking()
        .Where(message => message.GroupId == id)
        .Where(message => !message.IsHiddenForSender || message.SenderId != parsedCurrentUserId)
        .OrderBy(message => message.CreatedAt)
        .Join(
            db.Users.AsNoTracking(),
            message => message.SenderId,
            user => user.Id,
            (message, user) => new ChatMessageListItem(
                message.Id,
                message.GroupId,
                message.SenderId,
                user.DisplayName,
                message.ReceiverId,
                message.Text,
                message.AttachmentFileName,
                message.AttachmentContentType,
                message.AttachmentContent != null,
                message.CreatedAt,
                message.SenderId == parsedCurrentUserId))
        .ToListAsync();

    return Results.Ok(messages);
}).RequireAuthorization();

app.MapGet("/api/chat/{userId:guid}/messages", async (
    Guid userId,
    AppDbContext db,
    ClaimsPrincipal principal) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Chats))
    {
        return Results.Forbid();
    }

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
            message.GroupId == null &&
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
            message.GroupId == null && (
                message.SenderId == parsedCurrentUserId && message.ReceiverId == userId ||
                message.SenderId == userId && message.ReceiverId == parsedCurrentUserId))
        .Where(message => !message.IsHiddenForSender || message.SenderId != parsedCurrentUserId)
        .OrderBy(message => message.CreatedAt)
        .Join(
            db.Users.AsNoTracking(),
            message => message.SenderId,
            user => user.Id,
            (message, user) => new ChatMessageListItem(
                message.Id,
                message.GroupId,
                message.SenderId,
                user.DisplayName,
                message.ReceiverId,
                message.Text,
                message.AttachmentFileName,
                message.AttachmentContentType,
                message.AttachmentContent != null,
                message.CreatedAt,
                message.SenderId == parsedCurrentUserId))
        .ToListAsync();

    return Results.Ok(messages);
}).RequireAuthorization();

app.MapPost("/api/chat/groups/{id:guid}/messages", async (
    Guid id,
    HttpRequest request,
    AppDbContext db,
    ClaimsPrincipal principal,
    IHubContext<AppHub> hub,
    CancellationToken cancellationToken) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Chats))
    {
        return Results.Forbid();
    }

    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!Guid.TryParse(currentUserId, out var parsedCurrentUserId))
    {
        return Results.Unauthorized();
    }

    if (!await ChatAccess.IsGroupMemberAsync(db, id, parsedCurrentUserId))
    {
        return Results.Forbid();
    }

    if (!request.HasFormContentType)
    {
        return Results.BadRequest("Ожидается multipart/form-data.");
    }

    var form = await request.ReadFormAsync(cancellationToken);
    var text = form["text"].ToString().Trim();
    var file = form.Files.GetFile("file");

    if (text.Length > 2000)
    {
        return Results.BadRequest("Сообщение слишком длинное.");
    }

    if (file is not null && file.Length > 10 * 1024 * 1024)
    {
        return Results.BadRequest("Файл слишком большой. Максимум 10 МБ.");
    }

    if (string.IsNullOrWhiteSpace(text) && (file is null || file.Length == 0))
    {
        return Results.BadRequest("Напишите сообщение или прикрепите файл.");
    }

    byte[]? attachmentContent = null;
    var attachmentFileName = string.Empty;
    var attachmentContentType = string.Empty;
    if (file is not null && file.Length > 0)
    {
        await using var stream = file.OpenReadStream();
        using var memory = new MemoryStream();
        await stream.CopyToAsync(memory, cancellationToken);
        attachmentContent = memory.ToArray();
        attachmentFileName = Path.GetFileName(file.FileName);
        attachmentContentType = string.IsNullOrWhiteSpace(file.ContentType)
            ? "application/octet-stream"
            : file.ContentType;
    }

    var message = new ChatMessage
    {
        GroupId = id,
        SenderId = parsedCurrentUserId,
        Text = text,
        AttachmentFileName = attachmentFileName,
        AttachmentContentType = attachmentContentType,
        AttachmentContent = attachmentContent
    };

    db.ChatMessages.Add(message);
    await db.SaveChangesAsync();

    var sender = await db.Users.AsNoTracking().FirstAsync(user => user.Id == parsedCurrentUserId);
    var result = new ChatMessageListItem(
        message.Id,
        message.GroupId,
        message.SenderId,
        sender.DisplayName,
        message.ReceiverId,
        message.Text,
        message.AttachmentFileName,
        message.AttachmentContentType,
        message.AttachmentContent != null,
        message.CreatedAt,
        true);

    await hub.Clients.All.SendAsync("ChatMessagesChanged", message.SenderId, null, id);

    return Results.Created($"/api/chat/groups/{id}/messages/{message.Id}", result);
}).DisableAntiforgery().RequireAuthorization();

app.MapPost("/api/chat/{userId:guid}/messages", async (
    Guid userId,
    HttpRequest request,
    AppDbContext db,
    ClaimsPrincipal principal,
    IHubContext<AppHub> hub,
    CancellationToken cancellationToken) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Chats))
    {
        return Results.Forbid();
    }

    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!Guid.TryParse(currentUserId, out var parsedCurrentUserId))
    {
        return Results.Unauthorized();
    }

    if (parsedCurrentUserId == userId)
    {
        return Results.BadRequest("Нельзя отправить сообщение самому себе.");
    }

    if (!request.HasFormContentType)
    {
        return Results.BadRequest("Ожидается multipart/form-data.");
    }

    var form = await request.ReadFormAsync(cancellationToken);
    var text = form["text"].ToString().Trim();
    var file = form.Files.GetFile("file");

    if (text.Length > 2000)
    {
        return Results.BadRequest("Сообщение слишком длинное.");
    }

    if (file is not null && file.Length > 10 * 1024 * 1024)
    {
        return Results.BadRequest("Файл слишком большой. Максимум 10 МБ.");
    }

    if (string.IsNullOrWhiteSpace(text) && (file is null || file.Length == 0))
    {
        return Results.BadRequest("Напишите сообщение или прикрепите файл.");
    }

    var receiverExists = await db.Users.AnyAsync(user => user.Id == userId && user.IsActive);
    if (!receiverExists)
    {
        return Results.NotFound();
    }

    byte[]? attachmentContent = null;
    var attachmentFileName = string.Empty;
    var attachmentContentType = string.Empty;
    if (file is not null && file.Length > 0)
    {
        await using var stream = file.OpenReadStream();
        using var memory = new MemoryStream();
        await stream.CopyToAsync(memory, cancellationToken);
        attachmentContent = memory.ToArray();
        attachmentFileName = Path.GetFileName(file.FileName);
        attachmentContentType = string.IsNullOrWhiteSpace(file.ContentType)
            ? "application/octet-stream"
            : file.ContentType;
    }

    var message = new ChatMessage
    {
        SenderId = parsedCurrentUserId,
        ReceiverId = userId,
        Text = text,
        AttachmentFileName = attachmentFileName,
        AttachmentContentType = attachmentContentType,
        AttachmentContent = attachmentContent
    };

    db.ChatMessages.Add(message);
    await db.SaveChangesAsync();

    var sender = await db.Users.AsNoTracking().FirstAsync(user => user.Id == parsedCurrentUserId);
    var result = new ChatMessageListItem(
        message.Id,
        message.GroupId,
        message.SenderId,
        sender.DisplayName,
        message.ReceiverId,
        message.Text,
        message.AttachmentFileName,
        message.AttachmentContentType,
        message.AttachmentContent != null,
        message.CreatedAt,
        true);

    await hub.Clients.All.SendAsync("ChatMessagesChanged", message.SenderId, message.ReceiverId, null);

    return Results.Created($"/api/chat/{userId}/messages/{message.Id}", result);
}).DisableAntiforgery().RequireAuthorization();

app.MapGet("/api/chat/messages/{id:guid}/attachment", async (
    Guid id,
    AppDbContext db,
    ClaimsPrincipal principal) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Chats))
    {
        return Results.Forbid();
    }

    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!Guid.TryParse(currentUserId, out var parsedCurrentUserId))
    {
        return Results.Unauthorized();
    }

    var message = await db.ChatMessages.AsNoTracking().FirstOrDefaultAsync(message => message.Id == id);
    if (message is null || message.AttachmentContent is null || string.IsNullOrWhiteSpace(message.AttachmentFileName))
    {
        return Results.NotFound();
    }

    var isAdmin = principal.IsInRole(UserRoles.Admin);
    if (!isAdmin && message.SenderId != parsedCurrentUserId && message.ReceiverId != parsedCurrentUserId)
    {
        if (message.GroupId is Guid groupId && !await ChatAccess.IsGroupMemberAsync(db, groupId, parsedCurrentUserId))
        {
            return Results.Forbid();
        }

        if (message.GroupId is null)
        {
            return Results.Forbid();
        }
    }

    return Results.File(message.AttachmentContent, message.AttachmentContentType, message.AttachmentFileName);
}).RequireAuthorization();

app.MapDelete("/api/chat/messages/{id:guid}", async (
    Guid id,
    AppDbContext db,
    ClaimsPrincipal principal,
    IHubContext<AppHub> hub) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Chats))
    {
        return Results.Forbid();
    }

    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!Guid.TryParse(currentUserId, out var userId))
    {
        return Results.Unauthorized();
    }

    var message = await db.ChatMessages.FirstOrDefaultAsync(entry => entry.Id == id);
    if (message is null)
    {
        return Results.NotFound();
    }

    if (message.SenderId != userId)
    {
        return Results.Forbid();
    }

    if (message.IsHiddenForSender)
    {
        return Results.NoContent();
    }

    message.IsHiddenForSender = true;
    await db.SaveChangesAsync();

    await hub.Clients.All.SendAsync(
        "ChatMessagesChanged",
        message.SenderId,
        message.ReceiverId,
        message.GroupId);

    return Results.NoContent();
}).RequireAuthorization();

app.MapPost("/api/ozon/analytics/export", async (
    AnalyticsExportRequest request,
    AppDbContext db,
    ClaimsPrincipal principal) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Analytics))
    {
        return Results.Forbid();
    }

    if (request.Rows is not { Count: > 0 })
    {
        return Results.BadRequest("Нет данных для выгрузки.");
    }

    var sheetName = string.IsNullOrWhiteSpace(request.SheetName) ? "Аналитика" : request.SheetName.Trim();
    var fileName = string.IsNullOrWhiteSpace(request.FileName)
        ? $"analytics-{DateTime.UtcNow:yyyyMMdd-HHmmss}.xlsx"
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

app.MapGet("/api/products", async (AppDbContext db, ClaimsPrincipal principal) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Products))
    {
        return Results.Forbid();
    }

    return Results.Ok(products);
})
    .WithName("GetProducts")
    .RequireAuthorization();

app.MapGet("/api/ozon/products", async (OzonApiClient ozonApi, AppDbContext db, ClaimsPrincipal principal, CancellationToken cancellationToken) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Products, FeatureAccess.Production, FeatureAccess.Supplies))
    {
        return Results.Forbid();
    }

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

app.MapGet("/api/ozon/stocks", async (OzonApiClient ozonApi, AppDbContext db, ClaimsPrincipal principal, CancellationToken cancellationToken) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Pooling))
    {
        return Results.Forbid();
    }

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
    AppDbContext db,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, "pooling.editPrices"))
    {
        return Results.Forbid();
    }

    try
    {
        var result = await ozonApi.UpdatePriceAsync(request, cancellationToken);
        AuditLogWriter.Add(
            db,
            principal,
            result.Success ? "Изменение цены Ozon" : "Ошибка изменения цены Ozon",
            "OzonProduct",
            request.ProductId.ToString(),
            $"{request.OfferId}: {request.Price} {request.CurrencyCode}. {result.Message}");
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(result);
    }
    catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
    {
        return Results.Problem(exception.Message);
    }
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapGet("/api/ozon/analytics", async (
    string? dateFrom,
    string? dateTo,
    OzonApiClient ozonApi,
    AppDbContext db,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Analytics))
    {
        return Results.Forbid();
    }

    try
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var from = new DateOnly(today.Year, today.Month, 1);
        var to = today;

        if (!string.IsNullOrWhiteSpace(dateFrom) && !DateOnly.TryParse(dateFrom, out from))
        {
            return Results.BadRequest("Некорректная дата начала периода.");
        }

        if (!string.IsNullOrWhiteSpace(dateTo) && !DateOnly.TryParse(dateTo, out to))
        {
            return Results.BadRequest("Некорректная дата окончания периода.");
        }

        if (from > to)
        {
            return Results.BadRequest("Дата начала не может быть позже даты окончания.");
        }

        var supplyArrivalDates = await SupplyAnalyticsHelper.BuildAcceptedSupplyArrivalDatesAsync(db);
        var result = await ozonApi.GetAnalyticsAsync(from, to, supplyArrivalDates, cancellationToken);
        return Results.Ok(result);
    }
    catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
    {
        return Results.Problem(exception.Message);
    }
}).RequireAuthorization();

app.MapGet("/api/ozon/analytics/snapshot", async (
    OzonApiClient ozonApi,
    AppDbContext db,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Analytics))
    {
        return Results.Forbid();
    }

    try
    {
        var result = await ozonApi.GetAnalyticsSnapshotAsync(cancellationToken);
        return Results.Ok(result);
    }
    catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
    {
        return Results.Problem(exception.Message);
    }
}).RequireAuthorization();

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

app.MapGet("/api/production/catalog", async (string? type, AppDbContext db, ClaimsPrincipal principal) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Production))
    {
        return Results.Forbid();
    }

    var catalog = await ProductionTaskResponses.BuildCatalogAsync(db, type ?? ProductionTaskTypes.Ozon);
    return Results.Ok(catalog);
}).RequireAuthorization();

app.MapPut("/api/production/catalog/convert-to-ozon", async (
    ConvertNovinkaToOzonRequest request,
    AppDbContext db,
    OzonApiClient ozonApi,
    ClaimsPrincipal principal,
    CancellationToken cancellationToken) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Production))
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
        return Results.BadRequest("Не найдены файлы производства для выбранной новинки.");
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
        $"Новинка: {sourceProductName}, файлов: {filesToUpdate.Count}, артикул: {targetProduct.OfferId}");

    await db.SaveChangesAsync(cancellationToken);

    return Results.Ok(new ConvertNovinkaToOzonResponse(
        filesToUpdate.Count,
        targetProduct.ProductId,
        targetProduct.OfferId,
        targetProduct.Name,
        targetProduct.ProductUrl));
}).RequireAuthorization();

app.MapGet("/api/link-preview", async (string? url, IHttpClientFactory httpClientFactory, ClaimsPrincipal principal) =>
{
    if (principal.Identity?.IsAuthenticated != true)
    {
        return Results.Unauthorized();
    }

    if (!LinkPreviewHelper.TryNormalizeExternalUrl(url, out var normalizedUrl))
    {
        return Results.BadRequest("Invalid URL");
    }

    try
    {
        var client = httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(8);
        client.DefaultRequestHeaders.UserAgent.ParseAdd(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        client.DefaultRequestHeaders.Accept.ParseAdd("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
        using var response = await client.GetAsync(normalizedUrl);
        if (!response.IsSuccessStatusCode)
        {
            return Results.Ok(new LinkPreviewResponse(null, null));
        }

        var html = await response.Content.ReadAsStringAsync();
        if (html.Length > 512_000)
        {
            html = html[..512_000];
        }

        var imageUrl = LinkPreviewHelper.ExtractMetaContent(html, "og:image")
            ?? LinkPreviewHelper.ExtractMetaContent(html, "og:image:secure_url")
            ?? LinkPreviewHelper.ExtractMetaContent(html, "og:image:url")
            ?? LinkPreviewHelper.ExtractMetaContent(html, "twitter:image")
            ?? LinkPreviewHelper.ExtractMetaContent(html, "twitter:image:src")
            ?? LinkPreviewHelper.ExtractLinkHref(html, "image_src");
        imageUrl = LinkPreviewHelper.ResolveResourceUrl(normalizedUrl, imageUrl);
        var title = LinkPreviewHelper.ExtractMetaContent(html, "og:title")
            ?? LinkPreviewHelper.ExtractMetaContent(html, "twitter:title");
        return Results.Ok(new LinkPreviewResponse(imageUrl, title));
    }
    catch
    {
        return Results.Ok(new LinkPreviewResponse(null, null));
    }
}).RequireAuthorization();

app.MapGet("/api/link-preview/image", async (string? url, IHttpClientFactory httpClientFactory, ClaimsPrincipal principal) =>
{
    if (principal.Identity?.IsAuthenticated != true)
    {
        return Results.Unauthorized();
    }

    if (!LinkPreviewHelper.TryNormalizeExternalUrl(url, out var normalizedUrl))
    {
        return Results.BadRequest("Invalid URL");
    }

    try
    {
        var client = httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(8);
        client.DefaultRequestHeaders.UserAgent.ParseAdd(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        client.DefaultRequestHeaders.Accept.ParseAdd("image/avif,image/webp,image/apng,image/*,*/*;q=0.8");
        using var response = await client.GetAsync(normalizedUrl);
        if (!response.IsSuccessStatusCode)
        {
            return Results.NotFound();
        }

        var contentType = response.Content.Headers.ContentType?.MediaType ?? "image/jpeg";
        if (!contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
        {
            return Results.NotFound();
        }

        var bytes = await response.Content.ReadAsByteArrayAsync();
        if (bytes.Length == 0 || bytes.Length > 5_000_000)
        {
            return Results.NotFound();
        }

        return Results.File(bytes, contentType);
    }
    catch
    {
        return Results.NotFound();
    }
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

    return Results.Created($"/api/production/files/{productionFile.Id}", new ProductionFileListItem(
        productionFile.Id,
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

app.MapDelete("/api/production/files/{id:guid}", async (
    Guid id,
    AppDbContext db,
    ClaimsPrincipal principal,
    IHubContext<AppHub> hub) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Production))
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

    if (!string.IsNullOrWhiteSpace(status))
    {
        query = query.Where(task => task.Status == status);
    }

    var tasks = await query
        .OrderByDescending(task => task.CreatedAt)
        .ToListAsync();

    return Results.Ok(tasks.Select(ProductionTaskResponses.ToListItem));
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
    TelegramNotificationService telegram) =>
{
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
        if (requestItems.Any(item => string.IsNullOrWhiteSpace(item.ProductName) || string.IsNullOrWhiteSpace(item.ProductLink)))
        {
            return Results.BadRequest("Укажите наименование и ссылку для каждой новинки.");
        }
    }
    else if (requestItems.Any(item => !ProductionTaskResponses.IsValidOzonTaskItemRequest(item)))
    {
        return Results.BadRequest("Выберите товар и укажите количество больше нуля.");
    }

    var builtItems = ProductionTaskResponses.BuildTaskItems(taskType, requestItems);
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
        RequiredQuantity = taskType == ProductionTaskTypes.Novinka
            ? 0
            : builtItems.Sum(item => item.RequiredQuantity),
        IsUrgent = request.IsUrgent,
        CreatedByUserId = currentUser?.Id,
        CreatedByDisplayName = currentUser?.DisplayName
            ?? principal.FindFirstValue("display_name")
            ?? principal.FindFirstValue(ClaimTypes.Name),
        Items = builtItems
    };

    db.ProductionTasks.Add(task);
    AuditLogWriter.Add(db, principal, "Создание задачи", "ProductionTask", task.Id.ToString(), task.ProductName);
    await db.SaveChangesAsync();

    var result = ProductionTaskResponses.ToListItem(task);

    await hub.Clients.All.SendAsync("ProductionTasksChanged", result);

    var createdEventId = task.IsUrgent
        ? "production.task.new.urgent"
        : taskType == ProductionTaskTypes.Novinka
            ? "production.task.new.novinka"
            : "production.task.new.ozon";
    await IntegrationNotificationPublisher.PublishAsync(
        telegram,
        db,
        createdEventId,
        ProductionTaskResponses.BuildNewTaskTelegramMessage(task));

    return Results.Created($"/api/production/tasks/{task.Id}", result);
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapPut("/api/production/tasks/{id:guid}", async (
    Guid id,
    UpdateProductionTaskRequest request,
    AppDbContext db,
    ClaimsPrincipal principal,
    IHubContext<AppHub> hub) =>
{
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

    if (task.Status != ProductionTaskStatuses.New)
    {
        return Results.BadRequest("Редактировать можно только задачу, которая ещё не взята в работу.");
    }

    var taskType = ProductionTaskResponses.NormalizeTaskType(task.TaskType);
    if (taskType == ProductionTaskTypes.Novinka)
    {
        if (requestItems.Any(item => string.IsNullOrWhiteSpace(item.ProductName) || string.IsNullOrWhiteSpace(item.ProductLink)))
        {
            return Results.BadRequest("Укажите наименование и ссылку для каждой новинки.");
        }
    }
    else if (requestItems.Any(item => !ProductionTaskResponses.IsValidOzonTaskItemRequest(item)))
    {
        return Results.BadRequest("Добавьте товары и укажите количество больше нуля.");
    }

    var builtItems = ProductionTaskResponses.BuildTaskItems(taskType, requestItems);
    var firstItem = builtItems[0];
    db.ProductionTaskItems.RemoveRange(task.Items);
    task.Items = builtItems;
    task.OzonProductId = firstItem.OzonProductId;
    task.OfferId = firstItem.OfferId.Trim();
    task.ProductName = builtItems.Count == 1
        ? firstItem.ProductName.Trim()
        : taskType == ProductionTaskTypes.Novinka
            ? $"Новинки · {builtItems.Count} товаров"
            : $"Задача на {builtItems.Count} товаров";
    task.RequiredQuantity = taskType == ProductionTaskTypes.Novinka
        ? 0
        : builtItems.Sum(item => item.RequiredQuantity);
    task.IsUrgent = request.IsUrgent;

    AuditLogWriter.Add(db, principal, "Редактирование задачи", "ProductionTask", task.Id.ToString(), task.ProductName);
    await db.SaveChangesAsync();
    await hub.Clients.All.SendAsync("ProductionTasksChanged");

    return Results.NoContent();
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

    if (task.Status == ProductionTaskStatuses.Cancelled)
    {
        return Results.BadRequest("Отменённую задачу нельзя взять в работу.");
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

    return Results.NoContent();
}).RequireAuthorization();

app.MapPut("/api/production/tasks/{taskId:guid}/items/{itemId:guid}", async (
    Guid taskId,
    Guid itemId,
    UpdateProductionTaskItemRequest request,
    AppDbContext db,
    ClaimsPrincipal principal,
    IHubContext<AppHub> hub) =>
{
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
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

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

    if (task.Status != ProductionTaskStatuses.New)
    {
        return Results.BadRequest("Отменить можно только новую задачу.");
    }

    if (!principal.IsInRole(UserRoles.Admin))
    {
        return Results.Forbid();
    }

    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!Guid.TryParse(currentUserId, out var userId))
    {
        return Results.Unauthorized();
    }

    var currentUser = await db.Users.AsNoTracking().FirstOrDefaultAsync(user => user.Id == userId);
    var cancelledByName = currentUser?.DisplayName
        ?? principal.FindFirstValue("display_name")
        ?? principal.FindFirstValue(ClaimTypes.Name)
        ?? "Администратор";

    task.Status = ProductionTaskStatuses.Cancelled;
    task.CancelledAt = DateTimeOffset.UtcNow;
    task.CancelledByUserId = userId;
    task.CancelledByDisplayName = cancelledByName;
    task.CancellationComment = comment;
    AuditLogWriter.Add(db, principal, "Задача отменена", "ProductionTask", task.Id.ToString(), $"{task.ProductName}. Причина: {comment}");

    if (task.CreatedByUserId is Guid creatorId)
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

    if (task.CreatedByUserId is Guid notifiedUserId)
    {
        await hub.Clients.All.SendAsync("ChatMessagesChanged", SystemUser.Id, notifiedUserId, null);
    }

    await hub.Clients.All.SendAsync("ProductionTasksChanged");

    await IntegrationNotificationPublisher.PublishAsync(
        telegram,
        db,
        "production.task.cancelled",
        ProductionTaskResponses.BuildCancelledTaskTelegramMessage(task, cancelledByName, comment));

    return Results.NoContent();
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapPut("/api/production/tasks/{id:guid}/complete", async (
    Guid id,
    CompleteProductionTaskRequest request,
    AppDbContext db,
    ClaimsPrincipal principal,
    IHubContext<AppHub> hub) =>
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
        foreach (var taskItem in task.Items.Count == 0
                     ? [new ProductionTaskItem { OfferId = task.OfferId, OzonProductId = task.OzonProductId, ProductName = task.ProductName }]
                     : task.Items)
        {
            var hasFiles = files.Any(file =>
                (!string.IsNullOrWhiteSpace(taskItem.OfferId) && file.OfferId == taskItem.OfferId) ||
                (taskItem.OzonProductId > 0 && file.OzonProductId == taskItem.OzonProductId));

            if (!hasFiles)
            {
                return Results.BadRequest($"Добавьте файлы для «{taskItem.ProductName}» перед завершением задачи.");
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
    await hub.Clients.All.SendAsync("ProductionTasksChanged");

    return Results.NoContent();
}).RequireAuthorization();

app.MapPut("/api/production/tasks/{id:guid}/archive", async (
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

    if (task.Status != ProductionTaskStatuses.Completed && task.Status != ProductionTaskStatuses.Cancelled)
    {
        return Results.BadRequest("В архив можно отправить только выполненную или отменённую задачу.");
    }

    task.IsArchived = true;
    task.ArchivedAt = DateTimeOffset.UtcNow;
    AuditLogWriter.Add(db, principal, "Задача архивирована", "ProductionTask", task.Id.ToString(), task.ProductName);
    await db.SaveChangesAsync();
    await hub.Clients.All.SendAsync("ProductionTasksChanged");

    return Results.NoContent();
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapPut("/api/production/tasks/{id:guid}/restore", async (
    Guid id,
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

    if (task.Status != ProductionTaskStatuses.Cancelled)
    {
        return Results.BadRequest("Вернуть в новые можно только отменённую задачу.");
    }

    if (task.IsArchived)
    {
        return Results.BadRequest("Архивированную задачу нельзя вернуть в новые.");
    }

    task.Status = ProductionTaskStatuses.New;
    task.CancelledAt = null;
    task.CancelledByUserId = null;
    task.CancelledByDisplayName = null;
    task.CancellationComment = null;
    task.StartedAt = null;
    task.AssignedUserName = null;
    task.ActualQuantity = null;
    foreach (var item in task.Items)
    {
        item.ActualQuantity = null;
    }

    AuditLogWriter.Add(db, principal, "Задача возвращена в новые", "ProductionTask", task.Id.ToString(), task.ProductName);
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
    AuditLogWriter.Add(db, principal, "Создание поставки", "Supply", supply.Id.ToString(), $"Товаров: {supply.Items.Count}");
    await db.SaveChangesAsync();
    await hub.Clients.All.SendAsync("SuppliesChanged");
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
        supply.IsArchived,
        supply.ArchivedAt,
        supply.Items.Select(item => new SupplyItemListItem(
            item.Id,
            item.OzonProductId,
            item.OfferId,
            item.ProductName,
            item.Quantity,
            item.IsReserve)).ToList(),
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
    AuditLogWriter.Add(db, principal, "Импорт поставки из Excel", "Supply", supply.Id.ToString(), $"Товаров: {supply.Items.Count}");
    await db.SaveChangesAsync(cancellationToken);
    await hub.Clients.All.SendAsync("SuppliesChanged");

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

    AuditLogWriter.Add(db, principal, $"Статус поставки: {request.Status}", "Supply", supply.Id.ToString(), supply.Status);
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
    AuditLogWriter.Add(db, principal, "Редактирование поставки", "Supply", supply.Id.ToString(), $"Товаров: {updatedItems.Count}");
    await db.SaveChangesAsync();

    return Results.NoContent();
}).RequireAuthorization();

app.MapPut("/api/supplies/{id:guid}/archive", async (Guid id, AppDbContext db, ClaimsPrincipal principal) =>
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
            item.Supply.Status,
            item.Supply.IsArchived,
            item.Supply.ArchivedAt,
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
            group.Key.IsArchived,
            group.Key.ArchivedAt,
            group.Key.CreatedAt,
            group.Key.SentAt,
            group.Key.AcceptedAt))
        .ToList());
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
            item.Supply.Status,
            item.Supply.IsArchived,
            item.Supply.CreatedAt,
            item.Supply.SentAt,
            item.Supply.AcceptedAt
        })
        .OrderByDescending(group => group.Key.CreatedAt)
        .ThenBy(group => group.Key.ProductName)
        .ToList();

    var builder = new StringBuilder();
    builder.AppendLine("Дата создания;Дата отправки;Дата приемки;Статус;Товар;Артикул;Количество;Новый товар;ID поставки");
    foreach (var row in rows)
    {
        builder.AppendLine(string.Join(';', [
            CsvExport.Cell(row.Key.CreatedAt.ToString("yyyy-MM-dd HH:mm:ss")),
            CsvExport.Cell(row.Key.SentAt?.ToString("yyyy-MM-dd HH:mm:ss") ?? string.Empty),
            CsvExport.Cell(row.Key.AcceptedAt?.ToString("yyyy-MM-dd HH:mm:ss") ?? string.Empty),
            CsvExport.Cell(row.Key.IsArchived ? "Архив" : row.Key.Status),
            CsvExport.Cell(row.Key.ProductName),
            CsvExport.Cell(row.Key.OfferId),
            CsvExport.Cell(row.Sum(item => item.Quantity).ToString()),
            CsvExport.Cell(row.Key.IsReserve ? "Да" : "Нет"),
            CsvExport.Cell(row.Key.SupplyId.ToString())
        ]));
    }

    return Results.File(
        Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(builder.ToString())).ToArray(),
        "text/csv; charset=utf-8",
        $"supplies-analytics-{DateTime.UtcNow:yyyyMMdd-HHmmss}.csv");
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

if (hasStaticClient)
{
    app.MapFallbackToFile("index.html");
}

app.Run();

record Product(int Id, string Name, string Status, decimal Price);
record CreateInitialAdminRequest(string UserName, string DisplayName, string Password);
record LoginRequest(string UserName, string Password);
record AuthResponse(string Token, CurrentUserResponse User);
record CurrentUserResponse(Guid Id, string UserName, string DisplayName, string Position, string Role, string AvatarUrl, List<string> AllowedFeatures);
record CreateUserRequest(string UserName, string DisplayName, string Position, string Password, string Role, List<string>? AllowedFeatures);
record UpdateUserSettingsRequest(string DisplayName, string Position, string Role, List<string>? AllowedFeatures);
record UpdateProfileRequest(string DisplayName);
record ChangeUserPasswordRequest(string Password);
record UserListItem(
    Guid Id,
    string UserName,
    string DisplayName,
    string Position,
    string Role,
    string AvatarUrl,
    List<string> AllowedFeatures,
    bool IsActive,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastSeenAt,
    bool IsOnline);
record ChatUserListItem(
    Guid Id,
    string UserName,
    string DisplayName,
    string Position,
    string AvatarUrl,
    string Role,
    DateTimeOffset? LastSeenAt,
    bool IsOnline,
    int UnreadCount);
record ChatThreadListItem(
    string Type,
    Guid Id,
    string Title,
    string Subtitle,
    string AvatarUrl,
    bool IsOnline,
    int UnreadCount,
    int MemberCount,
    Guid? CreatedByUserId,
    List<ChatGroupMemberListItem>? Members);
record ChatGroupDetailResponse(
    Guid Id,
    string Name,
    Guid CreatedByUserId,
    int MemberCount,
    List<ChatGroupMemberListItem> Members);
record ChatGroupDeleteMemberResponse(
    bool Deleted,
    Guid GroupId,
    ChatGroupDetailResponse? Group);
record ChatGroupMemberListItem(
    Guid UserId,
    string UserName,
    string DisplayName,
    string Position,
    string AvatarUrl);
record AnalyticsExportRequest(string? SheetName, string? FileName, List<List<string>> Rows);
record CreateChatGroupRequest(string Name, List<string>? MemberIds);
record UpdateChatGroupMembersRequest(List<Guid>? MemberIds);
record ChatMessageListItem(
    Guid Id,
    Guid? GroupId,
    Guid SenderId,
    string SenderDisplayName,
    Guid? ReceiverId,
    string Text,
    string AttachmentFileName,
    string AttachmentContentType,
    bool HasAttachment,
    DateTimeOffset CreatedAt,
    bool IsOwn);
record ProductionFileListItem(
    Guid Id,
    long? OzonProductId,
    string OfferId,
    string ProductName,
    string ProductLink,
    string Notes,
    string FileName,
    string ContentType,
    DateTimeOffset CreatedAt);
record DeleteProductionFileResponse(bool ReworkTaskCreated, Guid? TaskId);
record CreateProductionTaskRequest(string? TaskType, long OzonProductId, string OfferId, string ProductName, int RequiredQuantity, bool IsUrgent, List<CreateProductionTaskItemRequest>? Items);
record CreateProductionTaskItemRequest(long OzonProductId, string OfferId, string ProductName, int RequiredQuantity, bool EnforceMinimumQuantity, string? ProductLink);
record UpdateProductionTaskRequest(bool IsUrgent, List<CreateProductionTaskItemRequest>? Items);
record UpdateProductionTaskItemRequest(int RequiredQuantity);
record CancelProductionTaskRequest(string Comment);
record CompleteProductionTaskRequest(int ActualQuantity, List<CompleteProductionTaskItemRequest>? Items);
record CompleteProductionTaskItemRequest(Guid Id, int ActualQuantity);
record ProductionCatalogItem(
    string OfferId,
    long? OzonProductId,
    string ProductName,
    string ProductLink,
    int FileCount,
    DateTimeOffset? CompletedAt);
record ConvertNovinkaToOzonRequest(
    string SourceOfferId,
    string SourceProductName,
    string SourceProductLink,
    long TargetOzonProductId);
record ConvertNovinkaToOzonResponse(
    int UpdatedFileCount,
    long OzonProductId,
    string OfferId,
    string ProductName,
    string ProductUrl);
record ProductionTaskListItem(
    Guid Id,
    long OzonProductId,
    string OfferId,
    string ProductName,
    int RequiredQuantity,
    int? ActualQuantity,
    string Status,
    string TaskType,
    bool IsUrgent,
    string? AssignedUserName,
    Guid? CreatedByUserId,
    string? CreatedByDisplayName,
    DateTimeOffset CreatedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CancelledAt,
    Guid? CancelledByUserId,
    string? CancelledByDisplayName,
    string? CancellationComment,
    DateTimeOffset? CompletedAt,
    bool IsArchived,
    DateTimeOffset? ArchivedAt,
    List<ProductionTaskItemListItem> Items);
record ProductionTaskItemListItem(Guid Id, long OzonProductId, string OfferId, string ProductName, string ProductLink, int RequiredQuantity, int? ActualQuantity, bool EnforceMinimumQuantity);
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
    List<SupplyItemListItem> Items,
    List<SupplyHistoryItem> History);
record SupplyItemListItem(
    Guid Id,
    long? OzonProductId,
    string OfferId,
    string ProductName,
    int Quantity,
    bool IsReserve);
record SupplyHistoryItem(
    Guid Id,
    string UserName,
    string DisplayName,
    string Action,
    string Details,
    DateTimeOffset CreatedAt);
record SupplyAnalyticsItem(
    Guid Id,
    Guid SupplyId,
    long? OzonProductId,
    string OfferId,
    string ProductName,
    int Quantity,
    bool IsReserve,
    string Status,
    bool IsArchived,
    DateTimeOffset? ArchivedAt,
    DateTimeOffset CreatedAt,
    DateTimeOffset? SentAt,
    DateTimeOffset? AcceptedAt);
record AuditLogListItem(
    Guid Id,
    string UserName,
    string DisplayName,
    string Action,
    string EntityType,
    string EntityId,
    string Details,
    DateTimeOffset CreatedAt);
record SystemHealthResponse(
    bool DatabaseOk,
    DateTimeOffset ServerTime,
    string Uptime,
    string MachineName,
    string DotnetVersion);
record BackupFileResponse(string FileName, long SizeBytes, DateTimeOffset CreatedAt);
record OzonIntegrationStatusResponse(
    bool Configured,
    bool Success,
    string Message,
    string BaseUrl,
    string ClientIdMasked,
    string ApiKeyMasked,
    DateTimeOffset CheckedAt);

static class SupplyAnalyticsHelper
{
    public static async Task<Dictionary<string, string>> BuildAcceptedSupplyArrivalDatesAsync(AppDbContext db)
    {
        var items = await (
            from item in db.SupplyItems.AsNoTracking()
            join supply in db.Supplies.AsNoTracking() on item.SupplyId equals supply.Id
            where !item.IsReserve &&
                  supply.Status == SupplyStatuses.Accepted &&
                  supply.AcceptedAt != null
            select new
            {
                item.OfferId,
                item.OzonProductId,
                AcceptedAt = supply.AcceptedAt!.Value
            }).ToListAsync();

        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in items)
        {
            var date = item.AcceptedAt.ToString("yyyy-MM-dd");
            if (!string.IsNullOrWhiteSpace(item.OfferId))
            {
                var key = $"offer:{item.OfferId.Trim()}";
                if (!map.TryGetValue(key, out var existing) || string.Compare(date, existing, StringComparison.Ordinal) > 0)
                {
                    map[key] = date;
                }
            }

            if (item.OzonProductId is > 0)
            {
                var key = $"product:{item.OzonProductId.Value}";
                if (!map.TryGetValue(key, out var existing) || string.Compare(date, existing, StringComparison.Ordinal) > 0)
                {
                    map[key] = date;
                }
            }
        }

        return map;
    }
}

static class AuditLogWriter
{
    public static void Add(
        AppDbContext db,
        ClaimsPrincipal principal,
        string action,
        string entityType,
        string entityId,
        string details)
    {
        Guid? userId = null;
        if (Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var parsedUserId))
        {
            userId = parsedUserId;
        }

        db.AuditLogs.Add(new AuditLog
        {
            UserId = userId,
            UserName = principal.FindFirstValue(ClaimTypes.Name) ?? string.Empty,
            DisplayName = principal.FindFirstValue("display_name") ?? string.Empty,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            Details = details,
        });
    }
}

static class ProductionTaskResponses
{
    public static string NormalizeTaskType(string? value) =>
        string.Equals(value, ProductionTaskTypes.Novinka, StringComparison.OrdinalIgnoreCase)
            ? ProductionTaskTypes.Novinka
            : ProductionTaskTypes.Ozon;

    public static string BuildNovinkaOfferId(Guid itemId) => $"NV-{itemId:N}";

    public static bool IsNovinkaProductionFile(ProductionFile file) =>
        file.OfferId.StartsWith("NV-", StringComparison.OrdinalIgnoreCase) ||
        (!string.IsNullOrWhiteSpace(file.ProductLink) && file.OzonProductId is null or 0);

    public static bool MatchesNovinkaProductionFile(
        ProductionFile file,
        string offerId,
        string productName,
        string productLink)
    {
        if (!string.IsNullOrWhiteSpace(offerId) &&
            string.Equals(file.OfferId, offerId.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (!string.IsNullOrWhiteSpace(productLink) &&
            string.Equals(file.ProductLink, productLink.Trim(), StringComparison.OrdinalIgnoreCase) &&
            string.Equals(file.ProductName, productName.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return !string.IsNullOrWhiteSpace(productName) &&
               file.OfferId.StartsWith("NV-", StringComparison.OrdinalIgnoreCase) &&
               string.Equals(file.ProductName, productName.Trim(), StringComparison.OrdinalIgnoreCase);
    }

    public static async Task<ProductionTaskListItem?> TryCreateNovinkaReworkTaskAsync(
        AppDbContext db,
        ClaimsPrincipal principal,
        string productName,
        string productLink,
        string offerId)
    {
        var normalizedName = productName.Trim();
        if (string.IsNullOrWhiteSpace(normalizedName))
        {
            return null;
        }

        var normalizedOfferId = offerId.Trim();
        var normalizedLink = await ResolveNovinkaProductLinkAsync(
            db,
            normalizedName,
            productLink,
            normalizedOfferId);

        if (string.IsNullOrWhiteSpace(normalizedLink) && string.IsNullOrWhiteSpace(normalizedOfferId))
        {
            return null;
        }

        var activeTasks = await db.ProductionTasks
            .AsNoTracking()
            .Include(task => task.Items)
            .Where(task =>
                !task.IsArchived &&
                task.TaskType == ProductionTaskTypes.Novinka &&
                (task.Status == ProductionTaskStatuses.New || task.Status == ProductionTaskStatuses.InProgress))
            .ToListAsync();

        var existingActiveTask = activeTasks.FirstOrDefault(task =>
            TaskMatchesNovinkaProduct(task, normalizedName, normalizedLink, normalizedOfferId));

        if (existingActiveTask is not null)
        {
            return ToListItem(existingActiveTask);
        }

        var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        var currentUser = Guid.TryParse(currentUserId, out var parsedUserId)
            ? await db.Users.AsNoTracking().FirstOrDefaultAsync(user => user.Id == parsedUserId)
            : null;
        var builtItems = BuildTaskItems(
            ProductionTaskTypes.Novinka,
            [new CreateProductionTaskItemRequest(0, string.Empty, normalizedName, 0, false, normalizedLink)]);
        var firstItem = builtItems[0];
        var task = new ProductionTask
        {
            TaskType = ProductionTaskTypes.Novinka,
            Status = ProductionTaskStatuses.New,
            OzonProductId = firstItem.OzonProductId,
            OfferId = firstItem.OfferId.Trim(),
            ProductName = normalizedName,
            RequiredQuantity = 0,
            CreatedByUserId = currentUser?.Id,
            CreatedByDisplayName = currentUser?.DisplayName
                ?? principal.FindFirstValue("display_name")
                ?? principal.FindFirstValue(ClaimTypes.Name),
            Items = builtItems
        };

        db.ProductionTasks.Add(task);
        AuditLogWriter.Add(
            db,
            principal,
            "Автосоздание задачи после удаления файлов новинки",
            "ProductionTask",
            task.Id.ToString(),
            task.ProductName);
        await db.SaveChangesAsync();

        return ToListItem(task);
    }

    private static async Task<string> ResolveNovinkaProductLinkAsync(
        AppDbContext db,
        string productName,
        string productLink,
        string offerId)
    {
        if (!string.IsNullOrWhiteSpace(productLink))
        {
            return productLink.Trim();
        }

        if (!string.IsNullOrWhiteSpace(offerId))
        {
            var linkByOffer = await db.ProductionTaskItems
                .AsNoTracking()
                .Where(item =>
                    item.OfferId == offerId &&
                    !string.IsNullOrWhiteSpace(item.ProductLink))
                .OrderByDescending(item => item.Id)
                .Select(item => item.ProductLink)
                .FirstOrDefaultAsync();

            if (!string.IsNullOrWhiteSpace(linkByOffer))
            {
                return linkByOffer.Trim();
            }
        }

        var linkByName = await db.ProductionTaskItems
            .AsNoTracking()
            .Where(item =>
                item.ProductName == productName &&
                !string.IsNullOrWhiteSpace(item.ProductLink))
            .OrderByDescending(item => item.Id)
            .Select(item => item.ProductLink)
            .FirstOrDefaultAsync();

        return linkByName?.Trim() ?? string.Empty;
    }

    private static bool TaskMatchesNovinkaProduct(
        ProductionTask task,
        string productName,
        string productLink,
        string offerId)
    {
        return task.Items.Any(item =>
            (string.Equals(item.ProductName, productName, StringComparison.OrdinalIgnoreCase) &&
             (string.IsNullOrWhiteSpace(productLink) ||
              string.Equals(item.ProductLink, productLink, StringComparison.OrdinalIgnoreCase))) ||
            (!string.IsNullOrWhiteSpace(offerId) &&
             string.Equals(item.OfferId, offerId, StringComparison.OrdinalIgnoreCase)));
    }

    public static ProductionTaskListItem ToListItem(ProductionTask task) =>
        new(
            task.Id,
            task.OzonProductId,
            task.OfferId,
            task.ProductName,
            task.RequiredQuantity,
            task.ActualQuantity,
            task.Status,
            NormalizeTaskType(task.TaskType),
            task.IsUrgent,
            task.AssignedUserName,
            task.CreatedByUserId,
            task.CreatedByDisplayName,
            task.CreatedAt,
            task.StartedAt,
            task.CancelledAt,
            task.CancelledByUserId,
            task.CancelledByDisplayName,
            task.CancellationComment,
            task.CompletedAt,
            task.IsArchived,
            task.ArchivedAt,
            MapItems(task));

    public static string BuildNewTaskTelegramMessage(ProductionTask task)
    {
        var taskType = NormalizeTaskType(task.TaskType);
        var isNovinka = taskType == ProductionTaskTypes.Novinka;
        var items = task.Items.Count > 0
            ? task.Items.OrderBy(item => item.ProductName).ToList()
            :
            [
                new ProductionTaskItem
                {
                    OfferId = task.OfferId,
                    ProductName = task.ProductName,
                    RequiredQuantity = task.RequiredQuantity
                }
            ];

        var builder = new StringBuilder();
        builder.Append("Новая задача");
        if (task.IsUrgent)
        {
            builder.Append(" (срочно)");
        }

        builder.AppendLine();
        builder.AppendLine($"Тип: {(isNovinka ? "Новинка" : "Ozon")}");

        if (items.Count == 1)
        {
            var item = items[0];
            builder.AppendLine($"Товар: {ShortenText(item.ProductName)}");
            if (!string.IsNullOrWhiteSpace(item.OfferId))
            {
                builder.AppendLine($"Артикул: {item.OfferId.Trim()}");
            }

            if (!isNovinka && item.RequiredQuantity > 0)
            {
                builder.AppendLine($"Количество: {item.RequiredQuantity} шт.");
            }

            if (isNovinka && !string.IsNullOrWhiteSpace(item.ProductLink))
            {
                builder.AppendLine($"Ссылка: {ShortenText(item.ProductLink, 96)}");
            }
        }
        else
        {
            builder.AppendLine($"Позиций: {items.Count}");
            foreach (var item in items.Take(5))
            {
                var line = new StringBuilder($"• {ShortenText(item.ProductName, 52)}");
                if (!isNovinka && item.RequiredQuantity > 0)
                {
                    line.Append($" — {item.RequiredQuantity} шт.");
                }

                if (!string.IsNullOrWhiteSpace(item.OfferId))
                {
                    line.Append($" · {item.OfferId.Trim()}");
                }

                builder.AppendLine(line.ToString());
            }

            if (items.Count > 5)
            {
                builder.AppendLine($"• … ещё {items.Count - 5}");
            }
        }

        var executor = string.IsNullOrWhiteSpace(task.AssignedUserName)
            ? "не назначен"
            : task.AssignedUserName.Trim();
        builder.AppendLine($"Исполнитель: {executor}");

        var creator = string.IsNullOrWhiteSpace(task.CreatedByDisplayName)
            ? "—"
            : task.CreatedByDisplayName.Trim();
        builder.AppendLine($"Создал: {creator}");

        return builder.ToString().TrimEnd();
    }

    public static string BuildCancelledTaskTelegramMessage(
        ProductionTask task,
        string cancelledByName,
        string comment)
    {
        var items = task.Items.Count > 0
            ? task.Items.OrderBy(item => item.ProductName).ToList()
            :
            [
                new ProductionTaskItem
                {
                    OfferId = task.OfferId,
                    ProductName = task.ProductName,
                    RequiredQuantity = task.RequiredQuantity
                }
            ];

        var builder = new StringBuilder();
        builder.AppendLine("Задача отменена");
        builder.AppendLine($"Товар: {ShortenText(items.Count == 1 ? items[0].ProductName : task.ProductName)}");

        if (items.Count == 1 && !string.IsNullOrWhiteSpace(items[0].OfferId))
        {
            builder.AppendLine($"Артикул: {items[0].OfferId.Trim()}");
        }
        else if (items.Count > 1)
        {
            builder.AppendLine($"Позиций: {items.Count}");
        }

        if (items.Count == 1 && items[0].RequiredQuantity > 0)
        {
            builder.AppendLine($"Количество: {items[0].RequiredQuantity} шт.");
        }

        builder.AppendLine($"Отменил: {cancelledByName.Trim()}");

        var creator = string.IsNullOrWhiteSpace(task.CreatedByDisplayName)
            ? "—"
            : task.CreatedByDisplayName.Trim();
        builder.AppendLine($"Создал: {creator}");
        builder.AppendLine($"Причина: {comment.Trim()}");

        return builder.ToString().TrimEnd();
    }

    private static string ShortenText(string? value, int maxLength = 72)
    {
        var trimmed = (value ?? string.Empty).Replace('\r', ' ').Replace('\n', ' ').Trim();
        while (trimmed.Contains("  ", StringComparison.Ordinal))
        {
            trimmed = trimmed.Replace("  ", " ", StringComparison.Ordinal);
        }

        if (trimmed.Length <= maxLength)
        {
            return trimmed;
        }

        return trimmed[..(maxLength - 1)].TrimEnd() + "…";
    }

    private static List<ProductionTaskItemListItem> MapItems(ProductionTask task) =>
        task.Items.Count == 0
            ? [new ProductionTaskItemListItem(task.Id, task.OzonProductId, task.OfferId, task.ProductName, string.Empty, task.RequiredQuantity, task.ActualQuantity, false)]
            : task.Items
                .OrderBy(item => item.ProductName)
                .Select(item => new ProductionTaskItemListItem(
                    item.Id,
                    item.OzonProductId,
                    item.OfferId,
                    item.ProductName,
                    item.ProductLink,
                    item.RequiredQuantity,
                    item.ActualQuantity,
                    item.EnforceMinimumQuantity))
                .ToList();

    public static List<ProductionTaskItem> BuildTaskItems(
        string taskType,
        IReadOnlyCollection<CreateProductionTaskItemRequest> requestItems)
    {
        if (NormalizeTaskType(taskType) == ProductionTaskTypes.Novinka)
        {
            return requestItems.Select(itemRequest =>
            {
                var itemId = Guid.NewGuid();
                return new ProductionTaskItem
                {
                    Id = itemId,
                    OzonProductId = 0,
                    OfferId = BuildNovinkaOfferId(itemId),
                    ProductName = itemRequest.ProductName.Trim(),
                    ProductLink = itemRequest.ProductLink?.Trim() ?? string.Empty,
                    RequiredQuantity = 0,
                    EnforceMinimumQuantity = false
                };
            }).ToList();
        }

        return requestItems.Select(itemRequest => new ProductionTaskItem
        {
            OzonProductId = itemRequest.OzonProductId,
            OfferId = itemRequest.OfferId.Trim(),
            ProductName = itemRequest.ProductName.Trim(),
            ProductLink = itemRequest.ProductLink?.Trim() ?? string.Empty,
            RequiredQuantity = itemRequest.RequiredQuantity,
            EnforceMinimumQuantity = itemRequest.EnforceMinimumQuantity
        }).ToList();
    }

    public static bool IsValidOzonTaskItemRequest(CreateProductionTaskItemRequest item)
    {
        if (item.RequiredQuantity <= 0)
        {
            return false;
        }

        if (item.OzonProductId > 0)
        {
            return !string.IsNullOrWhiteSpace(item.OfferId) || !string.IsNullOrWhiteSpace(item.ProductName);
        }

        return !string.IsNullOrWhiteSpace(item.OfferId) ||
               (!string.IsNullOrWhiteSpace(item.ProductName) && !string.IsNullOrWhiteSpace(item.ProductLink));
    }

    public static async Task<List<ProductionCatalogItem>> BuildCatalogAsync(
        AppDbContext db,
        string taskType)
    {
        var normalizedTaskType = NormalizeTaskType(taskType);
        var files = await db.ProductionFiles.AsNoTracking().ToListAsync();

        if (normalizedTaskType == ProductionTaskTypes.Novinka)
        {
            return BuildNovinkaCatalogFromFiles(files);
        }

        var tasks = await db.ProductionTasks
            .AsNoTracking()
            .Include(task => task.Items)
            .Where(task =>
                task.Status == ProductionTaskStatuses.Completed &&
                !task.IsArchived &&
                task.TaskType == normalizedTaskType)
            .ToListAsync();

        var catalog = new List<ProductionCatalogItem>();

        foreach (var task in tasks)
        {
            var taskItems = task.Items.Count == 0
                ?
                [
                    new ProductionTaskItem
                    {
                        Id = task.Id,
                        OzonProductId = task.OzonProductId,
                        OfferId = task.OfferId,
                        ProductName = task.ProductName,
                        ProductLink = string.Empty
                    }
                ]
                : task.Items;

            foreach (var item in taskItems)
            {
                var itemFiles = files.Where(file =>
                        (!string.IsNullOrWhiteSpace(item.OfferId) && file.OfferId == item.OfferId) ||
                        (item.OzonProductId > 0 && file.OzonProductId == item.OzonProductId))
                    .ToList();

                if (itemFiles.Count == 0)
                {
                    continue;
                }

                catalog.Add(new ProductionCatalogItem(
                    item.OfferId,
                    item.OzonProductId > 0 ? item.OzonProductId : null,
                    item.ProductName,
                    item.ProductLink,
                    itemFiles.Count,
                    task.CompletedAt));
            }
        }

        return catalog
            .GroupBy(item => item.OfferId, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.OrderByDescending(item => item.CompletedAt).First())
            .OrderBy(item => item.ProductName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public static string GetNovinkaCatalogKey(ProductionFile file) =>
        GetNovinkaCatalogKeyFromCatalogItem(file.OfferId, file.ProductName, file.ProductLink);

    private static string GetNovinkaCatalogKeyFromCatalogItem(string offerId, string productName, string productLink)
    {
        var name = productName.Trim();
        var link = productLink.Trim();
        if (!string.IsNullOrEmpty(link))
        {
            return $"{name.ToLowerInvariant()}|{link.ToLowerInvariant()}";
        }

        if (!string.IsNullOrWhiteSpace(offerId))
        {
            return offerId.Trim().ToUpperInvariant();
        }

        return name.ToLowerInvariant();
    }

    public static List<ProductionFile> FindNovinkaCatalogFiles(
        IEnumerable<ProductionFile> files,
        string offerId,
        string productName,
        string productLink)
    {
        var key = GetNovinkaCatalogKeyFromCatalogItem(offerId, productName, productLink);
        return files
            .Where(IsNovinkaProductionFile)
            .Where(file => string.Equals(GetNovinkaCatalogKey(file), key, StringComparison.OrdinalIgnoreCase))
            .ToList();
    }

    private static List<ProductionCatalogItem> BuildNovinkaCatalogFromFiles(List<ProductionFile> files) =>
        files
            .Where(IsNovinkaProductionFile)
            .GroupBy(GetNovinkaCatalogKey, StringComparer.OrdinalIgnoreCase)
            .Select(group =>
            {
                var latest = group.OrderByDescending(file => file.CreatedAt).First();
                return new ProductionCatalogItem(
                    latest.OfferId,
                    latest.OzonProductId is > 0 ? latest.OzonProductId : null,
                    latest.ProductName,
                    latest.ProductLink,
                    group.Count(),
                    group.Max(file => file.CreatedAt));
            })
            .OrderBy(item => item.ProductName, StringComparer.OrdinalIgnoreCase)
            .ToList();
}

static class ChatAccess
{
    public static async Task<bool> IsGroupMemberAsync(AppDbContext db, Guid groupId, Guid userId) =>
        await db.ChatGroupMembers.AnyAsync(member => member.GroupId == groupId && member.UserId == userId);
}

static class ChatResponses
{
    public static async Task<List<ChatGroupMemberListItem>> LoadGroupMembersAsync(AppDbContext db, Guid groupId) =>
        await db.ChatGroupMembers
            .AsNoTracking()
            .Where(member => member.GroupId == groupId)
            .Join(
                db.Users.AsNoTracking(),
                member => member.UserId,
                user => user.Id,
                (member, user) => new ChatGroupMemberListItem(
                    user.Id,
                    user.UserName,
                    user.DisplayName,
                    user.Position,
                    UserResponses.AvatarUrl(user.AvatarFileName)))
            .OrderBy(member => member.DisplayName)
            .ThenBy(member => member.UserName)
            .ToListAsync();

    public static async Task<ChatGroupDetailResponse?> BuildGroupDetailAsync(AppDbContext db, Guid groupId)
    {
        var group = await db.ChatGroups
            .AsNoTracking()
            .FirstOrDefaultAsync(entry => entry.Id == groupId);
        if (group is null)
        {
            return null;
        }

        var members = await LoadGroupMembersAsync(db, groupId);
        return new ChatGroupDetailResponse(group.Id, group.Name, group.CreatedByUserId, members.Count, members);
    }
}

static class SystemUserBootstrap
{
    public static async Task EnsureExistsAsync(AppDbContext db)
    {
        if (await db.Users.AnyAsync(user => user.Id == SystemUser.Id))
        {
            return;
        }

        db.Users.Add(new AppUser
        {
            Id = SystemUser.Id,
            UserName = SystemUser.UserName,
            DisplayName = SystemUser.DisplayName,
            PasswordHash = PasswordHasher.Hash(Guid.NewGuid().ToString("N")),
            Role = UserRoles.User,
            IsActive = true,
            AllowedFeatures = string.Empty
        });
        await db.SaveChangesAsync();
    }
}

static class AppPublicText
{
    public static string MaskSecret(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "не задан";
        }

        if (value.Length <= 6)
        {
            return new string('*', value.Length);
        }

        return $"{value[..3]}...{value[^3..]}";
    }

    public static string GetPublicOzonError(Exception exception)
    {
        var message = exception.Message;
        if (message.Length > 220)
        {
            message = $"{message[..220]}...";
        }

        return $"Ozon API не отвечает: {message}";
    }
}

static class FeatureAccess
{
    public const string Production = "production";
    public const string Products = "products";
    public const string Analytics = "analytics";
    public const string Pooling = "pooling";
    public const string Supplies = "supplies";
    public const string Chats = "chats";
    public const string Home = "home";

    public static readonly string[] UserDefaults =
    [
        Home,
        Production,
        "production.products",
        "production.tasks",
        "production.inProgress",
        "production.cancelled",
        "production.completed",
        Products,
        Supplies,
        "supplies.create",
        "supplies.all",
        Chats,
        "integrations"
    ];

    public static readonly string[] All =
    [
        Home,
        Production,
        "production.products",
        "production.tasks",
        "production.inProgress",
        "production.cancelled",
        "production.completed",
        "production.archive",
        "production.createTask",
        Products,
        Analytics,
        "analytics.summary",
        "analytics.topProducts",
        "analytics.noSales",
        Pooling,
        "pooling.editPrices",
        Supplies,
        "supplies.create",
        "supplies.editor",
        "supplies.all",
        "supplies.archive",
        "supplies.analytics",
        Chats,
        "integrations"
    ];

    public static List<string> Parse(string value) =>
        value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(feature => All.Contains(feature))
            .Distinct()
            .ToList();

    public static string NormalizeForRole(string role, IReadOnlyCollection<string>? features)
    {
        if (role == UserRoles.Admin)
        {
            return string.Join(',', All);
        }

        var selected = features is { Count: > 0 }
            ? features.Where(feature => All.Contains(feature)).Distinct().ToList()
            : UserDefaults.ToList();

        return string.Join(',', selected);
    }

    public static async Task<bool> HasAnyAsync(AppDbContext db, ClaimsPrincipal principal, params string[] features)
    {
        if (principal.IsInRole(UserRoles.Admin))
        {
            return true;
        }

        var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(currentUserId, out var userId))
        {
            return false;
        }

        var allowedFeatures = await db.Users
            .AsNoTracking()
            .Where(user => user.Id == userId && user.IsActive)
            .Select(user => user.AllowedFeatures)
            .FirstOrDefaultAsync();

        if (allowedFeatures is null)
        {
            return false;
        }

        var allowed = Parse(allowedFeatures);
        return features.Any(feature => allowed.Contains(feature));
    }
}

static class UserResponses
{
    public static CurrentUserResponse Current(AppUser user) =>
        new(
            user.Id,
            user.UserName,
            user.DisplayName,
            user.Position,
            user.Role,
            AvatarUrl(user),
            Features(user));

    public static List<string> Features(AppUser user) =>
        user.Role == UserRoles.Admin ? FeatureAccess.All.ToList() : FeatureAccess.Parse(user.AllowedFeatures);

    public static string AvatarUrl(AppUser user) => AvatarUrl(user.AvatarFileName);

    public static string AvatarUrl(string avatarFileName) =>
        string.IsNullOrWhiteSpace(avatarFileName) ? string.Empty : $"/api/avatars/{Uri.EscapeDataString(avatarFileName)}";
}

static class AppPaths
{
    public static string GetAvatarDirectory(IWebHostEnvironment environment) =>
        Path.GetFullPath(Path.Combine(environment.ContentRootPath, "user-avatars"));

    public static string GetBackupDirectory(IWebHostEnvironment environment)
    {
        var contentRootBackups = Path.Combine(environment.ContentRootPath, "backups");
        if (Directory.Exists(contentRootBackups))
        {
            return Path.GetFullPath(contentRootBackups);
        }

        var parent = Directory.GetParent(environment.ContentRootPath)?.FullName;
        return Path.GetFullPath(Path.Combine(parent ?? environment.ContentRootPath, "backups"));
    }
}

static class CsvExport
{
    public static string Cell(string value) => $"\"{value.Replace("\"", "\"\"")}\"";
}

static class ExcelExport
{
    private static readonly XNamespace Spreadsheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

    public static byte[] CreateWorkbook(string sheetName, IReadOnlyList<string[]> rows)
    {
        var safeSheetName = string.IsNullOrWhiteSpace(sheetName) ? "Sheet1" : sheetName.Trim();
        if (safeSheetName.Length > 31)
        {
            safeSheetName = safeSheetName[..31];
        }

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
            WriteEntry(archive, "xl/workbook.xml", $"""
                <?xml version="1.0" encoding="UTF-8"?>
                <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
                  <sheets><sheet name="{System.Security.SecurityElement.Escape(safeSheetName)}" sheetId="1" r:id="rId1"/></sheets>
                </workbook>
                """);
            WriteEntry(archive, "xl/worksheets/sheet1.xml", CreateWorksheet(rows));
        }

        return memory.ToArray();
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

    private static void WriteEntry(ZipArchive archive, string path, string content)
    {
        var entry = archive.CreateEntry(path);
        using var writer = new StreamWriter(entry.Open(), Encoding.UTF8);
        writer.Write(content.Trim());
    }

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
}

static class ExcelSupplyImport
{
    private static readonly XNamespace Spreadsheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private static readonly XNamespace Relationships = "http://schemas.openxmlformats.org/package/2006/relationships";

    public static byte[] CreateTemplate()
    {
        var rows = new[]
        {
            new[] { "Название товара", "Артикул", "ProductId", "Количество", "Новый товар" },
            new[] { "Пример постоянного товара", "OFFER-001", "123456789", "10", "нет" },
            new[] { "Пример нового товара", "", "", "5", "да" }
        };
        return ExcelExport.CreateWorkbook("Поставка", rows);
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

    private static string GetValue(IReadOnlyList<string> values, int index) =>
        index < values.Count ? values[index].Trim() : string.Empty;

    private static bool IsTrue(string value) =>
        value.Equals("да", StringComparison.OrdinalIgnoreCase)
        || value.Equals("true", StringComparison.OrdinalIgnoreCase)
        || value.Equals("1", StringComparison.OrdinalIgnoreCase);

    private static int ColumnIndex(string cellReference)
    {
        var letters = new string(cellReference.TakeWhile(char.IsLetter).ToArray());
        return letters.Aggregate(0, (sum, letter) => sum * 26 + letter - 'A' + 1) - 1;
    }
}

record LinkPreviewResponse(string? ImageUrl, string? Title);

static class LinkPreviewHelper
{
    private static readonly Regex MetaTagRegex = new(
        "<meta\\s+(?<attrs>[^>]*?)>",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex LinkTagRegex = new(
        "<link\\s+(?<attrs>[^>]*?)>",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static bool TryNormalizeExternalUrl(string? url, out Uri normalizedUrl)
    {
        normalizedUrl = null!;
        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri))
        {
            return false;
        }

        if (uri.Scheme is not "http" and not "https")
        {
            return false;
        }

        if (uri.IsLoopback || uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (uri.Host.EndsWith(".local", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        normalizedUrl = uri;
        return true;
    }

    public static string? ExtractMetaContent(string html, string propertyName)
    {
        foreach (Match match in MetaTagRegex.Matches(html))
        {
            var attrs = match.Groups["attrs"].Value;
            if (!MetaAttributeMatches(attrs, "property", propertyName)
                && !MetaAttributeMatches(attrs, "name", propertyName))
            {
                continue;
            }

            var content = ReadMetaAttribute(attrs, "content");
            if (!string.IsNullOrWhiteSpace(content))
            {
                return WebUtility.HtmlDecode(content.Trim());
            }
        }

        return null;
    }

    public static string? ExtractLinkHref(string html, string relValue)
    {
        foreach (Match match in LinkTagRegex.Matches(html))
        {
            var attrs = match.Groups["attrs"].Value;
            if (!MetaAttributeMatches(attrs, "rel", relValue))
            {
                continue;
            }

            var href = ReadMetaAttribute(attrs, "href");
            if (!string.IsNullOrWhiteSpace(href))
            {
                return WebUtility.HtmlDecode(href.Trim());
            }
        }

        return null;
    }

    public static string? ResolveResourceUrl(Uri pageUrl, string? resourceUrl)
    {
        if (string.IsNullOrWhiteSpace(resourceUrl))
        {
            return null;
        }

        var trimmed = WebUtility.HtmlDecode(resourceUrl.Trim());
        if (trimmed.StartsWith("//", StringComparison.Ordinal))
        {
            return $"{pageUrl.Scheme}:{trimmed}";
        }

        if (Uri.TryCreate(trimmed, UriKind.Absolute, out var absolute)
            && absolute.Scheme is "http" or "https")
        {
            return absolute.ToString();
        }

        if (Uri.TryCreate(pageUrl, trimmed, out var resolved)
            && resolved.Scheme is "http" or "https")
        {
            return resolved.ToString();
        }

        return null;
    }

    private static bool MetaAttributeMatches(string attrs, string attributeName, string expectedValue)
    {
        var value = ReadMetaAttribute(attrs, attributeName);
        return value.Equals(expectedValue, StringComparison.OrdinalIgnoreCase);
    }

    private static string ReadMetaAttribute(string attrs, string attributeName)
    {
        var pattern = $"{attributeName}\\s*=\\s*(?:\"(?<value>[^\"]*)\"|'(?<value>[^']*)'|(?<value>[^\\s>]+))";
        var match = Regex.Match(attrs, pattern, RegexOptions.IgnoreCase);
        return match.Success ? match.Groups["value"].Value.Trim() : string.Empty;
    }
}
