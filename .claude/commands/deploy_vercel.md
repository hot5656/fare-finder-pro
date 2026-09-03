---
description: Deploy the local project to Vercel and report the live URL
---

Deploy this project to Vercel and give the user the URL to see it live on the internet.

Steps:

1. Check whether the Vercel CLI is authenticated (`vercel whoami`). If not logged in,
   tell the user to run `! vercel login` themselves (interactive login can't be done
   on their behalf) and stop.
2. Check whether this project is already linked to a Vercel project (look for
   `.vercel/project.json`). If not linked, linking will happen automatically on
   first deploy — confirm with the user which Vercel scope/project name to use if
   it's ambiguous.
3. Confirm with the user whether this should be a **preview** deployment or a
   **production** deployment (`vercel --prod`) before running anything — deploying
   to production is user-facing and should not happen silently.
4. Run the deploy:
   - Preview: `vercel`
   - Production: `vercel --prod`
5. Parse the deployment URL from the CLI output (the CLI prints the live URL on
   success, typically the last `https://...vercel.app` link, or a custom domain in
   production).
6. Report the final URL back to the user clearly, e.g.:
   "Your project is live at: <url>"

Notes:
- If the deploy fails (build error, missing env vars, etc.), show the relevant
  error output and do not fabricate a URL.
- Never use `--force` or skip confirmation prompts without the user's explicit go-ahead.
- If environment variables are required for the build (e.g. `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_PUBLISHABLE_KEY`), remind the user to set them in the Vercel
  project settings (or via `vercel env add`) if the deploy fails due to missing config.
