using Microsoft.AspNetCore.SignalR;

namespace backend.Hubs;

public class CallHub : Hub
{
    public async Task JoinRoom(string roomId)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.GroupExcept(roomId, Context.ConnectionId).SendAsync("UserJoined", Context.ConnectionId);
    }

    public async Task SendSignal(string signal, string roomId)
    {
        await Clients.GroupExcept(roomId, Context.ConnectionId).SendAsync("ReceiveSignal", Context.ConnectionId, signal);
    }

    public async Task SendMessage(string userName, string message, string roomId)
    {
        await Clients.Group(roomId).SendAsync("ReceiveMessage", userName, message);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await Clients.All.SendAsync("UserLeft", Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }
}
