import { useCallback, useEffect, useRef } from 'react';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

export type SoundType = 'message' | 'mention' | 'join' | 'leave';

const SOUND_COOLDOWN_MS = 180; // Trava contra estouro de áudio em rajadas de mensagens

/**
 * Hook global unificado de notificações para o CuiCall.
 * Gerencia efeitos sonoros com trava de concorrência e notificações nativas (Tauri / Web API).
 */
export const useNotifications = () => {
    const hasTauriPermission = useRef<boolean | null>(null);
    const audioPoolRef = useRef<Map<SoundType, HTMLAudioElement>>(new Map());
    const lastPlayedRef = useRef<{ time: number; type: SoundType }>({ time: 0, type: 'message' });

    // Inicializa e solicita permissão de notificação no SO
    useEffect(() => {
        const initPermissions = async () => {
            try {
                let granted = await isPermissionGranted();
                if (!granted) {
                    const permission = await requestPermission();
                    granted = permission === 'granted';
                }
                hasTauriPermission.current = granted;
            } catch {
                // Fallback para Web Notification API se fora do ambiente Tauri
                if (typeof window !== 'undefined' && 'Notification' in window) {
                    if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
                        Notification.requestPermission();
                    }
                }
            }
        };

        // Pré-carrega instâncias de áudio para baixa latência
        if (typeof window !== 'undefined') {
            const soundTypes: SoundType[] = ['message', 'mention', 'join', 'leave'];
            soundTypes.forEach((type) => {
                const audio = new Audio(`/sounds/${type}.mp3`);
                audio.volume = type === 'mention' ? 0.8 : 0.65;
                audioPoolRef.current.set(type, audio);
            });
        }

        initPermissions();
    }, []);

    // Reproduz efeito sonoro com trava inteligente contra sobreposição e distorção
    const playSound = useCallback((type: SoundType) => {
        try {
            const now = Date.now();
            const elapsed = now - lastPlayedRef.current.time;

            // Trava de debounce: Se for o mesmo som dentro da janela de cooldown, bloqueia
            // Exceção: 'mention' tem prioridade máxima e interrompe sons de 'message'
            if (elapsed < SOUND_COOLDOWN_MS && lastPlayedRef.current.type === type) {
                return;
            }

            let audio = audioPoolRef.current.get(type);
            if (!audio) {
                audio = new Audio(`/sounds/${type}.mp3`);
                audio.volume = type === 'mention' ? 0.8 : 0.65;
                audioPoolRef.current.set(type, audio);
            }

            audio.currentTime = 0;
            lastPlayedRef.current = { time: now, type };

            audio.play().catch((err) => {
                console.debug(`[Audio] Autoplay bloqueado para som '${type}':`, err);
            });
        } catch (err) {
            console.warn(`[Audio] Falha ao reproduzir '${type}':`, err);
        }
    }, []);

    // Dispara notificação nativa no Sistema Operacional
    const notifyOS = useCallback(async (title: string, body: string) => {
        try {
            if (hasTauriPermission.current) {
                sendNotification({ title, body });
                return;
            }

            const granted = await isPermissionGranted();
            if (granted) {
                hasTauriPermission.current = true;
                sendNotification({ title, body });
                return;
            }
        } catch {
            if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
                new Notification(title, { body, icon: '/tauri.svg' });
            }
        }
    }, []);

    // Dispara alerta de nova mensagem direta
    const notifyNewDM = useCallback((senderName: string, text: string, isChatActive: boolean) => {
        playSound('message');

        if (!isChatActive) {
            notifyOS(`Nova mensagem de ${senderName}`, text.length > 80 ? `${text.slice(0, 80)}...` : text);
        }
    }, [playSound, notifyOS]);

    // Dispara alerta específico de menção (@)
    const notifyMention = useCallback((senderName: string, channelName: string, text: string, isChatActive: boolean) => {
        playSound('mention');

        if (!isChatActive) {
            notifyOS(`Mencionado por ${senderName} em #${channelName}`, text.length > 80 ? `${text.slice(0, 80)}...` : text);
        }
    }, [playSound, notifyOS]);

    // Dispara notificação de entrada/saída de voz
    const notifyVoiceState = useCallback((action: 'joined' | 'left', _userName?: string) => {
        playSound(action === 'joined' ? 'join' : 'leave');
    }, [playSound]);

    return {
        playSound,
        notifyOS,
        notifyNewDM,
        notifyMention,
        notifyVoiceState,
    };
};
