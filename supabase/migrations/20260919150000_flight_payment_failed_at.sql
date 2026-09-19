-- M2 follow-up: remember that we already sent the "payment failed" email for
-- the current renewal cycle. ECPay calls PeriodReturnURL once per failed retry
-- (up to 6 in a row), so without this the user would get up to 6 emails.
--
-- Set by flight-ecpay-period on the first failed charge (the update is
-- `where payment_failed_at is null`, so it is once-only even under concurrent
-- callbacks); cleared again when a renewal succeeds.

alter table flight.subscriptions
  add column payment_failed_at timestamptz;
