using System.Security.Claims;
using LShopOzonWebReact.Api.Contracts.Chat;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Hubs;
using LShopOzonWebReact.Api.Integrations;
using LShopOzonWebReact.Api.Models;
using LShopOzonWebReact.Api.Security;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Endpoints;

public static class ChatEndpoints
{
    public static void MapChatEndpoints(this WebApplication app)
    {
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
    IHubContext<AppHub> hub,
    TelegramNotificationService telegram) =>
{
    if (!await FeatureAccess.HasAnyAsync(db, principal, FeatureAccess.Chats))
    {
        return Results.Forbid();
    }

    if (!UserRoleResolver.IsInRole(principal, UserRoles.Admin) && !await FeatureAccess.HasAnyAsync(db, principal, "chats.groups"))
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

        await IntegrationNotificationPublisher.PublishAsync(
            telegram,
            db,
            "chat.group.created",
            $"Создана группа «{name}»",
            validMembers.Select(member => member.UserId),
            userId);

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
    TelegramNotificationService telegram,
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

    var groupMemberIds = await db.ChatGroupMembers
        .AsNoTracking()
        .Where(member => member.GroupId == id && member.UserId != parsedCurrentUserId)
        .Select(member => member.UserId)
        .ToListAsync(cancellationToken);
    var hasAttachment = message.AttachmentContent is not null;
    var chatEventId = hasAttachment ? "chat.attachment.received" : "chat.group.received";
    var preview = ChatNotificationText.BuildPreview(sender.DisplayName, text, hasAttachment);
    await telegram.SendToUsersAsync(
        db,
        chatEventId,
        preview,
        groupMemberIds,
        parsedCurrentUserId,
        cancellationToken);

    return Results.Created($"/api/chat/groups/{id}/messages/{message.Id}", result);
}).DisableAntiforgery().RequireAuthorization();

app.MapPost("/api/chat/{userId:guid}/messages", async (
    Guid userId,
    HttpRequest request,
    AppDbContext db,
    ClaimsPrincipal principal,
    IHubContext<AppHub> hub,
    TelegramNotificationService telegram,
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

    var hasAttachment = message.AttachmentContent is not null;
    var chatEventId = hasAttachment ? "chat.attachment.received" : "chat.direct.received";
    var preview = ChatNotificationText.BuildPreview(sender.DisplayName, text, hasAttachment);
    await telegram.SendToUserAsync(db, userId, chatEventId, preview, cancellationToken);

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

    var isAdmin = await UserRoleResolver.IsInRoleAsync(db, principal, UserRoles.Admin);
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
    }
}
