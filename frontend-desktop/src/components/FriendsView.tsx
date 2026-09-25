import { useState, useEffect, useCallback } from 'react';
import {
    Box, Flex, VStack, HStack, Text, Heading, Input, Button, Tabs, TabList, TabPanels, Tab, TabPanel,
    Avatar, Badge, IconButton, Tooltip, useToast, Spinner
} from '@chakra-ui/react';
import { supabase } from '../supabaseClient';
import { BsChatDotsFill, BsCheckLg, BsXLg, BsPersonPlusFill, BsPersonCheckFill, BsClockHistory } from 'react-icons/bs';
import { getAvatarColor } from '../utils/avatarColors';
import { KuiAvatarIcon } from './KuiAvatar';

export interface FriendProfile {
    id: string;
    display_name?: string;
    avatar_url?: string;
    username?: string;
    email?: string;
}

export interface FriendshipItem {
    id: string;
    requester_id: string;
    addressee_id: string;
    status: 'pending' | 'accepted' | 'blocked';
    created_at: string;
    profile: FriendProfile;
    isIncoming?: boolean;
}

interface FriendsViewProps {
    currentUserId: string;
    currentUserName: string;
    onSelectFriend: (friend: FriendProfile) => void;
    onSendFriendRequestSignal: (targetUserId: string, data: any) => void;
    onAcceptFriendRequestSignal: (requesterId: string, data: any) => void;
}

