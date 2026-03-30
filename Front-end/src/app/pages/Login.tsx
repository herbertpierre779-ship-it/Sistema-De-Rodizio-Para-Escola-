import { useEffect, useState } from "react";
import { ArrowLeft, KeyRound, Lock } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import { useFeedback } from "../hooks/useFeedback";

export default function Login() {
  const { emit } = useFeedback();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage("");

    if (username.trim().length > 0 && password.trim().length > 0) {
      setIsSubmitting(true);
      try {
        await login({ username, password });
        setUsername("");
        setPassword("");
        navigate("/dashboard");
      } catch (error) {
        setErrorMessage(error instanceof ApiError ? error.message : "Não foi possível entrar no sistema.");
      } finally {
        setIsSubmitting(false);
      }
    } else {
      setErrorMessage("Preencha o usuário e a senha para continuar.");
    }
  };

  useEffect(() => {
    if (!errorMessage) {
      return;
    }

    void emit("notification.generic", {
      dedupeKey: `login-error-${errorMessage}`,
    });
  }, [emit, errorMessage]);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#fff7ed_0%,#f8fafc_32%,#eff6ff_100%)] px-4 py-8 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-2xl items-center justify-center">
        <section className="w-full rounded-[2.2rem] border border-white bg-white/90 p-7 shadow-2xl shadow-orange-100 sm:p-9">
          <div className="flex items-center justify-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-700">
              <KeyRound className="h-4 w-4" />
              Acesso ao sistema
            </div>
          </div>

          <Link
            to="/"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-200"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Link>

          <div className="mb-9 mt-7 text-center">
            <div className="mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-orange-500 text-white shadow-lg shadow-orange-200">
              <Lock className="h-11 w-11" />
            </div>
            <h1 className="text-4xl font-black text-slate-900 sm:text-5xl">Login do sistema</h1>
            <p className="mt-3 text-base leading-7 text-slate-500">Digite seus dados para continuar.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="username" className="mb-2 block text-sm font-semibold text-slate-700">
                Usuário
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Digite seu usuário"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-400"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-2 block text-sm font-semibold text-slate-700">
                Senha de acesso
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Digite a senha"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-400"
                required
              />
            </div>

            {errorMessage && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-xl bg-orange-500 py-3 font-semibold text-white shadow-lg shadow-orange-100 transition hover:bg-orange-600"
            >
              {isSubmitting ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
