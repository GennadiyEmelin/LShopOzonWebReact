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
using LShopOzonWebReact.Api.Contracts.Profile;
using LShopOzonWebReact.Api.Hubs;

namespace LShopOzonWebReact.Api.Endpoints;

public static class ProfileEndpoints
{
    public static void MapProfileEndpoints(this WebApplication app)
    {
        app.MapPut("/api/profile/password", async (
            ChangeOwnPasswordRequest request,
            AppDbContext db,
            ClaimsPrincipal principal) =>
        {
            var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
            if (!Guid.TryParse(currentUserId, out var userId))
            {
                return Results.Unauthorized();
            }

            if (string.IsNullOrWhiteSpace(request.CurrentPassword) || string.IsNullOrWhiteSpace(request.NewPassword))
            {
                return Results.BadRequest("Укажите текущий и новый пароль.");
            }

            var user = await db.Users.FindAsync(userId);
            if (user is null || !user.IsActive)
            {
                return Results.Unauthorized();
            }

            if (!PasswordHasher.Verify(request.CurrentPassword, user.PasswordHash))
            {
                return Results.BadRequest("Текущий пароль указан неверно.");
            }

            user.PasswordHash = PasswordHasher.Hash(request.NewPassword);
            AuditLogWriter.Add(db, principal, "Смена своего пароля", "User", user.Id.ToString(), user.UserName);
            await db.SaveChangesAsync();

            return Results.NoContent();
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

            return Results.Ok(await UserResponses.BuildCurrentUserAsync(db, user));
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

            return Results.Ok(await UserResponses.BuildCurrentUserAsync(db, user));
        }).DisableAntiforgery().RequireAuthorization();
    }
}

