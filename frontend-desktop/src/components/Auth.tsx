import { useState } from 'react';
import { Box, Button, Input, VStack, Heading, Text, Flex, Alert, AlertIcon, Link, Image } from '@chakra-ui/react';
import { supabase } from '../supabaseClient';
import logo from '../assets/CuiCall.png';

export const Auth = () => {
    const [loading, setLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLogin, setIsLogin] = useState(true);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMessage(null);

        try {
            if (isLogin) {
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
            } else {
                const { error } = await supabase.auth.signUp({ email, password });
                if (error) throw error;
                setMessage({ type: 'success', text: 'Conta criada! Verifique seu e-mail ou faça login se o auto-confirm estiver ativado.' });
            }
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message || 'Ocorreu um erro durante a autenticação.' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Flex minH="100vh" align="center" justify="center" bg="gray.900" p={{ base: 4, md: 8 }}>
            <Box 
                bg="gray.800" 
                p={8} 
                borderRadius="xl" 
                shadow="2xl" 
                w="full" 
                maxW="md"
                borderWidth="1px"
                borderColor="gray.700"
            >
                <VStack spacing={6} as="form" onSubmit={handleAuth}>
                    <Image src={logo} alt="CuiCall Logo" maxH="80px" objectFit="contain" />
                    <Heading size="lg" color="white">
                        {isLogin ? 'Entrar no CuiCall' : 'Criar sua Conta'}
                    </Heading>
                    <Text color="gray.400" textAlign="center">
                        {isLogin ? 'Bem-vindo de volta! Faça login para continuar.' : 'Crie uma conta para acessar as chamadas de vídeo P2P.'}
                    </Text>
                    
                    {message && (
                        <Alert status={message.type} borderRadius="md" bg={message.type === 'error' ? 'red.900' : 'green.900'} color="white">
                            <AlertIcon color={message.type === 'error' ? 'red.300' : 'green.300'} />
                            <Text fontSize="sm">{message.text}</Text>
                        </Alert>
                    )}

                    <VStack w="full" spacing={4}>
                        <Input
                            type="email"
                            placeholder="Seu E-mail"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            bg="gray.900"
                            border="1px solid"
                            borderColor="gray.700"
                            _hover={{ borderColor: 'gray.600' }}
                            _focus={{ borderColor: 'blue.500', boxShadow: '0 0 0 1px #3182ce' }}
                            size="lg"
                            color="white"
                            required
                        />
                        <Input
                            type="password"
                            placeholder="Sua Senha"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            bg="gray.900"
                            border="1px solid"
                            borderColor="gray.700"
                            _hover={{ borderColor: 'gray.600' }}
                            _focus={{ borderColor: 'blue.500', boxShadow: '0 0 0 1px #3182ce' }}
                            size="lg"
                            color="white"
                            required
                        />
                        <Button 
                            colorScheme="blue" 
                            size="lg" 
                            w="full" 
                            type="submit"
                            isLoading={loading}
                        >
                            {isLogin ? 'Entrar na Conta' : 'Registrar Conta'}
                        </Button>
                    </VStack>

                    <Text color="gray.400" fontSize="sm">
                        {isLogin ? 'Ainda não tem uma conta? ' : 'Já possui uma conta? '}
                        <Link color="teal.300" onClick={() => {
                            setIsLogin(!isLogin);
                            setMessage(null);
                        }}>
                            {isLogin ? 'Cadastre-se' : 'Faça Login'}
                        </Link>
                    </Text>
                </VStack>
            </Box>
        </Flex>
    );
};
