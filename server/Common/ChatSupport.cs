using LShopOzonWebReact.Api.Contracts.Chat;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Security;
using Microsoft.EntityFrameworkCore;

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


