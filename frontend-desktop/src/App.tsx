import { useState, useEffect, useCallback, useRef } from 'react';
import {
    Box, Button, Input, VStack, HStack, Heading, Text, Flex, Image, Spinner, Tooltip, IconButton, Avatar, useDisclosure, useToast
} from '@chakra-ui/react';
import { Virtuoso } from 'react-virtuoso';
import logo from './assets/CuiCall.png';
import { useWebRTC } from './useWebRTC';
import { useNotifications } from './useNotifications';
import { useAutoUpdater } from './useAutoUpdater';
import { supabase } from './supabaseClient';
import { Auth } from './components/Auth';
import { SettingsModal } from './components/SettingsModal';
import { CreateServerModal } from './components/CreateServerModal';
import { CreateChannelModal } from './components/CreateChannelModal';
import { EditServerModal } from './components/EditServerModal';
import { JoinServerModal } from './components/JoinServerModal';
import { VideoGrid } from './components/VideoGrid';
import { ChatMessageItem } from './components/ChatMessage';
import { FriendsView, FriendProfile } from './components/FriendsView';
import { DMPanel } from './components/DMPanel';
import { getAvatarColor } from './utils/avatarColors';
import { KuiAvatarIcon } from './components/KuiAvatar';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import {
    BsMicFill, BsMicMuteFill, BsCameraVideoFill, BsCameraVideoOffFill, BsTelephoneXFill,
    BsBoxArrowRight, BsShareFill, BsGearFill, BsClipboard, BsPlusLg, BsPeopleFill, BsCompass, BsPaperclip
} from 'react-icons/bs';

export interface Channel {
    id: string;
    server_id: string;
    name: string;
    type: 'text' | 'voice';
    created_at: string;
}

