import { useEffect, useCallback, useRef, useState } from 'react';
import { useToast } from '@chakra-ui/react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export interface UpdateProgress {
    totalBytes: number;
    downloadedBytes: number;
    percentage: number;
}

export function useAutoUpdater(autoCheck: boolean = true) {
    const toast = useToast();
    const isCheckingRef = useRef(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [progress, setProgress] = useState<UpdateProgress | null>(null);

    const checkForUpdates = useCallback(async (isManual: boolean = false) => {
        if (isCheckingRef.current) return;
        isCheckingRef.current = true;

        try {
            console.log('[AutoUpdater] Verificando se há atualizações disponíveis...');
            const update = await check();

            if (update) {
                console.log(`[AutoUpdater] Nova versão encontrada: v${update.version}`);
                setIsUpdating(true);

                toast({
                    id: 'update-downloading',
                    title: 'Nova versão disponível!',
                    description: `Baixando versão ${update.version}... O aplicativo será reiniciado ao concluir.`,
                    status: 'info',
                    duration: null, // Mantém na tela enquanto faz o download
                    isClosable: false,
                    position: 'top-right',
                });

                let totalLength = 0;
                let downloadedLength = 0;

                await update.downloadAndInstall((event) => {
                    switch (event.event) {
                        case 'Started':
                            totalLength = event.data.contentLength || 0;
                            setProgress({ totalBytes: totalLength, downloadedBytes: 0, percentage: 0 });
                            console.log(`[AutoUpdater] Download iniciado. Tamanho total: ${totalLength} bytes`);
                            break;
                        case 'Progress':
                            downloadedLength += event.data.chunkLength;
                            const percentage = totalLength > 0 ? Math.round((downloadedLength / totalLength) * 100) : 0;
                            setProgress({ totalBytes: totalLength, downloadedBytes: downloadedLength, percentage });
                            console.log(`[AutoUpdater] Progresso: ${downloadedLength}/${totalLength} (${percentage}%)`);
                            break;
                        case 'Finished':
                            console.log('[AutoUpdater] Download e instalação concluídos com sucesso!');
                            break;
                    }
                });

                // Fecha o toast de download
                toast.close('update-downloading');

                toast({
                    title: 'Atualização concluída!',
                    description: 'Reiniciando o CuiCall agora...',
                    status: 'success',
                    duration: 3000,
                    isClosable: false,
                    position: 'top-right',
                });

                // Reinicia a aplicação na nova versão
                await relaunch();
            } else if (isManual) {
                toast({
                    title: 'Tudo atualizado!',
                    description: 'Você já está usando a versão mais recente do CuiCall.',
                    status: 'success',
                    duration: 3000,
                    isClosable: true,
                    position: 'top-right',
                });
            }
        } catch (error: any) {
            console.warn('[AutoUpdater] Não foi possível verificar ou aplicar atualização:', error);
            toast.close('update-downloading');

            if (isManual) {
                toast({
                    title: 'Erro na verificação',
                    description: error?.message || 'Não foi possível conectar ao servidor de atualizações.',
                    status: 'error',
                    duration: 4000,
                    isClosable: true,
                    position: 'top-right',
                });
            }
        } finally {
            isCheckingRef.current = false;
            setIsUpdating(false);
        }
    }, [toast]);

    // Executa a verificação silenciosa na inicialização do aplicativo se autoCheck for true
    useEffect(() => {
        if (autoCheck) {
            checkForUpdates(false);
        }
    }, [autoCheck, checkForUpdates]);

    return {
        checkForUpdates: () => checkForUpdates(true),
        isUpdating,
        progress,
    };
}
