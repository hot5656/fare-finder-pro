-- M1: subscribe -> fetch on schedule -> email on target.
-- No subscription_status anywhere here -- that's M2's paywall gate.

create schema if not exists flight;

create table flight.routes (
  plan_name text primary key,       -- 'tokyo' | 'seoul'
  display_name text not null,       -- '台北 ✈ 東京'
  origin text not null,             -- 'TPE'
  destination text not null,        -- 'TYO' | 'SEL'
  route text generated always as (origin || '-' || destination) stored
);

insert into flight.routes (plan_name, display_name, origin, destination) values
  ('tokyo', '台北 ✈ 東京', 'TPE', 'TYO'),
  ('seoul', '台北 ✈ 首爾', 'TPE', 'SEL');

create table flight.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,              -- denormalized: lets flight-notification send without joining auth.users
  plan_name text not null references flight.routes(plan_name),
  route text not null,
  target_price numeric not null,    -- TWD
  currency text not null default 'TWD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, route)
);

create table flight.notification_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  route text not null,
  price numeric not null,
  currency text not null,
  sent_at timestamptz not null default now()
);
create index on flight.notification_history (user_id, route, sent_at desc);

alter table flight.subscriptions enable row level security;
alter table flight.notification_history enable row level security;
alter table flight.routes enable row level security;

-- routes: everyone signed in can read the two plans, nobody from the client can write
create policy "routes are readable" on flight.routes for select to authenticated using (true);

-- subscriptions: users can only see/write their own row
create policy "select own subscriptions" on flight.subscriptions for select to authenticated using (auth.uid() = user_id);
create policy "insert own subscriptions" on flight.subscriptions for insert to authenticated with check (auth.uid() = user_id);
create policy "update own subscriptions" on flight.subscriptions for update to authenticated using (auth.uid() = user_id);

-- notification_history: no policies for authenticated/anon at all -> only the
-- service role (used inside Edge Functions) can read or write it.
