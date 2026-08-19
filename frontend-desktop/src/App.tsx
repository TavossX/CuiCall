import { useState, useRef, useEffect, useCallback } from 'react';
import { Box, Button, Input, VStack, HStack, Heading, Text, Flex, Image, Spinner, Tooltip, IconButton, Avatar, useDisclosure, useToast } from '@chakra-ui/react';
import logo from './assets/CuiCall.png';
import { useWebRTC } from './useWebRTC';
import { supabase } from './supabaseClient';
import { Auth } from './components/Auth';
import { SettingsModal } from './components/SettingsModal';
import { CreateServerModal } from './components/CreateServerModal';
import { CreateChannelModal } from './components/CreateChannelModal';
import { EditServerModal } from './components/EditServerModal';
import { JoinServerModal } from './components/JoinServerModal';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { BsMicFill, BsMicMuteFill, BsCameraVideoFill, BsCameraVideoOffFill, BsTelephoneXFill, BsBoxArrowRight, BsShareFill, BsGearFill, BsClipboard, BsPlusLg, BsCompass } from 'react-icons/bs';

export interface Channel {
    id: string;
    server_id: string;
    name: string;
    type: 'text' | 'voice';
    created_at: string;
}

function App() {
    const [isLoading, setIsLoading] = useState(true);
    const [session, setSession] = useState<any>(null);
    const [servers, setServers] = useState<any[]>([]);
    const [selectedServer, setSelectedServer] = useState<any | null>(null);
    const [channels, setChannels] = useState<Channel[]>([]);
    const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
    const [chatInput, setChatInput] = useState('');

    const settingsDisclosure = useDisclosure();
    const createServerDisclosure = useDisclosure();
    const createChannelDisclosure = useDisclosure();
    const editServerDisclosure = useDisclosure();
    const joinServerDisclosure = useDisclosure();
    const toast = useToast();

    const [channelTypeToCreate, setChannelTypeToCreate] = useState<'text' | 'voice'>('text');
    const [userProfile, setUserProfile] = useState<{ display_name?: string; avatar_url?: string } | null>(null);

    // Hook global no nível raiz do App
    const {
        localStream, remoteStream, inVoice, voiceRoomId,
        isCamOff, isMuted, channelMessages,
        setChannelMessages, loadChannelMessages,
        joinVoice, leaveVoice, joinTextChannel,
        toggleMute, toggleCamera, shareScreen,
        sendMessage, stopAllMedia,
    } = useWebRTC();

    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const userEmail = session?.user?.email ?? 'Usuário';
    const userName = userProfile?.display_name || userEmail.split('@')[0];
    const userAvatar = userProfile?.avatar_url || '';

    // ═══════ Auth & Servers ═══════
    const fetchServers = async () => {
        const { data, error } = await supabase
            .from('servers')
            .select('*')
            .order('created_at', { ascending: true });

        if (!error && data) {
            setServers(data);
            setSelectedServer((prev: any) => {
                if (!prev && data.length > 0) return data[0];
                const stillExists = data.find((s: any) => s.id === prev?.id);
                return stillExists || data[0] || null;
            });
        }
    };

    const fetchUserProfile = async (userId: string) => {
        const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
        if (data) setUserProfile(data);
    };

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setIsLoading(false);
            if (session) {
                fetchServers();
                fetchUserProfile(session.user.id);
            }
        });
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            if (session) {
                fetchServers();
                fetchUserProfile(session.user.id);
            }
        });
        return () => subscription.unsubscribe();
    }, []);

    useEffect(() => {
        let unlisten: () => void;
        async function setupDeepLink() {
            try {
                unlisten = await onOpenUrl(async (urls) => {
                    for (const url of urls) {
                        if (url.startsWith('cuicall://invite/')) {
                            const inviteId = url.replace('cuicall://invite/', '');
                            const { data: { user } } = await supabase.auth.getUser();
                            if (user && inviteId) {
                                const { error } = await supabase.from('server_members').insert([
                                    { server_id: inviteId, user_id: user.id, role: 'member' }
                                ]);
                                if (!error || error.code === '23505') {
                                    toast({ title: 'Servidor adicionado via link!', status: 'success' });
                                    fetchServers();
                                } else {
                                    toast({ title: 'Erro ao entrar via link', description: error.message, status: 'error' });
                                }
                            }
                        }
                    }
                });
            } catch (err) {
                console.error("Deep link plugin error:", err);
            }
        }
        setupDeepLink();
        return () => {
            if (unlisten) unlisten();
        };
    }, []);

    // ═══════ Canais Dinâmicos por Servidor ═══════
    const fetchChannels = useCallback(async (serverId: string) => {
        const { data, error } = await supabase
            .from('channels')
            .select('*')
            .eq('server_id', serverId)
            .order('created_at', { ascending: true });

        if (!error && data) {
            if (data.length === 0) {
                // Servidor sem canais: cria os canais padrão automaticamente
                const { data: newChannels } = await supabase
                    .from('channels')
                    .insert([
                        { server_id: serverId, name: 'geral', type: 'text' },
                        { server_id: serverId, name: 'Lobby', type: 'voice' }
                    ])
                    .select();

                if (newChannels) setChannels(newChannels);
            } else {
                setChannels(data);
            }
        }
    }, []);

    useEffect(() => {
        if (selectedServer) {
            fetchChannels(selectedServer.id);
            setActiveChannel(null); // Reseta canal ativo ao trocar de servidor
        } else {
            setChannels([]);
            setActiveChannel(null);
        }
    }, [selectedServer, fetchChannels]);

    // ═══════ Histórico de Mensagens do Supabase ═══════
    const fetchMessages = useCallback(async (channelId: string) => {
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('channel_id', channelId)
            .order('created_at', { ascending: true });

        if (!error && data) {
            const formatted = data.map((m: any) => ({
                senderId: m.user_id === session?.user?.id ? userName : m.user_id.slice(0, 8),
                text: m.content
            }));
            loadChannelMessages(channelId, formatted);
        }
    }, [session?.user?.id, userName, loadChannelMessages]);

    // ═══════ Video refs ═══════
    useEffect(() => {
        if (localVideoRef.current && localStream && !isCamOff) {
            localVideoRef.current.srcObject = localStream;
        }
    }, [localStream, isCamOff, activeChannel]);

    useEffect(() => {
        if (remoteVideoRef.current && remoteStream) {
            remoteVideoRef.current.srcObject = remoteStream;
        }
    }, [remoteStream, activeChannel]);

    // Mensagens do canal ativo
    const currentMessages = activeChannel ? (channelMessages[activeChannel.id] || []) : [];

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [currentMessages]);

    // ═══════ Handlers ═══════
    const handleChannelClick = async (channel: Channel) => {
        setActiveChannel(channel);
        if (channel.type === 'voice') {
            if (!inVoice || voiceRoomId !== channel.id) {
                const videoId = localStorage.getItem('cuicall-video-input') || undefined;
                const audioId = localStorage.getItem('cuicall-audio-input') || undefined;
                await joinVoice(channel.id, videoId, audioId);
            }
            await fetchMessages(channel.id);
        } else {
            await joinTextChannel(channel.id);
            await fetchMessages(channel.id);
            // Chamada de voz continua rodando em background!
        }
    };

    const handleLeaveVoice = () => {
        leaveVoice();
        if (activeChannel?.type === 'voice') {
            setActiveChannel(null);
        }
    };

    const handleLogout = async () => {
        stopAllMedia();
        await supabase.auth.signOut();
        setActiveChannel(null);
        setSelectedServer(null);
    };

    const handleSendMessage = async () => {
        if (!chatInput.trim() || !activeChannel || !session?.user) return;
        const textToSend = chatInput.trim();
        const channelId = activeChannel.id;
        setChatInput('');

        // 1. Persiste no banco de dados (Supabase)
        const { error } = await supabase.from('messages').insert([
            { channel_id: channelId, user_id: session.user.id, content: textToSend }
        ]);

        if (error) {
            console.error('Erro ao salvar mensagem no Supabase:', error);
        }

        // 2. Dispara no SignalR para sincronização em tempo real (que já devolve a msg para nós via ReceiveMessage)
        await sendMessage(userName, textToSend, channelId);
    };

    const handleCopyInvite = () => {
        if (!selectedServer) return;
        const inviteUrl = `https://cui-call.vercel.app/#/invite/${selectedServer.id}`;
        
        navigator.clipboard.writeText(inviteUrl);
        toast({
            title: 'Link copiado!',
            description: `Link de convite copiado para a área de transferência.`,
            status: 'success',
            duration: 2000,
            isClosable: true,
            position: 'top',
        });
    };

    // ═══════ Loading / Auth gates ═══════
    if (isLoading) {
        return (
            <Flex minH="100vh" align="center" justify="center" bg="gray.900">
                <Spinner size="xl" color="blue.400" thickness="4px" />
            </Flex>
        );
    }
    if (!session) {
        return <Auth />;
    }

    const textChannels = channels.filter(c => c.type === 'text');
    const voiceChannels = channels.filter(c => c.type === 'voice');

    return (
        <Flex h="100vh" overflow="hidden">
            {/* ═══════ Column 1: Server Bar (72px) ═══════ */}
            <Flex
                w="72px" minW="72px"
                flexDir="column" align="center"
                py={4} gap={3}
                borderRight="1px solid" borderColor="gray.800"
                sx={{ bg: '#1a1a2e' }}
                overflowY="auto"
            >
                {/* Home / Default Icon */}
                <Tooltip label="CuiCall Home" placement="right">
                    <Box
                        w="48px" h="48px" borderRadius={!selectedServer ? 'xl' : 'full'} overflow="hidden"
                        cursor="pointer" bg={!selectedServer ? 'blue.600' : 'gray.800'}
                        display="flex" alignItems="center" justifyContent="center"
                        _hover={{ borderRadius: 'xl', bg: 'blue.500' }}
                        transition="all 0.2s"
                        onClick={() => setSelectedServer(null)}
                    >
                        <Image src={logo} alt="CuiCall" boxSize="36px" objectFit="contain" />
                    </Box>
                </Tooltip>

                {servers.length > 0 && <Box w="32px" h="2px" bg="gray.700" borderRadius="full" />}

                {/* Dinâmica de Servidores do Supabase */}
                {servers.map((server) => {
                    const initials = server.name ? server.name.substring(0, 2).toUpperCase() : 'SV';
                    const isSelected = selectedServer?.id === server.id;
                    return (
                        <Tooltip key={server.id} label={server.name} placement="right">
                            <Box
                                w="48px" h="48px"
                                borderRadius={isSelected ? 'xl' : 'full'}
                                bg={isSelected ? 'blue.600' : 'gray.800'}
                                color="white"
                                display="flex" alignItems="center" justifyContent="center"
                                fontWeight="bold" fontSize="sm"
                                cursor="pointer"
                                _hover={{ borderRadius: 'xl', bg: 'blue.500' }}
                                transition="all 0.2s"
                                onClick={() => setSelectedServer(server)}
                                overflow="hidden"
                            >
                                {server.icon_url ? (
                                    <Image src={server.icon_url} alt={server.name} w="full" h="full" objectFit="cover" />
                                ) : (
                                    initials
                                )}
                            </Box>
                        </Tooltip>
                    );
                })}

                <Box w="32px" h="2px" bg="gray.700" borderRadius="full" />

                {/* Botão de Adicionar Servidor */}
                <Tooltip label="Criar Servidor" placement="right">
                    <Box
                        w="48px" h="48px" borderRadius="full" cursor="pointer" bg="gray.800"
                        display="flex" alignItems="center" justifyContent="center"
                        _hover={{ borderRadius: 'xl', bg: 'green.600', color: 'white' }}
                        transition="all 0.2s" color="green.400" fontSize="20px"
                        onClick={createServerDisclosure.onOpen}
                    >
                        <BsPlusLg />
                    </Box>
                </Tooltip>

                {/* Botão de Entrar em Servidor */}
                <Tooltip label="Entrar em Servidor" placement="right">
                    <Box
                        w="48px" h="48px" borderRadius="full" cursor="pointer" bg="gray.800"
                        display="flex" alignItems="center" justifyContent="center"
                        _hover={{ borderRadius: 'xl', bg: 'blue.600', color: 'white' }}
                        transition="all 0.2s" color="blue.400" fontSize="20px"
                        onClick={joinServerDisclosure.onOpen}
                    >
                        <BsCompass />
                    </Box>
                </Tooltip>
            </Flex>

            {/* ═══════ Column 2: Channel Sidebar (240px) ═══════ */}
            <Flex w="240px" minW="240px" bg="gray.800" flexDir="column" borderRight="1px solid" borderColor="gray.700">
                {/* Server Header */}
                <Flex h="48px" px={4} align="center" justify="space-between" borderBottom="1px solid" borderColor="gray.700">
                    <Heading size="sm" color="white" fontWeight="bold" isTruncated maxW="170px">
                        {selectedServer?.name || 'CuiCall Home'}
                    </Heading>
                    <HStack>
                        {selectedServer && (
                            <Tooltip label="Configurações do Servidor">
                                <IconButton
                                    aria-label="Edit Server" icon={<BsGearFill />}
                                    size="xs" variant="ghost" color="gray.400"
                                    _hover={{ color: 'white', bg: 'gray.700' }}
                                    onClick={editServerDisclosure.onOpen}
                                />
                            </Tooltip>
                        )}
                        <Tooltip label="Convidar Amigo">
                            <IconButton
                                aria-label="Copy Invite" icon={<BsClipboard />}
                                size="xs" variant="ghost" color="gray.400"
                                _hover={{ color: 'white', bg: 'gray.700' }}
                                onClick={handleCopyInvite}
                            />
                        </Tooltip>
                    </HStack>
                </Flex>

                {/* Channel List Dinâmica do Supabase */}
                <VStack align="stretch" flex="1" overflowY="auto" px={2} py={4} spacing={1}>
                    {/* Text Channels */}
                    <Flex px={2} mb={1} align="center" justify="space-between">
                        <Text fontSize="xs" fontWeight="bold" color="gray.500" textTransform="uppercase" letterSpacing="wider">
                            Canais de Texto
                        </Text>
                        {selectedServer && (
                            <Tooltip label="Criar Canal de Texto">
                                <IconButton aria-label="Criar Canal" icon={<BsPlusLg />} size="xs" variant="ghost" color="gray.500" _hover={{ color: 'white', bg: 'gray.700' }} onClick={() => { setChannelTypeToCreate('text'); createChannelDisclosure.onOpen(); }} />
                            </Tooltip>
                        )}
                    </Flex>
                    {textChannels.length === 0 ? (
                        <Text fontSize="xs" color="gray.600" px={2} fontStyle="italic">Nenhum canal de texto</Text>
                    ) : (
                        textChannels.map((c) => (
                            <ChannelItem
                                key={c.id}
                                label={`# ${c.name}`}
                                isActive={activeChannel?.id === c.id}
                                onClick={() => handleChannelClick(c)}
                            />
                        ))
                    )}

                    <Box h={4} />

                    {/* Voice Channels */}
                    <Flex px={2} mb={1} align="center" justify="space-between">
                        <Text fontSize="xs" fontWeight="bold" color="gray.500" textTransform="uppercase" letterSpacing="wider">
                            Canais de Voz
                        </Text>
                        {selectedServer && (
                            <Tooltip label="Criar Canal de Voz">
                                <IconButton aria-label="Criar Canal" icon={<BsPlusLg />} size="xs" variant="ghost" color="gray.500" _hover={{ color: 'white', bg: 'gray.700' }} onClick={() => { setChannelTypeToCreate('voice'); createChannelDisclosure.onOpen(); }} />
                            </Tooltip>
                        )}
                    </Flex>
                    {voiceChannels.length === 0 ? (
                        <Text fontSize="xs" color="gray.600" px={2} fontStyle="italic">Nenhum canal de voz</Text>
                    ) : (
                        voiceChannels.map((c) => (
                            <ChannelItem 
                                key={c.id}
                                label={`🔊 ${c.name}`} 
                                isActive={activeChannel?.id === c.id} 
                                isConnected={inVoice && voiceRoomId === c.id}
                                onClick={() => handleChannelClick(c)} 
                            />
                        ))
                    )}

                    {/* Indicador de conectado na voz em background */}
                    {inVoice && (
                        <Box pl={8} py={1}>
                            <HStack spacing={2}>
                                <Box w={2} h={2} borderRadius="full" bg="green.400" />
                                <Text fontSize="xs" color="green.300" fontWeight="medium">{userName}</Text>
                            </HStack>
                            {remoteStream && (
                                <HStack spacing={2} mt={1}>
                                    <Box w={2} h={2} borderRadius="full" bg="green.400" />
                                    <Text fontSize="xs" color="green.300" fontWeight="medium">Convidado</Text>
                                </HStack>
                            )}
                        </Box>
                    )}
                </VStack>

                {/* User Footer */}
                <Box bg="gray.900" px={2} py={2} borderTop="1px solid" borderColor="gray.700">
                    <Flex align="center" gap={2}>
                        <Avatar size="sm" name={userName} src={userAvatar} bg="blue.600" color="white" />
                        <Box flex="1" minW={0}>
                            <Text fontSize="xs" fontWeight="bold" color="white" isTruncated>{userName}</Text>
                            <Text fontSize="10px" color={inVoice ? 'green.400' : 'gray.500'} isTruncated>
                                {inVoice ? 'Voz Conectada' : 'Online'}
                            </Text>
                        </Box>
                        <HStack spacing={0}>
                            <Tooltip label={isMuted ? 'Ativar Microfone' : 'Mutar Microfone'}>
                                <IconButton aria-label="Mic" icon={isMuted ? <BsMicMuteFill /> : <BsMicFill />} size="xs" variant="ghost"
                                    color={isMuted ? 'red.400' : 'gray.400'} _hover={{ color: isMuted ? 'red.300' : 'white', bg: 'gray.700' }}
                                    onClick={toggleMute} isDisabled={!inVoice} />
                            </Tooltip>
                            <Tooltip label={isCamOff ? 'Ligar Câmera' : 'Desligar Câmera'}>
                                <IconButton aria-label="Cam" icon={isCamOff ? <BsCameraVideoOffFill /> : <BsCameraVideoFill />} size="xs" variant="ghost"
                                    color={isCamOff ? 'red.400' : 'gray.400'} _hover={{ color: isCamOff ? 'red.300' : 'white', bg: 'gray.700' }}
                                    onClick={toggleCamera} isDisabled={!inVoice} />
                            </Tooltip>
                            <Tooltip label="Desconectar da Voz">
                                <IconButton aria-label="Leave" icon={<BsTelephoneXFill />} size="xs" variant="ghost"
                                    color={inVoice ? 'red.400' : 'gray.600'} _hover={{ color: 'red.300', bg: 'gray.700' }}
                                    onClick={handleLeaveVoice} isDisabled={!inVoice} />
                            </Tooltip>
                            <Tooltip label="Configurações">
                                <IconButton aria-label="Settings" icon={<BsGearFill />} size="xs" variant="ghost"
                                    color="gray.400" _hover={{ color: 'white', bg: 'gray.700' }}
                                    onClick={settingsDisclosure.onOpen} />
                            </Tooltip>
                            <Tooltip label="Sair da Conta">
                                <IconButton aria-label="Logout" icon={<BsBoxArrowRight />} size="xs" variant="ghost"
                                    color="gray.400" _hover={{ color: 'red.400', bg: 'gray.700' }}
                                    onClick={handleLogout} />
                            </Tooltip>
                        </HStack>
                    </Flex>
                </Box>
            </Flex>

            {/* ═══════ Column 3: Main Stage ═══════ */}
            <Flex flex="1" flexDir="column" bg="gray.700" minW={0}>
                {/* Top bar */}
                <Flex h="48px" px={4} align="center" borderBottom="1px solid" borderColor="gray.600" bg="gray.700" gap={3} flexShrink={0}>
                    <Text fontWeight="bold" color="white">
                        {activeChannel ? (activeChannel.type === 'voice' ? `🔊 ${activeChannel.name}` : `# ${activeChannel.name}`) : (selectedServer?.name || 'CuiCall')}
                    </Text>
                    <Box w="1px" h="24px" bg="gray.600" />
                    <Text fontSize="sm" color="gray.400">
                        {activeChannel 
                            ? (activeChannel.type === 'voice' ? 'Chamada de Voz e Vídeo P2P' : 'Canal de texto do servidor')
                            : 'Bem-vindo ao servidor'}
                    </Text>
                    {activeChannel?.type === 'voice' && inVoice && (
                        <HStack ml="auto" spacing={2}>
                            <Button size="sm" colorScheme="purple" variant="outline" onClick={shareScreen} leftIcon={<BsShareFill />}>
                                Compartilhar Tela
                            </Button>
                        </HStack>
                    )}
                </Flex>

                {/* Main Content */}
                {activeChannel?.type === 'voice' ? (
                    <Flex flex="1" overflow="hidden">
                        {/* Video Grid */}
                        <Flex flex="1" flexDir="column" p={4} gap={4} overflow="auto">
                            <Flex flex="1" gap={4} flexDir={{ base: 'column', md: 'row' }} minH="300px">
                                {/* Local Video / Avatar */}
                                <Flex flex="1" bg="gray.900" borderRadius="lg" overflow="hidden" position="relative" minH="200px" align="center" justify="center">
                                    {isCamOff ? (
                                        <VStack spacing={3}>
                                            <Avatar size="2xl" name={userName} bg="blue.600" color="white" />
                                            <Text fontSize="sm" color="gray.500">Câmera desligada</Text>
                                        </VStack>
                                    ) : (
                                        <video ref={localVideoRef} autoPlay muted
                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    )}
                                    <Box position="absolute" bottom={3} left={3} bg="blackAlpha.700" px={2} py={1} borderRadius="md">
                                        <HStack spacing={1}>
                                            {isMuted && <Box as={BsMicMuteFill} color="red.400" />}
                                            <Text fontSize="xs" color="white" fontWeight="medium">{userName} (Você)</Text>
                                        </HStack>
                                    </Box>
                                </Flex>

                                {/* Remote Video / Avatar */}
                                <Flex flex="1" bg="gray.900" borderRadius="lg" overflow="hidden" position="relative" minH="200px" align="center" justify="center">
                                    {!remoteStream ? (
                                        <VStack spacing={3}>
                                            <Avatar size="2xl" name="?" bg="gray.700" color="gray.500" />
                                        </VStack>
                                    ) : (
                                        <>
                                            <video ref={remoteVideoRef} autoPlay
                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                            <Box position="absolute" bottom={3} left={3} bg="blackAlpha.700" px={2} py={1} borderRadius="md">
                                                <Text fontSize="xs" color="white" fontWeight="medium">Convidado</Text>
                                            </Box>
                                        </>
                                    )}
                                </Flex>
                            </Flex>
                        </Flex>

                        {/* Voice Chat Panel */}
                        <ChatPanel messages={currentMessages} chatInput={chatInput} setChatInput={setChatInput}
                            handleSendMessage={handleSendMessage} messagesEndRef={messagesEndRef} />
                    </Flex>
                ) : activeChannel ? (
                    /* Text Channel View */
                    <Flex flex="1" overflow="hidden" flexDir="column">
                        <Box flex="1" overflowY="auto" px={4} py={4}>
                            <VStack align="stretch" spacing={3}>
                                {currentMessages.length === 0 && (
                                    <Flex flex="1" align="center" justify="center" flexDir="column" gap={4} minH="300px">
                                        <Image src={logo} alt="CuiCall" maxH="80px" objectFit="contain" opacity={0.4} />
                                        <Heading size="md" color="gray.500">Bem-vindo ao # {activeChannel.name}!</Heading>
                                        <Text color="gray.600" fontSize="sm">Este é o início do canal #{activeChannel.name}. Comece a conversa!</Text>
                                    </Flex>
                                )}
                                {currentMessages.map((msg, idx) => (
                                    <HStack key={idx} spacing={3} align="start">
                                        <Avatar size="sm" name={msg.senderId.slice(0, 5)} bg="teal.600" mt={1} />
                                        <Box>
                                            <HStack spacing={2}>
                                                <Text fontSize="sm" fontWeight="bold" color="gray.200">{msg.senderId}</Text>
                                                <Text fontSize="xs" color="gray.500">agora</Text>
                                            </HStack>
                                            <Text fontSize="sm" color="gray.300">{msg.text}</Text>
                                        </Box>
                                    </HStack>
                                ))}
                                <div ref={messagesEndRef} />
                            </VStack>
                        </Box>
                        <Box px={4} py={3} borderTop="1px solid" borderColor="gray.600">
                            <Input
                                placeholder={`Conversar em # ${activeChannel.name}`}
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                                bg="gray.600" border="none" size="md" borderRadius="lg"
                                _focus={{ boxShadow: 'none', bg: 'gray.500' }}
                                _placeholder={{ color: 'gray.400' }}
                            />
                        </Box>
                    </Flex>
                ) : (
                    /* Welcome / No channel selected */
                    <Flex flex="1" align="center" justify="center" flexDir="column" gap={4} p={8}>
                        <Image src={logo} alt="CuiCall" maxH="100px" objectFit="contain" opacity={0.5} />
                        <Heading size="lg" color="gray.300">{selectedServer?.name || 'CuiCall Home'}</Heading>
                        <Text color="gray.400" textAlign="center" maxW="450px">
                            Selecione um canal de texto na barra lateral para ver o histórico e conversar, ou entre em um canal de voz para iniciar uma chamada.
                        </Text>
                    </Flex>
                )}
            </Flex>

            {/* ═══════ Column 4: Members Sidebar (240px) ═══════ */}
            <Flex w="240px" minW="240px" bg="gray.800" flexDir="column" borderLeft="1px solid" borderColor="gray.700" display={{ base: 'none', xl: 'flex' }}>
                <Box px={4} py={4}>
                    <Text fontSize="xs" fontWeight="bold" color="gray.500" textTransform="uppercase" letterSpacing="wider" mb={3}>
                        Membros Online — {inVoice ? (remoteStream ? 2 : 1) : 1}
                    </Text>
                    <VStack align="stretch" spacing={2}>
                        <MemberItem name={userName} letter={userEmail.charAt(0).toUpperCase()} bg="blue.600"
                            status={inVoice ? '🔊 Na Sala de Vídeo' : 'Online'} />
                        {inVoice && remoteStream && (
                            <MemberItem name="Convidado" letter="C" bg="green.600" status="🔊 Na Sala de Vídeo" />
                        )}
                    </VStack>
                </Box>
            </Flex>

            {/* ═══════ Modals ═══════ */}
            <SettingsModal 
                isOpen={settingsDisclosure.isOpen} 
                onClose={settingsDisclosure.onClose} 
                onProfileUpdated={() => session?.user?.id && fetchUserProfile(session.user.id)}
            />
            <CreateServerModal
                isOpen={createServerDisclosure.isOpen}
                onClose={createServerDisclosure.onClose}
                onServerCreated={fetchServers}
            />
            <JoinServerModal
                isOpen={joinServerDisclosure.isOpen}
                onClose={joinServerDisclosure.onClose}
                onServerJoined={fetchServers}
            />
            <EditServerModal
                isOpen={editServerDisclosure.isOpen}
                onClose={editServerDisclosure.onClose}
                server={selectedServer}
                onServerUpdated={() => { fetchServers(); }}
            />
            {selectedServer && (
                <CreateChannelModal
                    isOpen={createChannelDisclosure.isOpen}
                    onClose={createChannelDisclosure.onClose}
                    serverId={selectedServer.id}
                    initialType={channelTypeToCreate}
                    onChannelCreated={() => fetchChannels(selectedServer.id)}
                />
            )}
        </Flex>
    );
}

