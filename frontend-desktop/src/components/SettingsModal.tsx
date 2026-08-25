import { useState, useEffect, useRef } from 'react';
import {
    Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton,
    Button, VStack, Text, Select, FormControl, FormLabel, Tabs, TabList, TabPanels, Tab, TabPanel,
    Input, useToast, Avatar, Flex, Progress, Badge, Box, Switch, Divider, Tooltip,
    Slider, SliderTrack, SliderFilledTrack, SliderThumb
} from '@chakra-ui/react';
import { FiCamera } from 'react-icons/fi';
import { supabase } from '../supabaseClient';
import { useAutoUpdater } from '../useAutoUpdater';
import { getAvatarColor } from '../utils/avatarColors';
import { KuiAvatarIcon } from './KuiAvatar';
import { AvatarCropModal } from './AvatarCropModal';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onProfileUpdated?: () => void;
}

interface DeviceList {
    audioInputs: MediaDeviceInfo[];
    audioOutputs: MediaDeviceInfo[];
    videoInputs: MediaDeviceInfo[];
}

export const SettingsModal = ({ isOpen, onClose, onProfileUpdated }: SettingsModalProps) => {
    // Aba Dispositivos
    const [devices, setDevices] = useState<DeviceList>({ audioInputs: [], audioOutputs: [], videoInputs: [] });
    const [selectedAudioInput, setSelectedAudioInput] = useState(localStorage.getItem('cuicall-audio-input') || '');
    const [selectedAudioOutput, setSelectedAudioOutput] = useState(localStorage.getItem('cuicall-audio-output') || '');
    const [selectedVideoInput, setSelectedVideoInput] = useState(localStorage.getItem('cuicall-video-input') || '');
    const [pttEnabled, setPttEnabled] = useState(localStorage.getItem('cuicall-ptt-enabled') === 'true');
    const [pttShortcut, setPttShortcut] = useState(localStorage.getItem('cuicall-ptt-shortcut') || 'F8');
    const [noiseSuppressionEnabled, setNoiseSuppressionEnabled] = useState(
        localStorage.getItem('cuicall-noise-suppression') === null ? true : localStorage.getItem('cuicall-noise-suppression') === 'true'
    );
    const [noiseThreshold, setNoiseThreshold] = useState(
        localStorage.getItem('cuicall-noise-threshold') ? parseInt(localStorage.getItem('cuicall-noise-threshold')!, 10) : -48
    );

    // Aba Perfil
    const [userId, setUserId] = useState<string | null>(null);
    const [displayName, setDisplayName] = useState('');
    const [avatarUrl, setAvatarUrl] = useState('');
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [isSavingProfile, setIsSavingProfile] = useState(false);

    // Modal de Crop & Zoom
    const [isCropModalOpen, setIsCropModalOpen] = useState(false);
    const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const { checkForUpdates, isUpdating, progress } = useAutoUpdater(false);
    const toast = useToast();

    useEffect(() => {
        if (!isOpen) return;

        const loadDevices = async () => {
            try {
                const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
                tempStream.getTracks().forEach(t => t.stop());
            } catch {}

            const allDevices = await navigator.mediaDevices.enumerateDevices();
            setDevices({
                audioInputs: allDevices.filter(d => d.kind === 'audioinput'),
                audioOutputs: allDevices.filter(d => d.kind === 'audiooutput'),
                videoInputs: allDevices.filter(d => d.kind === 'videoinput'),
            });
        };

        const loadProfile = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                setUserId(user.id);
                const { data } = await supabase
                    .from('profiles')
                    .select('id, display_name, avatar_url, updated_at')
                    .eq('id', user.id)
                    .maybeSingle();
                
                if (data) {
                    setDisplayName(data.display_name || '');
                    setAvatarUrl(data.avatar_url || '');
                } else {
                    setDisplayName(user.email ? user.email.split('@')[0] : '');
                }
            }
        };

        loadDevices();
        loadProfile();
    }, [isOpen]);

    const handleSaveDevices = () => {
        localStorage.setItem('cuicall-audio-input', selectedAudioInput);
        localStorage.setItem('cuicall-audio-output', selectedAudioOutput);
        localStorage.setItem('cuicall-video-input', selectedVideoInput);
        localStorage.setItem('cuicall-ptt-enabled', pttEnabled ? 'true' : 'false');
        localStorage.setItem('cuicall-ptt-shortcut', pttShortcut);
        localStorage.setItem('cuicall-noise-suppression', noiseSuppressionEnabled ? 'true' : 'false');
        localStorage.setItem('cuicall-noise-threshold', String(noiseThreshold));

        // Dispara evento para hooks ativos
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('cuicall:pttConfigChanged', {
                detail: { pttEnabled, pttShortcut }
            }));
            window.dispatchEvent(new CustomEvent('cuicall:noiseConfigChanged', {
                detail: { noiseSuppressionEnabled, noiseThreshold }
            }));
        }

        toast({
            title: 'Configurações de áudio salvas',
            status: 'success',
            duration: 2000,
            isClosable: true,
            position: 'top',
        });
        onClose();
    };

    // Quando o usuário seleciona um arquivo pela janela do sistema operacional
    const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const objectUrl = URL.createObjectURL(file);
            setCropImageSrc(objectUrl);
            setIsCropModalOpen(true);
            e.target.value = ''; // Permite selecionar o mesmo arquivo novamente
        }
    };

    // Callback após confirmar o corte e zoom
    const handleCropComplete = (croppedBlob: Blob, previewUrl: string) => {
        const croppedFile = new File([croppedBlob], `avatar-${Date.now()}.jpg`, { type: 'image/jpeg' });
        setAvatarFile(croppedFile);
        setAvatarUrl(previewUrl);
    };

    const handleSaveProfile = async () => {
        setIsSavingProfile(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                toast({ title: 'Erro de autenticação', description: 'Usuário não conectado', status: 'error' });
                setIsSavingProfile(false);
                return;
            }

            let finalAvatarUrl = avatarUrl;
            
            if (avatarFile) {
                const fileName = `${user.id}-${Date.now()}.jpg`;
                const { error: uploadError } = await supabase.storage.from('images').upload(fileName, avatarFile, {
                    upsert: true,
                    contentType: 'image/jpeg'
                });
                
                if (uploadError) {
                    toast({ title: 'Erro no upload da imagem', description: uploadError.message, status: 'error' });
                    setIsSavingProfile(false);
                    return;
                }
                
                const { data } = supabase.storage.from('images').getPublicUrl(fileName);
                finalAvatarUrl = data.publicUrl;
                setAvatarUrl(data.publicUrl);
            }

            // Salva na tabela profiles respeitando exatamente o schema: id, display_name, avatar_url, updated_at
            const profilePayload = {
                id: user.id,
                display_name: displayName.trim(),
                avatar_url: finalAvatarUrl,
                updated_at: new Date().toISOString()
            };

            const { error: saveError } = await supabase
                .from('profiles')
                .upsert(profilePayload);

            if (saveError) {
                toast({ title: 'Erro ao salvar perfil', description: saveError.message, status: 'error' });
                setIsSavingProfile(false);
                return;
            }

            toast({ title: 'Perfil atualizado com sucesso!', status: 'success', duration: 2000 });
            setAvatarFile(null);
            if (onProfileUpdated) onProfileUpdated();
        } catch (err: any) {
            toast({ title: 'Erro inesperado', description: err.message || 'Falha ao salvar', status: 'error' });
        } finally {
            setIsSavingProfile(false);
        }
    };

    return (
        <>
            <Modal isOpen={isOpen} onClose={onClose} isCentered size="md">
                <ModalOverlay bg="blackAlpha.700" backdropFilter="blur(3px)" />
                <ModalContent bg="gray.800" color="white" borderColor="gray.700" borderWidth="1px">
                    <ModalHeader>Configurações</ModalHeader>
                    <ModalCloseButton />
                    <ModalBody pb={6}>
                        <Tabs variant="enclosed" colorScheme="blue">
                            <TabList mb="1em" borderBottomColor="gray.700">
                                <Tab _selected={{ color: 'white', bg: 'gray.700', borderColor: 'gray.700' }} color="gray.400">Perfil</Tab>
                                <Tab _selected={{ color: 'white', bg: 'gray.700', borderColor: 'gray.700' }} color="gray.400">Áudio e Vídeo</Tab>
                                <Tab _selected={{ color: 'white', bg: 'gray.700', borderColor: 'gray.700' }} color="gray.400">Atualizações</Tab>
                            </TabList>
                            
                            <TabPanels>
                                <TabPanel px={0}>
                                    <VStack spacing={5} align="stretch">
                                        {/* Input de arquivo invisível ativado ao clicar no avatar */}
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*"
                                            style={{ display: 'none' }}
                                            onChange={handleFileSelected}
                                        />

                                        <Flex align="center" gap={5} w="full">
                                            {/* Avatar circular com hover e clique para corte/upload */}
                                            <Tooltip label="Clique para alterar foto de perfil" hasArrow placement="top">
                                                <Box
                                                    position="relative"
                                                    cursor="pointer"
                                                    role="group"
                                                    onClick={() => fileInputRef.current?.click()}
                                                    borderRadius="full"
                                                    overflow="hidden"
                                                    w="88px"
                                                    h="88px"
                                                    minW="88px"
                                                    minH="88px"
                                                    boxShadow="0 4px 14px rgba(0,0,0,0.4)"
                                                    border="2px solid"
                                                    borderColor="gray.600"
                                                    transition="all 0.2s ease"
                                                    _hover={{
                                                        transform: 'scale(1.05)',
                                                        borderColor: 'blue.400',
                                                        boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.4), 0 6px 20px rgba(0,0,0,0.5)',
                                                    }}
                                                >
                                                    <Avatar
                                                        size="full"
                                                        name={displayName || 'Usuário'}
                                                        src={avatarUrl}
                                                        bg={getAvatarColor(userId)}
                                                        icon={<KuiAvatarIcon fill={getAvatarColor(userId)} />}
                                                    />

                                                    {/* Overlay animado no Hover */}
                                                    <Flex
                                                        position="absolute"
                                                        top={0}
                                                        left={0}
                                                        right={0}
                                                        bottom={0}
                                                        bg="rgba(0, 0, 0, 0.72)"
                                                        backdropFilter="blur(2px)"
                                                        opacity={0}
                                                        _groupHover={{ opacity: 1 }}
                                                        transition="opacity 0.2s ease"
                                                        align="center"
                                                        justify="center"
                                                        direction="column"
                                                        color="white"
                                                        gap={1}
                                                    >
                                                        <FiCamera size={22} />
                                                        <Text fontSize="10px" fontWeight="bold" textTransform="uppercase" letterSpacing="0.5px">
                                                            Alterar
                                                        </Text>
                                                    </Flex>
                                                </Box>
                                            </Tooltip>

                                            <VStack align="start" flex={1} spacing={2}>
                                                <FormControl>
                                                    <FormLabel fontSize="sm" color="gray.300" mb={1}>
                                                        Nome de Exibição
                                                    </FormLabel>
                                                    <Input 
                                                        value={displayName} 
                                                        onChange={(e) => setDisplayName(e.target.value)} 
                                                        bg="gray.900" 
                                                        borderColor="gray.700" 
                                                        _hover={{ borderColor: 'gray.600' }}
                                                        _focus={{ borderColor: 'blue.500', boxShadow: '0 0 0 1px #3182ce' }}
                                                        placeholder="Como você quer ser chamado"
                                                    />
                                                </FormControl>
                                                <Text fontSize="xs" color="gray.400">
                                                    Passe o mouse e clique na foto para trocar e recortar seu avatar.
                                                </Text>
                                            </VStack>
                                        </Flex>

                                        <Button colorScheme="blue" w="full" onClick={handleSaveProfile} isLoading={isSavingProfile} mt={2}>
                                            Salvar Perfil
                                        </Button>
                                    </VStack>
                                </TabPanel>

                                <TabPanel px={0}>
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

                                        <Divider borderColor="gray.700" my={1} />

                                        {/* Configuração de Supressão de Ruído e Noise Gate */}
                                        <Box p={3} borderRadius="md" bg="gray.900" border="1px solid" borderColor="gray.700" w="full">
                                            <Flex justify="space-between" align="center" mb={2}>
                                                <Box>
                                                    <Text fontSize="sm" fontWeight="bold" color="white">Supressão de Ruído & Noise Gate</Text>
                                                    <Text fontSize="xs" color="gray.400">
                                                        Filtra ruídos de fundo, cliques de teclado e vibrações cortando o sinal quando você não está falando.
                                                    </Text>
                                                </Box>
                                                <Switch
                                                    colorScheme="blue"
                                                    isChecked={noiseSuppressionEnabled}
                                                    onChange={(e) => setNoiseSuppressionEnabled(e.target.checked)}
                                                />
                                            </Flex>

                                            {noiseSuppressionEnabled && (
                                                <Box mt={3} pt={2} borderTop="1px dashed" borderColor="gray.800">
                                                    <Flex justify="space-between" align="center" mb={1}>
                                                        <Text fontSize="xs" color="gray.400">Sensibilidade do Noise Gate</Text>
                                                        <Text fontSize="xs" fontWeight="bold" color="blue.300">{noiseThreshold} dB</Text>
                                                    </Flex>
                                                    <Slider
                                                        min={-60}
                                                        max={-30}
                                                        step={1}
                                                        value={noiseThreshold}
                                                        onChange={(val) => setNoiseThreshold(val)}
                                                        colorScheme="blue"
                                                    >
                                                        <SliderTrack bg="gray.700">
                                                            <SliderFilledTrack />
                                                        </SliderTrack>
                                                        <SliderThumb boxSize={4} bg="blue.400" />
                                                    </Slider>
                                                    <Flex justify="space-between" mt={1}>
                                                        <Text fontSize="10px" color="gray.500">Mais sensível (-60 dB)</Text>
                                                        <Text fontSize="10px" color="gray.500">Mais agressivo (-30 dB)</Text>
                                                    </Flex>
                                                </Box>
                                            )}
                                        </Box>

                                        {/* Configuração de Push-to-Talk (PTT) */}
                                        <Box p={3} borderRadius="md" bg="gray.900" border="1px solid" borderColor="gray.700" w="full">
                                            <Flex justify="space-between" align="center" mb={2}>
                                                <Box>
                                                    <Text fontSize="sm" fontWeight="bold" color="white">Modo Push-to-Talk (Aperte para Falar)</Text>
                                                    <Text fontSize="xs" color="gray.400">
                                                        O microfone só é transmitido enquanto a tecla de atalho estiver pressionada.
                                                    </Text>
                                                </Box>
                                                <Switch
                                                    colorScheme="blue"
                                                    isChecked={pttEnabled}
                                                    onChange={(e) => setPttEnabled(e.target.checked)}
                                                />
                                            </Flex>

                                            {pttEnabled && (
                                                <FormControl mt={3}>
                                                    <FormLabel fontSize="xs" color="gray.400">Tecla de Atalho (Global / Sistema)</FormLabel>
                                                    <Select
                                                        bg="gray.800"
                                                        borderColor="gray.600"
                                                        size="sm"
                                                        value={pttShortcut}
                                                        onChange={(e) => setPttShortcut(e.target.value)}
                                                    >
                                                        <option value="F8" style={{ background: '#1a202c' }}>F8 (Recomendado)</option>
                                                        <option value="F9" style={{ background: '#1a202c' }}>F9</option>
                                                        <option value="F10" style={{ background: '#1a202c' }}>F10</option>
                                                        <option value="Alt" style={{ background: '#1a202c' }}>Alt</option>
                                                        <option value="Control" style={{ background: '#1a202c' }}>Control / Ctrl</option>
                                                        <option value="Shift" style={{ background: '#1a202c' }}>Shift</option>
                                                        <option value="Space" style={{ background: '#1a202c' }}>Barra de Espaço</option>
                                                        <option value="Mouse4" style={{ background: '#1a202c' }}>Mouse 4 (Lateral)</option>
                                                    </Select>
                                                </FormControl>
                                            )}
                                        </Box>

                                        <Text fontSize="xs" color="gray.500">
                                            As configurações de áudio, vídeo, filtro de ruído e Push-to-Talk são salvas e sincronizadas automaticamente.
                                        </Text>
                                        <Button colorScheme="blue" w="full" onClick={handleSaveDevices}>
                                            Salvar Configurações de Áudio
                                        </Button>
                                    </VStack>
                                </TabPanel>

                                <TabPanel px={0}>
                                    <VStack spacing={5} align="stretch">
                                        <Box p={4} borderRadius="lg" bg="gray.900" border="1px solid" borderColor="gray.700">
                                            <Flex justify="space-between" align="center" mb={2}>
                                                <Text fontSize="sm" fontWeight="bold" color="white">CuiCall Desktop</Text>
                                                <Badge colorScheme="blue" borderRadius="full" px={2}>v0.3.4</Badge>
                                            </Flex>
                                            <Text fontSize="xs" color="gray.400">
                                                O CuiCall verifica e instala atualizações automaticamente sempre que uma nova versão é lançada.
                                            </Text>
                                        </Box>

                                        {isUpdating && progress && (
                                            <Box>
                                                <Flex justify="space-between" fontSize="xs" color="gray.400" mb={1}>
                                                    <Text>Baixando atualização...</Text>
                                                    <Text>{progress.percentage}%</Text>
                                                </Flex>
                                                <Progress value={progress.percentage} size="xs" colorScheme="blue" borderRadius="full" />
                                            </Box>
                                        )}

                                        <Button
                                            colorScheme="purple"
                                            w="full"
                                            onClick={checkForUpdates}
                                            isLoading={isUpdating}
                                            loadingText="Baixando e instalando..."
                                        >
                                            Verificar Atualizações Agora
                                        </Button>
                                    </VStack>
                                </TabPanel>
                            </TabPanels>
                        </Tabs>
                    </ModalBody>
                </ModalContent>
            </Modal>

            {/* Modal de Recorte e Zoom do Avatar */}
            <AvatarCropModal
                isOpen={isCropModalOpen}
                onClose={() => {
                    setIsCropModalOpen(false);
                    setCropImageSrc(null);
                }}
                imageSrc={cropImageSrc}
                onCropComplete={handleCropComplete}
            />
        </>
    );
};
