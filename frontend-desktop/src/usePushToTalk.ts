import { useState, useEffect, useRef, useCallback } from 'react';
import { register, unregister, isRegistered } from '@tauri-apps/plugin-global-shortcut';

export interface PTTOptions {
    defaultShortcut?: string; // Ex: 'CapsLock', 'F13', 'Alt+Space', 'Control+Shift+Space'
    releaseDelayMs?: number;  // Tempo de buffer para não cortar o final da fala (ex: 150ms)
}

/**
 * Hook de Push-to-Talk (PTT) Global para Tauri v2 e React.
 * Gerencia a escuta de atalhos globais do sistema operacional (mesmo em segundo plano/jogos)
 * e fornece o estado `isPTTActive` em tempo real para sincronização com WebRTC.
 */
export const usePushToTalk = (options?: PTTOptions) => {
    const [isPTTEnabled, setIsPTTEnabled] = useState<boolean>(() => {
        return localStorage.getItem('cuicall-ptt-enabled') === 'true';
    });

    const [pttShortcut, setPttShortcut] = useState<string>(() => {
        return localStorage.getItem('cuicall-ptt-shortcut') || options?.defaultShortcut || 'CapsLock';
    });

    const [releaseDelay, setReleaseDelay] = useState<number>(() => {
        const stored = localStorage.getItem('cuicall-ptt-delay');
        return stored ? parseInt(stored, 10) : (options?.releaseDelayMs ?? 150);
    });

    const [isPTTActive, setIsPTTActive] = useState<boolean>(false);
    const releaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isPTTActiveRef = useRef<boolean>(false);

    // Atualiza referência síncrona
    useEffect(() => {
        isPTTActiveRef.current = isPTTActive;
    }, [isPTTActive]);

    // Escuta alterações de configuração feitas em outros modais (ex: SettingsModal)
    useEffect(() => {
        const handleConfigChanged = (e: any) => {
            if (e.detail) {
                if (typeof e.detail.pttEnabled === 'boolean') {
                    setIsPTTEnabled(e.detail.pttEnabled);
                }
                if (e.detail.pttShortcut) {
                    setPttShortcut(e.detail.pttShortcut);
                }
                if (typeof e.detail.releaseDelay === 'number') {
                    setReleaseDelay(e.detail.releaseDelay);
                }
            }
        };

        window.addEventListener('cuicall:pttConfigChanged', handleConfigChanged);
        return () => {
            window.removeEventListener('cuicall:pttConfigChanged', handleConfigChanged);
        };
    }, []);

    // Salva preferências no localStorage
    const updatePTTEnabled = useCallback((enabled: boolean) => {
        setIsPTTEnabled(enabled);
        localStorage.setItem('cuicall-ptt-enabled', String(enabled));
        if (!enabled) {
            setIsPTTActive(false);
            if (releaseTimeoutRef.current) clearTimeout(releaseTimeoutRef.current);
        }
    }, []);

    const updatePTTShortcut = useCallback((shortcut: string) => {
        setPttShortcut(shortcut);
        localStorage.setItem('cuicall-ptt-shortcut', shortcut);
    }, []);

    const updateReleaseDelay = useCallback((delay: number) => {
        setReleaseDelay(delay);
        localStorage.setItem('cuicall-ptt-delay', String(delay));
    }, []);

    // Handlers de ativação e desativação com buffer de liberação
    const handlePTTPressed = useCallback(() => {
        if (releaseTimeoutRef.current) {
            clearTimeout(releaseTimeoutRef.current);
            releaseTimeoutRef.current = null;
        }
        if (!isPTTActiveRef.current) {
            setIsPTTActive(true);
        }
    }, []);

    const handlePTTReleased = useCallback(() => {
        if (releaseTimeoutRef.current) {
            clearTimeout(releaseTimeoutRef.current);
        }
        // Aplica o buffer de liberação para não cortar a última sílaba falada
        releaseTimeoutRef.current = setTimeout(() => {
            setIsPTTActive(false);
            releaseTimeoutRef.current = null;
        }, releaseDelay);
    }, [releaseDelay]);

    // Registra o atalho global no Tauri v2
    useEffect(() => {
        if (!isPTTEnabled || !pttShortcut) {
            setIsPTTActive(false);
            return;
        }

        let isMounted = true;
        let registeredShortcut = pttShortcut;

        const setupGlobalShortcut = async () => {
            try {
                // Remove registro anterior caso exista
                const alreadyRegistered = await isRegistered(registeredShortcut);
                if (alreadyRegistered) {
                    await unregister(registeredShortcut);
                }

                if (!isMounted) return;

                // Registra o atalho global no Tauri v2
                await register(registeredShortcut, (event) => {
                    if (event.state === 'Pressed') {
                        handlePTTPressed();
                    } else if (event.state === 'Released') {
                        handlePTTReleased();
                    }
                });
                console.log(`[PTT] Atalho global registrado com sucesso: ${registeredShortcut}`);
            } catch (err) {
                console.warn(`[PTT] Aviso ao registrar atalho global '${registeredShortcut}':`, err);
            }
        };

        setupGlobalShortcut();

        // Fallback para eventos de janela durante desenvolvimento web ou foco direto
        const handleWindowKeyDown = (e: KeyboardEvent) => {
            if (e.code === registeredShortcut || e.key === registeredShortcut) {
                if (!e.repeat) handlePTTPressed();
            }
        };

        const handleWindowKeyUp = (e: KeyboardEvent) => {
            if (e.code === registeredShortcut || e.key === registeredShortcut) {
                handlePTTReleased();
            }
        };

        window.addEventListener('keydown', handleWindowKeyDown);
        window.addEventListener('keyup', handleWindowKeyUp);

        return () => {
            isMounted = false;
            window.removeEventListener('keydown', handleWindowKeyDown);
            window.removeEventListener('keyup', handleWindowKeyUp);

            unregister(registeredShortcut).catch((err) => {
                console.debug(`[PTT] Cleanup de atalho global '${registeredShortcut}':`, err);
            });
        };
    }, [isPTTEnabled, pttShortcut, handlePTTPressed, handlePTTReleased]);

    return {
        isPTTEnabled,
        isPTTActive,
        pttShortcut,
        releaseDelay,
        updatePTTEnabled,
        updatePTTShortcut,
        updateReleaseDelay,
    };
};
