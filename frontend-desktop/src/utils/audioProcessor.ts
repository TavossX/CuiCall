/**
 * Módulo de Processamento de Áudio Nativo via Web Audio API.
 * Implementa Filtro Passa-Alta (High-Pass Filter 85Hz) e Noise Gate Dinâmico
 * com detecção de decibéis (dBFS) e transição suave de ganho (Attack/Release)
 * para eliminar ruídos de fundo, cliques de teclado e vibrações antes do envio P2P.
 */

export interface AudioProcessorOptions {
    thresholdDb?: number;      // Limiar de corte em dB (padrão: -48 dB)
    holdTimeMs?: number;       // Tempo de retenção do portão aberto (padrão: 120ms)
    highPassFrequency?: number;// Frequência de corte do filtro passa-alta (padrão: 85Hz)
    enabled?: boolean;         // Se o filtro está ativado
}

export interface ProcessedAudioResult {
    processedStream: MediaStream;
    setNoiseSuppressionEnabled: (enabled: boolean) => void;
    setThresholdDb: (dB: number) => void;
    isGateOpen: () => boolean;
    getDecibels: () => number;
    close: () => void;
}

export function createProcessedAudioStream(
    rawStream: MediaStream,
    options?: AudioProcessorOptions
): ProcessedAudioResult {
    const rawAudioTrack = rawStream.getAudioTracks()[0];
    if (!rawAudioTrack) {
        return {
            processedStream: rawStream,
            setNoiseSuppressionEnabled: () => {},
            setThresholdDb: () => {},
            isGateOpen: () => true,
            getDecibels: () => -100,
            close: () => {},
        };
    }

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioContextClass();

    // 1. Fonte de Áudio do Microfone
    const sourceStream = new MediaStream([rawAudioTrack]);
    const sourceNode = audioCtx.createMediaStreamSource(sourceStream);

    // 2. Filtro Passa-Alta (High-Pass a 85Hz para eliminar estalos, vibrações de mesa e zumbidos)
    const highPassFilter = audioCtx.createBiquadFilter();
    highPassFilter.type = 'highpass';
    highPassFilter.frequency.value = options?.highPassFrequency ?? 85;
    highPassFilter.Q.value = 0.707;

    // 3. Analisador de Decibéis em Tempo Real
    const analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 512;
    analyserNode.smoothingTimeConstant = 0.2;

    // 4. Ganho Dinâmico (Noise Gate)
    const gateGainNode = audioCtx.createGain();
    gateGainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);

    // 5. Destino do Stream Processado
    const destinationNode = audioCtx.createMediaStreamDestination();

    // Encadeamento do grafo de áudio:
    // source -> highPassFilter -> analyserNode -> gateGainNode -> destinationNode
    sourceNode.connect(highPassFilter);
    highPassFilter.connect(analyserNode);
    analyserNode.connect(gateGainNode);
    gateGainNode.connect(destinationNode);

    // Estado interno do Noise Gate
    let isSuppressionEnabled = options?.enabled ?? true;
    let thresholdDb = options?.thresholdDb ?? -48;
    const holdTimeMs = options?.holdTimeMs ?? 120;

    let currentDb = -100;
    let gateIsOpen = true;
    let lastVoiceDetectedTime = Date.now();
    let animationFrameId: number | null = null;
    const dataArray = new Float32Array(analyserNode.fftSize);

    // Loop de monitoramento do volume em dBFS e abertura/fechamento do Noise Gate
    const processGateLoop = () => {
        if (audioCtx.state === 'closed') return;

        analyserNode.getFloatTimeDomainData(dataArray);

        // Calcula o valor eficaz RMS (Root Mean Square)
        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sumSquares += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sumSquares / dataArray.length);

        // Converte RMS para dBFS
        currentDb = rms > 0 ? 20 * Math.log10(rms) : -100;

        const now = Date.now();

        if (!isSuppressionEnabled) {
            // Bypass mode: portão 100% aberto
            gateGainNode.gain.setTargetAtTime(1.0, audioCtx.currentTime, 0.01);
            gateIsOpen = true;
        } else {
            if (currentDb >= thresholdDb) {
                // Voz detectada: abre o portão com ataque rápido (10ms)
                lastVoiceDetectedTime = now;
                gateGainNode.gain.setTargetAtTime(1.0, audioCtx.currentTime, 0.01);
                gateIsOpen = true;
            } else {
                // Abaixo do limiar: aguarda o tempo de retenção (holdTime) antes de fechar suavemente (35ms)
                if (now - lastVoiceDetectedTime > holdTimeMs) {
                    gateGainNode.gain.setTargetAtTime(0.0, audioCtx.currentTime, 0.035);
                    gateIsOpen = false;
                }
            }
        }

        animationFrameId = requestAnimationFrame(processGateLoop);
    };

    // Inicia o processamento caso o contexto esteja rodando
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => {
            animationFrameId = requestAnimationFrame(processGateLoop);
        });
    } else {
        animationFrameId = requestAnimationFrame(processGateLoop);
    }

    // Cria o stream final unindo a trilha de áudio processada com quaisquer trilhas de vídeo existentes
    const processedAudioTrack = destinationNode.stream.getAudioTracks()[0];
    const finalStream = new MediaStream([
        ...rawStream.getVideoTracks(),
        processedAudioTrack,
    ]);

    const close = () => {
        if (animationFrameId !== null) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        try {
            sourceNode.disconnect();
            highPassFilter.disconnect();
            analyserNode.disconnect();
            gateGainNode.disconnect();
            audioCtx.close();
        } catch (e) {
            console.debug("[AudioProcessor] Cleanup:", e);
        }
    };

    return {
        processedStream: finalStream,
        setNoiseSuppressionEnabled: (enabled: boolean) => {
            isSuppressionEnabled = enabled;
        },
        setThresholdDb: (dB: number) => {
            thresholdDb = dB;
        },
        isGateOpen: () => gateIsOpen,
        getDecibels: () => currentDb,
        close,
    };
}
