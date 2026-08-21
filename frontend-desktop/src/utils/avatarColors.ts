// ═══════ Algoritmo de Cores Determinísticas de Avatar (Estilo Discord) ═══════

export const AVATAR_COLORS: readonly string[] = [
    '#5865F2', // Discord Blurple
    '#57F287', // Verde vibrante
    '#FEE75C', // Amarelo Dourado
    '#EB459E', // Fúcsia / Rosa
    '#ED4245', // Vermelho Coral
    '#00B0F4', // Azul Ciano
    '#9B59B6', // Roxo Ametista
    '#E67E22', // Laranja Solar
] as const;

/**
 * Converte qualquer ID ou string em um hash numérico determinístico
 * e retorna uma das cores da paleta padrão.
 * Sempre retorna a mesma cor para o mesmo ID/usuário.
 */
export function getAvatarColor(userId?: string | null): string {
    if (!userId || typeof userId !== 'string') {
        return AVATAR_COLORS[0];
    }

    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = (hash + userId.charCodeAt(i) * (i + 1)) % 2147483647;
    }

    const index = Math.abs(hash) % AVATAR_COLORS.length;
    return AVATAR_COLORS[index];
}
