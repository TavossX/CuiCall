import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    Box, Flex, HStack, Text, Input, Avatar, IconButton, Tooltip, Spinner, useToast
} from '@chakra-ui/react';
import { Virtuoso } from 'react-virtuoso';
import { BsArrowLeft, BsSendFill, BsPaperclip } from 'react-icons/bs';
import { supabase } from '../supabaseClient';
import { ChatMessageItem } from './ChatMessage';
import { getCache, setCache, getDMCacheKey } from '../utils/chatCache';
import type { ChatMessage } from '../useWebRTC';
import type { FriendProfile } from './FriendsView';
import { getAvatarColor } from '../utils/avatarColors';
import { KuiAvatarIcon } from './KuiAvatar';
import { TypingIndicator } from './TypingIndicator';

interface DMPanelProps {
    currentUserId: string;
    currentUserName: string;
    targetFriend: FriendProfile;
    messages: ChatMessage[];
    onSendMessage: (receiverId: string, text: string, data?: any) => void;
    onBack: () => void;
    loadMessages: (partnerId: string, msgs: ChatMessage[]) => void;
    isPartnerTyping?: boolean;
    onSendTyping?: () => void;
}

export const DMPanel = ({
    currentUserId,
    currentUserName,
    targetFriend,
    messages,
    onSendMessage,
    onBack,
    loadMessages,
    isPartnerTyping = false,
    onSendTyping,
}: DMPanelProps) => {
    const [inputText, setInputText] = useState('');
    const [loading, setLoading] = useState(true);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const lastTypingSentRef = useRef<number>(0);
    const toast = useToast();

    // Carrega histórico de DMs entre os dois usuários no Supabase
    const fetchDMHistory = useCallback(async () => {
        if (!currentUserId || !targetFriend.id) return;
        
        const cacheKey = getDMCacheKey(currentUserId, targetFriend.id);
        const cached = getCache(cacheKey);
        if (cached) {
            loadMessages(targetFriend.id, cached);
            setLoading(false);
            return;
        }

        setLoading(true);

        try {
            const { data, error } = await supabase
                .from('direct_messages')
                .select('*')
                .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${targetFriend.id}),and(sender_id.eq.${targetFriend.id},receiver_id.eq.${currentUserId})`)
                .order('created_at', { ascending: true });

            if (!error && data) {
                const partnerName = targetFriend.display_name || targetFriend.username || targetFriend.email?.split('@')[0] || targetFriend.id.slice(0, 8);
                const formatted: ChatMessage[] = data.map((m: any) => {
                    let text = m.text || m.content || '';
                    let attachment = m.attachment_url || null;

                    // Extrai URL de imagem caso o schema armazene o anexo dentro do texto por fallback
                    if (!attachment && text) {
                        const urlMatch = text.match(/(https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|svg|bmp)(\?[^\s]*)?)/i);
                        if (urlMatch) {
                            attachment = urlMatch[0];
                            text = text.replace(urlMatch[0], '').trim();
                        }
                    }

                    return {
                        id: m.id,
                        senderId: m.sender_id === currentUserId ? currentUserName : partnerName,
                        text,
                        attachment_url: attachment,
                        created_at: m.created_at,
                    };
                });
                setCache(cacheKey, formatted);
                loadMessages(targetFriend.id, formatted);
            }
        } catch (err) {
            console.error('Erro ao carregar DMs:', err);
        } finally {
            setLoading(false);
        }
    }, [currentUserId, targetFriend.id, targetFriend.username, targetFriend.display_name, targetFriend.email, currentUserName, loadMessages]);

    useEffect(() => {
        fetchDMHistory();
    }, [fetchDMHistory]);

    // Upload de anexo e envio
    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !currentUserId || !targetFriend.id) return;

        // Reset input
        e.target.value = '';

        if (!file.type.startsWith('image/')) {
            toast({ title: 'Formato não suportado', description: 'Por favor, envie apenas imagens (PNG, JPG, GIF, WebP).', status: 'warning' });
            return;
        }

        if (file.size > 10 * 1024 * 1024) {
            toast({ title: 'Arquivo muito grande', description: 'O tamanho máximo é 10MB.', status: 'warning' });
            return;
        }

        setIsUploading(true);

        try {
            const fileExt = file.name.split('.').pop() || 'png';
            const fileName = `dm-${currentUserId}-${Date.now()}.${fileExt}`;

            let bucketName = 'chat_attachments';
            let { error: uploadError } = await supabase.storage
                .from(bucketName)
                .upload(fileName, file, { upsert: true });

            // Se o bucket chat_attachments não existir, tenta o bucket images
            if (uploadError && uploadError.message?.toLowerCase().includes('bucket not found')) {
                bucketName = 'images';
                const retryUpload = await supabase.storage
                    .from(bucketName)
                    .upload(fileName, file, { upsert: true });
                uploadError = retryUpload.error;
            }

            if (uploadError) {
                console.error('Erro no upload para storage:', uploadError);
                toast({ title: 'Erro no envio do anexo', description: uploadError.message, status: 'error' });
                return;
            }

            const { data } = supabase.storage.from(bucketName).getPublicUrl(fileName);
            const attachmentUrl = data.publicUrl;

            // Salva no banco com o anexo
            const textContent = inputText.trim();
            let { data: insertedMsg, error: insertError } = await supabase
                .from('direct_messages')
                .insert([{
                    sender_id: currentUserId,
                    receiver_id: targetFriend.id,
                    text: textContent,
                    attachment_url: attachmentUrl
                }])
                .select()
                .single();

            // Fallback se a coluna attachment_url não existir no schema da tabela direct_messages
            if (insertError && (insertError.message.includes('attachment_url') || insertError.message.includes('column'))) {
                const fallbackText = textContent ? `${textContent}\n${attachmentUrl}` : attachmentUrl;
                const retry = await supabase
                    .from('direct_messages')
                    .insert([{
                        sender_id: currentUserId,
                        receiver_id: targetFriend.id,
                        text: fallbackText
                    }])
                    .select()
                    .single();
                insertedMsg = retry.data;
                insertError = retry.error;
            }

            if (insertError) throw insertError;

            setInputText('');

            // Dispara SignalR
            onSendMessage(targetFriend.id, textContent, {
                id: insertedMsg?.id,
                senderName: currentUserName,
                attachment_url: attachmentUrl,
                created_at: insertedMsg?.created_at,
            });

            // Atualiza local
            const newMsg: ChatMessage = {
                id: insertedMsg?.id,
                senderId: currentUserName,
                text: textContent,
                attachment_url: attachmentUrl,
                created_at: insertedMsg?.created_at,
            };
            loadMessages(targetFriend.id, [...(messages || []), newMsg]);

        } catch (err: any) {
            console.error('Erro ao enviar imagem DM:', err);
            toast({ title: 'Erro ao enviar imagem', description: err.message, status: 'error' });
        } finally {
            setIsUploading(false);
        }
    };

    // Envio de nova mensagem direta
    const handleSend = async () => {
        const text = inputText.trim();
        if (!text || !currentUserId || !targetFriend.id || isUploading) return;

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
                        <Avatar
                            size="xs"
                            name={friendDisplayName}
                            src={targetFriend.avatar_url}
                            bg={getAvatarColor(targetFriend.id)}
                            icon={<KuiAvatarIcon fill={getAvatarColor(targetFriend.id)} />}
                        />
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
                        <Avatar
                            size="xl"
                            name={friendDisplayName}
                            src={targetFriend.avatar_url}
                            bg={getAvatarColor(targetFriend.id)}
                            icon={<KuiAvatarIcon fill={getAvatarColor(targetFriend.id)} />}
                            opacity={0.8}
                        />
                        <Text fontWeight="bold" fontSize="md" color="gray.300">
                            Este é o início da sua conversa direta com @{friendDisplayName}
                        </Text>
                        <Text fontSize="xs" color="gray.500">
                            Envie uma mensagem ou imagem para começar!
                        </Text>
                    </Flex>
                ) : (
                    <Virtuoso
                        data={messages || []}
                        initialTopMostItemIndex={messages && messages.length > 0 ? messages.length - 1 : 0}
                        followOutput="smooth"
                        style={{ height: '100%', width: '100%' }}
                        itemContent={(index, msg) => (
                            <ChatMessageItem key={index} message={msg} index={index} currentUserName={currentUserName} />
                        )}
                    />
                )}
            </Box>

            {/* Indicador Visual de Digitação */}
            {isPartnerTyping && (
                <Box px={4} py={1} bg="gray.800" borderTop="1px solid" borderColor="gray.700">
                    <TypingIndicator partnerName={friendDisplayName} isDM={true} />
                </Box>
            )}

            {/* Input de Mensagem */}
            <Box px={4} py={3} borderTop="1px solid" borderColor="gray.600" bg="gray.750">
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    accept="image/*"
                    style={{ display: 'none' }}
                />
                <HStack spacing={2}>
                    <Tooltip label={isUploading ? "Enviando anexo..." : "Enviar imagem"}>
                        <IconButton
                            aria-label="Anexar Imagem"
                            icon={isUploading ? <Spinner size="xs" color="blue.400" /> : <BsPaperclip />}
                            size="md"
                            variant="ghost"
                            color="gray.400"
                            _hover={{ color: 'white', bg: 'gray.700' }}
                            onClick={() => fileInputRef.current?.click()}
                            isDisabled={isUploading}
                        />
                    </Tooltip>
                    <Input
                        placeholder={isUploading ? "Enviando imagem..." : `Conversar com @${friendDisplayName}`}
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                handleSend();
                                return;
                            }
                            if (onSendTyping) {
                                const now = Date.now();
                                if (now - lastTypingSentRef.current > 3000) {
                                    lastTypingSentRef.current = now;
                                    onSendTyping();
                                }
                            }
                        }}
                        bg="gray.800"
                        border="none"
                        size="md"
                        borderRadius="lg"
                        _focus={{ boxShadow: 'none', bg: 'gray.850' }}
                        _placeholder={{ color: 'gray.400' }}
                        isDisabled={isUploading}
                    />
                    <IconButton
                        aria-label="Enviar"
                        icon={<BsSendFill />}
                        colorScheme="blue"
                        size="md"
                        borderRadius="lg"
                        onClick={handleSend}
                        isDisabled={(!inputText.trim() && !isUploading) || isUploading}
                        isLoading={isUploading}
                    />
                </HStack>
            </Box>
        </Flex>
    );
};
