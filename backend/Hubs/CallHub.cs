using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;

namespace backend.Hubs;

public record VoiceMemberInfo(string ConnectionId, string? UserId, string? UserName, string? AvatarUrl, bool IsMuted);

public class CallHub : Hub
{
    // ═══════ In-Memory Room & User Tracking ═══════
    // Maps roomId → set of connectionIds currently in that room
    private static readonly ConcurrentDictionary<string, ConcurrentDictionary<string, byte>> RoomMembers = new();

    // Maps roomId → set of VoiceMemberInfo currently in voice in that room
    private static readonly ConcurrentDictionary<string, ConcurrentDictionary<string, VoiceMemberInfo>> RoomVoiceMembers = new();

    // Maps connectionId → set of roomIds the connection has joined
    private static readonly ConcurrentDictionary<string, ConcurrentDictionary<string, byte>> ConnectionRooms = new();

    // Maps Supabase/DB UserId → SignalR ConnectionId (for targeted DMs & Friend Requests)
    private static readonly ConcurrentDictionary<string, string> UserConnections = new();

    // Maps SignalR ConnectionId → Supabase/DB UserId (for reverse lookup on disconnect)
    private static readonly ConcurrentDictionary<string, string> ConnectionUsers = new();

    // ═══════ User Registration ═══════

    /// <summary>
    /// Registers the authenticated database UserId with the current SignalR ConnectionId.
    /// Enables direct user-to-user routing for DMs and Friend notifications.
    /// </summary>
    public Task RegisterUser(string userId)
    {
        if (!string.IsNullOrWhiteSpace(userId))
        {
            var connId = Context.ConnectionId;
            UserConnections[userId] = connId;
            ConnectionUsers[connId] = userId;
        }

        return Task.CompletedTask;
    }

    // ═══════ Direct Messaging & Friends ═══════

    /// <summary>
    /// Sends a real-time Direct Message to a specific user if they are currently online.
    /// </summary>
    public async Task SendDirectMessage(string receiverId, string text, object? dmData)
    {
        var senderUserId = ConnectionUsers.TryGetValue(Context.ConnectionId, out var uId) ? uId : Context.ConnectionId;

        if (UserConnections.TryGetValue(receiverId, out var targetConnId))
        {
            await Clients.Client(targetConnId).SendAsync("ReceiveDirectMessage", senderUserId, text, dmData);
        }
    }

    /// <summary>
    /// Notifies a target user in real-time that they have received a friend request.
    /// </summary>
    public async Task SendFriendRequest(string targetUserId, object? requestData)
    {
        var requesterUserId = ConnectionUsers.TryGetValue(Context.ConnectionId, out var uId) ? uId : Context.ConnectionId;

        if (UserConnections.TryGetValue(targetUserId, out var targetConnId))
        {
            await Clients.Client(targetConnId).SendAsync("FriendRequestReceived", requesterUserId, requestData);
        }
    }

    public async Task SendMessage(string messageId, string userName, string message, string roomId, string? attachmentUrl = null)
    {
        await Clients.Group(roomId).SendAsync("ReceiveMessage", messageId, userName, message, roomId, attachmentUrl);
    }

    public async Task AddReaction(string messageId, string emoji, string userName, string roomId)
    {
        await Clients.Group(roomId).SendAsync("ReceiveReactionAdded", messageId, emoji, userName);
    }

    public async Task RemoveReaction(string messageId, string emoji, string userName, string roomId)
    {
        await Clients.Group(roomId).SendAsync("ReceiveReactionRemoved", messageId, emoji, userName);
    }

    /// <summary>
    /// Notifies the requester in real-time that their friend request was accepted.
    /// </summary>
    public async Task AcceptFriendRequest(string requesterId, object? acceptData)
    {
        var accepterUserId = ConnectionUsers.TryGetValue(Context.ConnectionId, out var uId) ? uId : Context.ConnectionId;

        if (UserConnections.TryGetValue(requesterId, out var requesterConnId))
        {
            await Clients.Client(requesterConnId).SendAsync("FriendRequestAccepted", accepterUserId, acceptData);
        }
    }

    // ═══════ Join / Leave Rooms (Channels / Voice) ═══════

