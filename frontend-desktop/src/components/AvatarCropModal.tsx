import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    Modal,
    ModalOverlay,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalFooter,
    ModalCloseButton,
    Button,
    VStack,
    HStack,
    Box,
    Text,
    Slider,
    SliderTrack,
    SliderFilledTrack,
    SliderThumb,
    Flex,
} from '@chakra-ui/react';
import { FiZoomIn, FiZoomOut, FiMove } from 'react-icons/fi';

interface AvatarCropModalProps {
    isOpen: boolean;
    onClose: () => void;
    imageSrc: string | null;
    onCropComplete: (croppedBlob: Blob, previewUrl: string) => void;
}

const CROP_CONTAINER_SIZE = 320; // Tamanho do viewport (320x320 px)
const CROP_CIRCLE_DIAMETER = 240; // Diâmetro do círculo de corte (240 px)
const OUTPUT_SIZE = 512; // Resolução final do arquivo de saída (512x512 px)

export const AvatarCropModal: React.FC<AvatarCropModalProps> = ({
    isOpen,
    onClose,
    imageSrc,
    onCropComplete,
}) => {
    const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
    const [zoom, setZoom] = useState<number>(1);
    const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const positionStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const previewCanvasRef = useRef<HTMLCanvasElement>(null);

    // Carrega o objeto HTMLImageElement quando imageSrc muda
    useEffect(() => {
        if (!imageSrc) {
            setImageElement(null);
            return;
        }

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = imageSrc;
        img.onload = () => {
            setImageElement(img);
            setZoom(1);
            setPosition({ x: 0, y: 0 });
        };
    }, [imageSrc]);

    // Limites de deslocamento para não deixar espaço vazio dentro do círculo
    const getClampedPosition = useCallback((pos: { x: number; y: number }, currentZoom: number) => {
        if (!imageElement) return pos;

        const baseScale = Math.max(
            CROP_CIRCLE_DIAMETER / imageElement.naturalWidth,
            CROP_CIRCLE_DIAMETER / imageElement.naturalHeight
        );
        const scale = baseScale * currentZoom;
        const renderedWidth = imageElement.naturalWidth * scale;
        const renderedHeight = imageElement.naturalHeight * scale;

        const maxX = Math.max(0, (renderedWidth - CROP_CIRCLE_DIAMETER) / 2);
        const maxY = Math.max(0, (renderedHeight - CROP_CIRCLE_DIAMETER) / 2);

        return {
            x: Math.min(Math.max(pos.x, -maxX), maxX),
            y: Math.min(Math.max(pos.y, -maxY), maxY),
        };
    }, [imageElement]);

    // Atualiza o canvas de pré-visualização ao vivo
    useEffect(() => {
        if (!imageElement || !previewCanvasRef.current) return;

        const canvas = previewCanvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const baseScale = Math.max(
            CROP_CIRCLE_DIAMETER / imageElement.naturalWidth,
            CROP_CIRCLE_DIAMETER / imageElement.naturalHeight
        );
        const scale = baseScale * zoom;
        const scaleFactor = canvas.width / CROP_CIRCLE_DIAMETER;

        const renderedWidth = imageElement.naturalWidth * scale * scaleFactor;
        const renderedHeight = imageElement.naturalHeight * scale * scaleFactor;

        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const drawX = centerX + position.x * scaleFactor - renderedWidth / 2;
        const drawY = centerY + position.y * scaleFactor - renderedHeight / 2;

        ctx.save();
        ctx.beginPath();
        ctx.arc(centerX, centerY, canvas.width / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(imageElement, drawX, drawY, renderedWidth, renderedHeight);
        ctx.restore();
    }, [imageElement, zoom, position]);

    // Controle de Zoom
    const handleZoomChange = (newZoom: number) => {
        setZoom(newZoom);
        setPosition(prev => getClampedPosition(prev, newZoom));
    };

    // Controle do Scroll do Mouse para Zoom
    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        const nextZoom = Math.min(Math.max(zoom + delta, 1), 3);
        handleZoomChange(Number(nextZoom.toFixed(2)));
    };

    // Início do Arraste
    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        dragStartRef.current = { x: e.clientX, y: e.clientY };
        positionStartRef.current = { ...position };
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging) return;
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        const newPos = {
            x: positionStartRef.current.x + dx,
            y: positionStartRef.current.y + dy,
        };
        setPosition(getClampedPosition(newPos, zoom));
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    // Touch Support para telas sensíveis ao toque
    const handleTouchStart = (e: React.TouchEvent) => {
        if (e.touches.length === 1) {
            setIsDragging(true);
            dragStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            positionStartRef.current = { ...position };
        }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (!isDragging || e.touches.length !== 1) return;
        const dx = e.touches[0].clientX - dragStartRef.current.x;
        const dy = e.touches[0].clientY - dragStartRef.current.y;
        const newPos = {
            x: positionStartRef.current.x + dx,
            y: positionStartRef.current.y + dy,
        };
        setPosition(getClampedPosition(newPos, zoom));
    };

    const handleTouchEnd = () => {
        setIsDragging(false);
    };

    // Confirmar e Gerar Imagem Final
    const handleConfirm = () => {
        if (!imageElement) return;

        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = OUTPUT_SIZE;
        offscreenCanvas.height = OUTPUT_SIZE;
        const ctx = offscreenCanvas.getContext('2d');
        if (!ctx) return;

        const baseScale = Math.max(
            CROP_CIRCLE_DIAMETER / imageElement.naturalWidth,
            CROP_CIRCLE_DIAMETER / imageElement.naturalHeight
        );
        const scale = baseScale * zoom;
        const scaleFactor = OUTPUT_SIZE / CROP_CIRCLE_DIAMETER;

        const renderedWidth = imageElement.naturalWidth * scale * scaleFactor;
        const renderedHeight = imageElement.naturalHeight * scale * scaleFactor;

        const centerX = OUTPUT_SIZE / 2;
        const centerY = OUTPUT_SIZE / 2;
        const drawX = centerX + position.x * scaleFactor - renderedWidth / 2;
        const drawY = centerY + position.y * scaleFactor - renderedHeight / 2;

        ctx.drawImage(imageElement, drawX, drawY, renderedWidth, renderedHeight);

        offscreenCanvas.toBlob(
            (blob) => {
                if (blob) {
                    const previewUrl = URL.createObjectURL(blob);
                    onCropComplete(blob, previewUrl);
                    onClose();
                }
            },
            'image/jpeg',
            0.92
        );
    };

    // Cálculos de renderização no viewport do modal
    let imageStyle: React.CSSProperties = {};
    if (imageElement) {
        const baseScale = Math.max(
            CROP_CIRCLE_DIAMETER / imageElement.naturalWidth,
            CROP_CIRCLE_DIAMETER / imageElement.naturalHeight
        );
        const scale = baseScale * zoom;
        const renderedWidth = imageElement.naturalWidth * scale;
        const renderedHeight = imageElement.naturalHeight * scale;

        imageStyle = {
            width: `${renderedWidth}px`,
            height: `${renderedHeight}px`,
            maxWidth: 'none',
            maxHeight: 'none',
            position: 'absolute',
            left: `${CROP_CONTAINER_SIZE / 2 + position.x - renderedWidth / 2}px`,
            top: `${CROP_CONTAINER_SIZE / 2 + position.y - renderedHeight / 2}px`,
            userSelect: 'none',
            pointerEvents: 'none',
        };
    }

    return (
        <Modal isOpen={isOpen} onClose={onClose} isCentered size="md">
            <ModalOverlay bg="blackAlpha.800" backdropFilter="blur(4px)" />
            <ModalContent bg="gray.850" backgroundColor="#1e1f22" color="white" borderColor="gray.700" borderWidth="1px">
                <ModalHeader fontSize="md" fontWeight="bold" borderBottom="1px solid" borderColor="gray.700">
                    Ajustar Foto de Perfil
                </ModalHeader>
                <ModalCloseButton />

                <ModalBody py={6}>
                    <VStack spacing={5} align="center">
                        {/* Área interativa de corte */}
                        <Box
                            w={`${CROP_CONTAINER_SIZE}px`}
                            h={`${CROP_CONTAINER_SIZE}px`}
                            position="relative"
                            overflow="hidden"
                            borderRadius="12px"
                            bg="#111214"
                            cursor={isDragging ? 'grabbing' : 'grab'}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                            onTouchStart={handleTouchStart}
                            onTouchMove={handleTouchMove}
                            onTouchEnd={handleTouchEnd}
                            onWheel={handleWheel}
                            boxShadow="inset 0 0 20px rgba(0,0,0,0.8)"
                        >
                            {/* Imagem a ser cortada */}
                            {imageElement && (
                                <img
                                    src={imageElement.src}
                                    alt="Crop source"
                                    style={imageStyle}
                                    draggable={false}
                                />
                            )}

                            {/* Máscara escura com furo circular central */}
                            <svg
                                width={CROP_CONTAINER_SIZE}
                                height={CROP_CONTAINER_SIZE}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    pointerEvents: 'none',
                                }}
                            >
                                <defs>
                                    <mask id="crop-circle-mask">
                                        <rect width="100%" height="100%" fill="white" />
                                        <circle
                                            cx={CROP_CONTAINER_SIZE / 2}
                                            cy={CROP_CONTAINER_SIZE / 2}
                                            r={CROP_CIRCLE_DIAMETER / 2}
                                            fill="black"
                                        />
                                    </mask>
                                </defs>
                                <rect
                                    width="100%"
                                    height="100%"
                                    fill="rgba(0, 0, 0, 0.65)"
                                    mask="url(#crop-circle-mask)"
                                />
                                {/* Borda guia do círculo */}
                                <circle
                                    cx={CROP_CONTAINER_SIZE / 2}
                                    cy={CROP_CONTAINER_SIZE / 2}
                                    r={CROP_CIRCLE_DIAMETER / 2}
                                    fill="none"
                                    stroke="rgba(255, 255, 255, 0.85)"
                                    strokeWidth="2"
                                    strokeDasharray="4 4"
                                />
                            </svg>

                            {/* Dica de arraste */}
                            <Flex
                                position="absolute"
                                bottom="8px"
                                left="50%"
                                transform="translateX(-50%)"
                                bg="rgba(0,0,0,0.6)"
                                px={2.5}
                                py={0.5}
                                borderRadius="full"
                                align="center"
                                gap={1.5}
                                pointerEvents="none"
                            >
                                <FiMove size={12} color="#aaa" />
                                <Text fontSize="10px" color="gray.300">
                                    Arraste para reposicionar
                                </Text>
                            </Flex>
                        </Box>

                        {/* Controles de Zoom e Pré-visualização */}
                        <HStack w="full" spacing={4} justify="space-between" align="center">
                            <VStack flex={1} align="stretch" spacing={1}>
                                <Flex justify="space-between" align="center" color="gray.400" fontSize="xs">
                                    <Text fontWeight="medium">Zoom</Text>
                                    <Text>{Math.round(zoom * 100)}%</Text>
                                </Flex>
                                <HStack spacing={3}>
                                    <FiZoomOut size={16} color="#888" />
                                    <Slider
                                        min={1}
                                        max={3}
                                        step={0.01}
                                        value={zoom}
                                        onChange={handleZoomChange}
                                        colorScheme="blue"
                                    >
                                        <SliderTrack bg="gray.700">
                                            <SliderFilledTrack bg="blue.500" />
                                        </SliderTrack>
                                        <SliderThumb boxSize={4} bg="white" />
                                    </Slider>
                                    <FiZoomIn size={16} color="#888" />
                                </HStack>
                            </VStack>

                            {/* Miniatura do Avatar Circular */}
                            <VStack spacing={1} align="center" minW="76px">
                                <Box
                                    w="64px"
                                    h="64px"
                                    borderRadius="full"
                                    overflow="hidden"
                                    border="2px solid"
                                    borderColor="blue.500"
                                    boxShadow="0 2px 10px rgba(0,0,0,0.5)"
                                    bg="#111214"
                                >
                                    <canvas
                                        ref={previewCanvasRef}
                                        width={64}
                                        height={64}
                                        style={{ width: '100%', height: '100%', display: 'block' }}
                                    />
                                </Box>
                                <Text fontSize="10px" color="gray.400">Prévia</Text>
                            </VStack>
                        </HStack>
                    </VStack>
                </ModalBody>

                <ModalFooter borderTop="1px solid" borderColor="gray.700" gap={2}>
                    <Button variant="ghost" colorScheme="gray" onClick={onClose}>
                        Cancelar
                    </Button>
                    <Button colorScheme="blue" onClick={handleConfirm}>
                        Aplicar Foto
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
};
