import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { APP_NAME } from "@/integrations/supabase/app-scope";
import { SiteHeader } from "@/components/SiteHeader";

export const Route = createFileRoute("/auth/reset")({
  head: () => ({
    meta: [{ title: "Reset password — Flight Price Notifier" }],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.updateUser({
      password,
      data: { app: APP_NAME },
    });
    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }
    await supabase.auth.refreshSession();
    setLoading(false);
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto flex max-w-md flex-col justify-center px-4 py-16 sm:py-24">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-xl">
          <h1 className="text-2xl font-bold tracking-tight">Set a new password．設定新密碼</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            注意：這組新密碼將成為您在所有共用此帳號系統之服務的登入密碼。
          </p>

          {!ready ? (
            <p className="mt-6 text-sm text-muted-foreground">
              正在確認重設連結，請稍候…如果這裡卡住，請確認你是從信箱裡的連結點進來的。
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
                  New password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
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

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "Please wait…" : "Set password / 設定密碼"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
