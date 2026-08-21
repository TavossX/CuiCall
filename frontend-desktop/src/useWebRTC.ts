import { useEffect, useRef, useState, useCallback } from 'react';
import * as signalR from '@microsoft/signalr';

const STUN_SERVERS: RTCConfiguration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ],
};

export interface ChatMessage {
    senderId: string;
    text: string;
    id?: string;
    created_at?: string;
}

export interface RemoteStreamInfo {
    peerId: string;
    stream: MediaStream;
    isScreenSharing: boolean;
}

/**
 * Hook global gerenciador de WebRTC (voz/vídeo P2P Mesh), SignalR (chat de canais, DMs e Amizades).
 * Permanece ativo no nível raiz do App para manter chamadas de voz ativas em background
 * enquanto o usuário navega entre canais de texto, servidores e conversas diretas.
 */
export const useWebRTC = () => {
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStreams, setRemoteStreams] = useState<RemoteStreamInfo[]>([]);
    const [inVoice, setInVoice] = useState(false);
    const [voiceRoomId, setVoiceRoomId] = useState<string | null>(null);
    const [isCamOff, setIsCamOff] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [channelMessages, setChannelMessages] = useState<Record<string, ChatMessage[]>>({});
    const [directMessages, setDirectMessages] = useState<Record<string, ChatMessage[]>>({});
    const [voicePresence, setVoicePresence] = useState<Record<string, string[]>>({});

    const connectionRef = useRef<signalR.HubConnection | null>(null);
    const peersRef = useRef(new Map<string, RTCPeerConnection>());
    const localStreamRef = useRef<MediaStream | null>(null);
    const voiceRoomIdRef = useRef<string | null>(null);
    const currentChannelIdRef = useRef<string | null>(null);
    const isScreenSharingRef = useRef(false);
    const registeredUserIdRef = useRef<string | null>(null);

    // Keep refs in sync
    useEffect(() => {
        localStreamRef.current = localStream;
    }, [localStream]);

    useEffect(() => {
        voiceRoomIdRef.current = voiceRoomId;
    }, [voiceRoomId]);

    useEffect(() => {
        isScreenSharingRef.current = isScreenSharing;
    }, [isScreenSharing]);

    // ═══════ Remote Streams Management ═══════

    const addRemoteStream = useCallback((peerId: string, stream: MediaStream, isScreen: boolean = false) => {
        setRemoteStreams(prev => {
            const filtered = prev.filter(s => s.peerId !== peerId);
            return [...filtered, { peerId, stream, isScreenSharing: isScreen }];
        });
    }, []);

    const removeRemoteStream = useCallback((peerId: string) => {
        setRemoteStreams(prev => prev.filter(s => s.peerId !== peerId));
    }, []);

    // ═══════ Peer Connection Factory ═══════

    const createPeerForUser = useCallback((remotePeerId: string): RTCPeerConnection => {
        const existing = peersRef.current.get(remotePeerId);
        if (existing) {
            existing.close();
            peersRef.current.delete(remotePeerId);
        }

        const peer = new RTCPeerConnection(STUN_SERVERS);
        peersRef.current.set(remotePeerId, peer);

        peer.onicecandidate = (event) => {
            if (event.candidate) {
                connectionRef.current?.invoke(
                    "SendSignalToUser",
                    JSON.stringify({ candidate: event.candidate }),
                    remotePeerId
                );
            }
        };

        peer.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
                addRemoteStream(remotePeerId, event.streams[0]);
            }
        };

        peer.onconnectionstatechange = () => {
            if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
                console.warn(`[WebRTC] Connection to ${remotePeerId} ${peer.connectionState}`);
            }
        };

        const stream = localStreamRef.current;
        if (stream) {
            stream.getTracks().forEach(track => peer.addTrack(track, stream));
        }

        return peer;
    }, [addRemoteStream]);

    // ═══════ Singleton SignalR Hub Connection ═══════
    const getHubConnection = useCallback(async () => {
        if (connectionRef.current && connectionRef.current.state === signalR.HubConnectionState.Connected) {
            return connectionRef.current;
        }

        if (!connectionRef.current) {
            const signalRUrl = import.meta.env.VITE_SIGNALR_URL || "http://localhost:5222/callHub";
            const hub = new signalR.HubConnectionBuilder()
                .withUrl(signalRUrl)
                .withAutomaticReconnect()
                .build();

            // ── P2P Mesh Signaling ──

            hub.on("UserJoined", async (connectionId: string, _roomId: string) => {
                const currentVoiceRoom = voiceRoomIdRef.current;
                if (!currentVoiceRoom) return;

                try {
                    const peer = createPeerForUser(connectionId);
                    const offer = await peer.createOffer();
                    await peer.setLocalDescription(offer);
                    await hub.invoke(
                        "SendSignalToUser",
                        JSON.stringify({ type: 'offer', sdp: offer }),
                        connectionId
                    );
                } catch (err) {
                    console.error(`[WebRTC] Error creating offer for ${connectionId}:`, err);
                }
            });

            hub.on("ExistingMembers", (_memberIds: string[], _roomId: string) => {
                console.log(`[WebRTC] Existing members in room:`, _memberIds);
            });

            hub.on("ReceiveSignal", async (senderId: string, signal: string) => {
                const currentVoiceRoom = voiceRoomIdRef.current;
                if (!currentVoiceRoom) return;

                try {
                    const data = JSON.parse(signal);

                    if (data.type === 'offer') {
                        const peer = createPeerForUser(senderId);
                        await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
                        const answer = await peer.createAnswer();
                        await peer.setLocalDescription(answer);
                        await hub.invoke(
                            "SendSignalToUser",
                            JSON.stringify({ type: 'answer', sdp: answer }),
                            senderId
                        );
                    } else if (data.type === 'answer') {
                        const peer = peersRef.current.get(senderId);
                        if (peer) {
                            await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
                        }
                    } else if (data.candidate) {
                        const peer = peersRef.current.get(senderId);
                        if (peer) {
                            await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
                        }
                    }
                } catch (err) {
                    console.error(`[WebRTC] Error handling signal from ${senderId}:`, err);
                }
            });

            hub.on("UserLeft", (connectionId: string, _roomId: string) => {
                const peer = peersRef.current.get(connectionId);
                if (peer) {
                    peer.close();
                    peersRef.current.delete(connectionId);
                }
                removeRemoteStream(connectionId);
            });

            // ── Voice Presence ──
            hub.on("VoiceStateUpdated", (roomId: string, connectionId: string, action: string) => {
                setVoicePresence(prev => {
                    const current = prev[roomId] || [];
                    if (action === 'joined') {
                        if (current.includes(connectionId)) return prev;
                        return { ...prev, [roomId]: [...current, connectionId] };
                    } else if (action === 'left') {
                        const filtered = current.filter(id => id !== connectionId);
                        if (filtered.length === 0) {
                            const next = { ...prev };
                            delete next[roomId];
                            return next;
                        }
                        return { ...prev, [roomId]: filtered };
                    }
                    return prev;
                });

                // Dispara evento no window para o hook de notificações de voz
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('cuicall:voiceState', { detail: { roomId, connectionId, action } }));
                }
            });

            // ── Chat de Servidor ──
            hub.on("ReceiveMessage", (senderId: string, text: string) => {
                const targetChannel = currentChannelIdRef.current || voiceRoomIdRef.current || 'cuicall-geral';
                setChannelMessages(prev => ({
                    ...prev,
                    [targetChannel]: [...(prev[targetChannel] || []), { senderId, text }]
                }));
            });

            // ── Direct Messages (DMs) ──
            hub.on("ReceiveDirectMessage", (senderUserId: string, text: string, dmData: any) => {
                setDirectMessages(prev => ({
                    ...prev,
                    [senderUserId]: [...(prev[senderUserId] || []), {
                        senderId: dmData?.senderName || senderUserId,
                        text,
                        id: dmData?.id,
                        created_at: dmData?.created_at,
                    }]
                }));

                // Dispara evento global de nova DM para o hook de notificações
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('cuicall:newDirectMessage', {
                        detail: { senderUserId, text, dmData }
                    }));
                }
            });

            // ── Solicitações de Amizade em Tempo Real ──
            hub.on("FriendRequestReceived", (requesterUserId: string, requestData: any) => {
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('cuicall:friendRequestReceived', {
                        detail: { requesterUserId, requestData }
                    }));
                }
            });

            hub.on("FriendRequestAccepted", (accepterUserId: string, acceptData: any) => {
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('cuicall:friendRequestAccepted', {
                        detail: { accepterUserId, acceptData }
                    }));
                }
            });

            connectionRef.current = hub;
        }

        if (connectionRef.current.state === signalR.HubConnectionState.Disconnected) {
            await connectionRef.current.start();

            // Re-registra o usuário se já autenticado
            if (registeredUserIdRef.current) {
                try {
                    await connectionRef.current.invoke("RegisterUser", registeredUserIdRef.current);
                } catch (err) {
                    console.warn("[SignalR] Erro ao re-registrar usuário:", err);
                }
            }

            // Carrega snapshot inicial de presença de voz
            try {
                const snapshot = await connectionRef.current.invoke<Record<string, string[]>>("GetVoiceState");
                if (snapshot) {
                    setVoicePresence(snapshot);
                }
            } catch (err) {
                console.warn("[SignalR] Could not load initial voice state:", err);
            }
        }

        return connectionRef.current;
    }, [createPeerForUser, addRemoteStream, removeRemoteStream]);

    // ═══════ Registro de Usuário ═══════
    const registerUser = useCallback(async (userId: string) => {
        if (!userId) return;
        registeredUserIdRef.current = userId;
        try {
            const hub = await getHubConnection();
            await hub.invoke("RegisterUser", userId);
        } catch (err) {
            console.error("[SignalR] Erro ao registrar usuário no Hub:", err);
        }
    }, [getHubConnection]);

    // ═══════ Envio de DMs e Amizades ═══════
    const sendDirectMessage = useCallback(async (receiverId: string, text: string, dmData?: any) => {
        if (!text.trim() || !receiverId) return;
        const hub = await getHubConnection();
        await hub.invoke("SendDirectMessage", receiverId, text, dmData || null);
    }, [getHubConnection]);

    const sendFriendRequest = useCallback(async (targetUserId: string, requestData?: any) => {
        if (!targetUserId) return;
        const hub = await getHubConnection();
        await hub.invoke("SendFriendRequest", targetUserId, requestData || null);
    }, [getHubConnection]);

    const acceptFriendRequest = useCallback(async (requesterId: string, acceptData?: any) => {
        if (!requesterId) return;
        const hub = await getHubConnection();
        await hub.invoke("AcceptFriendRequest", requesterId, acceptData || null);
    }, [getHubConnection]);

    const loadDirectMessages = useCallback((partnerId: string, msgs: ChatMessage[]) => {
        setDirectMessages(prev => ({
            ...prev,
            [partnerId]: msgs,
        }));
    }, []);

    // ═══════ Text Channel Join ═══════
    const joinTextChannel = useCallback(async (channelId: string) => {
        currentChannelIdRef.current = channelId;
        const hub = await getHubConnection();
        await hub.invoke("JoinRoom", channelId);
    }, [getHubConnection]);

    // ═══════ Voice Call Controls ═══════
    const joinVoice = useCallback(async (roomId: string = 'cuicall-voice-main', videoDeviceId?: string, audioDeviceId?: string) => {
        const constraints: MediaStreamConstraints = {
            video: videoDeviceId ? { deviceId: { exact: videoDeviceId } } : true,
            audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        setLocalStream(stream);
        localStreamRef.current = stream;
        setIsCamOff(false);
        setIsMuted(false);
        setIsScreenSharing(false);
        setInVoice(true);
        setVoiceRoomId(roomId);
        voiceRoomIdRef.current = roomId;

        const hub = await getHubConnection();
        await hub.invoke("JoinRoom", roomId);

        peersRef.current.forEach((peer) => {
            const senders = peer.getSenders();
            if (senders.length === 0) {
                stream.getTracks().forEach(track => peer.addTrack(track, stream));
            }
        });
    }, [getHubConnection]);

    const leaveVoice = useCallback(async () => {
        localStreamRef.current?.getTracks().forEach(track => track.stop());
        setLocalStream(null);
        localStreamRef.current = null;
        setRemoteStreams([]);
        setIsCamOff(false);
        setIsMuted(false);
        setIsScreenSharing(false);

        peersRef.current.forEach((peer) => {
            peer.close();
        });
        peersRef.current.clear();

        const currentRoom = voiceRoomIdRef.current;
        if (currentRoom && connectionRef.current?.state === signalR.HubConnectionState.Connected) {
            try {
                await connectionRef.current.invoke("LeaveRoom", currentRoom);
            } catch (err) {
                console.warn("[SignalR] Error leaving room:", err);
            }
        }

        setInVoice(false);
        setVoiceRoomId(null);
        voiceRoomIdRef.current = null;
    }, []);

    const toggleCamera = useCallback(async () => {
        const stream = localStreamRef.current;
        if (!stream) return;

        if (!isCamOff) {
            stream.getVideoTracks().forEach(track => track.stop());

            peersRef.current.forEach((peer) => {
                const videoSender = peer.getSenders().find(s => s.track?.kind === 'video');
                if (videoSender) {
                    videoSender.replaceTrack(null);
                }
            });

            const audioOnly = new MediaStream(stream.getAudioTracks());
            setLocalStream(audioOnly);
            localStreamRef.current = audioOnly;
            setIsCamOff(true);
        } else {
            const newVideoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const newVideoTrack = newVideoStream.getVideoTracks()[0];

            peersRef.current.forEach((peer) => {
                const videoSender = peer.getSenders().find(
                    s => s.track?.kind === 'video' || s.track === null
                );
                if (videoSender) {
                    videoSender.replaceTrack(newVideoTrack);
                }
            });

            const currentAudioTracks = localStreamRef.current?.getAudioTracks() ?? [];
            const combined = new MediaStream([...currentAudioTracks, newVideoTrack]);
            setLocalStream(combined);
            localStreamRef.current = combined;
            setIsCamOff(false);
        }
    }, [isCamOff]);

    const toggleMute = useCallback(() => {
        const stream = localStreamRef.current;
        if (!stream) return;
        stream.getAudioTracks().forEach(track => {
            track.enabled = !track.enabled;
        });
        setIsMuted(prev => !prev);
    }, []);

    const shareScreen = useCallback(async () => {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];

        peersRef.current.forEach((peer) => {
            const videoSender = peer.getSenders().find(s => s.track?.kind === 'video');
            if (videoSender) {
                videoSender.replaceTrack(screenTrack);
            }
        });

        setLocalStream(screenStream);
        localStreamRef.current = screenStream;
        setIsCamOff(false);
        setIsScreenSharing(true);
        isScreenSharingRef.current = true;

        screenTrack.onended = async () => {
            setIsScreenSharing(false);
            isScreenSharingRef.current = false;
            const currentRoom = voiceRoomIdRef.current;
            if (currentRoom) {
                try {
                    const camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                    const camVideoTrack = camStream.getVideoTracks()[0];

                    peersRef.current.forEach((peer) => {
                        const videoSender = peer.getSenders().find(s => s.track?.kind === 'video');
                        if (videoSender) {
                            videoSender.replaceTrack(camVideoTrack);
                        }
                    });

                    setLocalStream(camStream);
                    localStreamRef.current = camStream;
                } catch {
                    console.warn("[WebRTC] Could not re-acquire camera after screen share ended");
                }
            }
        };
    }, []);

    const sendMessage = useCallback(async (userName: string, text: string, channelId: string) => {
        if (!text.trim() || !channelId) return;
        const hub = await getHubConnection();
        await hub.invoke("SendMessage", userName, text, channelId);
    }, [getHubConnection]);

    const loadChannelMessages = useCallback((channelId: string, msgs: ChatMessage[]) => {
        setChannelMessages(prev => ({
            ...prev,
            [channelId]: msgs,
        }));
    }, []);

    const stopAllMedia = useCallback(() => {
        localStreamRef.current?.getTracks().forEach(track => track.stop());
        setLocalStream(null);
        localStreamRef.current = null;
        setRemoteStreams([]);

        peersRef.current.forEach((peer) => {
            peer.close();
        });
        peersRef.current.clear();

        connectionRef.current?.stop();
        connectionRef.current = null;

        setInVoice(false);
        setVoiceRoomId(null);
        voiceRoomIdRef.current = null;
        setIsScreenSharing(false);
    }, []);

    return {
        localStream,
        remoteStreams,
        inVoice,
        voiceRoomId,
        isCamOff,
        isMuted,
        isScreenSharing,
        channelMessages,
        directMessages,
        voicePresence,
        setChannelMessages,
        setDirectMessages,
        loadChannelMessages,
        loadDirectMessages,
        joinVoice,
        leaveVoice,
        joinTextChannel,
        toggleMute,
        toggleCamera,
        shareScreen,
        sendMessage,
        sendDirectMessage,
        sendFriendRequest,
        acceptFriendRequest,
        registerUser,
        stopAllMedia,
    };
};
