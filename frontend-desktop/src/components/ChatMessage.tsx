import React from 'react';
import { Box, HStack, Text, Avatar } from '@chakra-ui/react';
import type { ChatMessage } from '../useWebRTC';
import { getAvatarColor } from '../utils/avatarColors';
import { KuiAvatarIcon } from './KuiAvatar';

interface ChatMessageProps {
    message: ChatMessage;
    index?: number;
    isCompact?: boolean;
}

/**
 * Componente individual de mensagem de chat otimizado para alta performance.
 * Envolvido em React.memo com comparação customizada para evitar re-renderizações desnecessárias.
 */
export const ChatMessageItem = React.memo(
    function ChatMessageItem({ message, isCompact = false }: ChatMessageProps) {
        const senderInitials = message.senderId ? message.senderId.slice(0, 5) : '??';
        const avatarColor = getAvatarColor(message.senderId);

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
                        <Text fontSize="xs" color="gray.200" wordBreak="break-word" lineHeight="short">
                            {message.text}
                        </Text>
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
                    <Text fontSize="sm" color="gray.300" wordBreak="break-word" lineHeight="tall">
                        {message.text}
                    </Text>
                </Box>
            </HStack>
        );
    },
    (prevProps, nextProps) => {
        return (
            prevProps.message.senderId === nextProps.message.senderId &&
            prevProps.message.text === nextProps.message.text &&
            prevProps.isCompact === nextProps.isCompact &&
            prevProps.index === nextProps.index
        );
    }
);
