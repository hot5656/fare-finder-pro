-- M2: payment state on flight.subscriptions, and no more client-side writes.
--
-- Every pre-existing M1 row picks up subscription_status = 'pending_payment'
-- from the column default, so it stops being alerted until the user pays.

alter table flight.subscriptions
  add column subscription_status text not null default 'pending_payment'
    check (subscription_status in ('pending_payment', 'active', 'cancelled', 'expired')),
  add column merchant_trade_no text,
  add column current_period_end timestamptz;

create unique index subscriptions_merchant_trade_no_key
  on flight.subscriptions (merchant_trade_no) where merchant_trade_no is not null;

-- The row now carries proof of payment, so the browser must not be able to
-- write it. All writes go through Edge Functions using the service role
-- (flight-subscribe, flight-ecpay-return, flight-ecpay-period,
-- flight-cancel-subscription), each after its own verification.
drop policy if exists "insert own subscriptions" on flight.subscriptions;
drop policy if exists "update own subscriptions" on flight.subscriptions;
revoke insert, update on flight.subscriptions from authenticated;
-- "select own subscriptions" stays: users read their own live status.
