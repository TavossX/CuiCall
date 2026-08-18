import { useState, useEffect } from 'react';
import {
    Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton,
    Button, VStack, Text, Select, FormControl, FormLabel,
} from '@chakra-ui/react';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface DeviceList {
    audioInputs: MediaDeviceInfo[];
    audioOutputs: MediaDeviceInfo[];
    videoInputs: MediaDeviceInfo[];
}

export const SettingsModal = ({ isOpen, onClose }: SettingsModalProps) => {
    const [devices, setDevices] = useState<DeviceList>({ audioInputs: [], audioOutputs: [], videoInputs: [] });
    const [selectedAudioInput, setSelectedAudioInput] = useState(localStorage.getItem('cuicall-audio-input') || '');
    const [selectedAudioOutput, setSelectedAudioOutput] = useState(localStorage.getItem('cuicall-audio-output') || '');
    const [selectedVideoInput, setSelectedVideoInput] = useState(localStorage.getItem('cuicall-video-input') || '');

    useEffect(() => {
        if (!isOpen) return;

        const loadDevices = async () => {
            // Request permission first so labels are populated
            try {
                const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
                tempStream.getTracks().forEach(t => t.stop());
            } catch {
                // Permission denied — we'll still try to enumerate
            }

            const allDevices = await navigator.mediaDevices.enumerateDevices();
            setDevices({
                audioInputs: allDevices.filter(d => d.kind === 'audioinput'),
                audioOutputs: allDevices.filter(d => d.kind === 'audiooutput'),
                videoInputs: allDevices.filter(d => d.kind === 'videoinput'),
            });
        };

        loadDevices();
    }, [isOpen]);

    const handleSave = () => {
        localStorage.setItem('cuicall-audio-input', selectedAudioInput);
        localStorage.setItem('cuicall-audio-output', selectedAudioOutput);
        localStorage.setItem('cuicall-video-input', selectedVideoInput);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} isCentered size="md">
            <ModalOverlay bg="blackAlpha.700" />
            <ModalContent bg="gray.800" color="white" borderColor="gray.700" borderWidth="1px">
                <ModalHeader>Configurações de Dispositivos</ModalHeader>
                <ModalCloseButton />
                <ModalBody>
                    <VStack spacing={5}>
                        <FormControl>
                            <FormLabel fontSize="sm" color="gray.400">Entrada de Áudio (Microfone)</FormLabel>
                            <Select
                                bg="gray.900"
                                borderColor="gray.700"
                                value={selectedAudioInput}
                                onChange={(e) => setSelectedAudioInput(e.target.value)}
                                placeholder="Padrão do sistema"
                            >
                                {devices.audioInputs.map(d => (
                                    <option key={d.deviceId} value={d.deviceId} style={{ background: '#1a202c' }}>
                                        {d.label || `Microfone ${d.deviceId.slice(0, 8)}`}
                                    </option>
                                ))}
                            </Select>
                        </FormControl>

                        <FormControl>
                            <FormLabel fontSize="sm" color="gray.400">Saída de Áudio (Alto-falante)</FormLabel>
                            <Select
                                bg="gray.900"
                                borderColor="gray.700"
                                value={selectedAudioOutput}
                                onChange={(e) => setSelectedAudioOutput(e.target.value)}
                                placeholder="Padrão do sistema"
                            >
                                {devices.audioOutputs.map(d => (
                                    <option key={d.deviceId} value={d.deviceId} style={{ background: '#1a202c' }}>
                                        {d.label || `Alto-falante ${d.deviceId.slice(0, 8)}`}
                                    </option>
                                ))}
                            </Select>
                        </FormControl>

                        <FormControl>
                            <FormLabel fontSize="sm" color="gray.400">Entrada de Vídeo (Câmera)</FormLabel>
                            <Select
                                bg="gray.900"
                                borderColor="gray.700"
                                value={selectedVideoInput}
                                onChange={(e) => setSelectedVideoInput(e.target.value)}
                                placeholder="Padrão do sistema"
                            >
                                {devices.videoInputs.map(d => (
                                    <option key={d.deviceId} value={d.deviceId} style={{ background: '#1a202c' }}>
                                        {d.label || `Câmera ${d.deviceId.slice(0, 8)}`}
                                    </option>
                                ))}
                            </Select>
                        </FormControl>

                        <Text fontSize="xs" color="gray.500">
                            As configurações serão aplicadas na próxima vez que você entrar em um canal de voz.
                        </Text>
                    </VStack>
                </ModalBody>
                <ModalFooter>
                    <Button variant="ghost" color="gray.400" mr={3} onClick={onClose}>Cancelar</Button>
                    <Button colorScheme="blue" onClick={handleSave}>Salvar</Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};
