import { useState, useEffect } from 'react';
import {
    Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton,
    Button, VStack, Input, FormControl, FormLabel, Select, useToast
} from '@chakra-ui/react';
import { supabase } from '../supabaseClient';

interface CreateChannelModalProps {
    isOpen: boolean;
    onClose: () => void;
    serverId: string;
    initialType?: 'text' | 'voice';
    onChannelCreated: () => void;
}

export const CreateChannelModal = ({ isOpen, onClose, serverId, initialType = 'text', onChannelCreated }: CreateChannelModalProps) => {
    const [name, setName] = useState('');
    const [type, setType] = useState<'text' | 'voice'>(initialType);
    const [isLoading, setIsLoading] = useState(false);
    const toast = useToast();

    useEffect(() => {
        if (isOpen) {
            setName('');
            setType(initialType);
        }
    }, [isOpen, initialType]);

    const handleCreate = async () => {
        if (!name.trim()) return;

        setIsLoading(true);
        const { error } = await supabase
            .from('channels')
            .insert([{ server_id: serverId, name: name.trim().toLowerCase().replace(/\s+/g, '-'), type }]);

        setIsLoading(false);

        if (error) {
            toast({
                title: 'Erro ao criar canal',
                description: error.message,
                status: 'error',
                duration: 3000,
            });
        } else {
            toast({
                title: 'Canal criado!',
                status: 'success',
                duration: 2000,
            });
            onChannelCreated();
            onClose();
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} isCentered size="md">
            <ModalOverlay bg="blackAlpha.700" />
            <ModalContent bg="gray.800" color="white" borderColor="gray.700" borderWidth="1px">
                <ModalHeader>Criar Canal</ModalHeader>
                <ModalCloseButton />
                <ModalBody pb={6}>
                    <VStack spacing={4}>
                        <FormControl isRequired>
                            <FormLabel fontSize="sm" color="gray.400">Tipo de Canal</FormLabel>
                            <Select 
                                value={type} 
                                onChange={(e) => setType(e.target.value as 'text' | 'voice')}
                                bg="gray.900" borderColor="gray.700"
                            >
                                <option value="text" style={{ background: '#1a202c' }}># Texto</option>
                                <option value="voice" style={{ background: '#1a202c' }}>🔊 Voz</option>
                            </Select>
                        </FormControl>

                        <FormControl isRequired>
                            <FormLabel fontSize="sm" color="gray.400">Nome do Canal</FormLabel>
                            <Input 
                                placeholder="novo-canal"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                bg="gray.900" borderColor="gray.700"
                            />
                        </FormControl>
                    </VStack>
                </ModalBody>
                <ModalFooter>
                    <Button variant="ghost" color="gray.400" mr={3} onClick={onClose} isDisabled={isLoading}>
                        Cancelar
                    </Button>
                    <Button colorScheme="blue" onClick={handleCreate} isLoading={isLoading} isDisabled={!name.trim()}>
                        Criar
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};
