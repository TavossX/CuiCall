interface CachedChat {
    messages: any[];
    lastFetched: number;
}

const globalChatCache = new Map<string, CachedChat>();

/**
 * Retorna as mensagens em cache se o TTL (em minutos) não tiver expirado.
 * Retorna null se não houver cache ou se estiver expirado.
 */
export function getCache(chatId: string, ttlMinutes: number = 10): any[] | null {
    const cached = globalChatCache.get(chatId);
    if (!cached) return null;

    const now = Date.now();
    const ttlMs = ttlMinutes * 60 * 1000;
    
    if (now - cached.lastFetched < ttlMs) {
        return cached.messages;
    }
    
    // Expired
    globalChatCache.delete(chatId);
    return null;
}

/**
 * Salva ou atualiza as mensagens de um chat no cache, renovando o timestamp.
 */
export function setCache(chatId: string, messages: any[]): void {
    globalChatCache.set(chatId, {
        messages: [...messages], // Shallow copy para evitar mutações acidentais na mesma referência
        lastFetched: Date.now()
    });
}

/**
 * Adiciona uma nova mensagem ao final do array de um chat no cache, se ele existir.
 * Evita duplicação conferindo se a mensagem (pelo id) já existe (útil se o evento disparar duas vezes).
 */
export function appendMessageToCache(chatId: string, message: any): void {
    const cached = globalChatCache.get(chatId);
    if (!cached) return;

    // Previne inserção duplicada se a mensagem tiver id
    if (message.id) {
        const exists = cached.messages.some(m => m.id === message.id);
        if (exists) return;
    }

    cached.messages.push(message);
    globalChatCache.set(chatId, cached);
}

/**
 * Helper para padronizar a chave de cache de Direct Messages,
 * de modo que (A, B) e (B, A) gerem a mesma chave.
 */
export function getDMCacheKey(userA: string, userB: string): string {
    return `dm_${[userA, userB].sort().join('_')}`;
}
