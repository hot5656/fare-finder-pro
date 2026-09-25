import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { APP_NAME, hasAppAccess } from "@/integrations/supabase/app-scope";
import { SiteHeader } from "@/components/SiteHeader";

export const Route = createFileRoute("/auth/")({
  head: () => ({
    meta: [
      { title: "Sign in — Flight Price Notifier" },
      {
        name: "description",
        content: "Sign in to manage your fare alerts on Flight Price Notifier.",
      },
      { property: "og:title", content: "Sign in — Flight Price Notifier" },
      {
        property: "og:description",
        content: "Sign in to manage your fare alerts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

// Sign-up and "forgot password" take an email only; the password is set on
// /auth/reset after the emailed link proves the address. Sign-up still has to
// hand Supabase a password, so it gets a random one nobody ever sees.
function throwawayPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

// Same message whether the email was new, already used by another app, or
// unknown, so the page never tells a visitor which addresses have accounts.
const CHECK_EMAIL_NOTICE =
  "請到信箱點擊連結設定密碼。若此 email 已在其他共用此帳號系統的服務註冊過，" +
  "設定的密碼也會成為那些服務的登入密碼。 / Check your email for a link to set your password.";

type Mode = "sign-in" | "sign-up" | "forgot";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  // ?app= lets the shared send-email hook pick this app's sender and subject.
  const setPasswordUrl = () => `${window.location.origin}/auth/reset?app=${APP_NAME}`;

  async function sendResetLink(): Promise<boolean> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: setPasswordUrl(),
    });
    if (error) {
      setError(error.message);
      return false;
    }
    return true;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    if (mode === "sign-in") {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      if (!hasAppAccess(data.user?.app_metadata)) {
        // Correct password, but this account was never registered for this
        // app specifically — reject here rather than auto-joining. Joining
        // only happens through a verified email link (sign-up or forgot
        // password, then /auth/reset), never just by signing in.
        await supabase.auth.signOut();
        setError("Invalid login credentials");
        setLoading(false);
        return;
      }
      navigate({ to: "/dashboard" });
      return;
    }

    if (mode === "forgot") {
      const sent = await sendResetLink();
      setLoading(false);
      if (sent) {
        setNotice(CHECK_EMAIL_NOTICE);
        setMode("sign-in");
      }
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password: throwawayPassword(),
      options: {
        // The confirmation link lands on the set-password page.
        emailRedirectTo: setPasswordUrl(),
        data: { app: APP_NAME },
      },
    });

    // Whether a duplicate email surfaces as an explicit error or as a
    // silently-obfuscated "success" depends on this shared project's Email
    // Enumeration Protection setting — handle both signals.
    const alreadyRegistered =
      error?.code === "user_already_exists" ||
      (!error && !!data.user && data.user.identities?.length === 0);

    if (error && !alreadyRegistered) {
      setLoading(false);
      setError(error.message);
      return;
    }

    if (alreadyRegistered || data.session) {
      // An existing account (another app's, or already confirmed) keeps its
      // password until the owner sets a new one from the emailed reset link,
      // which is also where this app's tag is added. A session here would mean
      // email confirmation is off; its password is the throwaway one, so drop
      // it and send the same link.
      if (data.session) await supabase.auth.signOut();
      const sent = await sendResetLink();
      setLoading(false);
      if (sent) {
        setNotice(CHECK_EMAIL_NOTICE);
        setMode("sign-in");
      }
      return;
    }

    setLoading(false);
    setNotice(CHECK_EMAIL_NOTICE);
    setMode("sign-in");
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto flex max-w-md flex-col justify-center px-4 py-16 sm:py-24">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-xl">
          <h1 className="text-2xl font-bold tracking-tight">
            {mode === "sign-in"
              ? "Welcome back．登入"
              : mode === "sign-up"
                ? "Create account．註冊"
                : "Forgot password．忘記密碼"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "sign-in"
              ? "Sign in to manage your fare alerts."
              : mode === "sign-up"
                ? "輸入 email，我們會寄出連結讓你設定密碼。 / Enter your email and we'll send a link to set your password."
                : "輸入 email，我們會寄出重設密碼的連結。 / Enter your email and we'll send a link to reset your password."}
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {mode === "sign-in" && (
              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {notice && <p className="text-sm text-primary">{notice}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading
                ? "Please wait…"
                : mode === "sign-in"
                  ? "Sign in / 登入"
                  : mode === "sign-up"
                    ? "Send sign-up link / 寄送註冊連結"
                    : "Send reset link / 寄送重設連結"}
            </button>
          </form>

          {mode === "sign-in" && (
            <button
              type="button"
              onClick={() => switchMode("forgot")}
              className="mt-4 w-full text-center text-sm text-muted-foreground hover:underline"
            >
              Forgot password? 忘記密碼？
            </button>
          )}
          <button
            type="button"
            onClick={() => switchMode(mode === "sign-in" ? "sign-up" : "sign-in")}
            className="mt-6 w-full text-center text-sm font-medium text-primary hover:underline"
          >
            {mode === "sign-in" ? "No account yet? Create one" : "Already have an account? Sign in"}
          </button>
        </div>
      </main>
    </div>
  );
}
