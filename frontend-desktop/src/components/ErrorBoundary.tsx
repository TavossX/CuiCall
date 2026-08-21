import { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Button, Heading, Text, VStack, Image } from '@chakra-ui/react';
import logo from '../assets/CuiCall.png';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('[ErrorBoundary] Erro não tratado:', error, errorInfo);
    }

    private handleReload = () => {
        window.location.reload();
    };

    public render() {
        if (this.state.hasError) {
            return (
                <Box
                    minH="100vh"
                    bg="gray.900"
                    color="white"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    p={6}
                >
                    <VStack spacing={6} maxW="450px" textAlign="center">
                        <Image src={logo} alt="CuiCall" boxSize="72px" objectFit="contain" />
                        <Heading size="md" color="red.400">
                            Ops! Ocorreu um erro inesperado
                        </Heading>
                        <Text fontSize="sm" color="gray.400">
                            {this.state.error?.message || 'Falha temporária ao carregar a interface.'}
                        </Text>
                        <Button colorScheme="blue" size="sm" onClick={this.handleReload}>
                            Recarregar Aplicativo
                        </Button>
                    </VStack>
                </Box>
            );
        }

        return this.props.children;
    }
}
