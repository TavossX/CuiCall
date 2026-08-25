interface CachedChat {
    messages: any[];
    lastFetched: number;
}

const globalChatCache = new Map<string, CachedChat>();
const MAX_CACHE_ENTRIES = 50; // Limite máximo para evitar vazamento de memória

/**
 * Remove entradas expiradas do cache em lote para liberar memória.
 */
function sweepExpired(ttlMs: number): void {
    const now = Date.now();
    for (const [key, entry] of globalChatCache.entries()) {
        if (now - entry.lastFetched >= ttlMs) {
            globalChatCache.delete(key);
        }
    }
}

/**
 * Retorna as mensagens em cache se o TTL (em minutos) não tiver expirado.
 * Retorna null se não houver cache ou se estiver expirado.
 * Retorna uma cópia superficial para manter o cache isolado de mutações externas.
 */
export function getCache(chatId: string, ttlMinutes: number = 10): any[] | null {
    const ttlMs = ttlMinutes * 60 * 1000;
    const cached = globalChatCache.get(chatId);
    
    if (!cached) return null;

    const now = Date.now();
    
    if (now - cached.lastFetched < ttlMs) {
        // Retorna cópia rasa do array para proteger a imutabilidade do cache
        return [...cached.messages];
    }
    
    // Entrada expirada: remove e executa limpeza
    globalChatCache.delete(chatId);
    sweepExpired(ttlMs);
    return null;
}

/**
 * Salva ou atualiza as mensagens de um chat no cache, renovando o timestamp.
 * Respeita o limite máximo de entradas (LRU simples).
 */
export function setCache(chatId: string, messages: any[]): void {
    // Evita crescimento descontrolado da memória
    if (globalChatCache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = globalChatCache.keys().next().value;
        if (oldestKey) globalChatCache.delete(oldestKey);
    }

    globalChatCache.set(chatId, {
        messages: [...messages], // Clone seguro
        lastFetched: Date.now()
    });
}

/**
 * Adiciona uma nova mensagem ao final do array de um chat no cache sem mutar o array original.
 * Previne duplicatas de IDs.
 */
export function appendMessageToCache(chatId: string, message: any): void {
    const cached = globalChatCache.get(chatId);
    if (!cached) return;

    // Previne inserção duplicada se a mensagem já possuir id
    if (message.id && cached.messages.some(m => m.id === message.id)) {
        return;
    }

    // Criação de nova referência de array (Imutabilidade estrita)
    globalChatCache.set(chatId, {
        ...cached,
        messages: [...cached.messages, message]
    });
}

/**
 * Helper para padronizar a chave de cache de Direct Messages,
 * de modo que (A, B) e (B, A) gerem a mesma chave unificada.
 */
export function getDMCacheKey(userA: string, userB: string): string {
    return `dm_${[userA, userB].sort().join('_')}`;
}

/**
 * Limpa todo o cache em memória (útil no logout).
 */
export function clearAllChatCache(): void {
    globalChatCache.clear();
}
