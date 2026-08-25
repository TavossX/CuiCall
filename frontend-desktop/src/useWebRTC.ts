import { useEffect, useRef, useState, useCallback } from 'react';
import * as signalR from '@microsoft/signalr';
import { appendMessageToCache, getDMCacheKey } from './utils/chatCache';
import { usePushToTalk } from './usePushToTalk';
import { createProcessedAudioStream, ProcessedAudioResult } from './utils/audioProcessor';

const STUN_SERVERS: RTCConfiguration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ],
};

const DEFAULT_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 30, max: 30 },
};

const DEFAULT_SCREEN_CONSTRAINTS: MediaTrackConstraints = {
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 30, max: 30 },
};

/**
 * Adquire stream da câmera aplicando limites de 720p @ 30fps.
 * Implementa fallbacks graduais caso o dispositivo não suporte a resolução ideal/máxima
 * ou caso o usuário não possua câmera/recuse permissão de vídeo.
 */
const acquireCameraStream = async (
    videoDeviceId?: string,
    audioDeviceId?: string
): Promise<MediaStream> => {
    const videoConstraints: MediaTrackConstraints = {
        ...DEFAULT_VIDEO_CONSTRAINTS,
        ...(videoDeviceId ? { deviceId: { exact: videoDeviceId } } : {}),
    };

    const audioConstraints: MediaTrackConstraints | boolean = audioDeviceId
        ? { deviceId: { exact: audioDeviceId } }
        : true;

    // 1ª Tentativa: Limites de 720p / 30fps + áudio
    try {
        return await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: audioConstraints,
        });
    } catch (err) {
        console.warn("[WebRTC] getUserMedia com constraints 720p/30fps falhou. Tentando fallback...", err);
    }

    // 2ª Tentativa: Fallback com vídeo sem restrições estritas de resolução
    try {
        return await navigator.mediaDevices.getUserMedia({
            video: videoDeviceId ? { deviceId: { exact: videoDeviceId } } : true,
            audio: audioConstraints,
        });
    } catch (err) {
        console.warn("[WebRTC] Fallback de vídeo falhou. Tentando áudio apenas...", err);
    }

    // 3ª Tentativa: Fallback para apenas microfone (caso não haja câmera ou permissão de vídeo)
    return await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: audioConstraints,
    });
};

/**
 * Adquire stream de compartilhamento de tela com limites de 720p @ 30fps e captura de áudio do sistema.
 * Implementa fallback caso a captura de áudio do sistema não seja suportada pelo navegador/OS.
 */
const acquireScreenStream = async (): Promise<MediaStream> => {
    // 1ª Tentativa: Compartilhamento de tela em 720p/30fps com áudio do sistema
    try {
        return await navigator.mediaDevices.getDisplayMedia({
            video: DEFAULT_SCREEN_CONSTRAINTS,
            audio: true,
        });
    } catch (err) {
        console.warn("[WebRTC] getDisplayMedia com áudio falhou, tentando apenas vídeo com constraints:", err);
    }

    // 2ª Tentativa: Compartilhamento de tela em 720p/30fps apenas vídeo
    try {
        return await navigator.mediaDevices.getDisplayMedia({
            video: DEFAULT_SCREEN_CONSTRAINTS,
        });
    } catch (err) {
        console.warn("[WebRTC] getDisplayMedia com constraints falhou, tentando padrão do sistema:", err);
    }

    // 3ª Tentativa: getDisplayMedia básico
    return await navigator.mediaDevices.getDisplayMedia({
        video: true,
    });
};

export interface ChatMessage {
    senderId: string;
    text: string;
    id?: string;
    channelId?: string;
    attachment_url?: string | null;
    created_at?: string;
}

export interface RemoteStreamInfo {
    peerId: string;
    stream: MediaStream;
    isScreenSharing: boolean;
}

export interface VoiceMemberInfo {
    connectionId: string;
    userId?: string;
    userName?: string;
    avatarUrl?: string;
    isMuted?: boolean;
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
    const [voicePresence, setVoicePresence] = useState<Record<string, VoiceMemberInfo[]>>({});
    const [typingUsers, setTypingUsers] = useState<Record<string, Record<string, number>>>({});
    const [dmTypingUsers, setDmTypingUsers] = useState<Record<string, number>>({});

    const { isPTTActive, isPTTEnabled, pttShortcut, updatePTTEnabled, updatePTTShortcut, releaseDelay, updateReleaseDelay } = usePushToTalk();

