// flight-ecpay-result: ECPay's OrderResultURL. After paying, ECPay sends the
// user's *browser* back with a POST. The front-end is a SPA route that only
// serves GET, so this function's only job is to turn that POST into a 302.
//
// It does no auth and never activates anything — flight-ecpay-return does that.
// ECPay's browser hit carries no JWT -> verify_jwt = false. Because the body is
// unauthenticated, the landing site (CustomField3, set by flight-subscribe) is
// only honoured when it is on the allowlist; otherwise we use SITE_URL.

import { allowedOrigin, SITE_URL } from "../_shared/ecpay.ts";

Deno.serve(async (req) => {
  let rtnCode = "";
  let origin = "";
  if (req.method === "POST") {
    try {
      const form = new URLSearchParams(await req.text());
      rtnCode = form.get("RtnCode") ?? "";
      origin = allowedOrigin(form.get("CustomField3"));
    } catch {
      // fall through: treat as unknown result
    }
  }
  const outcome = rtnCode === "1" ? "success" : "failed";
  return new Response(null, {
    status: 302,
    headers: { Location: `${origin || SITE_URL}/dashboard?purchase=${outcome}` },
  });
});
