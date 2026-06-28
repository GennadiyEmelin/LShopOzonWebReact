namespace LShopOzonWebReact.Api.Contracts.Chat;

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
