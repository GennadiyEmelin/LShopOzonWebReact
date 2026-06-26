using LShopOzonWebReact.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Data;

public static class AuditLogQueries
{
    public static IQueryable<AuditLog> ApplyFilters(
        IQueryable<AuditLog> query,
        string? search,
        string? action,
        string? entityType,
        string? dateFrom,
        string? dateTo,
        string? userId)
    {
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

        return query;
    }
}
