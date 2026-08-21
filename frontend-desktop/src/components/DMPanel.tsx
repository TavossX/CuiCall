import { useState, useEffect, useCallback } from 'react';
import { Box, Flex, HStack, Text, Input, Avatar, IconButton, Tooltip } from '@chakra-ui/react';
import { Virtuoso } from 'react-virtuoso';
import { BsArrowLeft, BsSendFill } from 'react-icons/bs';
import { supabase } from '../supabaseClient';
import { ChatMessageItem } from './ChatMessage';
import type { ChatMessage } from '../useWebRTC';
import type { FriendProfile } from './FriendsView';

interface DMPanelProps {
    currentUserId: string;
    currentUserName: string;
    targetFriend: FriendProfile;
    messages: ChatMessage[];
    onSendMessage: (receiverId: string, text: string, data?: any) => void;
    onBack: () => void;
    loadMessages: (partnerId: string, msgs: ChatMessage[]) => void;
}

export const DMPanel = ({
    currentUserId,
    currentUserName,
    targetFriend,
    messages,
    onSendMessage,
    onBack,
    loadMessages,
}: DMPanelProps) => {
    const [inputText, setInputText] = useState('');
    const [loading, setLoading] = useState(true);

    // Carrega histórico de DMs entre os dois usuários no Supabase
    const fetchDMHistory = useCallback(async () => {
        if (!currentUserId || !targetFriend.id) return;
        setLoading(true);

        try {
            const { data, error } = await supabase
                .from('direct_messages')
                .select('*')
                .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${targetFriend.id}),and(sender_id.eq.${targetFriend.id},receiver_id.eq.${currentUserId})`)
                .order('created_at', { ascending: true });

            if (!error && data) {
                const formatted: ChatMessage[] = data.map((m: any) => ({
                    id: m.id,
                    senderId: m.sender_id === currentUserId ? currentUserName : (targetFriend.username || targetFriend.email.split('@')[0]),
                    text: m.text,
                    created_at: m.created_at,
                }));
                loadMessages(targetFriend.id, formatted);
            }
        } catch (err) {
            console.error('Erro ao carregar DMs:', err);
        } finally {
            setLoading(false);
        }
    }, [currentUserId, targetFriend, currentUserName, loadMessages]);

    useEffect(() => {
        fetchDMHistory();
    }, [fetchDMHistory]);

    // Envio de nova mensagem direta
    const handleSend = async () => {
        const text = inputText.trim();
        if (!text || !currentUserId || !targetFriend.id) return;

        setInputText('');

        try {
            // 1. Salva no banco de dados Supabase
            const { data: insertedMsg, error } = await supabase
                .from('direct_messages')
                .insert([{ sender_id: currentUserId, receiver_id: targetFriend.id, text }])
                .select()
                .single();

            if (error) throw error;

            // 2. Dispara sinalização em tempo real via SignalR
            onSendMessage(targetFriend.id, text, {
                id: insertedMsg?.id,
                senderName: currentUserName,
                created_at: insertedMsg?.created_at,
            });

            // 3. Atualiza localmente
            const newMsg: ChatMessage = {
                id: insertedMsg?.id,
                senderId: currentUserName,
                text,
                created_at: insertedMsg?.created_at,
            };
            loadMessages(targetFriend.id, [...(messages || []), newMsg]);
        } catch (err) {
            console.error('Erro ao enviar direct message:', err);
        }
    };

    const friendDisplayName = targetFriend.username || targetFriend.email.split('@')[0];

    return (
        <Flex flex="1" flexDir="column" bg="gray.700" overflow="hidden">
            {/* Topbar da DM */}
            <Flex h="48px" px={4} align="center" borderBottom="1px solid" borderColor="gray.600" bg="gray.750" justify="space-between" flexShrink={0}>
                <HStack spacing={3}>
                    <Tooltip label="Voltar para a lista de amigos">
                        <IconButton
                            aria-label="Voltar"
                            icon={<BsArrowLeft />}
                            size="sm"
                            variant="ghost"
                            color="gray.400"
                            _hover={{ color: 'white', bg: 'gray.700' }}
                            onClick={onBack}
                        />
                    </Tooltip>
                    <Box position="relative">
                        <Avatar size="xs" name={friendDisplayName} bg="blue.600" />
                        <Box position="absolute" bottom="-1px" right="-1px" w="7px" h="7px" borderRadius="full" bg="green.400" border="1.5px solid" borderColor="gray.800" />
                    </Box>
                    <Box>
                        <Text fontWeight="bold" color="white" fontSize="sm">
                            @{friendDisplayName}
                        </Text>
                        <Text fontSize="10px" color="gray.400">
                            {targetFriend.email}
                        </Text>
                    </Box>
                </HStack>
            </Flex>

            {/* Container Virtualizado com Virtuoso */}
            <Box flex="1" px={4} py={2} position="relative" overflow="hidden">
                {!loading && (!messages || messages.length === 0) ? (
                    <Flex flex="1" align="center" justify="center" flexDir="column" gap={3} h="100%" color="gray.500">
                        <Avatar size="xl" name={friendDisplayName} bg="blue.600" opacity={0.6} />
                        <Text fontWeight="bold" fontSize="md" color="gray.300">
                            Este é o início da sua conversa direta com @{friendDisplayName}
                        </Text>
                        <Text fontSize="xs" color="gray.500">
                            Envie uma mensagem para começar!
                        </Text>
                    </Flex>
                ) : (
                    <Virtuoso
                        data={messages || []}
                        initialTopMostItemIndex={messages && messages.length > 0 ? messages.length - 1 : 0}
                        followOutput="smooth"
                        style={{ height: '100%', width: '100%' }}
                        itemContent={(index, msg) => (
                            <ChatMessageItem key={index} message={msg} index={index} />
                        )}
                    />
                )}
            </Box>

            {/* Input de Mensagem */}
            <Box px={4} py={3} borderTop="1px solid" borderColor="gray.600" bg="gray.750">
                <HStack>
                    <Input
                        placeholder={`Conversar com @${friendDisplayName}`}
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        bg="gray.800"
                        border="none"
                        size="md"
                        borderRadius="lg"
                        _focus={{ boxShadow: 'none', bg: 'gray.850' }}
                        _placeholder={{ color: 'gray.400' }}
                    />
                    <IconButton
                        aria-label="Enviar"
                        icon={<BsSendFill />}
                        colorScheme="blue"
                        size="md"
                        onClick={handleSend}
                        isDisabled={!inputText.trim()}
                    />
                </HStack>
            </Box>
        </Flex>
    );
};
