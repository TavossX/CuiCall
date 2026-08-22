import { useState, useEffect } from 'react';
import {
    Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton,
    Button, VStack, Text, Select, FormControl, FormLabel, Tabs, TabList, TabPanels, Tab, TabPanel,
    Input, useToast, Avatar, Flex, Progress, Badge, Box, Switch, Divider
} from '@chakra-ui/react';
import { supabase } from '../supabaseClient';
import { useAutoUpdater } from '../useAutoUpdater';
import { getAvatarColor } from '../utils/avatarColors';
import { KuiAvatarIcon } from './KuiAvatar';

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

    // Aba Perfil
    const [userId, setUserId] = useState<string | null>(null);
    const [displayName, setDisplayName] = useState('');
    const [avatarUrl, setAvatarUrl] = useState('');
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [isSavingProfile, setIsSavingProfile] = useState(false);
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
                    .select('*')
                    .eq('id', user.id)
                    .maybeSingle();
                
                if (data) {
                    setDisplayName(data.username || (data as any).display_name || '');
                    setAvatarUrl(data.avatar_url || '');
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

        // Dispara evento para hooks ativos
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('cuicall:pttConfigChanged', {
                detail: { pttEnabled, pttShortcut }
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

    const handleSaveProfile = async () => {
        setIsSavingProfile(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                let finalAvatarUrl = avatarUrl;
                
                if (avatarFile) {
                    const fileExt = avatarFile.name.split('.').pop();
                    const fileName = `${user.id}-${Date.now()}.${fileExt}`;
                    const { error: uploadError } = await supabase.storage.from('images').upload(fileName, avatarFile, {
                        upsert: true
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

                // Tenta update primeiro (respeita policy for update)
                const { error: updateError, data: updateData } = await supabase
                    .from('profiles')
                    .update({
                        username: displayName.trim(),
                        avatar_url: finalAvatarUrl,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', user.id)
                    .select();

                // Se a linha ainda não existia, tenta upsert completo com email
                if (updateError || !updateData || updateData.length === 0) {
                    const { error: upsertError } = await supabase
                        .from('profiles')
                        .upsert({
                            id: user.id,
                            username: displayName.trim(),
                            avatar_url: finalAvatarUrl,
                            updated_at: new Date().toISOString()
                        });

                    if (upsertError) {
                        toast({ title: 'Erro ao salvar perfil', description: upsertError.message, status: 'error' });
                        setIsSavingProfile(false);
                        return;
                    }
                }

                toast({ title: 'Perfil atualizado com sucesso!', status: 'success', duration: 2000 });
                setAvatarFile(null);
                if (onProfileUpdated) onProfileUpdated();
            }
        } catch (err: any) {
            toast({ title: 'Erro inesperado', description: err.message || 'Falha ao salvar', status: 'error' });
        } finally {
            setIsSavingProfile(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} isCentered size="md">
            <ModalOverlay bg="blackAlpha.700" />
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
                                <VStack spacing={5}>
                                    <Flex align="center" gap={4} w="full">
                                        <Avatar
                                            size="xl"
                                            name={displayName || 'Usuário'}
                                            src={avatarUrl}
                                            bg={getAvatarColor(userId)}
                                            icon={<KuiAvatarIcon fill={getAvatarColor(userId)} />}
                                        />
                                        <VStack align="start" flex={1}>
                                            <FormControl>
                                                <FormLabel fontSize="sm" color="gray.400">Nome de Exibição</FormLabel>
                                                <Input 
                                                    value={displayName} 
                                                    onChange={(e) => setDisplayName(e.target.value)} 
                                                    bg="gray.900" borderColor="gray.700" 
                                                    placeholder="Como você quer ser chamado"
                                                />
                                            </FormControl>
                                        </VStack>
                                    </Flex>
                                    <FormControl>
                                        <FormLabel fontSize="sm" color="gray.400">Foto de Perfil (Avatar)</FormLabel>
                                        <Input 
                                            type="file"
                                            accept="image/*"
                                            onChange={(e) => {
                                                if (e.target.files && e.target.files[0]) {
                                                    setAvatarFile(e.target.files[0]);
                                                }
                                            }} 
                                            bg="gray.900" borderColor="gray.700" 
                                            pt={1}
                                        />
                                    </FormControl>
                                    <Button colorScheme="blue" w="full" onClick={handleSaveProfile} isLoading={isSavingProfile}>
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
                                        As configurações de áudio, vídeo e Push-to-Talk são salvas e sincronizadas automaticamente.
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
                                            <Badge colorScheme="blue" borderRadius="full" px={2}>v0.1.0</Badge>
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
    );
};
