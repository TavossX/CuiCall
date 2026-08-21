import { useCallback, useEffect, useRef } from 'react';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

export type SoundType = 'message' | 'join' | 'leave';

/**
 * Hook global unificado de notificações para o CuiCall.
 * Gerencia efeitos sonoros e notificações nativas do Sistema Operacional (Tauri + Web API fallback).
 */
export const useNotifications = () => {
    const hasTauriPermission = useRef<boolean | null>(null);

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

        initPermissions();
    }, []);

    // Reproduz arquivo de áudio de public/sounds/
    const playSound = useCallback((type: SoundType) => {
        try {
            const audio = new Audio(`/sounds/${type}.mp3`);
            audio.volume = 0.65;
            audio.play().catch((err) => {
                // Navegadores podem bloquear áudio antes da primeira interação do usuário
                console.debug(`[Audio] Autoplay restrito para som '${type}':`, err);
            });
        } catch (err) {
            console.warn(`[Audio] Falha ao carregar áudio '${type}':`, err);
        }
    }, []);

    // Dispara notificação nativa no Sistema Operacional
    const notifyOS = useCallback(async (title: string, body: string) => {
        try {
            if (hasTauriPermission.current) {
                sendNotification({ title, body });
                return;
            }

            // Tenta permissão direta no Tauri se ainda não verificado
            const granted = await isPermissionGranted();
            if (granted) {
                hasTauriPermission.current = true;
                sendNotification({ title, body });
                return;
            }
        } catch {
            // Fallback para Web Notification API
            if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
                new Notification(title, { body, icon: '/tauri.svg' });
            }
        }
    }, []);

    // Dispara notificação de nova mensagem direta
    const notifyNewDM = useCallback((senderName: string, text: string, isChatActive: boolean) => {
        playSound('message');

        // Se o usuário não estiver com o chat desse amigo aberto, exibe no SO
        if (!isChatActive) {
            notifyOS(`Nova mensagem de ${senderName}`, text.length > 80 ? `${text.slice(0, 80)}...` : text);
        }
    }, [playSound, notifyOS]);

    // Dispara notificação de entrada/saída de voz
    const notifyVoiceState = useCallback((action: 'joined' | 'left', _userName?: string) => {
        if (action === 'joined') {
            playSound('join');
        } else {
            playSound('leave');
        }
    }, [playSound]);

    return {
        playSound,
        notifyOS,
        notifyNewDM,
        notifyVoiceState,
    };
};