function App() {
    const [isLoading, setIsLoading] = useState(true);
    const [loadingMessage, setLoadingMessage] = useState('Verificando sessão...');
    const [session, setSession] = useState<any>(null);
    const [servers, setServers] = useState<any[]>([]);
    const [selectedServer, setSelectedServer] = useState<any | null>(null);
    const [channels, setChannels] = useState<Channel[]>([]);
    const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
    const [chatInput, setChatInput] = useState('');
    const [activeFriend, setActiveFriend] = useState<FriendProfile | null>(null);
    const [sidebarFriends, setSidebarFriends] = useState<FriendProfile[]>([]);
    const [channelTypeToCreate, setChannelTypeToCreate] = useState<'text' | 'voice'>('text');
    const [userProfile, setUserProfile] = useState<{ username?: string; display_name?: string; avatar_url?: string } | null>(null);
    const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
    const channelFileInputRef = useRef<HTMLInputElement>(null);

    const settingsDisclosure = useDisclosure();
    const createServerDisclosure = useDisclosure();
    const createChannelDisclosure = useDisclosure();
    const editServerDisclosure = useDisclosure();
    const joinServerDisclosure = useDisclosure();
    const toast = useToast();

    // Hook global WebRTC e SignalR no nível raiz
    const {
        localStream, remoteStreams, inVoice, voiceRoomId,
        isCamOff, isMuted, isScreenSharing, channelMessages,
        directMessages, voicePresence,
        setChannelMessages, loadChannelMessages, loadDirectMessages,
        joinVoice, leaveVoice, joinTextChannel,
        toggleMute, toggleCamera, shareScreen,
        sendMessage, sendDirectMessage, sendFriendRequest, acceptFriendRequest,
        registerUser, stopAllMedia,
    } = useWebRTC();

    // Hook unificado de notificações (áudio + OS Tauri)
    const { playSound, notifyNewDM, notifyVoiceState, notifyOS } = useNotifications();

    // Hook do Auto-Updater (executa verificação silenciosa ao abrir o app)
    useAutoUpdater();

    const userEmail = session?.user?.email ?? 'Usuário';
    const userName = userProfile?.display_name || userEmail.split('@')[0];
    const userAvatar = userProfile?.avatar_url || '';

    // ═══════ Auth & Servers ═══════
    const fetchServers = async (): Promise<any[]> => {
        const { data, error } = await supabase
            .from('servers')
            .select('*')
            .order('created_at', { ascending: true });

        if (!error && data) {
            setServers(data);
            return data;
        }
        return [];
    };

    const fetchUserProfile = async (userId: string) => {
        const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
        if (data) setUserProfile(data);
    };

    // Busca lista de amigos para a sidebar de DMs
    const fetchSidebarFriends = useCallback(async () => {
        if (!session?.user?.id) return;
        try {
            const { data: friendships } = await supabase
                .from('friendships')
                .select('*')
                .eq('status', 'accepted')
                .or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`);

            if (friendships && friendships.length > 0) {
                const partnerIds = friendships.map(f =>
                    f.requester_id === session.user.id ? f.addressee_id : f.requester_id
                );
                const { data: profiles } = await supabase
                    .from('profiles')
                    .select('id, email, username, avatar_url')
                    .in('id', partnerIds);

                if (profiles) {
                    setSidebarFriends(profiles);
                }
            } else {
                setSidebarFriends([]);
            }
        } catch (err) {
            console.error('Erro ao carregar amigos da sidebar:', err);
        }
    }, [session?.user?.id]);

    // ═══════ Carregamento Inicial Completo ═══════
    const loadInitialData = useCallback(async (userSession: any) => {
        try {
            setLoadingMessage('Carregando servidores...');
            await fetchServers();
            await fetchSidebarFriends();
            if (userSession?.user?.id) {
                await fetchUserProfile(userSession.user.id);
            }
        } catch (err) {
            console.error('Erro ao carregar dados iniciais:', err);
        } finally {
            setIsLoading(false);
        }
    }, [fetchSidebarFriends]);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            if (session) {
                loadInitialData(session);
            } else {
                setIsLoading(false);
            }
        });
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            if (session) {
                setIsLoading(true);
                loadInitialData(session);
            }
        });
        return () => subscription.unsubscribe();
    }, [loadInitialData]);

    // Registra o UserId no Hub SignalR assim que a sessão estiver pronta
    useEffect(() => {
        if (session?.user?.id) {
            registerUser(session.user.id);
        }
    }, [session?.user?.id, registerUser]);

    // Listeners de Notificações de Áudio e Sistema Operacional
    useEffect(() => {
        const handleNewDM = (e: any) => {
            const { senderUserId, text, dmData } = e.detail;
            const senderName = dmData?.senderName || 'Amigo';
            const isChatActive = selectedServer === null && activeFriend?.id === senderUserId;
            notifyNewDM(senderName, text, isChatActive);
            fetchSidebarFriends();
        };

        const handleVoiceState = (e: any) => {
            const { action, connectionId } = e.detail;
            notifyVoiceState(action, connectionId);
        };

        const handleFriendReq = () => {
            playSound('message');
            notifyOS('Novo Pedido de Amizade', 'Você recebeu uma solicitação de amizade no CuiCall!');
            fetchSidebarFriends();
        };

        const handleFriendAcc = () => {
            playSound('message');
            notifyOS('Pedido de Amizade Aceito', 'Seu pedido de amizade foi aceito!');
            fetchSidebarFriends();
        };

        window.addEventListener('cuicall:newDirectMessage', handleNewDM);
        window.addEventListener('cuicall:voiceState', handleVoiceState);
        window.addEventListener('cuicall:friendRequestReceived', handleFriendReq);
        window.addEventListener('cuicall:friendRequestAccepted', handleFriendAcc);

        return () => {
            window.removeEventListener('cuicall:newDirectMessage', handleNewDM);
            window.removeEventListener('cuicall:voiceState', handleVoiceState);
            window.removeEventListener('cuicall:friendRequestReceived', handleFriendReq);
            window.removeEventListener('cuicall:friendRequestAccepted', handleFriendAcc);
        };
    }, [activeFriend, selectedServer, notifyNewDM, notifyVoiceState, playSound, notifyOS, fetchSidebarFriends]);

    // Deep-link para convites
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
    }, [toast]);

    // ═══════ Canais Dinâmicos por Servidor ═══════
    const fetchChannels = useCallback(async (serverId: string) => {
        const { data, error } = await supabase
            .from('channels')
            .select('*')
            .eq('server_id', serverId)
            .order('created_at', { ascending: true });

        if (!error && data) {
            if (data.length === 0) {
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
            setActiveChannel(null);
            setActiveFriend(null);
        } else {
            setChannels([]);
            setActiveChannel(null);
            fetchSidebarFriends();
        }
    }, [selectedServer, fetchChannels, fetchSidebarFriends]);

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
                text: m.content || '',
                attachment_url: m.attachment_url || null,
                id: m.id,
                created_at: m.created_at,
            }));
            loadChannelMessages(channelId, formatted);
        }
    }, [session?.user?.id, userName, loadChannelMessages]);

    // Mensagens do canal ativo
    const currentMessages = activeChannel ? (channelMessages[activeChannel.id] || []) : [];

    // ═══════ Handlers ═══════
    const handleChannelClick = async (channel: Channel) => {
        setActiveChannel(channel);
        if (channel.type === 'voice') {
            if (!inVoice || voiceRoomId !== channel.id) {
                const videoId = localStorage.getItem('cuicall-video-input') || undefined;
                const audioId = localStorage.getItem('cuicall-audio-input') || undefined;
                await joinVoice(channel.id, videoId, audioId, { userName, avatarUrl: userAvatar });
            }
            await fetchMessages(channel.id);
        } else {
            await joinTextChannel(channel.id);
            await fetchMessages(channel.id);
        }
    };

    const handleLeaveVoice = async () => {
        await leaveVoice();
        if (activeChannel?.type === 'voice') {
            setActiveChannel(null);
        }
    };

    const handleLogout = async () => {
        stopAllMedia();
        await supabase.auth.signOut();
        setActiveChannel(null);
        setSelectedServer(null);
        setActiveFriend(null);
    };

    const handleChannelFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !activeChannel || !session?.user) return;
        e.target.value = '';

        if (!file.type.startsWith('image/')) {
            toast({ title: 'Formato não suportado', description: 'Por favor, envie apenas imagens (PNG, JPG, GIF, WebP).', status: 'warning' });
            return;
        }

        if (file.size > 10 * 1024 * 1024) {
            toast({ title: 'Arquivo muito grande', description: 'O tamanho máximo do anexo é 10MB.', status: 'warning' });
            return;
        }

        setIsUploadingAttachment(true);

        try {
            const fileExt = file.name.split('.').pop() || 'png';
            const fileName = `channel-${session.user.id}-${Date.now()}.${fileExt}`;
            const { error: uploadError } = await supabase.storage
                .from('chat_attachments')
                .upload(fileName, file, { upsert: true });

            if (uploadError) throw uploadError;

            const { data } = supabase.storage.from('chat_attachments').getPublicUrl(fileName);
            const attachmentUrl = data.publicUrl;

            const textToSend = chatInput.trim();
            const channelId = activeChannel.id;
            setChatInput('');

            const { data: insertedMsg, error: insertError } = await supabase
                .from('messages')
                .insert([{
                    channel_id: channelId,
                    user_id: session.user.id,
                    content: textToSend,
                    attachment_url: attachmentUrl
                }])
                .select()
                .single();

            if (insertError) throw insertError;

            await sendMessage(userName, textToSend, channelId, attachmentUrl);

            setChannelMessages(prev => ({
                ...prev,
                [channelId]: [...(prev[channelId] || []), {
                    id: insertedMsg?.id,
                    senderId: userName,
                    text: textToSend,
                    attachment_url: attachmentUrl,
                    created_at: insertedMsg?.created_at
                }]
            }));
        } catch (err: any) {
            console.error('Erro ao enviar anexo no canal:', err);
            toast({ title: 'Erro ao enviar imagem', description: err.message, status: 'error' });
        } finally {
            setIsUploadingAttachment(false);
        }
    };

    const handleSendMessage = async () => {
        if (!chatInput.trim() || !activeChannel || !session?.user || isUploadingAttachment) return;
        const textToSend = chatInput.trim();
        const channelId = activeChannel.id;
        setChatInput('');

        const { error } = await supabase.from('messages').insert([
            { channel_id: channelId, user_id: session.user.id, content: textToSend }
        ]);

        if (error) {
            console.error('Erro ao salvar mensagem no Supabase:', error);
        }

        await sendMessage(userName, textToSend, channelId);

        setChannelMessages(prev => ({
            ...prev,
            [channelId]: [...(prev[channelId] || []), { senderId: userName, text: textToSend }]
        }));
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
            <Flex minH="100vh" align="center" justify="center" bg="gray.900" flexDir="column" gap={6}>
                <Image src={logo} alt="CuiCall" boxSize="80px" objectFit="contain" />
                <Spinner size="xl" color="blue.400" thickness="4px" />
                <Text color="gray.400" fontSize="sm" fontWeight="medium">
                    {loadingMessage}
                </Text>
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
            {/* ═══════ Column 1: Server & DMs Bar (72px) ═══════ */}
            <Flex
                w="72px" minW="72px"
                flexDir="column" align="center"
                py={4} gap={3}
                borderRight="1px solid" borderColor="gray.800"
                sx={{ bg: '#1a1a2e' }}
                overflowY="auto"
            >
                {/* Botão Início / Amigos / DMs */}
                <Tooltip label="Início / Amigos & DMs" placement="right">
                    <Box
                        w="48px" h="48px" borderRadius={!selectedServer ? 'xl' : 'full'} overflow="hidden"
                        cursor="pointer" bg={!selectedServer ? 'blue.600' : 'gray.800'}
                        display="flex" alignItems="center" justifyContent="center"
                        _hover={{ borderRadius: 'xl', bg: 'blue.500' }}
                        transition="all 0.2s"
                        onClick={() => {
                            setSelectedServer(null);
                            setActiveFriend(null);
                        }}
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

            {/* ═══════ Column 2: Channel or DM Sidebar (240px) ═══════ */}
            <Flex w="240px" minW="240px" bg="gray.800" flexDir="column" borderRight="1px solid" borderColor="gray.700">
                {/* Cabeçalho da Coluna 2 */}
                <Flex h="48px" px={4} align="center" justify="space-between" borderBottom="1px solid" borderColor="gray.700">
                    <Heading size="sm" color="white" fontWeight="bold" isTruncated maxW="170px">
                        {selectedServer ? selectedServer.name : 'Mensagens Diretas'}
                    </Heading>
                    <HStack>
                        {selectedServer && (
                            <>
                                <Tooltip label="Configurações do Servidor">
                                    <IconButton
                                        aria-label="Edit Server" icon={<BsGearFill />}
                                        size="xs" variant="ghost" color="gray.400"
                                        _hover={{ color: 'white', bg: 'gray.700' }}
                                        onClick={editServerDisclosure.onOpen}
                                    />
                                </Tooltip>
                                <Tooltip label="Convidar Amigo">
                                    <IconButton
                                        aria-label="Copy Invite" icon={<BsClipboard />}
                                        size="xs" variant="ghost" color="gray.400"
                                        _hover={{ color: 'white', bg: 'gray.700' }}
                                        onClick={handleCopyInvite}
                                    />
                                </Tooltip>
                            </>
                        )}
                    </HStack>
                </Flex>

                {/* Lista de Canais (Modo Servidor) ou Lista de Amigos/DMs (Modo Início) */}
                <VStack align="stretch" flex="1" overflowY="auto" px={2} py={3} spacing={1}>
                    {!selectedServer ? (
                        /* Modo Amigos e DMs */
                        <>
                            {/* Botão Amigos (Abre a view de abas) */}
                            <Flex
                                px={3} py={2} borderRadius="md" cursor="pointer"
                                align="center" gap={3}
                                bg={activeFriend === null ? 'gray.700' : 'transparent'}
                                color={activeFriend === null ? 'white' : 'gray.300'}
                                _hover={{ bg: 'gray.700', color: 'white' }}
                                transition="all 0.15s"
                                onClick={() => setActiveFriend(null)}
                                fontWeight="semibold" fontSize="sm"
                            >
                                <Box as={BsPeopleFill} fontSize="16px" color="teal.300" />
                                <Text>Amigos</Text>
                            </Flex>

                            <Box h={2} />

                            <Text fontSize="xs" fontWeight="bold" color="gray.500" px={2} mb={1} textTransform="uppercase" letterSpacing="wider">
                                Conversas Diretas
                            </Text>

                            {sidebarFriends.length === 0 ? (
                                <Text fontSize="xs" color="gray.500" px={2} fontStyle="italic">
                                    Nenhuma conversa ainda
                                </Text>
                            ) : (
                                sidebarFriends.map(friend => {
                                    const friendName = friend.username || friend.email.split('@')[0];
                                    const isSelected = activeFriend?.id === friend.id;
                                    return (
                                        <Flex
                                            key={friend.id}
                                            px={2} py={1.5} borderRadius="md" cursor="pointer"
                                            align="center" justify="space-between"
                                            bg={isSelected ? 'gray.700' : 'transparent'}
                                            color={isSelected ? 'white' : 'gray.400'}
                                            _hover={{ bg: 'gray.700', color: 'gray.200' }}
                                            transition="all 0.15s"
                                            onClick={() => setActiveFriend(friend)}
                                        >
                                            <HStack spacing={2.5} minW={0}>
                                                <Box position="relative">
                                                    <Avatar
                                                        size="xs"
                                                        name={friendName}
                                                        src={friend.avatar_url}
                                                        bg={getAvatarColor(friend.id)}
                                                        icon={<KuiAvatarIcon fill={getAvatarColor(friend.id)} />}
                                                    />
                                                    <Box position="absolute" bottom="-1px" right="-1px" w="7px" h="7px" borderRadius="full" bg="green.400" border="1.5px solid" borderColor="gray.800" />
                                                </Box>
                                                <Text fontSize="sm" fontWeight={isSelected ? 'semibold' : 'normal'} isTruncated>
                                                    {friendName}
                                                </Text>
                                            </HStack>
                                        </Flex>
                                    );
                                })
                            )}
                        </>
                    ) : (
                        /* Modo Servidor: Canais de Texto e Voz */
                        <>
                            <Flex px={2} mb={1} align="center" justify="space-between">
                                <Text fontSize="xs" fontWeight="bold" color="gray.500" textTransform="uppercase" letterSpacing="wider">
                                    Canais de Texto
                                </Text>
                                <Tooltip label="Criar Canal de Texto">
                                    <IconButton aria-label="Criar Canal" icon={<BsPlusLg />} size="xs" variant="ghost" color="gray.500" _hover={{ color: 'white', bg: 'gray.700' }} onClick={() => { setChannelTypeToCreate('text'); createChannelDisclosure.onOpen(); }} />
                                </Tooltip>
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

                            <Flex px={2} mb={1} align="center" justify="space-between">
                                <Text fontSize="xs" fontWeight="bold" color="gray.500" textTransform="uppercase" letterSpacing="wider">
                                    Canais de Voz
                                </Text>
                                <Tooltip label="Criar Canal de Voz">
                                    <IconButton aria-label="Criar Canal" icon={<BsPlusLg />} size="xs" variant="ghost" color="gray.500" _hover={{ color: 'white', bg: 'gray.700' }} onClick={() => { setChannelTypeToCreate('voice'); createChannelDisclosure.onOpen(); }} />
                                </Tooltip>
                            </Flex>
                            {voiceChannels.length === 0 ? (
                                <Text fontSize="xs" color="gray.600" px={2} fontStyle="italic">Nenhum canal de voz</Text>
                            ) : (
                                voiceChannels.map((c) => {
                                    const membersInChannel = voicePresence[c.id] || [];
                                    return (
                                        <Box key={c.id} mb={1}>
                                            <ChannelItem 
                                                label={`🔊 ${c.name}`} 
                                                isActive={activeChannel?.id === c.id} 
                                                isConnected={inVoice && voiceRoomId === c.id}
                                                onClick={() => handleChannelClick(c)} 
                                            />
                                            {/* Presença Global de Voz na Sidebar (Estilo Discord) */}
                                            {membersInChannel.length > 0 && (
                                                <VStack align="stretch" pl={5} pt={1} pb={1} spacing={0.5}>
                                                    {membersInChannel.map(member => {
                                                        const isSelf = inVoice && voiceRoomId === c.id && (member.userId === session?.user?.id || member.userName === userName);
                                                        const displayName = isSelf ? `${userName} (Você)` : (member.userName || member.connectionId.slice(0, 8));
                                                        const avatarSrc = isSelf ? userAvatar : (member.avatarUrl || '');
                                                        const isMemberMuted = isSelf ? isMuted : !!member.isMuted;
                                                        const memberColor = getAvatarColor(member.userId || member.connectionId);

                                                        return (
                                                            <Flex
                                                                key={member.connectionId}
                                                                align="center"
                                                                justify="space-between"
                                                                px={2}
                                                                py={1}
                                                                borderRadius="md"
                                                                _hover={{ bg: 'whiteAlpha.100' }}
                                                                transition="all 0.15s"
                                                                cursor="pointer"
                                                            >
                                                                <HStack spacing={2} minW={0}>
                                                                    <Box position="relative">
                                                                        <Avatar
                                                                            size="xs"
                                                                            name={displayName}
                                                                            src={avatarSrc}
                                                                            bg={memberColor}
                                                                            icon={<KuiAvatarIcon fill={memberColor} />}
                                                                        />
                                                                        <Box
                                                                            position="absolute"
                                                                            bottom="-1px"
                                                                            right="-1px"
                                                                            w="7px"
                                                                            h="7px"
                                                                            borderRadius="full"
                                                                            bg="green.400"
                                                                            border="1.5px solid"
                                                                            borderColor="gray.800"
                                                                        />
                                                                    </Box>
                                                                    <Text
                                                                        fontSize="xs"
                                                                        color="gray.300"
                                                                        fontWeight="medium"
                                                                        isTruncated
                                                                        maxW="115px"
                                                                    >
                                                                        {displayName}
                                                                    </Text>
                                                                </HStack>

                                                                {isMemberMuted && (
                                                                    <Box as={BsMicMuteFill} color="red.400" fontSize="12px" />
                                                                )}
                                                            </Flex>
                                                        );
                                                    })}
                                                </VStack>
                                            )}
                                        </Box>
                                    );
                                })
                            )}
                        </>
                    )}
                </VStack>

                {/* User Footer */}
                <Box bg="gray.900" px={2} py={2} borderTop="1px solid" borderColor="gray.700">
                    <Flex align="center" gap={2}>
                        <Avatar
                            size="sm"
                            name={userName}
                            src={userAvatar}
                            bg={getAvatarColor(session?.user?.id)}
                            icon={<KuiAvatarIcon fill={getAvatarColor(session?.user?.id)} />}
                        />
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
                {!selectedServer ? (
                    /* Visualização de Amigos ou Direct Message */
                    activeFriend ? (
                        <DMPanel
                            currentUserId={session.user.id}
                            currentUserName={userName}
                            targetFriend={activeFriend}
                            messages={directMessages[activeFriend.id] || []}
                            onSendMessage={sendDirectMessage}
                            onBack={() => setActiveFriend(null)}
                            loadMessages={loadDirectMessages}
                        />
                    ) : (
                        <FriendsView
                            currentUserId={session.user.id}
                            currentUserName={userName}
                            onSelectFriend={(friend) => setActiveFriend(friend)}
                            onSendFriendRequestSignal={sendFriendRequest}
                            onAcceptFriendRequestSignal={acceptFriendRequest}
                        />
                    )
                ) : (
                    /* Visualização de Servidor */
                    <>
                        {/* Top bar do Servidor */}
                        <Flex h="48px" px={4} align="center" borderBottom="1px solid" borderColor="gray.600" bg="gray.700" gap={3} flexShrink={0}>
                            <Text fontWeight="bold" color="white">
                                {activeChannel ? (activeChannel.type === 'voice' ? `🔊 ${activeChannel.name}` : `# ${activeChannel.name}`) : selectedServer.name}
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

                        {/* Conteúdo do Canal */}
                        {activeChannel?.type === 'voice' ? (
                            <Flex flex="1" overflow="hidden">
                                <VideoGrid
                                    localStream={localStream}
                                    remoteStreams={remoteStreams}
                                    isCamOff={isCamOff}
                                    isMuted={isMuted}
                                    isScreenSharing={isScreenSharing}
                                    userName={userName}
                                />
                                <ChatPanel
                                    messages={currentMessages}
                                    chatInput={chatInput}
                                    setChatInput={setChatInput}
                                    handleSendMessage={handleSendMessage}
                                    handleFileSelect={handleChannelFileSelect}
                                    isUploading={isUploadingAttachment}
                                />
                            </Flex>
                        ) : activeChannel ? (
                            <Flex flex="1" overflow="hidden" flexDir="column">
                                <Box flex="1" px={3} py={2} position="relative">
                                    {currentMessages.length === 0 ? (
                                        <Flex flex="1" align="center" justify="center" flexDir="column" gap={4} minH="300px" h="100%">
                                            <Image src={logo} alt="CuiCall" maxH="80px" objectFit="contain" opacity={0.4} />
                                            <Heading size="md" color="gray.500">Bem-vindo ao # {activeChannel.name}!</Heading>
                                            <Text color="gray.600" fontSize="sm">Este é o início do canal #{activeChannel.name}. Comece a conversa!</Text>
                                        </Flex>
                                    ) : (
                                        <Virtuoso
                                            data={currentMessages}
                                            initialTopMostItemIndex={currentMessages.length > 0 ? currentMessages.length - 1 : 0}
                                            followOutput="smooth"
                                            style={{ height: '100%', width: '100%' }}
                                            itemContent={(index, msg) => (
                                                <ChatMessageItem key={index} message={msg} index={index} />
                                            )}
                                        />
                                    )}
                                </Box>
                                <Box px={4} py={3} borderTop="1px solid" borderColor="gray.600" bg="gray.750">
                                    <input
                                        type="file"
                                        ref={channelFileInputRef}
                                        onChange={handleChannelFileSelect}
                                        accept="image/*"
                                        style={{ display: 'none' }}
                                    />
                                    <HStack spacing={2}>
                                        <Tooltip label={isUploadingAttachment ? "Enviando imagem..." : "Enviar anexo"}>
                                            <IconButton
                                                aria-label="Anexar Imagem"
                                                icon={isUploadingAttachment ? <Spinner size="xs" color="blue.400" /> : <BsPaperclip />}
                                                size="md"
                                                variant="ghost"
                                                color="gray.400"
                                                _hover={{ color: 'white', bg: 'gray.700' }}
                                                onClick={() => channelFileInputRef.current?.click()}
                                                isDisabled={isUploadingAttachment}
                                            />
                                        </Tooltip>
                                        <Input
                                            placeholder={isUploadingAttachment ? "Enviando anexo..." : `Conversar em # ${activeChannel.name}`}
                                            value={chatInput}
                                            onChange={(e) => setChatInput(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                                            bg="gray.800" border="none" size="md" borderRadius="lg"
                                            _focus={{ boxShadow: 'none', bg: 'gray.850' }}
                                            _placeholder={{ color: 'gray.400' }}
                                            isDisabled={isUploadingAttachment}
                                        />
                                        <Button
                                            colorScheme="blue"
                                            size="md"
                                            onClick={handleSendMessage}
                                            isDisabled={!chatInput.trim() || isUploadingAttachment}
                                            isLoading={isUploadingAttachment}
                                        >
                                            Enviar
                                        </Button>
                                    </HStack>
                                </Box>
                            </Flex>
                        ) : (
                            <Flex flex="1" align="center" justify="center" flexDir="column" gap={4} p={8}>
                                <Image src={logo} alt="CuiCall" maxH="100px" objectFit="contain" opacity={0.5} />
                                <Heading size="lg" color="gray.300">{selectedServer.name}</Heading>
                                <Text color="gray.400" textAlign="center" maxW="450px">
                                    Selecione um canal de texto na barra lateral para ver o histórico e conversar, ou entre em um canal de voz para iniciar uma chamada.
                                </Text>
                            </Flex>
                        )}
                    </>
                )}
            </Flex>

            {/* ═══════ Column 4: Members Sidebar (240px) ═══════ */}
            {selectedServer && (
                <Flex w="240px" minW="240px" bg="gray.800" flexDir="column" borderLeft="1px solid" borderColor="gray.700" display={{ base: 'none', xl: 'flex' }}>
                    <Box px={4} py={4}>
                        <Text fontSize="xs" fontWeight="bold" color="gray.500" textTransform="uppercase" letterSpacing="wider" mb={3}>
                            Membros Online — {inVoice ? (1 + remoteStreams.length) : 1}
                        </Text>
                        <VStack align="stretch" spacing={2}>
                            <MemberItem
                                name={userName}
                                avatarUrl={userAvatar}
                                userId={session?.user?.id}
                                status={inVoice ? '🔊 Na Sala de Vídeo' : 'Online'}
                            />
                            {remoteStreams.map(rs => (
                                <MemberItem
                                    key={rs.peerId}
                                    name={rs.peerId.slice(0, 8)}
                                    userId={rs.peerId}
                                    status="🔊 Na Sala de Vídeo"
                                />
                            ))}
                        </VStack>
                    </Box>
                </Flex>
            )}

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

function ChatPanel({ messages, chatInput, setChatInput, handleSendMessage, handleFileSelect, isUploading }: any) {
    const fileInputRef = useRef<HTMLInputElement>(null);

    return (
        <Flex w="300px" minW="300px" flexDir="column" bg="gray.800" borderLeft="1px solid" borderColor="gray.600">
            <Flex h="48px" px={4} align="center" borderBottom="1px solid" borderColor="gray.700" flexShrink={0}>
                <Text fontWeight="bold" color="white" fontSize="sm">Chat da Sala</Text>
            </Flex>
            <Box flex="1" px={2} py={2} position="relative">
                {messages.length === 0 ? (
                    <Text fontSize="sm" color="gray.500" textAlign="center" mt={4}>
                        Nenhuma mensagem ainda. Comece a conversa!
                    </Text>
                ) : (
                    <Virtuoso
                        data={messages}
                        initialTopMostItemIndex={messages.length > 0 ? messages.length - 1 : 0}
                        followOutput="smooth"
                        style={{ height: '100%', width: '100%' }}
                        itemContent={(index: number, msg: any) => (
                            <ChatMessageItem key={index} message={msg} index={index} isCompact={true} />
                        )}
                    />
                )}
            </Box>
            <Box px={3} py={3} borderTop="1px solid" borderColor="gray.700">
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    accept="image/*"
                    style={{ display: 'none' }}
                />
                <HStack spacing={1.5}>
                    <Tooltip label={isUploading ? "Enviando imagem..." : "Enviar anexo"}>
                        <IconButton
                            aria-label="Anexar Imagem"
                            icon={isUploading ? <Spinner size="xs" color="blue.400" /> : <BsPaperclip />}
                            size="sm"
                            variant="ghost"
                            color="gray.400"
                            _hover={{ color: 'white', bg: 'gray.700' }}
                            onClick={() => fileInputRef.current?.click()}
                            isDisabled={isUploading}
                        />
                    </Tooltip>
                    <Input
                        placeholder={isUploading ? "Enviando..." : "Mensagem..."}
                        value={chatInput}
                        onChange={(e: any) => setChatInput(e.target.value)}
                        onKeyDown={(e: any) => e.key === 'Enter' && handleSendMessage()}
                        bg="gray.900" border="none" size="sm" _focus={{ boxShadow: 'none' }}
                        isDisabled={isUploading}
                    />
                    <Button
                        colorScheme="blue"
                        size="sm"
                        onClick={handleSendMessage}
                        isDisabled={!chatInput.trim() || isUploading}
                        isLoading={isUploading}
                    >
                        Enviar
                    </Button>
                </HStack>
            </Box>
        </Flex>
    );
}

function MemberItem({ name, avatarUrl, userId, bg, status }: { name: string; avatarUrl?: string; userId?: string; bg?: string; status: string }) {
    const avatarBg = bg || getAvatarColor(userId || name);
    return (
        <HStack spacing={3} px={2} py={2} borderRadius="md" _hover={{ bg: 'gray.700' }} transition="background 0.15s" cursor="pointer">
            <Box position="relative">
                <Avatar
                    size="sm"
                    name={name}
                    src={avatarUrl}
                    bg={avatarBg}
                    icon={<KuiAvatarIcon fill={avatarBg} />}
                />
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
