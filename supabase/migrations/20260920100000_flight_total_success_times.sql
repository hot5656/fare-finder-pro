-- M2 follow-up: remember which successful charge we last processed, so the
-- "renewal charged" email is sent once per charge.
--
-- ECPay resends a PeriodReturnURL callback until it gets `1|OK`, so a plain
-- "email on every successful callback" would double-send. flight-ecpay-period
-- compares the callback's TotalSuccessTimes with this column and only sends when
-- the incoming count is larger (`where total_success_times is null or < N`, done
-- as one atomic update ... returning). flight-ecpay-return sets it to 1 for the
-- first charge. Rows that predate the column are null, so their next renewal
-- (TotalSuccessTimes >= 2) counts as new.

alter table flight.subscriptions
  add column total_success_times integer;
