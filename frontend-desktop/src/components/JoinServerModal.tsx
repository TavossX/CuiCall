import { useState } from 'react';
import {
    Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton,
    Button, VStack, Input, FormControl, FormLabel, useToast, Text
} from '@chakra-ui/react';
import { supabase } from '../supabaseClient';

interface JoinServerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onServerJoined: () => void;
}

export const JoinServerModal = ({ isOpen, onClose, onServerJoined }: JoinServerModalProps) => {
    const [inviteId, setInviteId] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const toast = useToast();

    const handleJoin = async () => {
        if (!inviteId.trim()) return;

        setIsLoading(true);

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Usuário não autenticado.');

            // Verifica se o servidor existe
            const { data: server, error: serverError } = await supabase
                .from('servers')
                .select('id')
                .eq('id', inviteId.trim())
                .single();

            if (serverError || !server) {
                throw new Error('Servidor não encontrado ou ID de convite inválido.');
            }

            // Tenta inserir como membro
            const { error: memberError } = await supabase
                .from('server_members')
                .insert([{ server_id: server.id, user_id: user.id, role: 'member' }]);

            if (memberError) {
                // Erro comum: violação de unicidade (já é membro)
                if (memberError.code === '23505') {
                    throw new Error('Você já é membro deste servidor.');
                }
                throw memberError;
            }

            toast({
                title: 'Você entrou no servidor!',
                status: 'success',
                duration: 2000,
            });
            
            setInviteId('');
            onServerJoined();
            onClose();
        } catch (err: any) {
            toast({
                title: 'Erro ao entrar',
                description: err.message || 'Erro desconhecido ao tentar entrar no servidor.',
                status: 'error',
                duration: 3000,
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} isCentered size="md">
            <ModalOverlay bg="blackAlpha.700" />
            <ModalContent bg="gray.800" color="white" borderColor="gray.700" borderWidth="1px">
                <ModalHeader>Entrar em um Servidor</ModalHeader>
                <ModalCloseButton />
                <ModalBody pb={6}>
                    <VStack spacing={4}>
                        <Text fontSize="sm" color="gray.400">
                            Cole o ID de convite (UUID) fornecido pelo administrador do servidor abaixo para participar.
                        </Text>
                        <FormControl isRequired>
                            <FormLabel fontSize="sm" color="gray.400">ID do Convite</FormLabel>
                            <Input 
                                placeholder="ex: 123e4567-e89b-12d3-a456-426614174000"
                                value={inviteId}
                                onChange={(e) => setInviteId(e.target.value)}
                                bg="gray.900" borderColor="gray.700"
                            />
                        </FormControl>
                    </VStack>
                </ModalBody>
                <ModalFooter>
                    <Button variant="ghost" color="gray.400" mr={3} onClick={onClose} isDisabled={isLoading}>
                        Cancelar
                    </Button>
                    <Button colorScheme="blue" onClick={handleJoin} isLoading={isLoading} isDisabled={!inviteId.trim()}>
                        Entrar no Servidor
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};