export const FriendsView = ({
    currentUserId,
    currentUserName,
    onSelectFriend,
    onSendFriendRequestSignal,
    onAcceptFriendRequestSignal,
}: FriendsViewProps) => {
    const [tabIndex, setTabIndex] = useState(0);
    const [friends, setFriends] = useState<FriendshipItem[]>([]);
    const [pendingRequests, setPendingRequests] = useState<FriendshipItem[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchLoading, setSearchLoading] = useState(false);
    const [loading, setLoading] = useState(true);
    const toast = useToast();

    // Carrega a lista de amizades e solicitações do Supabase
    const fetchFriendships = useCallback(async () => {
        if (!currentUserId) return;
        try {
            // 1. Busca todas as amizades onde o usuário participa
            const { data: friendshipsData, error } = await supabase
                .from('friendships')
                .select('*')
                .or(`requester_id.eq.${currentUserId},addressee_id.eq.${currentUserId}`);

            if (error) throw error;

            if (friendshipsData) {
                // Coleta os IDs de todos os parceiros
                const partnerIds = friendshipsData.map(f =>
                    f.requester_id === currentUserId ? f.addressee_id : f.requester_id
                );

                // 2. Busca os perfis correspondentes
                let profilesMap: Record<string, FriendProfile> = {};
                if (partnerIds.length > 0) {
                    const { data: profilesData } = await supabase
                        .from('profiles')
                        .select('id, display_name, avatar_url')
                        .in('id', partnerIds);

                    if (profilesData) {
                        profilesMap = profilesData.reduce((acc, p: any) => ({
                            ...acc,
                            [p.id]: {
                                id: p.id,
                                display_name: p.display_name,
                                avatar_url: p.avatar_url,
                                username: p.display_name || p.id.slice(0, 8),
                            },
                        }), {});
                    }
                }

                const acceptedList: FriendshipItem[] = [];
                const pendingList: FriendshipItem[] = [];

                friendshipsData.forEach(f => {
                    const partnerId = f.requester_id === currentUserId ? f.addressee_id : f.requester_id;
                    const partnerProfile = profilesMap[partnerId] || {
                        id: partnerId,
                        display_name: partnerId.slice(0, 8),
                        username: partnerId.slice(0, 8),
                    };

                    const item: FriendshipItem = {
                        ...f,
                        profile: partnerProfile,
                        isIncoming: f.addressee_id === currentUserId,
                    };

                    if (f.status === 'accepted') {
                        acceptedList.push(item);
                    } else if (f.status === 'pending') {
                        pendingList.push(item);
                    }
                });

                setFriends(acceptedList);
                setPendingRequests(pendingList);
            }
        } catch (err: any) {
            console.error('Erro ao carregar amizades:', err);
        } finally {
            setLoading(false);
        }
    }, [currentUserId]);

    useEffect(() => {
        fetchFriendships();

        // Escuta eventos globais de sinalização para atualizar a lista
        const handleSignalUpdate = () => {
            fetchFriendships();
        };

        window.addEventListener('cuicall:friendRequestReceived', handleSignalUpdate);
        window.addEventListener('cuicall:friendRequestAccepted', handleSignalUpdate);

        return () => {
            window.removeEventListener('cuicall:friendRequestReceived', handleSignalUpdate);
            window.removeEventListener('cuicall:friendRequestAccepted', handleSignalUpdate);
        };
    }, [fetchFriendships]);

    // Enviar solicitação de amizade por nome de exibição ou UUID
    const handleSendRequest = async () => {
        const query = searchQuery.trim();
        if (!query) return;

        setSearchLoading(true);
        try {
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query);
            let targetProfile: any = null;
            let searchErr: any = null;

            if (isUuid) {
                const res = await supabase
                    .from('profiles')
                    .select('id, display_name, avatar_url')
                    .eq('id', query)
                    .maybeSingle();
                targetProfile = res.data;
                searchErr = res.error;
            } else {
                // Busca por display_name (case-insensitive)
                const resDisplay = await supabase
                    .from('profiles')
                    .select('id, display_name, avatar_url')
                    .ilike('display_name', query)
                    .maybeSingle();

                targetProfile = resDisplay.data;
                searchErr = resDisplay.error;
            }

            if (searchErr || !targetProfile) {
                toast({
                    title: 'Usuário não encontrado',
                    description: 'Verifique se o nome de exibição ou ID foi digitado corretamente.',
                    status: 'error',
                    duration: 3000,
                    isClosable: true,
                });
                return;
            }

            const targetName = targetProfile.display_name || targetProfile.id.slice(0, 8);

            if (targetProfile.id === currentUserId) {
                toast({
                    title: 'Operação inválida',
                    description: 'Você não pode adicionar a si mesmo.',
                    status: 'warning',
                    duration: 3000,
                    isClosable: true,
                });
                return;
            }

            // Insere a amizade no Supabase
            const { data: newFriendship, error: insertErr } = await supabase
                .from('friendships')
                .insert([{ requester_id: currentUserId, addressee_id: targetProfile.id, status: 'pending' }])
                .select()
                .single();

            if (insertErr) {
                if (insertErr.code === '23505') {
                    toast({
                        title: 'Solicitação já existente',
                        description: 'Você já possui uma solicitação ou amizade com este usuário.',
                        status: 'info',
                        duration: 3000,
                        isClosable: true,
                    });
                    return;
                }
                throw insertErr;
            }

            // Dispara sinalização em tempo real para o destinatário via SignalR
            onSendFriendRequestSignal(targetProfile.id, {
                requesterId: currentUserId,
                requesterName: currentUserName,
                friendshipId: newFriendship?.id,
            });

            toast({
                title: 'Solicitação enviada!',
                description: `Pedido de amizade enviado para ${targetName}.`,
                status: 'success',
                duration: 3000,
                isClosable: true,
            });

            setSearchQuery('');
            fetchFriendships();
        } catch (err: any) {
            toast({
                title: 'Erro ao enviar pedido',
                description: err.message || 'Ocorreu um erro ao enviar a solicitação.',
                status: 'error',
                duration: 3000,
                isClosable: true,
            });
        } finally {
            setSearchLoading(false);
        }
    };

    // Aceitar solicitação de amizade
    const handleAccept = async (item: FriendshipItem) => {
        try {
            const { error } = await supabase
                .from('friendships')
                .update({ status: 'accepted', updated_at: new Date().toISOString() })
                .eq('id', item.id);

            if (error) throw error;

            onAcceptFriendRequestSignal(item.profile.id, {
                accepterId: currentUserId,
                accepterName: currentUserName,
            });

            toast({
                title: 'Amizade aceita!',
                description: `Agora você e ${item.profile.display_name || item.profile.username} são amigos.`,
                status: 'success',
                duration: 2500,
                isClosable: true,
            });

            fetchFriendships();
        } catch (err: any) {
            console.error('Erro ao aceitar amizade:', err);
        }
    };

    // Recusar ou cancelar solicitação de amizade
    const handleRemoveOrReject = async (item: FriendshipItem) => {
        try {
            const { error } = await supabase
                .from('friendships')
                .delete()
                .eq('id', item.id);

            if (error) throw error;

            toast({
                title: item.status === 'accepted' ? 'Amizade removida' : 'Solicitação cancelada',
                status: 'info',
                duration: 2000,
                isClosable: true,
            });

            fetchFriendships();
        } catch (err: any) {
            console.error('Erro ao remover/recusar amizade:', err);
        }
    };

    return (
        <Tabs
            variant="soft-rounded"
            colorScheme="blue"
            index={tabIndex}
            onChange={setTabIndex}
            size="sm"
            display="flex"
            flexDirection="column"
            flex="1"
            overflow="hidden"
            bg="gray.700"
        >
            {/* Topbar das Abas de Amigos */}
            <Flex h="48px" px={4} align="center" borderBottom="1px solid" borderColor="gray.600" bg="gray.750" gap={4} flexShrink={0}>
                <HStack spacing={2}>
                    <Box as={BsPersonCheckFill} color="teal.400" fontSize="18px" />
                    <Text fontWeight="bold" color="white">Amigos</Text>
                </HStack>

                <Box w="1px" h="20px" bg="gray.600" />

                <TabList gap={2}>
                    <Tab color="gray.300" _selected={{ color: 'white', bg: 'blue.600' }}>
                        Disponíveis ({friends.length})
                    </Tab>
                    <Tab color="gray.300" _selected={{ color: 'white', bg: 'blue.600' }}>
                        Pendentes {pendingRequests.length > 0 && <Badge ml={1.5} colorScheme="red" borderRadius="full">{pendingRequests.length}</Badge>}
                    </Tab>
                    <Tab color="green.300" _selected={{ color: 'white', bg: 'green.600' }}>
                        Adicionar Amigo
                    </Tab>
                </TabList>
            </Flex>

            {/* Conteúdo das Abas */}
            <Box flex="1" overflowY="auto" p={6}>
                {loading ? (
                    <Flex justify="center" align="center" h="200px">
                        <Spinner size="lg" color="blue.400" />
                    </Flex>
                ) : (
                    <TabPanels>
                        {/* Aba 1: Amigos Disponíveis / Aceitos */}
                        <TabPanel p={0}>
                            <VStack align="stretch" spacing={3}>
                                <Text fontSize="xs" fontWeight="bold" color="gray.400" textTransform="uppercase" letterSpacing="wider" mb={2}>
                                    Todos os Amigos — {friends.length}
                                </Text>

                                {friends.length === 0 ? (
                                    <Flex flexDir="column" align="center" justify="center" py={12} color="gray.500" gap={3}>
                                        <Box as={BsPersonPlusFill} fontSize="48px" opacity={0.4} />
                                        <Text fontSize="md">Nenhum amigo adicionado ainda.</Text>
                                        <Button size="sm" colorScheme="green" onClick={() => setTabIndex(2)}>
                                             Adicionar seu primeiro amigo
                                        </Button>
                                    </Flex>
                                ) : (
                                    friends.map(friend => {
                                        const name = friend.profile.display_name || friend.profile.username || friend.profile.id.slice(0, 8);
                                        return (
                                            <Flex
                                                key={friend.id}
                                                align="center" justify="space-between"
                                                p={3} borderRadius="lg" bg="gray.800"
                                                _hover={{ bg: 'gray.750' }} transition="all 0.15s"
                                                border="1px solid" borderColor="gray.650"
                                            >
                                                <HStack spacing={3}>
                                                    <Box position="relative">
                                                        <Avatar
                                                            size="md"
                                                            name={name}
                                                            src={friend.profile.avatar_url}
                                                            bg={getAvatarColor(friend.profile.id)}
                                                            icon={<KuiAvatarIcon fill={getAvatarColor(friend.profile.id)} />}
                                                        />
                                                        <Box position="absolute" bottom="-1px" right="-1px" w="12px" h="12px" borderRadius="full" bg="green.400" border="2px solid" borderColor="gray.800" />
                                                    </Box>
                                                    <Box>
                                                        <Text fontWeight="bold" color="white" fontSize="sm">
                                                            {name}
                                                        </Text>
                                                        <Text fontSize="xs" color="gray.400">
                                                            {friend.profile.display_name ? `@${friend.profile.display_name}` : friend.profile.id.slice(0, 8)}
                                                        </Text>
                                                    </Box>
                                                </HStack>

                                                <HStack spacing={2}>
                                                    <Tooltip label="Iniciar Conversa (DM)">
                                                        <IconButton
                                                            aria-label="Abrir DM"
                                                            icon={<BsChatDotsFill />}
                                                            colorScheme="blue"
                                                            size="sm"
                                                            onClick={() => onSelectFriend(friend.profile)}
                                                        />
                                                    </Tooltip>
                                                    <Tooltip label="Remover Amizade">
                                                        <IconButton
                                                            aria-label="Remover"
                                                            icon={<BsXLg />}
                                                            variant="ghost"
                                                            color="gray.400"
                                                            _hover={{ color: 'red.400', bg: 'gray.700' }}
                                                            size="sm"
                                                            onClick={() => handleRemoveOrReject(friend)}
                                                        />
                                                    </Tooltip>
                                                </HStack>
                                            </Flex>
                                        );
                                    })
                                )}
                            </VStack>
                        </TabPanel>

                        {/* Aba 2: Pendentes */}
                        <TabPanel p={0}>
                            <VStack align="stretch" spacing={3}>
                                <Text fontSize="xs" fontWeight="bold" color="gray.400" textTransform="uppercase" letterSpacing="wider" mb={2}>
                                    Solicitações Pendentes — {pendingRequests.length}
                                </Text>

                                {pendingRequests.length === 0 ? (
                                    <Flex flexDir="column" align="center" justify="center" py={12} color="gray.500" gap={2}>
                                        <Box as={BsClockHistory} fontSize="40px" opacity={0.4} />
                                        <Text fontSize="sm">Não há pedidos de amizade pendentes no momento.</Text>
                                    </Flex>
                                ) : (
                                    pendingRequests.map(item => {
                                        const name = item.profile.display_name || item.profile.username || item.profile.id.slice(0, 8);
                                        return (
                                            <Flex
                                                key={item.id}
                                                align="center" justify="space-between"
                                                p={3} borderRadius="lg" bg="gray.800"
                                                border="1px solid" borderColor="gray.650"
                                            >
                                                <HStack spacing={3}>
                                                    <Avatar
                                                        size="md"
                                                        name={name}
                                                        src={item.profile.avatar_url}
                                                        bg={getAvatarColor(item.profile.id)}
                                                        icon={<KuiAvatarIcon fill={getAvatarColor(item.profile.id)} />}
                                                    />
                                                    <Box>
                                                        <HStack spacing={2}>
                                                            <Text fontWeight="bold" color="white" fontSize="sm">
                                                                {name}
                                                            </Text>
                                                            <Badge colorScheme={item.isIncoming ? 'green' : 'gray'} fontSize="2xs">
                                                                {item.isIncoming ? 'Recebido' : 'Enviado'}
                                                            </Badge>
                                                        </HStack>
                                                        <Text fontSize="xs" color="gray.400">
                                                            {item.profile.display_name ? `@${item.profile.display_name}` : item.profile.id.slice(0, 8)}
                                                        </Text>
                                                    </Box>
                                                </HStack>

                                                <HStack spacing={2}>
                                                    {item.isIncoming ? (
                                                        <>
                                                            <Tooltip label="Aceitar Pedido">
                                                                <IconButton
                                                                    aria-label="Aceitar"
                                                                    icon={<BsCheckLg />}
                                                                    colorScheme="green"
                                                                    size="sm"
                                                                    onClick={() => handleAccept(item)}
                                                                />
                                                            </Tooltip>
                                                            <Tooltip label="Recusar Pedido">
                                                                <IconButton
                                                                    aria-label="Recusar"
                                                                    icon={<BsXLg />}
                                                                    colorScheme="red"
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={() => handleRemoveOrReject(item)}
                                                                />
                                                            </Tooltip>
                                                        </>
                                                    ) : (
                                                        <Tooltip label="Cancelar Solicitação">
                                                            <IconButton
                                                                aria-label="Cancelar"
                                                                icon={<BsXLg />}
                                                                variant="ghost"
                                                                color="gray.400"
                                                                _hover={{ color: 'red.400', bg: 'gray.700' }}
                                                                size="sm"
                                                                onClick={() => handleRemoveOrReject(item)}
                                                            />
                                                        </Tooltip>
                                                    )}
                                                </HStack>
                                            </Flex>
                                        );
                                    })
                                )}
                            </VStack>
                        </TabPanel>

                        {/* Aba 3: Adicionar Amigo */}
                        <TabPanel p={0}>
                            <Box maxW="600px">
                                <Heading size="sm" color="white" mb={2}>Adicionar Amigo</Heading>
                                <Text fontSize="sm" color="gray.400" mb={4}>
                                    Você pode adicionar um amigo usando o nome de exibição ou o identificador único (UUID) da conta dele.
                                </Text>

                                <HStack spacing={3}>
                                    <Input
                                        placeholder="ex: Nome do Amigo ou UUID"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSendRequest()}
                                        bg="gray.800"
                                        border="1px solid"
                                        borderColor="gray.600"
                                        size="md"
                                        borderRadius="lg"
                                        _focus={{ borderColor: 'green.500', boxShadow: 'none' }}
                                    />
                                    <Button
                                        colorScheme="green"
                                        size="md"
                                        onClick={handleSendRequest}
                                        isLoading={searchLoading}
                                        isDisabled={!searchQuery.trim()}
                                        leftIcon={<BsPersonPlusFill />}
                                    >
                                        Enviar Pedido
                                    </Button>
                                </HStack>
                            </Box>
                        </TabPanel>
                    </TabPanels>
                )}
            </Box>
        </Tabs>
    );
};
