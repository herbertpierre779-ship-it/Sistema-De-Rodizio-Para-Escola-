import { useEffect, useState } from "react";
import { ArrowLeft, Camera, ScanFace, ShieldCheck, UserRoundCheck } from "lucide-react";
import { Link } from "react-router-dom";

type ScanState = "idle" | "scanning" | "matched";

export default function Scan() {
  const [scanState, setScanState] = useState<ScanState>("idle");

  useEffect(() => {
    if (scanState !== "scanning") {
      return;
    }

    const timeout = window.setTimeout(() => {
      setScanState("matched");
    }, 2400);

    return () => window.clearTimeout(timeout);
  }, [scanState]);

  return (
    <div className="min-h-screen bg-slate-950 px-6 py-8 text-white">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
              Escaneamento
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">Central de reconhecimento</h1>
          </div>

          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar ao inicio
          </Link>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-[2rem] border border-cyan-400/20 bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950/50 p-6 shadow-2xl shadow-cyan-950/40 lg:p-8">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-300">
                  <ScanFace className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold">Leitura facial</h2>
                  <p className="text-sm text-slate-300">Interface visual para reconhecimento do aluno</p>
                </div>
              </div>

              <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-cyan-200">
                {scanState === "idle" && "Aguardando"}
                {scanState === "scanning" && "Escaneando"}
                {scanState === "matched" && "Correspondencia"}
              </span>
            </div>

            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top,#164e63_0%,#020617_65%)] p-6">
              <div className="relative mx-auto flex aspect-square max-w-[28rem] items-center justify-center rounded-[2rem] border border-cyan-400/30 bg-slate-950/60">
                <div className="absolute inset-6 rounded-[1.5rem] border border-dashed border-cyan-300/40" />
                <div className="absolute inset-x-10 top-1/2 h-0.5 -translate-y-1/2 bg-cyan-300 shadow-[0_0_24px_rgba(103,232,249,0.9)]">
                  {scanState === "scanning" && (
                    <div className="h-full w-full animate-pulse bg-cyan-200" />
                  )}
                </div>
                <div className="text-center">
                  {scanState === "matched" ? (
                    <UserRoundCheck className="mx-auto h-24 w-24 text-emerald-300" />
                  ) : (
                    <Camera className="mx-auto h-24 w-24 text-cyan-200/80" />
                  )}
                  <p className="mt-5 text-lg font-semibold">
                    {scanState === "idle" && "Posicione o rosto dentro da area de leitura"}
                    {scanState === "scanning" && "Analisando pontos faciais e verificando cadastro"}
                    {scanState === "matched" && "Aluno identificado com sucesso"}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-4">
              <button
                type="button"
                onClick={() => setScanState("scanning")}
                className="rounded-2xl bg-cyan-400 px-6 py-3 font-bold text-slate-950 transition hover:bg-cyan-300"
              >
                Iniciar escaneamento
              </button>
              <Link
                to="/dashboard"
                className="rounded-2xl border border-white/15 bg-white/5 px-6 py-3 font-semibold text-white transition hover:bg-white/10"
              >
                Abrir painel da cantina
              </Link>
            </div>
          </section>

          <aside className="space-y-5">
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6">
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-6 w-6 text-emerald-300" />
                <h3 className="text-lg font-bold">Como usar</h3>
              </div>
              <div className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
                <p>1. Posicione a pessoa em frente ao dispositivo.</p>
                <p>2. Clique em iniciar escaneamento.</p>
                <p>3. Depois da identificação, siga para a confirmação no painel.</p>
              </div>
            </div>

            <div className="rounded-[2rem] border border-cyan-400/20 bg-cyan-400/10 p-6">
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-200">
                Status atual
              </p>
              <h3 className="mt-3 text-2xl font-black text-white">
                {scanState === "idle" && "Sistema pronto para iniciar"}
                {scanState === "scanning" && "Reconhecimento em andamento"}
                {scanState === "matched" && "Pessoa reconhecida"}
              </h3>
              <p className="mt-3 text-sm leading-6 text-cyan-50/80">
                Esta tela está pronta como experiencia visual do fluxo de leitura facial. Se você
                quiser, no próximo passo eu posso conectar isso a webcam real.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
