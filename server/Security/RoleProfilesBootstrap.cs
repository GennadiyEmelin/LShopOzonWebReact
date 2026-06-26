using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Security;

public static class RoleProfilesBootstrap
{
    public static async Task EnsureDefaultsAsync(AppDbContext db)
    {
        foreach (var defaults in RoleProfileDefaults.All)
        {
            var existing = await db.RoleProfiles.FirstOrDefaultAsync(profile => profile.Role == defaults.Role);
            if (existing is null)
            {
                db.RoleProfiles.Add(defaults);
                continue;
            }

            if (string.IsNullOrWhiteSpace(existing.DisplayName))
            {
                existing.DisplayName = defaults.DisplayName;
            }
        }

        await db.SaveChangesAsync();
    }
}
