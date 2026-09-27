-- The public landing page (signed out, anon) words its "cancel anytime" card
-- by the 使用綠界付款 switch, so anon may read that one key too.
--
-- 20260923110000 revoked anon's inherited select on flight.settings; grant it
-- back and let only the payment_required policy cover anon. "admins can read
-- settings" stays `to authenticated`, so every other key is still admin-only.

grant select on flight.settings to anon;

alter policy "users can read payment_required"
  on flight.settings
  to anon, authenticated;
