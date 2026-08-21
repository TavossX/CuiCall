import { useState, useEffect, useCallback, useRef } from 'react';

export interface PushToTalkState {
    isPttActive: boolean;
    pttEnabled: boolean;
    pttShortcut: string;
    setPttEnabled: (enabled: boolean) => void;
    setPttShortcut: (shortcut: string) => void;
}

/**
 * Hook de Push-to-Talk (PTT) com suporte a atalhos globais de sistema (Tauri)
 * e eventos nativos de teclado do navegador/webview.
 */
export function usePushToTalk(): PushToTalkState {
    const [pttEnabled, setPttEnabledState] = useState<boolean>(() => {
        return localStorage.getItem('cuicall-ptt-enabled') === 'true';
    });

    const [pttShortcut, setPttShortcutState] = useState<string>(() => {
        return localStorage.getItem('cuicall-ptt-shortcut') || 'F8';
    });

    const [isPttActive, setIsPttActive] = useState<boolean>(false);
    const isPttActiveRef = useRef(false);
    isPttActiveRef.current = isPttActive;

    const setPttEnabled = useCallback((enabled: boolean) => {
        setPttEnabledState(enabled);
        localStorage.setItem('cuicall-ptt-enabled', enabled ? 'true' : 'false');
        if (!enabled) {
            setIsPttActive(false);
        }
    }, []);

    const setPttShortcut = useCallback((shortcut: string) => {
        setPttShortcutState(shortcut);
        localStorage.setItem('cuicall-ptt-shortcut', shortcut);
    }, []);

    // Sincroniza quando alterado pelo modal de configurações
    useEffect(() => {
        const handleConfigChange = (e: any) => {
            if (e.detail?.pttEnabled !== undefined) {
                setPttEnabledState(e.detail.pttEnabled);
            }
            if (e.detail?.pttShortcut) {
                setPttShortcutState(e.detail.pttShortcut);
            }
        };

        window.addEventListener('cuicall:pttConfigChanged', handleConfigChange);
        return () => window.removeEventListener('cuicall:pttConfigChanged', handleConfigChange);
    }, []);

    // ── 1. Integração com Tauri Global Shortcut ──
    useEffect(() => {
        if (!pttEnabled || !pttShortcut) {
            setIsPttActive(false);
            return;
        }

        let isRegistered = false;
        let unregisterFn: (() => Promise<void>) | null = null;

        const setupGlobalShortcut = async () => {
            try {
                const { register, unregister, isRegistered: checkRegistered } = await import('@tauri-apps/plugin-global-shortcut');

                // Se já estiver registrado, desregistra antes
                const alreadyRegistered = await checkRegistered(pttShortcut);
                if (alreadyRegistered) {
                    await unregister(pttShortcut);
                }

                await register(pttShortcut, (event) => {
                    if (event.state === 'Pressed') {
                        setIsPttActive(true);
                    } else if (event.state === 'Released') {
                        setIsPttActive(false);
                    }
                });

                isRegistered = true;
                unregisterFn = async () => {
                    try {
                        await unregister(pttShortcut);
                    } catch (e) {
                        console.warn('[PTT] Erro ao desregistrar atalho global:', e);
                    }
                };
                console.log(`[PTT 🎙️] Atalho global Tauri "${pttShortcut}" registrado com sucesso.`);
            } catch (err) {
                console.warn('[PTT] Tauri Global Shortcut não disponível (modo web ou erro de permissão):', err);
            }
        };

        setupGlobalShortcut();

        return () => {
            if (isRegistered && unregisterFn) {
                unregisterFn();
            }
        };
    }, [pttEnabled, pttShortcut]);

    // ── 2. Fallback / Listener Local no DOM (captura imediata enquanto janela está em foco) ──
    useEffect(() => {
        if (!pttEnabled) {
            setIsPttActive(false);
            return;
        }

        const normalizedTarget = pttShortcut.trim().toUpperCase();

        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignora se o foco estiver em um input de texto ou textarea
            const target = e.target as HTMLElement;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
                return;
            }

            const keyName = e.key.toUpperCase();
            const codeName = e.code.toUpperCase();

            const isMatch =
                keyName === normalizedTarget ||
                codeName === normalizedTarget ||
                (normalizedTarget === 'ALT' && e.altKey) ||
                (normalizedTarget === 'CONTROL' && e.ctrlKey) ||
                (normalizedTarget === 'SHIFT' && e.shiftKey) ||
                (normalizedTarget === 'SPACE' && e.code === 'Space');

            if (isMatch) {
                if (!e.repeat) {
                    setIsPttActive(true);
                }
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            const keyName = e.key.toUpperCase();
            const codeName = e.code.toUpperCase();

            const isMatch =
                keyName === normalizedTarget ||
                codeName === normalizedTarget ||
                (normalizedTarget === 'ALT' && !e.altKey) ||
                (normalizedTarget === 'CONTROL' && !e.ctrlKey) ||
                (normalizedTarget === 'SHIFT' && !e.shiftKey) ||
                (normalizedTarget === 'SPACE' && e.code === 'Space');

            if (isMatch) {
                setIsPttActive(false);
            }
        };

        const handleWindowBlur = () => {
            // Se a janela perder foco e não houver atalho global, muta por segurança
            setIsPttActive(false);
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', handleWindowBlur);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', handleWindowBlur);
        };
    }, [pttEnabled, pttShortcut]);

    return {
        isPttActive,
        pttEnabled,
        pttShortcut,
        setPttEnabled,
        setPttShortcut,
    };
}
