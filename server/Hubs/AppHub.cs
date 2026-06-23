using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace LShopOzonWebReact.Api.Hubs;

[Authorize]
public class AppHub : Hub
{
}

public static class ChatHub
{
    public static async Task NotifyThreadsChangedAsync(IHubContext<AppHub> hub)
    {
        try
        {
            await hub.Clients.All.SendAsync("ChatThreadsChanged");
        }
        catch
        {
            // DB changes are already saved; a failed push must not fail the HTTP request.
        }
    }
}
