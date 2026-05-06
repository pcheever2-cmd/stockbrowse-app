-- Watchlists: Plus = 1, Pro = up to 5

create table public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'My Watchlist',
  created_at timestamptz not null default now()
);

create table public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references public.watchlists(id) on delete cascade,
  symbol text not null,
  added_at timestamptz not null default now(),
  unique (watchlist_id, symbol)
);

-- RLS: users can only access their own watchlists
alter table public.watchlists enable row level security;
alter table public.watchlist_items enable row level security;

create policy "Users can CRUD own watchlists"
  on public.watchlists for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can CRUD own watchlist items"
  on public.watchlist_items for all
  using (
    watchlist_id in (
      select id from public.watchlists where user_id = auth.uid()
    )
  )
  with check (
    watchlist_id in (
      select id from public.watchlists where user_id = auth.uid()
    )
  );

-- Index for fast lookups
create index idx_watchlists_user_id on public.watchlists(user_id);
create index idx_watchlist_items_watchlist_id on public.watchlist_items(watchlist_id);
