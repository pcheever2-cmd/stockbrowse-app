-- Newsletter subscribers (includes non-account signups)
create table public.newsletter_subscribers (
  email text primary key,
  subscribed_at timestamptz not null default now(),
  unsubscribed_at timestamptz,
  source text default 'website'
);

-- Stripe event idempotency table
create table public.stripe_events (
  event_id text primary key,
  processed_at timestamptz not null default now()
);

-- Audit log for security-sensitive operations
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  event_type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- RLS on audit_log: read-only for the owning user
alter table public.audit_log enable row level security;

create policy "Users can read own audit log"
  on public.audit_log for select
  using (auth.uid() = user_id);

-- Index for audit log queries
create index idx_audit_log_user_id on public.audit_log(user_id);
create index idx_audit_log_created_at on public.audit_log(created_at);
