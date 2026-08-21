import { useState, useEffect } from 'react';
import {
    Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton,
    Button, VStack, Text, Select, FormControl, FormLabel, Tabs, TabList, TabPanels, Tab, TabPanel, Input, useToast, Avatar, Flex, Progress, Badge, Box
} from '@chakra-ui/react';
import { supabase } from '../supabaseClient';
import { useAutoUpdater } from '../useAutoUpdater';

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

    // Aba Perfil
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
                const { data } = await supabase
                    .from('profiles')
                    .select('display_name, avatar_url')
                    .eq('id', user.id)
                    .single();
                
                if (data) {
                    setDisplayName(data.display_name || '');
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
        toast({
            title: 'Dispositivos salvos',
            status: 'success',
            duration: 2000,
            isClosable: true,
            position: 'top',
        });
        onClose();
    };

    const handleSaveProfile = async () => {
        setIsSavingProfile(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            let finalAvatarUrl = avatarUrl;
            
            if (avatarFile) {
                const fileExt = avatarFile.name.split('.').pop();
                const fileName = `${Date.now()}.${fileExt}`;
                const { error: uploadError } = await supabase.storage.from('images').upload(fileName, avatarFile);
                
                if (uploadError) {
                    toast({ title: 'Erro no upload da imagem', description: uploadError.message, status: 'error' });
                    setIsSavingProfile(false);
                    return;
                }
                
                const { data } = supabase.storage.from('images').getPublicUrl(fileName);
                finalAvatarUrl = data.publicUrl;
                setAvatarUrl(data.publicUrl);
            }

            const { error } = await supabase
                .from('profiles')
                .upsert({
                    id: user.id,
                    display_name: displayName,
                    avatar_url: finalAvatarUrl,
                    updated_at: new Date()
                });
            
            if (error) {
                toast({ title: 'Erro ao salvar perfil', description: error.message, status: 'error' });
            } else {
                toast({ title: 'Perfil atualizado com sucesso', status: 'success', duration: 2000 });
                setAvatarFile(null); // Reset the selected file
                if (onProfileUpdated) onProfileUpdated();
            }
        }
        setIsSavingProfile(false);
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
                                        <Avatar size="xl" name={displayName || 'Usuário'} src={avatarUrl} bg="blue.600" />
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

                                    <Text fontSize="xs" color="gray.500">
                                        As configurações serão aplicadas na próxima vez que você entrar em um canal de voz.
                                    </Text>
                                    <Button colorScheme="blue" w="full" onClick={handleSaveDevices}>
                                        Salvar Dispositivos
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