    public async Task JoinRoom(string roomId, string? userName = null, string? avatarUrl = null, bool isMuted = false)
    {
        var connId = Context.ConnectionId;
        var userId = ConnectionUsers.TryGetValue(connId, out var uId) ? uId : null;

        var memberInfo = new VoiceMemberInfo(connId, userId, userName ?? "Usuário", avatarUrl ?? "", isMuted);

        // Track voice profile
        var voiceMembers = RoomVoiceMembers.GetOrAdd(roomId, _ => new ConcurrentDictionary<string, VoiceMemberInfo>());
        voiceMembers[connId] = memberInfo;

        // Track: room → connection
        var members = RoomMembers.GetOrAdd(roomId, _ => new ConcurrentDictionary<string, byte>());
        members.TryAdd(connId, 0);

        // Track: connection → room
        var rooms = ConnectionRooms.GetOrAdd(connId, _ => new ConcurrentDictionary<string, byte>());
        rooms.TryAdd(roomId, 0);

        await Groups.AddToGroupAsync(connId, roomId);

        // Notify existing members that a new peer joined
        await Clients.GroupExcept(roomId, connId).SendAsync("UserJoined", connId, roomId, memberInfo);

        // Send the list of existing members (connectionIds) to the new joiner so it can prepare for incoming offers
        var existingMembers = members.Keys.Where(id => id != connId).ToList();
        if (existingMembers.Count > 0)
        {
            await Clients.Caller.SendAsync("ExistingMembers", existingMembers, roomId);
        }

        // Broadcast rich voice presence update globally
        await Clients.All.SendAsync("VoiceStateUpdated", roomId, memberInfo, "joined");
    }

    public async Task UpdateVoiceMuteState(string roomId, bool isMuted)
    {
        var connId = Context.ConnectionId;
        if (RoomVoiceMembers.TryGetValue(roomId, out var members) && members.TryGetValue(connId, out var memberInfo))
        {
            var updated = memberInfo with { IsMuted = isMuted };
            members[connId] = updated;
            await Clients.All.SendAsync("VoiceMemberMuteUpdated", roomId, connId, isMuted);
        }
    }

    public async Task LeaveRoom(string roomId)
    {
        var connId = Context.ConnectionId;
        await RemoveFromRoom(connId, roomId);
    }

    // ═══════ WebRTC Signaling (Point-to-Point) ═══════

    /// <summary>
    /// Send a WebRTC signal (offer/answer/ICE candidate) directly to a specific peer.
    /// </summary>
    public async Task SendSignalToUser(string signal, string targetConnectionId)
    {
        await Clients.Client(targetConnectionId).SendAsync("ReceiveSignal", Context.ConnectionId, signal);
    }

    // ═══════ Channel Chat ═══════

    public async Task SendMessage(string userName, string message, string roomId, string? attachmentUrl = null)
    {
        await Clients.Group(roomId).SendAsync("ReceiveMessage", userName, message, roomId, attachmentUrl);
    }

    // ═══════ Disconnect ═══════

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var connId = Context.ConnectionId;

        // Clean up UserConnections mapping
        if (ConnectionUsers.TryRemove(connId, out var userId))
        {
            if (UserConnections.TryGetValue(userId, out var mappedConnId) && mappedConnId == connId)
            {
                UserConnections.TryRemove(userId, out _);
            }
        }

        // Clean up Room tracking
        if (ConnectionRooms.TryRemove(connId, out var rooms))
        {
            foreach (var roomId in rooms.Keys)
            {
                await RemoveFromRoom(connId, roomId);
            }
        }

        await base.OnDisconnectedAsync(exception);
    }

    // ═══════ Voice State Snapshot ═══════

    public Task<Dictionary<string, List<VoiceMemberInfo>>> GetVoiceState()
    {
        var snapshot = new Dictionary<string, List<VoiceMemberInfo>>();
        foreach (var (roomId, members) in RoomVoiceMembers)
        {
            var memberList = members.Values.ToList();
            if (memberList.Count > 0)
            {
                snapshot[roomId] = memberList;
            }
        }
        return Task.FromResult(snapshot);
    }

    // ═══════ Helpers ═══════

    private async Task RemoveFromRoom(string connId, string roomId)
    {
        VoiceMemberInfo? removedMember = null;
        if (RoomVoiceMembers.TryGetValue(roomId, out var voiceMembers))
        {
            voiceMembers.TryRemove(connId, out removedMember);
            if (voiceMembers.IsEmpty)
            {
                RoomVoiceMembers.TryRemove(roomId, out _);
            }
        }

        // Remove from room tracking
        if (RoomMembers.TryGetValue(roomId, out var members))
        {
            members.TryRemove(connId, out _);

            if (members.IsEmpty)
            {
                RoomMembers.TryRemove(roomId, out _);
            }
        }

        // Remove from connection tracking
        if (ConnectionRooms.TryGetValue(connId, out var rooms))
        {
            rooms.TryRemove(roomId, out _);
        }

        await Groups.RemoveFromGroupAsync(connId, roomId);

        // Notify remaining members in the room (scoped, not global)
        await Clients.Group(roomId).SendAsync("UserLeft", connId, roomId);

        // Broadcast voice presence update globally
        var memberToBroadcast = removedMember ?? new VoiceMemberInfo(connId, null, null, null, false);
        await Clients.All.SendAsync("VoiceStateUpdated", roomId, memberToBroadcast, "left");
    }
}