    // ── Limpeza periódica de usuários digitando (> 3 segundos) ──
    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            setTypingUsers(prev => {
                let changed = false;
                const updated: Record<string, Record<string, number>> = {};
                for (const [roomId, users] of Object.entries(prev)) {
                    const activeUsers: Record<string, number> = {};
                    for (const [user, expiry] of Object.entries(users)) {
                        if (now < expiry) {
                            activeUsers[user] = expiry;
                        } else {
                            changed = true;
                        }
                    }
                    if (Object.keys(activeUsers).length > 0) {
                        updated[roomId] = activeUsers;
                    } else if (Object.keys(users).length > 0) {
                        changed = true;
                    }
                }
                return changed ? updated : prev;
            });

            setDmTypingUsers(prev => {
                let changed = false;
                const updated: Record<string, number> = {};
                for (const [partnerId, expiry] of Object.entries(prev)) {
                    if (now < expiry) {
                        updated[partnerId] = expiry;
                    } else {
                        changed = true;
                    }
                }
                return changed ? updated : prev;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    // ── Heartbeat / Ping a cada 5 segundos para manter presença ativa ──
    useEffect(() => {
        const pingInterval = setInterval(() => {
            if (connectionRef.current && connectionRef.current.state === signalR.HubConnectionState.Connected) {
                connectionRef.current.invoke("Ping").catch((err) => {
                    console.debug("[SignalR Heartbeat] Falha temporária no ping:", err);
                });
            }
        }, 5000);

        return () => clearInterval(pingInterval);
    }, []);

    const connectionRef = useRef<signalR.HubConnection | null>(null);
    const peersRef = useRef(new Map<string, RTCPeerConnection>());
    const localStreamRef = useRef<MediaStream | null>(null);
    const voiceRoomIdRef = useRef<string | null>(null);
    const currentChannelIdRef = useRef<string | null>(null);
    const isScreenSharingRef = useRef(false);
    const isMutedRef = useRef(false);
    const registeredUserIdRef = useRef<string | null>(null);

    // ── Supressão de Ruído e Noise Gate ──
    const [isNoiseSuppressionEnabled, setIsNoiseSuppressionEnabled] = useState<boolean>(() => {
        const stored = localStorage.getItem('cuicall-noise-suppression');
        return stored === null ? true : stored === 'true';
    });
    const [noiseGateThreshold, setNoiseGateThreshold] = useState<number>(() => {
        const stored = localStorage.getItem('cuicall-noise-threshold');
        return stored ? parseInt(stored, 10) : -48;
    });
    const audioProcessorRef = useRef<ProcessedAudioResult | null>(null);

    // Sincroniza alterações vindas do modal de configurações
    useEffect(() => {
        const handleNoiseConfig = (e: any) => {
            if (e.detail) {
                if (typeof e.detail.noiseSuppressionEnabled === 'boolean') {
                    setIsNoiseSuppressionEnabled(e.detail.noiseSuppressionEnabled);
                    audioProcessorRef.current?.setNoiseSuppressionEnabled(e.detail.noiseSuppressionEnabled);
                }
                if (typeof e.detail.noiseThreshold === 'number') {
                    setNoiseGateThreshold(e.detail.noiseThreshold);
                    audioProcessorRef.current?.setThresholdDb(e.detail.noiseThreshold);
                }
            }
        };
        window.addEventListener('cuicall:noiseConfigChanged', handleNoiseConfig);
        return () => window.removeEventListener('cuicall:noiseConfigChanged', handleNoiseConfig);
    }, []);

    // ── Sincronização da trilha de áudio do microfone com Push-to-Talk ──
    useEffect(() => {
        if (!inVoice || !localStreamRef.current) return;

        if (isPTTEnabled) {
            const shouldTransmitAudio = isPTTActive;
            localStreamRef.current.getAudioTracks().forEach(track => {
                track.enabled = shouldTransmitAudio;
            });

            const currentMuteState = !shouldTransmitAudio;
            setIsMuted(currentMuteState);
            isMutedRef.current = currentMuteState;

            if (voiceRoomIdRef.current && connectionRef.current?.state === signalR.HubConnectionState.Connected) {
                connectionRef.current.invoke("UpdateVoiceMuteState", voiceRoomIdRef.current, currentMuteState).catch((err) => {
                    console.warn("[PTT] Erro ao sincronizar estado de mute com o Hub:", err);
                });
            }
        }
    }, [inVoice, isPTTEnabled, isPTTActive]);

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
            hub.on("VoiceStateUpdated", (roomId: string, memberOrConnId: any, action: string) => {
                const member: VoiceMemberInfo = typeof memberOrConnId === 'string'
                    ? { connectionId: memberOrConnId }
                    : memberOrConnId;

                console.log(`[VoicePresence 🎙️] Sala ${roomId} | Membro ${member.userName || member.connectionId} -> ${action}`);
                setVoicePresence(prev => {
                    const current = prev[roomId] || [];
                    if (action === 'joined') {
                        const filtered = current.filter(m => m.connectionId !== member.connectionId);
                        return { ...prev, [roomId]: [...filtered, member] };
                    } else if (action === 'left') {
                        const filtered = current.filter(m => m.connectionId !== member.connectionId);
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
                    window.dispatchEvent(new CustomEvent('cuicall:voiceState', {
                        detail: { roomId, connectionId: member.connectionId, action }
                    }));
                }
            });

            hub.on("VoiceMemberMuteUpdated", (roomId: string, connectionId: string, isMuted: boolean) => {
                console.log(`[VoicePresence 🔇] Sala ${roomId} | Peer ${connectionId} mutado: ${isMuted}`);
                setVoicePresence(prev => {
                    const current = prev[roomId] || [];
                    const updated = current.map(m => m.connectionId === connectionId ? { ...m, isMuted } : m);
                    return { ...prev, [roomId]: updated };
                });
            });

            // ── Chat de Servidor ──
            hub.on("ReceiveMessage", (senderId: string, text: string, roomId?: string, attachmentUrl?: string) => {
                const targetChannel = roomId || currentChannelIdRef.current || voiceRoomIdRef.current || 'cuicall-geral';
                console.log(`[Chat 💬] Canal ${targetChannel} | De: ${senderId} | Anexo: ${attachmentUrl ? 'Sim' : 'Não'}`);
                
                const newMsg = {
                    senderId,
                    text,
                    attachment_url: attachmentUrl || null
                };

                setChannelMessages(prev => ({
                    ...prev,
                    [targetChannel]: [...(prev[targetChannel] || []), newMsg]
                }));

                appendMessageToCache(targetChannel, newMsg);

                // Dispara evento global de nova mensagem de canal para detecção de menções e notificações
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('cuicall:newChannelMessage', {
                        detail: { senderId, text, channelId: targetChannel, attachmentUrl }
                    }));
                }
            });

            // ── Direct Messages (DMs) ──
            hub.on("ReceiveDirectMessage", (senderUserId: string, text: string, dmData: any) => {
                console.log(`[DM 📩] De: ${senderUserId} | Anexo: ${dmData?.attachment_url ? 'Sim' : 'Não'}`);
                
                const newDM = {
                    senderId: dmData?.senderName || senderUserId,
                    text,
                    id: dmData?.id,
                    attachment_url: dmData?.attachment_url || null,
                    created_at: dmData?.created_at,
                };

                setDirectMessages(prev => ({
                    ...prev,
                    [senderUserId]: [...(prev[senderUserId] || []), newDM]
                }));

                if (registeredUserIdRef.current) {
                    const cacheKey = getDMCacheKey(registeredUserIdRef.current, senderUserId);
                    appendMessageToCache(cacheKey, newDM);
                }

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

            // ── Indicador de Digitação em Canais e DMs ──
            hub.on("UserTyping", (roomId: string, typingUserName: string) => {
                setTypingUsers(prev => ({
                    ...prev,
                    [roomId]: {
                        ...(prev[roomId] || {}),
                        [typingUserName]: Date.now() + 3000
                    }
                }));
            });

            hub.on("UserDMTyping", (senderUserId: string, _senderName: string) => {
                setDmTypingUsers(prev => ({
                    ...prev,
                    [senderUserId]: Date.now() + 3000
                }));
            });

            hub.on("ForceDisconnect", (reason: string) => {
                console.warn(`[SignalR 🔴] Conexão forçada a desconectar pelo servidor: ${reason}`);
                stopAllMedia();
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
                const snapshot = await connectionRef.current.invoke<Record<string, VoiceMemberInfo[]>>("GetVoiceState");
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
        if ((!text.trim() && !dmData?.attachment_url) || !receiverId) return;
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
    const joinVoice = useCallback(async (
        roomId: string = 'cuicall-voice-main',
        videoDeviceId?: string,
        audioDeviceId?: string,
        profile?: { userName?: string; avatarUrl?: string }
    ) => {
        try {
            const rawStream = await acquireCameraStream(videoDeviceId, audioDeviceId);

            // Fecha processador anterior se houver
            if (audioProcessorRef.current) {
                audioProcessorRef.current.close();
                audioProcessorRef.current = null;
            }

            // Intercepta e processa através da Web Audio API (High-Pass + Noise Gate)
            const processor = createProcessedAudioStream(rawStream, {
                enabled: isNoiseSuppressionEnabled,
                thresholdDb: noiseGateThreshold,
            });
            audioProcessorRef.current = processor;
            const stream = processor.processedStream;

            setLocalStream(stream);
            localStreamRef.current = stream;

            const hasVideo = stream.getVideoTracks().length > 0;
            setIsCamOff(!hasVideo);

            // Se o modo Push-To-Talk estiver ativado, o áudio inicia mutado até a tecla ser pressionada
            const initialMuteState = isPTTEnabled;
            stream.getAudioTracks().forEach(track => {
                track.enabled = !initialMuteState;
            });

            setIsMuted(initialMuteState);
            isMutedRef.current = initialMuteState;
            setIsScreenSharing(false);
            setInVoice(true);
            setVoiceRoomId(roomId);
            voiceRoomIdRef.current = roomId;

            const hub = await getHubConnection();
            await hub.invoke("JoinRoom", roomId, profile?.userName || "Usuário", profile?.avatarUrl || "", initialMuteState);

            peersRef.current.forEach((peer) => {
                const senders = peer.getSenders();
                if (senders.length === 0) {
                    stream.getTracks().forEach(track => peer.addTrack(track, stream));
                }
            });
        } catch (err) {
            console.error("[WebRTC] Erro ao entrar no canal de voz:", err);
        }
    }, [getHubConnection, isPTTEnabled, isNoiseSuppressionEnabled, noiseGateThreshold]);

    const leaveVoice = useCallback(async () => {
        if (audioProcessorRef.current) {
            audioProcessorRef.current.close();
            audioProcessorRef.current = null;
        }

        localStreamRef.current?.getTracks().forEach(track => track.stop());
        setLocalStream(null);
        localStreamRef.current = null;
        setRemoteStreams([]);
        setIsCamOff(false);
        setIsMuted(false);
        isMutedRef.current = false;
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
            try {
                let newVideoStream: MediaStream;
                try {
                    newVideoStream = await navigator.mediaDevices.getUserMedia({
                        video: DEFAULT_VIDEO_CONSTRAINTS,
                        audio: false
                    });
                } catch (err) {
                    console.warn("[WebRTC] getUserMedia com 720p/30fps falhou ao alternar câmera, tentando fallback:", err);
                    newVideoStream = await navigator.mediaDevices.getUserMedia({
                        video: true,
                        audio: false
                    });
                }

                const newVideoTrack = newVideoStream.getVideoTracks()[0];
                if (newVideoTrack) {
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
            } catch (err) {
                console.error("[WebRTC] Falha ao reativar câmera:", err);
            }
        }
    }, [isCamOff]);

    const toggleMute = useCallback(async () => {
        const stream = localStreamRef.current;
        if (!stream) return;
        const newMuted = !isMuted;
        stream.getAudioTracks().forEach(track => {
            track.enabled = !newMuted;
        });
        setIsMuted(newMuted);
        isMutedRef.current = newMuted;

        if (voiceRoomIdRef.current && connectionRef.current?.state === signalR.HubConnectionState.Connected) {
            try {
                await connectionRef.current.invoke("UpdateVoiceMuteState", voiceRoomIdRef.current, newMuted);
            } catch (err) {
                console.warn("[SignalR] Erro ao atualizar mute no hub:", err);
            }
        }
    }, [isMuted]);

    // Atualiza o estado dos tracks de áudio com base no Push-to-Talk
    const updatePTTState = useCallback((isTalking: boolean, isPTTEnabled: boolean) => {
        const stream = localStreamRef.current;
        if (!stream) return;

        if (isPTTEnabled) {
            const shouldTransmit = isTalking && !isMutedRef.current;
            stream.getAudioTracks().forEach(track => {
                track.enabled = shouldTransmit;
            });

            if (voiceRoomIdRef.current && connectionRef.current?.state === signalR.HubConnectionState.Connected) {
                connectionRef.current.invoke("UpdateVoiceMuteState", voiceRoomIdRef.current, !shouldTransmit).catch(() => {});
            }
        } else {
            stream.getAudioTracks().forEach(track => {
                track.enabled = !isMutedRef.current;
            });
        }
    }, []);

    // Sincroniza estado de transmissão de áudio sempre que o PTT ativar/desativar
    useEffect(() => {
        updatePTTState(isPTTActive, isPTTEnabled);
    }, [isPTTActive, isPTTEnabled, updatePTTState]);

    const shareScreen = useCallback(async () => {
        try {
            const screenStream = await acquireScreenStream();
            const screenTrack = screenStream.getVideoTracks()[0];
            if (!screenTrack) return;

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
                        let camStream: MediaStream;
                        try {
                            camStream = await navigator.mediaDevices.getUserMedia({
                                video: DEFAULT_VIDEO_CONSTRAINTS,
                                audio: true
                            });
                        } catch (camErr) {
                            console.warn("[WebRTC] Fallback de câmera após encerramento do compartilhamento de tela:", camErr);
                            camStream = await navigator.mediaDevices.getUserMedia({
                                video: true,
                                audio: true
                            });
                        }

                        // Preservar estado de mute ao re-obter áudio da câmera/microfone
                        const currentMuteState = isMutedRef.current;
                        camStream.getAudioTracks().forEach(track => {
                            track.enabled = !currentMuteState;
                        });

                        const camVideoTrack = camStream.getVideoTracks()[0];
                        peersRef.current.forEach((peer) => {
                            const videoSender = peer.getSenders().find(s => s.track?.kind === 'video');
                            if (videoSender && camVideoTrack) {
                                videoSender.replaceTrack(camVideoTrack);
                            }
                        });

                        setLocalStream(camStream);
                        localStreamRef.current = camStream;
                    } catch (err) {
                        console.warn("[WebRTC] Não foi possível re-adquirir câmera após compartilhamento de tela:", err);
                    }
                }
            };
        } catch (err) {
            console.error("[WebRTC] Erro ao iniciar compartilhamento de tela:", err);
        }
    }, []);

    const sendMessage = useCallback(async (messageId: string, userName: string, text: string, channelId: string, attachmentUrl?: string | null) => {
        if ((!text.trim() && !attachmentUrl) || !channelId) return;
        const hub = await getHubConnection();
        await hub.invoke("SendMessage", messageId, userName, text, channelId, attachmentUrl || null);
    }, [getHubConnection]);

    const sendTyping = useCallback(async (roomId: string, userName: string) => {
        if (!roomId || !userName) return;
        try {
            const hub = await getHubConnection();
            await hub.invoke("SendTyping", roomId, userName);
        } catch (err) {
            console.warn("[SignalR] Erro ao enviar indicador de digitação:", err);
        }
    }, [getHubConnection]);

    const sendDMTyping = useCallback(async (receiverUserId: string, senderName: string) => {
        if (!receiverUserId || !senderName) return;
        try {
            const hub = await getHubConnection();
            await hub.invoke("SendDMTyping", receiverUserId, senderName);
        } catch (err) {
            console.warn("[SignalR] Erro ao enviar indicador de digitação DM:", err);
        }
    }, [getHubConnection]);

    const loadChannelMessages = useCallback((channelId: string, msgs: ChatMessage[]) => {
        setChannelMessages(prev => ({
            ...prev,
            [channelId]: msgs,
        }));
    }, []);

    const toggleNoiseSuppression = useCallback((enabled?: boolean) => {
        setIsNoiseSuppressionEnabled(prev => {
            const next = enabled !== undefined ? enabled : !prev;
            localStorage.setItem('cuicall-noise-suppression', String(next));
            if (audioProcessorRef.current) {
                audioProcessorRef.current.setNoiseSuppressionEnabled(next);
            }
            return next;
        });
    }, []);

    const updateNoiseGateThreshold = useCallback((threshold: number) => {
        setNoiseGateThreshold(threshold);
        localStorage.setItem('cuicall-noise-threshold', String(threshold));
        if (audioProcessorRef.current) {
            audioProcessorRef.current.setThresholdDb(threshold);
        }
    }, []);

    const stopAllMedia = useCallback(() => {
        if (audioProcessorRef.current) {
            audioProcessorRef.current.close();
            audioProcessorRef.current = null;
        }

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
        isPTTActive,
        isPTTEnabled,
        pttShortcut,
        releaseDelay,
        updatePTTEnabled,
        updatePTTShortcut,
        updateReleaseDelay,
        updatePTTState,
        isNoiseSuppressionEnabled,
        noiseGateThreshold,
        toggleNoiseSuppression,
        updateNoiseGateThreshold,
        channelMessages,
        directMessages,
        voicePresence,
        typingUsers,
        dmTypingUsers,
        sendTyping,
        sendDMTyping,
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
