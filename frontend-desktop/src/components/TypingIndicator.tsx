import React from 'react';
import { Box, HStack, Text } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';

const bounce = keyframes`
  0%, 80%, 100% {
    transform: scale(0.6);
    opacity: 0.4;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
`;

interface TypingIndicatorProps {
    users?: string[];
    partnerName?: string;
    isDM?: boolean;
}

/**
 * Componente visual animado para indicar digitação em tempo real.
 * Renderizado logo acima da barra de input de mensagens.
 */
export const TypingIndicator: React.FC<TypingIndicatorProps> = React.memo(({ users = [], partnerName, isDM = false }) => {
    if (!isDM && users.length === 0) return null;
    if (isDM && !partnerName) return null;

    let message = '';
    if (isDM) {
        message = `${partnerName} está digitando...`;
    } else {
        if (users.length === 1) {
            message = `${users[0]} está digitando...`;
        } else if (users.length === 2) {
            message = `${users[0]} e ${users[1]} estão digitando...`;
        } else {
            message = 'Várias pessoas estão digitando...';
        }
    }

    return (
        <HStack
            spacing={2}
            px={3}
            py={1}
            h="24px"
            align="center"
            fontSize="xs"
            color="gray.400"
            transition="all 0.2s ease"
        >
            <HStack spacing={1} align="center">
                <Box
                    w="5px"
                    h="5px"
                    borderRadius="full"
                    bg="blue.400"
                    animation={`${bounce} 1.4s infinite ease-in-out both`}
                />
                <Box
                    w="5px"
                    h="5px"
                    borderRadius="full"
                    bg="blue.400"
                    animation={`${bounce} 1.4s infinite ease-in-out both`}
                    style={{ animationDelay: '0.2s' }}
                />
                <Box
                    w="5px"
                    h="5px"
                    borderRadius="full"
                    bg="blue.400"
                    animation={`${bounce} 1.4s infinite ease-in-out both`}
                    style={{ animationDelay: '0.4s' }}
                />
            </HStack>
            <Text fontWeight="medium" color="gray.300" isTruncated maxW="400px">
                {message}
            </Text>
        </HStack>
    );
});

export default TypingIndicator;