// ═══════ Subcomponents ═══════

function ChannelItem({ label, isActive, isConnected, onClick }: { label: string; isActive: boolean; isConnected?: boolean; onClick: () => void }) {
    return (
        <Flex px={2} py={1.5} borderRadius="md" cursor="pointer"
            align="center" justify="space-between"
            bg={isActive ? 'gray.700' : 'transparent'}
            color={isActive ? 'white' : 'gray.400'}
            _hover={{ bg: isActive ? 'gray.700' : 'gray.750', color: 'gray.200' }}
            transition="all 0.15s" onClick={onClick}
            fontSize="sm" fontWeight={isActive ? 'semibold' : 'normal'}>
            <Text>{label}</Text>
            {isConnected && <Box w={2} h={2} borderRadius="full" bg="green.400" />}
        </Flex>
    );
}

function ChatPanel({ messages, chatInput, setChatInput, handleSendMessage, messagesEndRef }: any) {
    return (
        <Flex w="300px" minW="300px" flexDir="column" bg="gray.800" borderLeft="1px solid" borderColor="gray.600">
            <Flex h="48px" px={4} align="center" borderBottom="1px solid" borderColor="gray.700" flexShrink={0}>
                <Text fontWeight="bold" color="white" fontSize="sm">Chat da Sala</Text>
            </Flex>
            <Box flex="1" overflowY="auto" px={3} py={3}>
                <VStack align="stretch" spacing={3}>
                    {messages.length === 0 && (
                        <Text fontSize="sm" color="gray.500" textAlign="center" mt={4}>
                            Nenhuma mensagem ainda. Comece a conversa!
                        </Text>
                    )}
                    {messages.map((msg: any, idx: number) => (
                        <HStack key={idx} spacing={2} align="start">
                            <Avatar size="xs" name={msg.senderId.slice(0, 5)} bg="teal.600" mt={0.5} />
                            <Box>
                                <Text fontSize="xs" color="gray.400">{msg.senderId}</Text>
                                <Text fontSize="sm" color="gray.200">{msg.text}</Text>
                            </Box>
                        </HStack>
                    ))}
                    <div ref={messagesEndRef} />
                </VStack>
            </Box>
            <Box px={3} py={3} borderTop="1px solid" borderColor="gray.700">
                <HStack>
                    <Input placeholder="Enviar mensagem..." value={chatInput}
                        onChange={(e: any) => setChatInput(e.target.value)}
                        onKeyDown={(e: any) => e.key === 'Enter' && handleSendMessage()}
                        bg="gray.900" border="none" size="sm" _focus={{ boxShadow: 'none' }} />
                    <Button colorScheme="blue" size="sm" onClick={handleSendMessage} isDisabled={!chatInput.trim()}>
                        Enviar
                    </Button>
                </HStack>
            </Box>
        </Flex>
    );
}

function MemberItem({ name, letter, bg, status }: { name: string; letter: string; bg: string; status: string }) {
    return (
        <HStack spacing={3} px={2} py={2} borderRadius="md" _hover={{ bg: 'gray.700' }} transition="background 0.15s" cursor="pointer">
            <Box w="32px" h="32px" borderRadius="full" bg={bg} display="flex" alignItems="center" justifyContent="center" position="relative">
                <Text fontSize="sm" fontWeight="bold" color="white">{letter}</Text>
                <Box position="absolute" bottom={-0.5} right={-0.5} w="10px" h="10px" borderRadius="full" bg="green.400" border="2px solid" borderColor="gray.800" />
            </Box>
            <Box>
                <Text fontSize="sm" fontWeight="medium" color="gray.300">{name}</Text>
                <Text fontSize="xs" color="gray.500">{status}</Text>
            </Box>
        </HStack>
    );
}

export default App;
