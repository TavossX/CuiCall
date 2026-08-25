import React from 'react';
import { Box, HStack, Text, Avatar, Image } from '@chakra-ui/react';
import type { ChatMessage } from '../useWebRTC';
import { getAvatarColor } from '../utils/avatarColors';
import { KuiAvatarIcon } from './KuiAvatar';

interface ChatMessageProps {
    message: ChatMessage;
    index?: number;
    isCompact?: boolean;
    currentUserName?: string;
}

/**
 * Regex robusta para capturar menções no formato @usuario ou @todos/@everyone/@here
 * Suporta caracteres alfanuméricos, acentos, underlines e hífens com isolamento adequado.
 */
const MENTION_REGEX = /(@[a-zA-Z0-9_\-À-ÿ]+)/g;

/**
 * Renderiza o texto da mensagem formatando menções (@) como pílulas (badges) destacadas.
 */
function renderMessageText(text: string, currentUserName?: string) {
    if (!text) return null;
    const parts = text.split(MENTION_REGEX);

    return parts.map((part, idx) => {
        if (part.startsWith('@')) {
            const mentionTarget = part.slice(1);
            const isSelf = currentUserName && mentionTarget.toLowerCase() === currentUserName.toLowerCase();
            const isBroad = ['todos', 'everyone', 'here', 'aqui'].includes(mentionTarget.toLowerCase());

            return (
                <Box
                    as="span"
                    key={idx}
                    px={1.5}
                    py={0.5}
                    mx={0.5}
                    borderRadius="md"
                    fontSize="xs"
                    fontWeight="semibold"
                    bg={isSelf ? 'yellow.900' : isBroad ? 'purple.900' : 'blue.900'}
                    color={isSelf ? 'yellow.200' : isBroad ? 'purple.200' : 'blue.200'}
                    border="1px solid"
                    borderColor={isSelf ? 'yellow.600' : isBroad ? 'purple.600' : 'blue.600'}
                    display="inline-block"
                    lineHeight="shorter"
                    verticalAlign="baseline"
                >
                    {part}
                </Box>
            );
        }
        return <span key={idx}>{part}</span>;
    });
}

/**
 * Componente individual de mensagem de chat otimizado para alta performance.
 * Envolvido em React.memo com comparação customizada para evitar re-renderizações desnecessárias.
 */
export const ChatMessageItem = React.memo(
    function ChatMessageItem({ message, isCompact = false, currentUserName }: ChatMessageProps) {
        const senderInitials = message.senderId ? message.senderId.slice(0, 5) : '??';
        const avatarColor = getAvatarColor(message.senderId);

        const handleImageClick = () => {
            if (message.attachment_url) {
                window.open(message.attachment_url, '_blank');
            }
        };

        if (isCompact) {
            return (
                <HStack spacing={2} align="start" py={1} px={1} _hover={{ bg: 'whiteAlpha.50' }} borderRadius="md" transition="background 0.1s ease">
                    <Avatar
                        size="2xs"
                        name={senderInitials}
                        bg={avatarColor}
                        icon={<KuiAvatarIcon fill={avatarColor} />}
                        mt={0.5}
                    />
                    <Box flex="1" minW={0}>
                        <HStack spacing={1.5} align="baseline">
                            <Text fontSize="2xs" fontWeight="bold" color="gray.300" isTruncated>
                                {message.senderId}
                            </Text>
                        </HStack>
                        {message.text && (
                            <Text fontSize="xs" color="gray.200" wordBreak="break-word" lineHeight="short">
                                {renderMessageText(message.text, currentUserName)}
                            </Text>
                        )}
                        {message.attachment_url && (
                            <Box mt={1.5} maxW="220px">
                                <Image
                                    src={message.attachment_url}
                                    alt="Anexo"
                                    maxH="160px"
                                    borderRadius="md"
                                    objectFit="cover"
                                    cursor="pointer"
                                    onClick={handleImageClick}
                                    _hover={{ opacity: 0.9 }}
                                    transition="opacity 0.15s"
                                    fallback={<Text fontSize="2xs" color="gray.500">Carregando anexo...</Text>}
                                />
                            </Box>
                        )}
                    </Box>
                </HStack>
            );
        }

        return (
            <HStack spacing={3} align="start" py={1.5} px={2} _hover={{ bg: 'whiteAlpha.50' }} borderRadius="md" transition="background 0.1s ease">
                <Avatar
                    size="sm"
                    name={senderInitials}
                    bg={avatarColor}
                    icon={<KuiAvatarIcon fill={avatarColor} />}
                    mt={0.5}
                />
                <Box flex="1" minW={0}>
                    <HStack spacing={2} align="baseline" mb={0.5}>
                        <Text fontSize="sm" fontWeight="bold" color="gray.200">
                            {message.senderId}
                        </Text>
                        <Text fontSize="xs" color="gray.500">
                            agora
                        </Text>
                    </HStack>
                    {message.text && (
                        <Text fontSize="sm" color="gray.300" wordBreak="break-word" lineHeight="tall">
                            {renderMessageText(message.text, currentUserName)}
                        </Text>
                    )}
                    {message.attachment_url && (
                        <Box mt={2} maxW="320px">
                            <Image
                                src={message.attachment_url}
                                alt="Anexo do Chat"
                                maxH="240px"
                                borderRadius="lg"
                                border="1px solid"
                                borderColor="whiteAlpha.200"
                                objectFit="cover"
                                cursor="pointer"
                                onClick={handleImageClick}
                                _hover={{ opacity: 0.95, transform: 'scale(1.01)' }}
                                transition="all 0.15s"
                                shadow="md"
                                fallback={<Text fontSize="xs" color="gray.500">Carregando imagem...</Text>}
                            />
                        </Box>
                    )}
                </Box>
            </HStack>
        );
    },
    (prevProps, nextProps) => {
        return (
            prevProps.message.senderId === nextProps.message.senderId &&
            prevProps.message.text === nextProps.message.text &&
            prevProps.message.attachment_url === nextProps.message.attachment_url &&
            prevProps.isCompact === nextProps.isCompact &&
            prevProps.index === nextProps.index &&
            prevProps.currentUserName === nextProps.currentUserName
        );
    }
);

export default ChatMessageItem;
