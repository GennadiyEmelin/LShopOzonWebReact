using System.Security.Claims;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Models;

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


