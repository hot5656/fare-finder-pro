-- Add Taipei -> London. 'LON' is the IATA metropolitan code (covers LHR/LGW/STN/...),
-- which is what Travelpayouts expects, same as 'TYO' / 'SEL' for the existing routes.

insert into flight.routes (plan_name, display_name, origin, destination) values
  ('london', '台北 ✈ 倫敦', 'TPE', 'LON')
on conflict (plan_name) do nothing;
