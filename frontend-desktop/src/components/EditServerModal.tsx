import { useState, useEffect } from 'react';
import {
    Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton,
    Button, VStack, Input, FormControl, FormLabel, Textarea, useToast
} from '@chakra-ui/react';
import { supabase } from '../supabaseClient';

interface EditServerModalProps {
    isOpen: boolean;
    onClose: () => void;
    server: any | null;
    onServerUpdated: () => void;
}

export const EditServerModal = ({ isOpen, onClose, server, onServerUpdated }: EditServerModalProps) => {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [iconUrl, setIconUrl] = useState('');
    const [iconFile, setIconFile] = useState<File | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const toast = useToast();

    useEffect(() => {
        if (isOpen && server) {
            setName(server.name || '');
            setDescription(server.description || '');
            setIconUrl(server.icon_url || '');
        }
    }, [isOpen, server]);

    const handleSave = async () => {
        if (!name.trim() || !server) return;

        setIsLoading(true);
        let finalIconUrl = iconUrl;
        
        if (iconFile) {
            const fileExt = iconFile.name.split('.').pop();
            const fileName = `${Date.now()}.${fileExt}`;
            const { error: uploadError } = await supabase.storage.from('images').upload(fileName, iconFile);
            
            if (uploadError) {
                toast({ title: 'Erro no upload da imagem', description: uploadError.message, status: 'error' });
                setIsLoading(false);
                return;
            }
            
            const { data } = supabase.storage.from('images').getPublicUrl(fileName);
            finalIconUrl = data.publicUrl;
            setIconUrl(data.publicUrl);
        }

        const { error } = await supabase
            .from('servers')
            .update({ 
                name: name.trim(), 
                description: description.trim(), 
                icon_url: finalIconUrl.trim() 
            })
            .eq('id', server.id);

        setIsLoading(false);

        if (error) {
            toast({
                title: 'Erro ao atualizar servidor',
                description: error.message,
                status: 'error',
                duration: 3000,
            });
        } else {
            toast({
                title: 'Servidor atualizado!',
                status: 'success',
                duration: 2000,
            });
            setIconFile(null);
            onServerUpdated();
            onClose();
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} isCentered size="md">
            <ModalOverlay bg="blackAlpha.700" />
            <ModalContent bg="gray.800" color="white" borderColor="gray.700" borderWidth="1px">
                <ModalHeader>Configurações do Servidor</ModalHeader>
                <ModalCloseButton />
                <ModalBody pb={6}>
                    <VStack spacing={4}>
                        <FormControl isRequired>
                            <FormLabel fontSize="sm" color="gray.400">Nome do Servidor</FormLabel>
                            <Input 
                                placeholder="Meu Servidor"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                bg="gray.900" borderColor="gray.700"
                            />
                        </FormControl>

                        <FormControl>
                            <FormLabel fontSize="sm" color="gray.400">Descrição</FormLabel>
                            <Textarea 
                                placeholder="Uma breve descrição sobre o servidor..."
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                bg="gray.900" borderColor="gray.700"
                                resize="none"
                            />
                        </FormControl>

                        <FormControl>
                            <FormLabel fontSize="sm" color="gray.400">Ícone do Servidor</FormLabel>
                            <Input 
                                type="file"
                                accept="image/*"
                                onChange={(e) => {
                                    if (e.target.files && e.target.files[0]) {
                                        setIconFile(e.target.files[0]);
                                    }
                                }}
                                bg="gray.900" borderColor="gray.700"
                                pt={1}
                            />
                        </FormControl>
                    </VStack>
                </ModalBody>
                <ModalFooter>
                    <Button variant="ghost" color="gray.400" mr={3} onClick={onClose} isDisabled={isLoading}>
                        Cancelar
                    </Button>
                    <Button colorScheme="blue" onClick={handleSave} isLoading={isLoading} isDisabled={!name.trim()}>
                        Salvar
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};
