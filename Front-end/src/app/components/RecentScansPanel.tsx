import { useEffect, useMemo, useState } from "react";
import { Clock3, RefreshCcw, Users } from "lucide-react";
import { ApiError, mealEntriesApi } from "../lib/api";
import { getMealTypeLabel } from "../lib/constants";
import { useAuth } from "../hooks/useAuth";
import type { MealEntry, MealType } from "../types/api";

export default function RecentScansPanel() {
  const { token } = useAuth();
  const [entries, setEntries] = useState<MealEntry[]>([]);
  const [showAllPeople, setShowAllPeople] = useState(false);
  const [mealFilter, setMealFilter] = useState<MealType | "all">("all");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : false,
  );

  const loadEntries = async () => {
    if (!token) {
      return;
    }

    setIsLoading(true);
    setErrorMessage("");

    try {
      const response = await mealEntriesApi.list(token);
      setEntries(response);
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError ? error.message : "Não foi possível carregar as últimas entradas.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadEntries();
  }, [token]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const syncViewport = () => setIsDesktop(mediaQuery.matches);
    syncViewport();

    mediaQuery.addEventListener("change", syncViewport);
    return () => {
      mediaQuery.removeEventListener("change", syncViewport);
    };
  }, []);

  useEffect(() => {
    setShowAllPeople(false);
  }, [mealFilter]);

  const initialVisibleCount = isDesktop ? 10 : 6;

  const filteredEntries = useMemo(
    () => (mealFilter === "all" ? entries : entries.filter((entry) => entry.meal_type === mealFilter)),
    [entries, mealFilter],
  );

  const visibleEntries = useMemo(
    () => (showAllPeople ? filteredEntries : filteredEntries.slice(0, initialVisibleCount)),
    [filteredEntries, initialVisibleCount, showAllPeople],
  );

  const todayCount = useMemo(
    () =>
      entries.filter(
        (entry) =>
          new Date(entry.recorded_at).toLocaleDateString("sv-SE") === new Date().toLocaleDateString("sv-SE"),
      ).length,
    [entries],
  );

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-7 shadow-lg shadow-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-500">
              Atendimento recente
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Lista real dos registros de almoço, merenda e sem rodízio.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadEntries()}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            <RefreshCcw className="h-4 w-4" />
            Atualizar
          </button>
        </div>

          <div className="mt-5 flex flex-wrap gap-3">
            {(["all", "almoco", "merenda", "sem_rodizio"] as const).map((filterOption) => {
              const isActive = mealFilter === filterOption;
              const label = filterOption === "all" ? "Todas" : getMealTypeLabel(filterOption);
              return (
                <button
                  key={filterOption}
                  type="button"
                  onClick={() => setMealFilter(filterOption)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    isActive
                      ? "bg-slate-950 text-white shadow-lg shadow-slate-200"
                      : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <CardNumber title="Total" value={entries.length} tone="dark" />
            <CardNumber title="Hoje" value={todayCount} tone="orange" />
            <CardNumber title="Exibidos" value={visibleEntries.length} tone="green" />
        </div>
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-7 shadow-lg shadow-slate-200">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Users className="h-6 w-6 text-orange-500" />
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-500">
                Últimos registros
              </p>
              <p className="mt-1 text-sm text-slate-500">Use `Ver mais` para expandir a lista completa.</p>
            </div>
          </div>

          {filteredEntries.length > initialVisibleCount && (
            <button
              type="button"
              onClick={() => setShowAllPeople((current) => !current)}
              className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              {showAllPeople ? "Ver menos" : "Ver mais"}
            </button>
          )}
        </div>

        <div className="mt-5 space-y-4">
          {isLoading ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
              Carregando registros...
            </div>
          ) : errorMessage ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
              {errorMessage}
            </div>
          ) : visibleEntries.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
              Ainda não há registros de atendimento.
            </div>
          ) : (
            visibleEntries.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-col gap-4 rounded-[1.75rem] border border-slate-200 bg-slate-50 p-4 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex rounded-full bg-slate-950 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-white">
                      {getMealTypeLabel(entry.meal_type)}
                    </span>
                    <span className="inline-flex rounded-full bg-orange-100 px-3 py-1 text-sm font-semibold text-orange-700">
                      {entry.class_display_name}
                    </span>
                  </div>
                  <p className="mt-3 text-lg font-black text-slate-900">{entry.student_name}</p>
                  <p className="mt-3 text-sm text-slate-600">Registrado por: {entry.recorded_by_name}</p>
                </div>

                <div className="text-left md:text-right">
                  <div className="mt-2 flex items-center gap-2 text-sm text-slate-600 md:justify-end">
                    <Clock3 className="h-4 w-4" />
                    <span>
                      {new Date(entry.recorded_at).toLocaleDateString("pt-BR")}{" "}
                      {new Date(entry.recorded_at).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function CardNumber({
  title,
  value,
  tone,
}: {
  title: string;
  value: number;
  tone: "dark" | "orange" | "green";
}) {
  const toneClass = {
    dark: "bg-slate-950 text-white",
    orange: "bg-orange-500 text-white",
    green: "bg-emerald-500 text-white",
  }[tone];

  return (
    <div className={`rounded-[1.75rem] p-5 ${toneClass}`}>
      <p className="text-xs uppercase tracking-[0.2em] opacity-80">{title}</p>
      <p className="mt-3 text-4xl font-black">{value}</p>
    </div>
  );
}
