-- Admin switch: 使用綠界付款 (payment_required = true, the default) or 不需付款.
--
-- payment_required (boolean, default true): when an admin turns it off in
-- /admin, flight-subscribe activates new subscriptions straight away as free
-- one-month rows instead of returning the ECPay checkout. A missing row reads
-- as true, so the paywall fails closed.
--
-- Free rows (payment_method = 'free'):
--   - current_period_end = subscribe time + 1 month, no renewal
--   - flight-parser expires them as soon as that passes (no 7-day grace)
--   - cancelling expires them immediately and never calls ECPay
--   - re-subscribing from expired is unlimited, one month each time
--   - switching payment back on leaves existing free rows alone until they end

alter table flight.subscriptions
  add column payment_method text not null default 'ecpay'
    check (payment_method in ('ecpay', 'free'));

insert into flight.settings (key, value) values ('payment_required', 'true')
  on conflict (key) do nothing;

-- The dashboard must know which wording to show, so every signed-in user can
-- read this one key. Other settings stay admin-only ("admins can read
-- settings"); permissive policies are OR'ed together.
create policy "users can read payment_required"
  on flight.settings
  for select
  to authenticated
  using (key = 'payment_required');
