import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { logAudit } from "@/lib/supabaseSync";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resetSent, setResetSent] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError("Невірний email або пароль");
    } else {
      void logAudit('login');
      navigate("/");
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setError("Введіть email для відновлення пароля");
      return;
    }
    setLoading(true);
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    setResetSent(true);
  };

  return (
    <div className="min-h-screen bg-[#f0f4f8] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-sm p-8">
        <h1 className="text-xl font-semibold mb-1 text-foreground">ProctoCare</h1>
        <p className="text-sm text-muted-foreground mb-6">Вхід для лікаря</p>

        {resetSent ? (
          <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
            Лист для відновлення пароля надіслано на <strong>{email}</strong>. Перевірте пошту.
          </div>
        ) : (
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div>
              <label className="text-sm font-medium block mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                placeholder="doctor@example.com"
                autoComplete="email"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Пароль</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground rounded-lg py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? "Завантаження..." : "Увійти"}
            </button>
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={loading}
              className="text-sm text-muted-foreground hover:text-foreground text-center transition-colors disabled:opacity-50"
            >
              Забув пароль?
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
