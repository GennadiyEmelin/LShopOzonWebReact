using System.Security.Claims;
using LShopOzonWebReact.Api.Contracts.Auth;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Security;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this WebApplication app)
    {
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

            return Results.Created("/api/admin/users", await UserResponses.BuildCurrentUserAsync(db, admin));
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
                var profile = await db.RoleProfiles.AsNoTracking().FirstOrDefaultAsync(item => item.Role == user.Role);
                user.AllowedFeatures = FeatureAccess.NormalizeForRole(
                    user.Role,
                    null,
                    profile?.AllowedFeatures);
            }

            user.LastSeenAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();

            return Results.Ok(new AuthResponse(
                tokenService.CreateToken(user),
                await UserResponses.BuildCurrentUserAsync(db, user)));
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
            return user is null
                ? Results.Unauthorized()
                : Results.Ok(await UserResponses.BuildCurrentUserAsync(db, user));
        }).RequireAuthorization();
    }
}
