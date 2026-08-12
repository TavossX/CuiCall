# Contexto e Regras de Arquitetura do Projeto

Este repositório é um monorepo para a aplicação de videochamadas P2P (Peer-to-Peer).

## Visão Geral da Arquitetura

O sistema é dividido em duas partes principais:

### 1. Back-end (`/backend`)
- **Tecnologia:** .NET (ASP.NET Core Web API).
- **Protocolo de Sinalização:** SignalR (WebSockets).
- **Responsabilidade:** 
  - Gerenciar a troca de mensagens de sinalização (Signaling Server).
  - Trocar informações de conexão WebRTC entre os peers (Session Description Protocol - SDP offer/answer).
  - Transmitir candidatos ICE (Interactive Connectivity Establishment).
  - Gerenciar autenticação e salas de reunião/chamada.
- **Restrição Crítica:** O back-end **NÃO** deve trafegar dados de mídia (áudio e vídeo). Toda a transmissão de mídia deve ocorrer diretamente entre os clientes via P2P.

### 2. Front-end Desktop (`/frontend-desktop`)
- **Tecnologia:** Tauri + React + TypeScript + Vite.
- **Protocolo de Mídia:** WebRTC.
- **Responsabilidade:**
  - Interface de usuário (UI/UX) desktop nativa leve e responsiva.
  - Captura de áudio/vídeo local via APIs de mídia do navegador (`getUserMedia`, `getDisplayMedia`).
  - Estabelecimento de conexões diretas P2P (`RTCPeerConnection`) com outros pares.
  - Comunicação via WebSockets com o back-end SignalR para a fase de sinalização.

---

## Estrutura do Monorepo

```
CuiCall/
├── backend/            # Servidor ASP.NET Core Web API (SignalR)
├── frontend-desktop/   # Aplicação Desktop (Tauri + React + TS + WebRTC)
└── AGENTS.md           # Regras de arquitetura e contexto para assistentes de IA
```

---

## Diretrizes de Desenvolvimento para os Agentes

1. **Separação Rígida de Conceitos:**
   - Nunca adicione bibliotecas de streaming de mídia no back-end. O back-end é estritamente um servidor de sinalização leve.
   - Todo processamento e transmissão de áudio/vídeo deve utilizar WebRTC nativo ou abstrações no front-end.

2. **Gerenciamento de Dependências:**
   - Back-end: Pacotes do NuGet gerenciados em `backend/backend.csproj`.
   - Front-end: Pacotes npm em `frontend-desktop/package.json` e dependências Rust em `frontend-desktop/src-tauri/Cargo.toml`.

3. **Padronização de Código:**
   - Back-end em C# seguindo boas práticas de ASP.NET Core e SignalR Hubs.
   - Front-end em TypeScript + React seguindo princípios de componentes reutilizáveis, hooks customizados para WebRTC/SignalR e tipagem estrita.
