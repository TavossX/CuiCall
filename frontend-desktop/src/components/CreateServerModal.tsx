import { useState } from 'react';
import {
    Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton,
    Button, VStack, Input, FormControl, FormLabel, Alert, AlertIcon, Text
} from '@chakra-ui/react';
import { supabase } from '../supabaseClient';

interface CreateServerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onServerCreated?: () => void;
}

export const CreateServerModal = ({ isOpen, onClose, onServerCreated }: CreateServerModalProps) => {
    const [serverName, setServerName] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!serverName.trim()) return;

        setLoading(true);
        setError(null);

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Usuário não autenticado.');

            // 1. Cria o servidor
            const { data: server, error: serverError } = await supabase
                .from('servers')
                .insert([{ name: serverName.trim(), owner_id: user.id }])
                .select()
                .single();

            if (serverError) throw serverError;

            // 2. Adiciona o criador como membro do servidor (necessário para a RLS de leitura)
            if (server) {
                const { error: memberError } = await supabase
                    .from('server_members')
                    .insert([{ server_id: server.id, user_id: user.id, role: 'owner' }]);

                if (memberError) {
                    console.warn('Aviso ao registrar membro:', memberError);
                }

                // 3. Cria os canais padrão do servidor (# geral e 🔊 Lobby)
                const { error: channelsError } = await supabase
                    .from('channels')
                    .insert([
                        { server_id: server.id, name: 'geral', type: 'text' },
                        { server_id: server.id, name: 'Lobby', type: 'voice' }
                    ]);

                if (channelsError) {
                    console.warn('Aviso ao criar canais padrão:', channelsError);
                }
            }

            setServerName('');
            onServerCreated?.();
            onClose();
        } catch (err: any) {
            setError(err.message || 'Erro ao criar servidor.');
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        setServerName('');
        setError(null);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} isCentered size="md">
            <ModalOverlay bg="blackAlpha.700" />
            <ModalContent bg="gray.800" color="white" borderColor="gray.700" borderWidth="1px" as="form" onSubmit={handleCreate}>
                <ModalHeader>Criar um Servidor</ModalHeader>
                <ModalCloseButton />
                <ModalBody>
                    <VStack spacing={4}>
                        <Text fontSize="sm" color="gray.400">
                            Seu servidor é onde você e seus amigos se reúnem. Escolha um nome legal!
                        </Text>

                        {error && (
                            <Alert status="error" borderRadius="md" bg="red.900" color="white">
                                <AlertIcon color="red.300" />
                                <Text fontSize="sm">{error}</Text>
                            </Alert>
                        )}

                        <FormControl isRequired>
                            <FormLabel fontSize="sm" color="gray.300">Nome do Servidor</FormLabel>
                            <Input
                                placeholder="ex: Servidor do Otávio"
                                value={serverName}
                                onChange={(e) => setServerName(e.target.value)}
                                bg="gray.900"
                                border="1px solid"
                                borderColor="gray.700"
                                _focus={{ borderColor: 'blue.500', boxShadow: 'none' }}
                                autoFocus
                            />
                        </FormControl>
                    </VStack>
                </ModalBody>
                <ModalFooter>
                    <Button variant="ghost" color="gray.400" mr={3} onClick={handleClose} isDisabled={loading}>
                        Cancelar
                    </Button>
                    <Button colorScheme="blue" type="submit" isLoading={loading} isDisabled={!serverName.trim()}>
                        Criar
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};
