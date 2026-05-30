using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace LShopOzonWebReact.Api.Hubs;

[Authorize]
public class AppHub : Hub
{
}
