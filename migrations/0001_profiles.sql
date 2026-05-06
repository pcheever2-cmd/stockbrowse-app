-- Profiles table: stores subscription tier + Stripe mapping for each user.
-- Created automatically when a user signs up via a Supabase trigger.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  subscription_tier text not null default 'free'
    check (subscription_tier in ('free', 'newsletter', 'plus', 'pro')),
  stripe_customer_id text unique,
  current_period_end timestamptz,
  phone_e164 text,
  phone_verified_at timestamptz,
  created_at timestamptz not null default now()
);

-- RLS: users can only read/update their own profile
alter table public.profiles enable row level security;

create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create a profile row when a new user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
