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
                console.log(`[WebRTC 🧊] ICE Candidate local gerado para ${remotePeerId}:`, event.candidate.candidate.slice(0, 40));
                connectionRef.current?.invoke(
                    "SendSignalToUser",
                    JSON.stringify({ candidate: event.candidate }),
                    remotePeerId
                );
            }
        };

        peer.ontrack = (event) => {
            console.log(`[WebRTC 🎥] Track de mídia remota recebida de ${remotePeerId}:`, event.track.kind);
            if (event.streams && event.streams[0]) {
                addRemoteStream(remotePeerId, event.streams[0]);
            }
        };

        peer.onconnectionstatechange = () => {
            console.log(`[WebRTC 🔗] Estado da conexão P2P com ${remotePeerId}: ${peer.connectionState}`);
            if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
                console.warn(`[WebRTC ⚠️] Conexão P2P com ${remotePeerId} falhou ou desconectou.`);
            }
        };

        peer.oniceconnectionstatechange = () => {
            console.log(`[WebRTC 🧊] ICE Connection State com ${remotePeerId}: ${peer.iceConnectionState}`);
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
            console.log(`[SignalR 🚀] Inicializando conexão com: ${signalRUrl}`);

            const hub = new signalR.HubConnectionBuilder()
                .withUrl(signalRUrl)
                .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
                .configureLogging(signalR.LogLevel.Information)
                .build();

            // ── Ciclo de Vida da Conexão ──
            hub.onreconnecting((error) => {
                console.warn('[SignalR 🔄] Conexão perdida. Tentando reconectar automaticamente...', error);
            });

            hub.onreconnected(async (connectionId) => {
                console.log(`[SignalR ✅] Conexão restabelecida! ConnectionId: ${connectionId}`);
                if (registeredUserIdRef.current) {
                    try {
                        await hub.invoke("RegisterUser", registeredUserIdRef.current);
                        console.log(`[SignalR ✅] Usuário re-registrado: ${registeredUserIdRef.current}`);
                    } catch (err) {
                        console.error('[SignalR ❌] Falha ao re-registrar usuário após reconexão:', err);
                    }
                }
                if (voiceRoomIdRef.current) {
                    try {
                        await hub.invoke("JoinRoom", voiceRoomIdRef.current);
                        console.log(`[SignalR ✅] Reingressou na sala de voz: ${voiceRoomIdRef.current}`);
                    } catch (err) {
                        console.error('[SignalR ❌] Falha ao reingressar na sala de voz:', err);
                    }
                }
            });

            hub.onclose((error) => {
                console.error('[SignalR ❌] Conexão com o servidor foi encerrada permanentemente:', error);
            });

            // ── P2P Mesh Signaling ──

            hub.on("UserJoined", async (connectionId: string, roomId: string) => {
                const currentVoiceRoom = voiceRoomIdRef.current;
                console.log(`[WebRTC 👤] Peer entrou na sala (${roomId}): ${connectionId}`);
                if (!currentVoiceRoom) return;

                try {
                    console.log(`[WebRTC 📞] Criando RTCPeerConnection e Offer para peer: ${connectionId}`);
                    const peer = createPeerForUser(connectionId);
                    const offer = await peer.createOffer();
                    await peer.setLocalDescription(offer);
                    await hub.invoke(
                        "SendSignalToUser",
                        JSON.stringify({ type: 'offer', sdp: offer }),
                        connectionId
                    );
                    console.log(`[WebRTC 📤] Offer enviado com sucesso para: ${connectionId}`);
                } catch (err) {
                    console.error(`[WebRTC ❌] Erro ao criar/enviar offer para ${connectionId}:`, err);
                }
            });

            hub.on("ExistingMembers", (_memberIds: string[], _roomId: string) => {
                console.log(`[WebRTC 👥] Membros existentes na sala (${_roomId}):`, _memberIds);
            });

            hub.on("ReceiveSignal", async (senderId: string, signal: string) => {
                const currentVoiceRoom = voiceRoomIdRef.current;
                if (!currentVoiceRoom) return;

                try {
                    const data = JSON.parse(signal);

                    if (data.type === 'offer') {
                        console.log(`[WebRTC 📥] Recebido Offer de ${senderId}. Criando Answer...`);
                        const peer = createPeerForUser(senderId);
                        await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
                        const answer = await peer.createAnswer();
                        await peer.setLocalDescription(answer);
                        await hub.invoke(
                            "SendSignalToUser",
                            JSON.stringify({ type: 'answer', sdp: answer }),
                            senderId
                        );
                        console.log(`[WebRTC 📤] Answer enviado com sucesso para ${senderId}`);
                    } else if (data.type === 'answer') {
                        console.log(`[WebRTC 📥] Recebido Answer de ${senderId}. Setando remoteDescription...`);
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
                    console.error(`[WebRTC ❌] Erro ao processar sinal recebido de ${senderId}:`, err);
                }
            });

            hub.on("UserLeft", (connectionId: string, roomId: string) => {
                console.log(`[WebRTC 🚪] Peer saiu da sala (${roomId}): ${connectionId}`);
                const peer = peersRef.current.get(connectionId);
                if (peer) {
                    peer.close();
                    peersRef.current.delete(connectionId);
                }
                removeRemoteStream(connectionId);
            });

            // ── Voice Presence ──
            hub.on("VoiceStateUpdated", (roomId: string, connectionId: string, action: string) => {
                console.log(`[VoicePresence 🎙️] Sala ${roomId} | Peer ${connectionId} -> ${action}`);
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
                console.log(`[Chat 💬] Canal ${targetChannel} | De: ${senderId} | Texto: ${text.slice(0, 30)}...`);
                setChannelMessages(prev => ({
                    ...prev,
                    [targetChannel]: [...(prev[targetChannel] || []), { senderId, text }]
                }));
            });

            // ── Direct Messages (DMs) ──
            hub.on("ReceiveDirectMessage", (senderUserId: string, text: string, dmData: any) => {
                console.log(`[DM 📩] De: ${senderUserId} | Texto: ${text.slice(0, 30)}...`);
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
                console.log(`[Amigos 🤝] Pedido de amizade recebido de: ${requesterUserId}`);
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('cuicall:friendRequestReceived', {
                        detail: { requesterUserId, requestData }
                    }));
                }
            });

            hub.on("FriendRequestAccepted", (accepterUserId: string, acceptData: any) => {
                console.log(`[Amigos 🎉] Pedido de amizade aceito por: ${accepterUserId}`);
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('cuicall:friendRequestAccepted', {
                        detail: { accepterUserId, acceptData }
                    }));
                }
            });

            connectionRef.current = hub;
        }

        if (connectionRef.current.state === signalR.HubConnectionState.Disconnected) {
            try {
                console.log('[SignalR ⏳] Conectando ao hub...');
                await connectionRef.current.start();
                console.log('[SignalR 🟢] Conectado com sucesso! ID:', connectionRef.current.connectionId);
            } catch (err) {
                console.error('[SignalR 🔴] Falha ao conectar ao servidor SignalR (possível Cold Start no backend):', err);
                throw err;
            }

            // Re-registra o usuário se já autenticado
            if (registeredUserIdRef.current) {
                try {
                    await connectionRef.current.invoke("RegisterUser", registeredUserIdRef.current);
                    console.log(`[SignalR 👤] Usuário registrado no Hub: ${registeredUserIdRef.current}`);
                } catch (err) {
                    console.warn("[SignalR ⚠️] Erro ao registrar usuário:", err);
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
