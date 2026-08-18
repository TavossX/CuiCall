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
 * Hook que gerencia WebRTC (voz/vídeo) e SignalR (sinalização + chat).
 * 
 * - `voiceRoomId`: quando preenchido, conecta ao SignalR e inicia WebRTC para voz.
 * - `chatChannelId`: quando preenchido, conecta ao SignalR para chat de texto.
 *   Se ambos forem iguais, uma única conexão é compartilhada.
 */
export const useWebRTC = (voiceRoomId: string, chatChannelId: string = '') => {
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isCamOff, setIsCamOff] = useState(false);
    const [isMuted, setIsMuted] = useState(false);

    const connectionRef = useRef<signalR.HubConnection | null>(null);
    const peerRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);

    // Keep localStreamRef in sync
    useEffect(() => {
        localStreamRef.current = localStream;
    }, [localStream]);

    // ═══════ SignalR Connection (shared for voice + chat) ═══════
    const activeRoomId = voiceRoomId || chatChannelId;

    useEffect(() => {
        if (!activeRoomId) return;

        const connectSignalR = async () => {
            const signalRUrl = import.meta.env.VITE_SIGNALR_URL || "http://localhost:5222/callHub";
            const hub = new signalR.HubConnectionBuilder()
                .withUrl(signalRUrl)
                .withAutomaticReconnect()
                .build();

            connectionRef.current = hub;

            // ── WebRTC Signaling (only when in voice) ──
            hub.on("UserJoined", async () => {
                if (!voiceRoomId) return;
                const peer = createPeer();
                const offer = await peer.createOffer();
                await peer.setLocalDescription(offer);
                hub.invoke("SendSignal", JSON.stringify({ type: 'offer', sdp: offer }), voiceRoomId);
            });

            hub.on("ReceiveSignal", async (_, signal) => {
                if (!voiceRoomId) return;
                const data = JSON.parse(signal);
                const peer = peerRef.current || createPeer();

                if (data.type === 'offer') {
                    await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
                    const answer = await peer.createAnswer();
                    await peer.setLocalDescription(answer);
                    hub.invoke("SendSignal", JSON.stringify({ type: 'answer', sdp: answer }), voiceRoomId);
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

            // ── Chat ──
            hub.on("ReceiveMessage", (senderId: string, text: string) => {
                setMessages(prev => [...prev, { senderId, text }]);
            });

            await hub.start();
            await hub.invoke("JoinRoom", activeRoomId);
        };

        connectSignalR();

        return () => {
            connectionRef.current?.stop();
            connectionRef.current = null;
            peerRef.current?.close();
            peerRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeRoomId]);

    // Clear messages when switching channels
    useEffect(() => {
        setMessages([]);
    }, [chatChannelId]);

    // ═══════ Peer Connection Factory ═══════
    const createPeer = () => {
        const peer = new RTCPeerConnection(STUN_SERVERS);
        peerRef.current = peer;

        peer.onicecandidate = (event) => {
            if (event.candidate && voiceRoomId) {
                connectionRef.current?.invoke("SendSignal", JSON.stringify({ candidate: event.candidate }), voiceRoomId);
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
    };

    // ═══════ Camera / Mic Controls ═══════

    const startCamera = useCallback(async (videoDeviceId?: string, audioDeviceId?: string) => {
        const constraints: MediaStreamConstraints = {
            video: videoDeviceId ? { deviceId: { exact: videoDeviceId } } : true,
            audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        setLocalStream(stream);
        localStreamRef.current = stream;
        setIsCamOff(false);
        setIsMuted(false);

        if (peerRef.current) {
            stream.getTracks().forEach(track => peerRef.current?.addTrack(track, stream));
        }
    }, []);

    const toggleCamera = useCallback(async () => {
        const stream = localStreamRef.current;
        if (!stream) return;

        if (!isCamOff) {
            // DESLIGAR: stop() para liberar o hardware (LED apaga)
            stream.getVideoTracks().forEach(track => track.stop());

            // Notificar o peer remoto que não há mais vídeo
            const videoSender = peerRef.current?.getSenders().find(s => s.track?.kind === 'video');
            if (videoSender) {
                await videoSender.replaceTrack(null);
            }

            // Manter apenas o áudio no localStream
            const audioOnly = new MediaStream(stream.getAudioTracks());
            setLocalStream(audioOnly);
            localStreamRef.current = audioOnly;
            setIsCamOff(true);
        } else {
            // LIGAR: getUserMedia para reativar o hardware
            const newVideoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const newVideoTrack = newVideoStream.getVideoTracks()[0];

            // Substituir a trilha no peer
            const videoSender = peerRef.current?.getSenders().find(s => s.track?.kind === 'video' || s.track === null);
            if (videoSender) {
                await videoSender.replaceTrack(newVideoTrack);
            }

            // Reconstruir o stream com áudio existente + vídeo novo
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
            startCamera();
        };
    }, [startCamera]);

    const sendMessage = useCallback((text: string) => {
        const roomId = voiceRoomId || chatChannelId;
        if (connectionRef.current && text.trim() && roomId) {
            connectionRef.current.invoke("SendMessage", text, roomId);
        }
    }, [voiceRoomId, chatChannelId]);

    const stopAllMedia = useCallback(() => {
        localStreamRef.current?.getTracks().forEach(track => track.stop());
        setLocalStream(null);
        localStreamRef.current = null;
        setRemoteStream(null);
        setIsCamOff(false);
        setIsMuted(false);
        if (peerRef.current) {
            peerRef.current.close();
            peerRef.current = null;
        }
    }, []);

    return {
        localStream,
        remoteStream,
        messages,
        isCamOff,
        isMuted,
        startCamera,
        shareScreen,
        toggleMute,
        toggleCamera,
        sendMessage,
        stopAllMedia,
    };
};
