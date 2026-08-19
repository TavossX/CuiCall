-- ═══════════════════════════════════════════════════════
-- CuiCall - Schema SQL para Supabase
-- Cole este script inteiro no SQL Editor do Supabase
-- ═══════════════════════════════════════════════════════

-- 1. TABELA DE SERVIDORES
-- Cada servidor é como um "workspace" do Discord
create table if not exists public.servers (
    id uuid default gen_random_uuid() primary key,
    name text not null,
    description text,
    icon_url text,
    owner_id uuid references auth.users(id) on delete cascade not null,
    created_at timestamptz default now() not null
);

-- 2. TABELA DE CANAIS
-- Cada servidor pode ter múltiplos canais (texto ou voz)
create table if not exists public.channels (
    id uuid default gen_random_uuid() primary key,
    server_id uuid references public.servers(id) on delete cascade not null,
    name text not null,
    type text not null default 'text' check (type in ('text', 'voice')),
    created_at timestamptz default now() not null
);

-- 3. TABELA DE MEMBROS DO SERVIDOR
-- Relacionamento N:N entre usuários e servidores
create table if not exists public.server_members (
    id uuid default gen_random_uuid() primary key,
    server_id uuid references public.servers(id) on delete cascade not null,
    user_id uuid references auth.users(id) on delete cascade not null,
    role text not null default 'member' check (role in ('owner', 'admin', 'member')),
    joined_at timestamptz default now() not null,
    unique(server_id, user_id)
);

-- 4. TABELA DE MENSAGENS
-- Histórico persistente de mensagens por canal
create table if not exists public.messages (
    id uuid default gen_random_uuid() primary key,
    channel_id uuid references public.channels(id) on delete cascade not null,
    user_id uuid references auth.users(id) on delete cascade not null,
    content text not null,
    created_at timestamptz default now() not null
);

-- 5. TABELA DE PERFIS DE USUÁRIOS
-- Informações públicas de perfil (nome e avatar)
create table if not exists public.profiles (
    id uuid references auth.users(id) on delete cascade primary key,
    display_name text,
    avatar_url text,
    updated_at timestamptz default now()
);

-- ═══════════════════════════════════════════════════════
-- ÍNDICES (Performance)
-- ═══════════════════════════════════════════════════════

create index if not exists idx_channels_server_id on public.channels(server_id);
create index if not exists idx_server_members_server_id on public.server_members(server_id);
create index if not exists idx_server_members_user_id on public.server_members(user_id);
create index if not exists idx_messages_channel_id on public.messages(channel_id);
create index if not exists idx_messages_created_at on public.messages(created_at);

-- ═══════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- Garante que usuários só acessem dados permitidos
-- ═══════════════════════════════════════════════════════

-- Ativar RLS em todas as tabelas
alter table public.servers enable row level security;
alter table public.channels enable row level security;
alter table public.server_members enable row level security;
alter table public.messages enable row level security;

-- Função auxiliar para evitar recursão infinita no RLS
create or replace function public.is_server_member(_server_id uuid)
returns boolean
language sql security definer set search_path = public
as $$
  select exists (
    select 1
    from server_members
    where server_id = _server_id
    and user_id = auth.uid()
  );
$$;

-- SERVERS: Qualquer usuário logado pode ver servidores dos quais é membro
drop policy if exists "Membros podem ver seus servidores" on public.servers;
create policy "Membros podem ver seus servidores"
    on public.servers for select
    using (
        owner_id = auth.uid() or is_server_member(id)
    );

-- SERVERS: Qualquer usuário logado pode criar um servidor
drop policy if exists "Usuários logados podem criar servidores" on public.servers;
create policy "Usuários logados podem criar servidores"
    on public.servers for insert
    with check (auth.uid() = owner_id);

-- SERVERS: Apenas o dono pode editar/deletar
drop policy if exists "Donos podem editar seus servidores" on public.servers;
create policy "Donos podem editar seus servidores"
    on public.servers for update
    using (owner_id = auth.uid());

drop policy if exists "Donos podem deletar seus servidores" on public.servers;
create policy "Donos podem deletar seus servidores"
    on public.servers for delete
    using (owner_id = auth.uid());

-- CHANNELS: Membros do servidor podem ver os canais
drop policy if exists "Membros podem ver canais do servidor" on public.channels;
create policy "Membros podem ver canais do servidor"
    on public.channels for select
    using (
        is_server_member(server_id)
    );

-- CHANNELS: Donos/admins podem criar canais
drop policy if exists "Donos e admins podem criar canais" on public.channels;
create policy "Donos e admins podem criar canais"
    on public.channels for insert
    with check (
        is_server_member(server_id) and 
        exists (
            select 1 from public.server_members
            where server_id = channels.server_id and user_id = auth.uid() and role in ('owner', 'admin')
        )
    );

-- SERVER_MEMBERS: Membros podem ver quem está no servidor
drop policy if exists "Membros podem ver outros membros" on public.server_members;
create policy "Membros podem ver outros membros"
    on public.server_members for select
    using (
        user_id = auth.uid() or is_server_member(server_id)
    );

-- SERVER_MEMBERS: Qualquer logado pode entrar (insert) em servidores
drop policy if exists "Usuários podem entrar em servidores" on public.server_members;
create policy "Usuários podem entrar em servidores"
    on public.server_members for insert
    with check (auth.uid() = user_id);

-- MESSAGES: Membros do servidor podem ler mensagens dos canais
drop policy if exists "Membros podem ler mensagens" on public.messages;
create policy "Membros podem ler mensagens"
    on public.messages for select
    using (
        channel_id in (
            select id from public.channels
            where is_server_member(server_id)
        )
    );

-- MESSAGES: Membros podem enviar mensagens
drop policy if exists "Membros podem enviar mensagens" on public.messages;
create policy "Membros podem enviar mensagens"
    on public.messages for insert
    with check (
        auth.uid() = user_id
        and channel_id in (
            select id from public.channels
            where is_server_member(server_id)
        )
    );
