using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Security;

public static class UserRoleResolver
{
    private static readonly string[] RoleClaimTypes =
    [
        "role",
        ClaimTypes.Role,
        "http://schemas.microsoft.com/ws/2008/06/identity/claims/role"
    ];

    public static Guid? GetUserId(ClaimsPrincipal principal)
    {
        var userIdValue = principal.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? principal.FindFirstValue(JwtRegisteredClaimNames.Sub);

        return Guid.TryParse(userIdValue, out var userId) ? userId : null;
    }

    public static string? GetRoleFromClaims(ClaimsPrincipal principal)
    {
        foreach (var claimType in RoleClaimTypes)
        {
            var value = principal.FindFirstValue(claimType);
            if (!string.IsNullOrWhiteSpace(value))
            {
                return UserRoles.Normalize(value);
            }
        }

        return null;
    }

    public static bool IsInRole(ClaimsPrincipal principal, string role) =>
        principal.IsInRole(role) ||
        string.Equals(GetRoleFromClaims(principal), role, StringComparison.OrdinalIgnoreCase);

    public static async Task<string?> GetRoleAsync(AppDbContext db, ClaimsPrincipal principal)
    {
        if (IsInRole(principal, UserRoles.Admin))
        {
            return UserRoles.Admin;
        }

        var userId = GetUserId(principal);
        if (userId is null)
        {
            return GetRoleFromClaims(principal);
        }

        var role = await db.Users.AsNoTracking()
            .Where(user => user.Id == userId.Value && user.IsActive)
            .Select(user => user.Role)
            .FirstOrDefaultAsync();

        return string.IsNullOrWhiteSpace(role)
            ? GetRoleFromClaims(principal)
            : UserRoles.Normalize(role);
    }

    public static async Task<bool> IsInRoleAsync(AppDbContext db, ClaimsPrincipal principal, string role)
    {
        if (IsInRole(principal, role))
        {
            return true;
        }

        var resolvedRole = await GetRoleAsync(db, principal);
        return string.Equals(resolvedRole, role, StringComparison.OrdinalIgnoreCase);
    }
}
