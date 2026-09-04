import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { APP_NAME, hasAppAccess } from "@/integrations/supabase/app-scope";
import { SiteHeader } from "@/components/SiteHeader";

export const Route = createFileRoute("/auth")({
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

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
        // only happens through the explicit sign-up flow below (matched
        // password or a verified password reset), never just by signing in.
        await supabase.auth.signOut();
        setError("Invalid login credentials");
        setLoading(false);
        return;
      }
      navigate({ to: "/dashboard" });
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
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

    if (alreadyRegistered) {
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (!signInError && signInData.user) {
        await supabase.auth.updateUser({ data: { app: APP_NAME } });
        await supabase.auth.refreshSession();
        setLoading(false);
        navigate({ to: "/dashboard" });
        return;
      }
      // Password didn't match the existing account — only a click on the
      // emailed link can change it, never an unauthenticated guess.
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset`,
      });
      setLoading(false);
      setNotice(
        "此 email 已有帳號。我們已寄送一封密碼重設信，請至信箱點擊連結設定密碼以啟用本服務。" +
          "注意：重設後的新密碼將同步成為您在所有共用此帳號系統之服務的登入密碼。",
      );
      setMode("sign-in");
      return;
    }

    setLoading(false);
    if (!data.session) {
      setNotice("Check your email to confirm your account, then sign in. 請到信箱收確認信。");
      setMode("sign-in");
      return;
    }
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto flex max-w-md flex-col justify-center px-4 py-16 sm:py-24">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-xl">
          <h1 className="text-2xl font-bold tracking-tight">
            {mode === "sign-in" ? "Welcome back．登入" : "Create account．註冊"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "sign-in"
              ? "Sign in to manage your fare alerts."
              : "Create an account to start tracking fares."}
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
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

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
                  : "Create account / 註冊"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setMode(mode === "sign-in" ? "sign-up" : "sign-in");
              setError(null);
              setNotice(null);
            }}
            className="mt-6 w-full text-center text-sm font-medium text-primary hover:underline"
          >
            {mode === "sign-in"
              ? "No account yet? Create one"
              : "Already have an account? Sign in"}
          </button>
        </div>
      </main>
    </div>
  );
}
