using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Security;
using Microsoft.EntityFrameworkCore;

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
            Role = UserRoles.Production,
            IsActive = true,
            AllowedFeatures = string.Empty
        });
        await db.SaveChangesAsync();
    }
}


