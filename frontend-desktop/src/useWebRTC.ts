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
}

/**
 * Hook global gerenciador de WebRTC (voz/vídeo) e SignalR (chat de múltiplos canais).
 * Permanece ativo no nível raiz do App para manter chamadas de voz ativas em background
 * enquanto o usuário navega entre canais de texto.
 */
export const useWebRTC = () => {
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
    const [inVoice, setInVoice] = useState(false);
    const [voiceRoomId, setVoiceRoomId] = useState<string | null>(null);
    const [isCamOff, setIsCamOff] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [channelMessages, setChannelMessages] = useState<Record<string, ChatMessage[]>>({});

    const connectionRef = useRef<signalR.HubConnection | null>(null);
    const peerRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const voiceRoomIdRef = useRef<string | null>(null);
    const currentChannelIdRef = useRef<string | null>(null);

    // Keep refs in sync
    useEffect(() => {
        localStreamRef.current = localStream;
    }, [localStream]);

    useEffect(() => {
        voiceRoomIdRef.current = voiceRoomId;
    }, [voiceRoomId]);

    // ═══════ Peer Connection Factory ═══════
    const createPeer = useCallback((roomId: string) => {
        const peer = new RTCPeerConnection(STUN_SERVERS);
        peerRef.current = peer;

        peer.onicecandidate = (event) => {
            if (event.candidate && roomId) {
                connectionRef.current?.invoke("SendSignal", JSON.stringify({ candidate: event.candidate }), roomId);
            }
        };

        peer.ontrack = (event) => {
            setRemoteStream(event.streams[0]);
        };

        const stream = localStreamRef.current;
        if (stream) {
            stream.getTracks().forEach(track => peer.addTrack(track, stream));
        }

        return peer;
    }, []);

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

            // ── WebRTC Signaling ──
            hub.on("UserJoined", async () => {
                const currentVoiceRoom = voiceRoomIdRef.current;
                if (!currentVoiceRoom) return;

                const peer = createPeer(currentVoiceRoom);
                const offer = await peer.createOffer();
                await peer.setLocalDescription(offer);
                hub.invoke("SendSignal", JSON.stringify({ type: 'offer', sdp: offer }), currentVoiceRoom);
            });

            hub.on("ReceiveSignal", async (_, signal) => {
                const currentVoiceRoom = voiceRoomIdRef.current;
                if (!currentVoiceRoom) return;

                const data = JSON.parse(signal);
                const peer = peerRef.current || createPeer(currentVoiceRoom);

                if (data.type === 'offer') {
                    await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
                    const answer = await peer.createAnswer();
                    await peer.setLocalDescription(answer);
                    hub.invoke("SendSignal", JSON.stringify({ type: 'answer', sdp: answer }), currentVoiceRoom);
                } else if (data.type === 'answer') {
                    await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
                } else if (data.candidate) {
                    await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
                }
            });

            hub.on("UserLeft", () => {
                setRemoteStream(null);
                if (peerRef.current) {
                    peerRef.current.close();
                    peerRef.current = null;
                }
            });

            // ── Chat Multicanal ──
            hub.on("ReceiveMessage", (senderId: string, text: string) => {
                const targetChannel = currentChannelIdRef.current || voiceRoomIdRef.current || 'cuicall-geral';
                setChannelMessages(prev => ({
                    ...prev,
                    [targetChannel]: [...(prev[targetChannel] || []), { senderId, text }]
                }));
            });

            connectionRef.current = hub;
        }

        if (connectionRef.current.state === signalR.HubConnectionState.Disconnected) {
            await connectionRef.current.start();
        }

        return connectionRef.current;
    }, [createPeer]);

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
        setInVoice(true);
        setVoiceRoomId(roomId);
        voiceRoomIdRef.current = roomId;

        const hub = await getHubConnection();
        await hub.invoke("JoinRoom", roomId);

        if (peerRef.current) {
            stream.getTracks().forEach(track => peerRef.current?.addTrack(track, stream));
        }
    }, [getHubConnection]);

    const leaveVoice = useCallback(() => {
        localStreamRef.current?.getTracks().forEach(track => track.stop());
        setLocalStream(null);
        localStreamRef.current = null;
        setRemoteStream(null);
        setIsCamOff(false);
        setIsMuted(false);
        setInVoice(false);
        setVoiceRoomId(null);
        voiceRoomIdRef.current = null;

        if (peerRef.current) {
            peerRef.current.close();
            peerRef.current = null;
        }
    }, []);

    const toggleCamera = useCallback(async () => {
        const stream = localStreamRef.current;
        if (!stream) return;

        if (!isCamOff) {
            stream.getVideoTracks().forEach(track => track.stop());

            const videoSender = peerRef.current?.getSenders().find(s => s.track?.kind === 'video');
            if (videoSender) {
                await videoSender.replaceTrack(null);
            }

            const audioOnly = new MediaStream(stream.getAudioTracks());
            setLocalStream(audioOnly);
            localStreamRef.current = audioOnly;
            setIsCamOff(true);
        } else {
            const newVideoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const newVideoTrack = newVideoStream.getVideoTracks()[0];

            const videoSender = peerRef.current?.getSenders().find(s => s.track?.kind === 'video' || s.track === null);
            if (videoSender) {
                await videoSender.replaceTrack(newVideoTrack);
            }

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
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = stream.getVideoTracks()[0];

        const videoSender = peerRef.current?.getSenders().find(s => s.track?.kind === 'video');
        if (videoSender) {
            videoSender.replaceTrack(screenTrack);
        }

        setLocalStream(stream);
        localStreamRef.current = stream;
        setIsCamOff(false);

        screenTrack.onended = () => {
            if (voiceRoomIdRef.current) {
                joinVoice(voiceRoomIdRef.current);
            }
        };
    }, [joinVoice]);

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
        leaveVoice();
        connectionRef.current?.stop();
        connectionRef.current = null;
    }, [leaveVoice]);

    return {
        localStream,
        remoteStream,
        inVoice,
        voiceRoomId,
        isCamOff,
        isMuted,
        channelMessages,
        setChannelMessages,
        loadChannelMessages,
        joinVoice,
        leaveVoice,
        joinTextChannel,
        toggleMute,
        toggleCamera,
        shareScreen,
        sendMessage,
        stopAllMedia,
    };
};
