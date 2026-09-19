// flight-ecpay-result: ECPay's OrderResultURL. After paying, ECPay sends the
// user's *browser* back with a POST. The front-end is a SPA route that only
// serves GET, so this function's only job is to turn that POST into a 302.
//
// It does no auth and never activates anything — flight-ecpay-return does that.
// ECPay's browser hit carries no JWT -> verify_jwt = false.

import { SITE_URL } from "../_shared/ecpay.ts";

Deno.serve(async (req) => {
  let rtnCode = "";
  if (req.method === "POST") {
    try {
      rtnCode = new URLSearchParams(await req.text()).get("RtnCode") ?? "";
    } catch {
      // fall through: treat as unknown result
    }
  }
  const outcome = rtnCode === "1" ? "success" : "failed";
  return new Response(null, {
    status: 302,
    headers: { Location: `${SITE_URL}/dashboard?purchase=${outcome}` },
  });
});
