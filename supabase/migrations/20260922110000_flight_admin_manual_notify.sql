-- Records which admin (if any) forced a notification send, for audit purposes.
-- Null means the row came from the normal automatic (flight-parser ->
-- flight-notification) path, unchanged from today.
alter table flight.notification_history
  add column triggered_by uuid references auth.users(id) on delete set null;

-- No RLS/grant changes needed: the existing "admins can read all
-- notification_history" policy (20260922100000_flight_admin_dashboard.sql)
-- already covers this new column via select *; writes stay service-role-only.
