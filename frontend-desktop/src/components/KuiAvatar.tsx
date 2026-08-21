import React from 'react';
import { getAvatarColor } from '../utils/avatarColors';

export interface KuiAvatarProps {
    /** Tamanho em pixels ou formato CSS (ex: 32, "40px") */
    size?: number | string;
    /** Cor de fundo personalizada. Se não fornecida, usa userId para derivar via getAvatarColor */
    bgColor?: string;
    /** ID do usuário para gerar a cor determinística */
    userId?: string | null;
    /** Nome de classe CSS */
    className?: string;
    /** Estilos inline adicionais */
    style?: React.CSSProperties;
}

/**
 * Silhueta SVG em branco puro do mascote Kui (hamster com headset).
 * Perfeito para usar como prop `icon={<KuiAvatarIcon />}` no componente `<Avatar />` do Chakra UI.
 */
export const KuiAvatarIcon: React.FC<React.SVGProps<SVGSVGElement>> = ({
    fill = 'currentColor',
    width = '65%',
    height = '65%',
    ...props
}) => (
    <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        width={width}
        height={height}
        {...props}
    >
        {/* Arco superior do Headset */}
        <path
            d="M24 44 C24 22, 76 22, 76 44"
            stroke="#FFFFFF"
            strokeWidth="6"
            strokeLinecap="round"
            fill="none"
        />

        {/* Orelha Esquerda */}
        <path
            d="M 31 34 C 27 24, 38 18, 44 26 Z"
            fill="#FFFFFF"
        />

        {/* Orelha Direita */}
        <path
            d="M 69 34 C 73 24, 62 18, 56 26 Z"
            fill="#FFFFFF"
        />

        {/* Cabeça do Hamster (Bochechas gordinhas) */}
        <path
            d="M 32 40 C 32 32, 68 32, 68 40 C 76 43, 80 54, 76 66 C 72 78, 28 78, 24 66 C 20 54, 24 43, 32 40 Z"
            fill="#FFFFFF"
        />

        {/* Olho Esquerdo (recorte / espaço negativo sutil) */}
        <circle cx="41" cy="52" r="3.2" fill={fill === 'currentColor' ? 'rgba(0,0,0,0.45)' : fill} />

        {/* Olho Direito (recorte / espaço negativo sutil) */}
        <circle cx="59" cy="52" r="3.2" fill={fill === 'currentColor' ? 'rgba(0,0,0,0.45)' : fill} />

        {/* Focinho e Bochechas */}
        <path
            d="M 48 58 L 52 58 L 50 61 Z"
            fill={fill === 'currentColor' ? 'rgba(0,0,0,0.5)' : fill}
        />
        <path
            d="M 47 62 Q 50 64 53 62"
            stroke={fill === 'currentColor' ? 'rgba(0,0,0,0.5)' : fill}
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
        />

        {/* Almofada Esquerda do Headset */}
        <rect
            x="19"
            y="41"
            width="8"
            height="18"
            rx="4"
            fill="#FFFFFF"
            stroke="rgba(0,0,0,0.15)"
            strokeWidth="1"
        />

        {/* Almofada Direita do Headset */}
        <rect
            x="73"
            y="41"
            width="8"
            height="18"
            rx="4"
            fill="#FFFFFF"
            stroke="rgba(0,0,0,0.15)"
            strokeWidth="1"
        />

        {/* Haste do Microfone (Boom Mic) */}
        <path
            d="M 23 55 Q 26 73 40 73"
            stroke="#FFFFFF"
            strokeWidth="3.5"
            strokeLinecap="round"
            fill="none"
        />
        {/* Cápsula do Microfone */}
        <rect
            x="39"
            y="70"
            width="6.5"
            height="6"
            rx="3"
            fill="#FFFFFF"
        />
    </svg>
);

/**
 * Componente KuiAvatar: Renderiza o mascote vetorizado sobre um círculo
 * com cor de fundo determinística calculada a partir do ID do usuário.
 */
export const KuiAvatar: React.FC<KuiAvatarProps> = ({
    size = 40,
    bgColor,
    userId,
    className,
    style,
}) => {
    const finalBgColor = bgColor || getAvatarColor(userId);
    const dimension = typeof size === 'number' ? `${size}px` : size;

    return (
        <div
            className={className}
            style={{
                width: dimension,
                height: dimension,
                minWidth: dimension,
                minHeight: dimension,
                borderRadius: '50%',
                backgroundColor: finalBgColor,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                position: 'relative',
                boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
                userSelect: 'none',
                ...style,
            }}
        >
            <KuiAvatarIcon width="72%" height="72%" fill={finalBgColor} />
        </div>
    );
};

export default KuiAvatar;
