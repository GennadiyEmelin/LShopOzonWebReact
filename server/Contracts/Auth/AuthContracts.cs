using LShopOzonWebReact.Api.Security;

namespace LShopOzonWebReact.Api.Contracts.Auth;

public record CreateInitialAdminRequest(string UserName, string DisplayName, string Password);

public record LoginRequest(string UserName, string Password);

public record AuthResponse(string Token, CurrentUserResponse User);
