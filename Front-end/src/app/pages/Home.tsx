import { ArrowRight, Sparkles, Utensils } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

const highlights = [
  "Projeto apresentado por alunos do CETI Zacarias de Gois.",
  "Desenvolvido no curso de Desenvolvimento de Sistemas.",
  "Pensado para organizar a fila da cantina com mais clareza e controle.",
];

export default function Home() {
  const { user } = useAuth();
  const accessTarget = user ? "/dashboard" : "/login";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#e0f2fe_0%,#f8fafc_40%,#fff7ed_100%)] text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-10">
        <header className="mb-10 flex items-start justify-between gap-3 sm:items-center">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-200">
              <Utensils className="h-7 w-7" />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-orange-600">Cantina Escolar</p>
              <h1 className="text-2xl font-black tracking-tight">Controle de atendimento</h1>
            </div>
          </div>

          <Link
            to={accessTarget}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 sm:gap-2 sm:px-5 sm:py-3 sm:text-sm"
          >
            {user ? "Abrir painel" : "Entrar"}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </header>

        <main className="mx-auto max-w-5xl">
          <section className="overflow-hidden rounded-[2rem] border border-white/80 bg-white/85 p-8 shadow-2xl shadow-slate-200 backdrop-blur lg:p-10">
            <div className="inline-flex items-center gap-2 rounded-full bg-orange-100 px-4 py-2 text-sm font-semibold text-orange-700">
              <Sparkles className="h-4 w-4" />
              Bem-vindo ao projeto
            </div>

            <h2 className="mt-6 max-w-3xl text-4xl font-black tracking-tight text-slate-950 lg:text-5xl">
              Um sistema criado para melhorar o andamento da fila da cantina e reduzir confusão no atendimento.
            </h2>

            <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">
              Este projeto ajuda no controle da fila, evita que alunos furem a ordem de atendimento e traz mais
              organização para a rotina da escola.
            </p>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {highlights.map((item) => (
                <div key={item} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm leading-6 text-slate-700">{item}</p>
                </div>
              ))}
            </div>

            
          </section>
        </main>
      </div>
    </div>
  );
}
