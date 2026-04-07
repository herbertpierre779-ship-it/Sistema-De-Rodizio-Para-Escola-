import { useEffect, useMemo, useState } from "react";
import { BarChart3, Filter, RefreshCcw, Users, X } from "lucide-react";
import { ApiError, classesApi, mealEntriesApi, studentsApi } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import { getMealTypeLabel } from "../lib/constants";
import type { ClassItem, MealEntry, MealType, SchoolYear, StudentItem } from "../types/api";

type FilterValue = MealType | "all";
type ExceptionFilterValue = MealType | "exception" | "all";
type StudentYearFilter = SchoolYear | "all";
type StudentFilterState = {
  year: SchoolYear | "";
  classId: string;
};
type StudentRecordsFilter = "today" | "all";
type RankingPeriodMode = "day" | "month";
type EntriesPeriodMode = "week" | "month";
type HistoryPeriodMode = "today" | "week" | "month";
type TotalsView = "today" | "week" | "month";

type ChartPoint = { label: string; value: number };
type WeekRange = { index: number; startDay: number; endDay: number; label: string };

const mealFilterOptions: FilterValue[] = ["all", "almoco", "merenda", "sem_rodizio"];
const exceptionFilterOptions: ExceptionFilterValue[] = ["all", "almoco", "merenda", "sem_rodizio", "exception"];
const schoolYears: SchoolYear[] = ["1 ano", "2 ano", "3 ano"];

function isKnownSchoolYear(value: string): value is SchoolYear {
  return schoolYears.includes(value as SchoolYear);
}

function normalizeYearFilter(value: StudentYearFilter): StudentYearFilter {
  if (value === "all") {
    return "all";
  }
  return isKnownSchoolYear(value) ? value : "all";
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function toDayKey(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function toMonthKey(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function parseDayKey(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function parseMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return {
    year: year || new Date().getFullYear(),
    month: month || 1,
  };
}

function getDaysInMonth(monthKey: string) {
  const { year, month } = parseMonthKey(monthKey);
  return new Date(year, month, 0).getDate();
}

function buildWeekRanges(monthKey: string): WeekRange[] {
  const totalDays = getDaysInMonth(monthKey);
  const weeks: WeekRange[] = [];
  let weekIndex = 1;
  for (let startDay = 1; startDay <= totalDays; startDay += 7) {
    const endDay = Math.min(startDay + 6, totalDays);
    weeks.push({
      index: weekIndex,
      startDay,
      endDay,
      label: `Semana ${weekIndex} (${pad2(startDay)} ao ${pad2(endDay)})`,
    });
    weekIndex += 1;
  }
  return weeks;
}

function getCurrentWeekIndex(dayOfMonth: number) {
  return Math.floor((dayOfMonth - 1) / 7) + 1;
}

function formatMonthLabel(monthKey: string) {
  const { year, month } = parseMonthKey(monthKey);
  const raw = new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function formatDayLabel(dayKey: string) {
  return parseDayKey(dayKey).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatEntryDateTime(recordedAt: string) {
  const date = new Date(recordedAt);
  return `${date.toLocaleDateString("pt-BR")} ${date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function withCacheBust(url: string | null, versionHint?: string | null) {
  if (!url) {
    return null;
  }
  const version = (versionHint ?? "").trim();
  if (!version) {
    return url;
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}

function studentPhotoVersion(student: Pick<StudentItem, "id" | "updated_at"> | null | undefined) {
  if (!student) {
    return null;
  }
  return `${student.id}-${student.updated_at}`;
}

function isSameDay(recordedAt: string, dayKey: string) {
  return toDayKey(new Date(recordedAt)) === dayKey;
}

function isSameMonth(recordedAt: string, monthKey: string) {
  return toMonthKey(new Date(recordedAt)) === monthKey;
}

function filterEntriesByMeal(entries: MealEntry[], filter: FilterValue) {
  if (filter === "all") {
    return entries;
  }
  return entries.filter((entry) => entry.meal_type === filter);
}

function filterExceptionEntriesByType(entries: MealEntry[], filter: ExceptionFilterValue) {
  if (filter === "all") {
    return entries;
  }
  if (filter === "exception") {
    return entries.filter((entry) => entry.source === "excecao");
  }
  return entries.filter((entry) => entry.meal_type === filter);
}

function filterEntriesByRankingPeriod(
  entries: MealEntry[],
  mode: RankingPeriodMode,
  selectedDayKey: string,
  selectedMonthKey: string,
) {
  if (mode === "day") {
    return entries.filter((entry) => isSameDay(entry.recorded_at, selectedDayKey));
  }
  return entries.filter((entry) => isSameMonth(entry.recorded_at, selectedMonthKey));
}

function ChartColumn({ points }: { points: ChartPoint[] }) {
  const maxValue = Math.max(...points.map((point) => point.value), 1);

  return (
    <div className="space-y-3">
      {points.map((point) => (
        <div key={point.label}>
          <div className="mb-2 flex items-center justify-between gap-3 text-sm text-slate-600">
            <span>{point.label}</span>
            <span className="font-semibold text-slate-900">{point.value}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-orange-500" style={{ width: `${(point.value / maxValue) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MealEntryCard({ entry, compact = false }: { entry: MealEntry; compact?: boolean }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white ${compact ? "px-3 py-3" : "px-4 py-3"} text-sm text-slate-700`}>
      <span className="inline-flex rounded-full bg-slate-950 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white">
        {getMealTypeLabel(entry.meal_type)}
      </span>
      <p className="mt-2 font-semibold text-slate-900">{entry.student_name}</p>
      <p className="mt-1">{entry.class_display_name}</p>
      <p className="mt-1 text-slate-500">{formatEntryDateTime(entry.recorded_at)}</p>
    </div>
  );
}

function MealFilterPills({
  value,
  onChange,
}: {
  value: FilterValue;
  onChange: (value: FilterValue) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {mealFilterOptions.map((option) => {
        const isActive = value === option;
        const label = option === "all" ? "Todas" : getMealTypeLabel(option);

        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`whitespace-nowrap rounded-2xl px-4 py-3 text-sm font-semibold transition ${
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
  );
}

function ExceptionFilterPills({
  value,
  onChange,
}: {
  value: ExceptionFilterValue;
  onChange: (value: ExceptionFilterValue) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {exceptionFilterOptions.map((option) => {
        const isActive = value === option;
        const label = option === "all" ? "Todas" : option === "exception" ? "Excecao" : getMealTypeLabel(option);

        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`whitespace-nowrap rounded-2xl px-4 py-3 text-sm font-semibold transition ${
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
  );
}

function OverviewStatCard({
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
    <div className={`rounded-[1.5rem] p-4 sm:p-5 ${toneClass}`}>
      <p className="text-xs uppercase tracking-[0.2em] opacity-80">{title}</p>
      <p className="mt-2 text-3xl font-black sm:mt-3 sm:text-4xl">{value}</p>
    </div>
  );
}

function TodayMealCard({
  title,
  value,
  tone,
}: {
  title: string;
  value: number;
  tone: "orange" | "green" | "blue";
}) {
  const toneClass = {
    orange: "border-orange-200 bg-orange-50 text-orange-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
  }[tone];

  return (
    <div className={`rounded-[1.5rem] border px-4 py-5 text-center ${toneClass}`}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-2 text-4xl font-black leading-none">{value}</p>
    </div>
  );
}

function ExceptionEntryCard({
  entry,
  photoUrl,
  photoVersion,
}: {
  entry: MealEntry;
  photoUrl: string | null;
  photoVersion?: string | null;
}) {
  const resolvedPhotoUrl = withCacheBust(photoUrl, photoVersion);
  return (
    <article className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        {resolvedPhotoUrl ? (
          <img src={resolvedPhotoUrl} alt={entry.student_name} className="h-12 w-12 rounded-xl object-cover" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-200 text-slate-500">
            <Users className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">{entry.student_name}</p>
          <p className="truncate text-sm text-slate-500">{entry.class_display_name}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        <span className="rounded-full bg-slate-950 px-3 py-1 text-white">{getMealTypeLabel(entry.meal_type)}</span>
        <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-slate-700">
          {entry.source === "excecao" ? "Excecao" : "Padrao"}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-500">{formatEntryDateTime(entry.recorded_at)}</p>
    </article>
  );
}

function RankingCard({
  title,
  periodLabel,
  filterValue,
  onFilterChange,
  onOpenPeriodFilter,
  points,
  showPosition,
}: {
  title: string;
  periodLabel: string;
  filterValue: FilterValue;
  onFilterChange: (value: FilterValue) => void;
  onOpenPeriodFilter: () => void;
  points: ChartPoint[];
  showPosition: boolean;
}) {
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-500">{title}</p>
          <p className="mt-1 text-sm text-slate-500">{periodLabel}</p>
        </div>
        <button
          type="button"
          onClick={onOpenPeriodFilter}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
        >
          <Filter className="h-4 w-4" />
          Filtro periodo
        </button>
      </div>

      <div className="mt-4">
        <MealFilterPills value={filterValue} onChange={onFilterChange} />
      </div>

      <div className="mt-4 max-h-[42vh] space-y-3 overflow-y-auto pr-1">
        {points.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
            Sem dados no periodo selecionado.
          </div>
        ) : (
          points.map((point, index) => (
            <div key={point.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-slate-900">{showPosition ? `${index + 1}º - ${point.label}` : point.label}</p>
                <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-700">{point.value}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export default function StatsPanel() {
  const { token } = useAuth();
  const now = new Date();
  const todayKey = toDayKey(now);
  const currentMonthKey = toMonthKey(now);
  const currentWeekIndex = getCurrentWeekIndex(now.getDate());

  const [allEntries, setAllEntries] = useState<MealEntry[]>([]);
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [dailyMealFilter, setDailyMealFilter] = useState<FilterValue>("all");
  const [classRankMealFilter, setClassRankMealFilter] = useState<FilterValue>("all");
  const [yearRankMealFilter, setYearRankMealFilter] = useState<FilterValue>("all");

  const [rankPeriodMode, setRankPeriodMode] = useState<RankingPeriodMode>("month");
  const [rankSelectedDayKey, setRankSelectedDayKey] = useState(todayKey);
  const [rankSelectedMonthKey, setRankSelectedMonthKey] = useState(currentMonthKey);
  const [isRankFilterOpen, setIsRankFilterOpen] = useState(false);

  const [entriesPeriodMode, setEntriesPeriodMode] = useState<EntriesPeriodMode>("week");
  const [entriesSelectedMonthKey, setEntriesSelectedMonthKey] = useState(currentMonthKey);
  const [entriesSelectedWeekIndex, setEntriesSelectedWeekIndex] = useState(currentWeekIndex);
  const [isEntriesFilterOpen, setIsEntriesFilterOpen] = useState(false);

  const [exceptionMealFilter, setExceptionMealFilter] = useState<ExceptionFilterValue>("all");
  const [exceptionPeriodMode, setExceptionPeriodMode] = useState<HistoryPeriodMode>("month");
  const [exceptionSelectedMonthKey, setExceptionSelectedMonthKey] = useState(currentMonthKey);
  const [exceptionSelectedWeekIndex, setExceptionSelectedWeekIndex] = useState(currentWeekIndex);
  const [exceptionYearFilter, setExceptionYearFilter] = useState<StudentYearFilter>("all");
  const [exceptionClassFilter, setExceptionClassFilter] = useState<string>("all");
  const [isExceptionFilterOpen, setIsExceptionFilterOpen] = useState(false);

  const [studentFilterDraftYear, setStudentFilterDraftYear] = useState<SchoolYear | "">("");
  const [studentFilterDraftClassId, setStudentFilterDraftClassId] = useState<string>("");
  const [appliedStudentFilter, setAppliedStudentFilter] = useState<StudentFilterState | null>(null);
  const [isStudentFilterOpen, setIsStudentFilterOpen] = useState(false);
  const [selectedStudentForStats, setSelectedStudentForStats] = useState<StudentItem | null>(null);
  const [isStudentStatsOpen, setIsStudentStatsOpen] = useState(false);
  const [studentRecordsFilter, setStudentRecordsFilter] = useState<StudentRecordsFilter>("today");
  const [totalsView, setTotalsView] = useState<TotalsView>("today");

  const loadData = async (keepContent = false) => {
    if (!token) {
      return;
    }

    if (keepContent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setErrorMessage("");

    try {
      const [entriesResponse, studentsResponse, classesResponse] = await Promise.all([
        mealEntriesApi.list(token),
        studentsApi.list(token),
        classesApi.list(token),
      ]);
      setAllEntries(entriesResponse);
      setStudents(studentsResponse);
      setClasses(classesResponse);
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : "Nao foi possivel carregar as estatisticas.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void loadData(false);
  }, [token]);

  useEffect(() => {
    if (!isRankFilterOpen && !isEntriesFilterOpen && !isExceptionFilterOpen && !isStudentFilterOpen && !isStudentStatsOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isRankFilterOpen, isEntriesFilterOpen, isExceptionFilterOpen, isStudentFilterOpen, isStudentStatsOpen]);

  const availableMonthKeys = useMemo(() => {
    const monthSet = new Set<string>([currentMonthKey]);
    allEntries.forEach((entry) => {
      monthSet.add(toMonthKey(new Date(entry.recorded_at)));
    });
    return Array.from(monthSet).sort((first, second) => second.localeCompare(first));
  }, [allEntries, currentMonthKey]);

  const currentMonthWeeks = useMemo(() => buildWeekRanges(currentMonthKey), [currentMonthKey]);
  const currentWeekRange = useMemo(
    () => currentMonthWeeks.find((week) => week.index === currentWeekIndex) ?? currentMonthWeeks[currentMonthWeeks.length - 1],
    [currentMonthWeeks, currentWeekIndex],
  );

  const entriesWeeksForSelectedMonth = useMemo(() => buildWeekRanges(entriesSelectedMonthKey), [entriesSelectedMonthKey]);
  const exceptionWeeksForSelectedMonth = useMemo(
    () => buildWeekRanges(exceptionSelectedMonthKey),
    [exceptionSelectedMonthKey],
  );

  useEffect(() => {
    if (!entriesWeeksForSelectedMonth.some((week) => week.index === entriesSelectedWeekIndex)) {
      setEntriesSelectedWeekIndex(entriesWeeksForSelectedMonth[0]?.index ?? 1);
    }
  }, [entriesSelectedWeekIndex, entriesWeeksForSelectedMonth]);

  useEffect(() => {
    if (!exceptionWeeksForSelectedMonth.some((week) => week.index === exceptionSelectedWeekIndex)) {
      setExceptionSelectedWeekIndex(exceptionWeeksForSelectedMonth[0]?.index ?? 1);
    }
  }, [exceptionSelectedWeekIndex, exceptionWeeksForSelectedMonth]);

  const selectedEntriesWeek = useMemo(
    () => entriesWeeksForSelectedMonth.find((week) => week.index === entriesSelectedWeekIndex) ?? entriesWeeksForSelectedMonth[0],
    [entriesSelectedWeekIndex, entriesWeeksForSelectedMonth],
  );
  const selectedExceptionWeek = useMemo(
    () =>
      exceptionWeeksForSelectedMonth.find((week) => week.index === exceptionSelectedWeekIndex) ??
      exceptionWeeksForSelectedMonth[0],
    [exceptionSelectedWeekIndex, exceptionWeeksForSelectedMonth],
  );

  const classFilterOptions = useMemo(() => {
    const source = studentFilterDraftYear
      ? classes.filter((classItem) => classItem.school_year === studentFilterDraftYear)
      : classes;
    return [...source].sort((first, second) => first.name.localeCompare(second.name, "pt-BR"));
  }, [classes, studentFilterDraftYear]);
  const exceptionClassFilterOptions = useMemo(() => {
    const normalizedYearFilter = normalizeYearFilter(exceptionYearFilter);
    const byYear =
      normalizedYearFilter === "all"
        ? classes
        : classes.filter((classItem) => classItem.school_year === normalizedYearFilter);
    return [...byYear].sort((first, second) => first.name.localeCompare(second.name, "pt-BR"));
  }, [classes, exceptionYearFilter]);

  const filteredStudents = useMemo(() => {
    if (!appliedStudentFilter) {
      return [];
    }
    return students
      .filter((student) => (appliedStudentFilter.year ? student.school_year === appliedStudentFilter.year : true))
      .filter((student) => (appliedStudentFilter.classId ? student.class_id === appliedStudentFilter.classId : true))
      .sort((first, second) => first.full_name.localeCompare(second.full_name, "pt-BR"));
  }, [appliedStudentFilter, students]);

  useEffect(() => {
    const normalizedYearFilter = normalizeYearFilter(exceptionYearFilter);
    if (normalizedYearFilter !== exceptionYearFilter) {
      setExceptionYearFilter("all");
    }
  }, [exceptionYearFilter]);

  useEffect(() => {
    if (!studentFilterDraftClassId) {
      return;
    }
    if (!classFilterOptions.some((classItem) => classItem.id === studentFilterDraftClassId)) {
      setStudentFilterDraftClassId("");
    }
  }, [classFilterOptions, studentFilterDraftClassId]);
  useEffect(() => {
    if (exceptionClassFilter === "all") {
      return;
    }
    if (!exceptionClassFilterOptions.some((classItem) => classItem.id === exceptionClassFilter)) {
      setExceptionClassFilter("all");
    }
  }, [exceptionClassFilter, exceptionClassFilterOptions]);

  const todayEntries = useMemo(
    () => allEntries.filter((entry) => isSameDay(entry.recorded_at, todayKey)),
    [allEntries, todayKey],
  );

  const last7DayKeySet = useMemo(() => {
    const result = new Set<string>();
    for (let index = 0; index < 7; index += 1) {
      const date = new Date(now);
      date.setDate(now.getDate() - index);
      result.add(toDayKey(date));
    }
    return result;
  }, [now]);

  const entriesLast7Days = useMemo(
    () => allEntries.filter((entry) => last7DayKeySet.has(toDayKey(new Date(entry.recorded_at)))),
    [allEntries, last7DayKeySet],
  );

  const weekEntries = useMemo(() => {
    if (!currentWeekRange) {
      return [];
    }
    return allEntries.filter((entry) => {
      if (!isSameMonth(entry.recorded_at, currentMonthKey)) {
        return false;
      }
      const day = new Date(entry.recorded_at).getDate();
      return day >= currentWeekRange.startDay && day <= currentWeekRange.endDay;
    });
  }, [allEntries, currentMonthKey, currentWeekRange]);

  const monthEntries = useMemo(
    () => allEntries.filter((entry) => isSameMonth(entry.recorded_at, currentMonthKey)),
    [allEntries, currentMonthKey],
  );

  const totalsEntries = useMemo(() => {
    if (totalsView === "week") {
      return weekEntries;
    }
    if (totalsView === "month") {
      return monthEntries;
    }
    return todayEntries;
  }, [monthEntries, todayEntries, totalsView, weekEntries]);

  const totalsTitle = totalsView === "week" ? "Totais da semana" : totalsView === "month" ? "Totais do mes" : "Totais de hoje";
  const totalsPeriodLabel =
    totalsView === "week"
      ? currentWeekRange?.label ?? "Semana atual"
      : totalsView === "month"
        ? formatMonthLabel(currentMonthKey)
        : "Dia atual";

  const rankPeriodLabel =
    rankPeriodMode === "day"
      ? `Dia ${formatDayLabel(rankSelectedDayKey)}`
      : `Mes ${formatMonthLabel(rankSelectedMonthKey)}`;
  const exceptionPeriodLabel =
    exceptionPeriodMode === "today"
      ? `Hoje (${formatDayLabel(todayKey)})`
      : exceptionPeriodMode === "week"
      ? selectedExceptionWeek?.label ?? "Semana atual"
      : `Mes ${formatMonthLabel(exceptionSelectedMonthKey)}`;

  const classRankingPoints = useMemo(() => {
    const entriesByPeriod = filterEntriesByRankingPeriod(allEntries, rankPeriodMode, rankSelectedDayKey, rankSelectedMonthKey);
    const entriesByMeal = filterEntriesByMeal(entriesByPeriod, classRankMealFilter);
    const counter = new Map<string, number>();
    entriesByMeal.forEach((entry) => {
      counter.set(entry.class_name, (counter.get(entry.class_name) ?? 0) + 1);
    });
    return Array.from(counter.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((first, second) => second.value - first.value || first.label.localeCompare(second.label, "pt-BR"))
      .slice(0, 10);
  }, [allEntries, classRankMealFilter, rankPeriodMode, rankSelectedDayKey, rankSelectedMonthKey]);

  const yearRankingPoints = useMemo(() => {
    const entriesByPeriod = filterEntriesByRankingPeriod(allEntries, rankPeriodMode, rankSelectedDayKey, rankSelectedMonthKey);
    const entriesByMeal = filterEntriesByMeal(entriesByPeriod, yearRankMealFilter);
    const points = schoolYears.map((year, index) => ({
      label: year,
      value: entriesByMeal.filter((entry) => entry.school_year === year).length,
      order: index,
    }));
    return points
      .sort((first, second) => second.value - first.value || first.order - second.order)
      .map(({ label, value }) => ({ label, value }));
  }, [allEntries, rankPeriodMode, rankSelectedDayKey, rankSelectedMonthKey, yearRankMealFilter]);

  const dailyEntriesChartPoints = useMemo(() => {
    const source = filterEntriesByMeal(allEntries, dailyMealFilter);
    const points: ChartPoint[] = [];
    const totalDays = getDaysInMonth(entriesSelectedMonthKey);

    if (entriesPeriodMode === "month") {
      for (let day = 1; day <= totalDays; day += 1) {
        const count = source.filter((entry) => {
          if (!isSameMonth(entry.recorded_at, entriesSelectedMonthKey)) {
            return false;
          }
          return new Date(entry.recorded_at).getDate() === day;
        }).length;
        points.push({ label: pad2(day), value: count });
      }
      return points;
    }

    if (!selectedEntriesWeek) {
      return [];
    }

    for (let day = selectedEntriesWeek.startDay; day <= selectedEntriesWeek.endDay; day += 1) {
      const count = source.filter((entry) => {
        if (!isSameMonth(entry.recorded_at, entriesSelectedMonthKey)) {
          return false;
        }
        return new Date(entry.recorded_at).getDate() === day;
      }).length;
      points.push({ label: pad2(day), value: count });
    }

    return points;
  }, [allEntries, dailyMealFilter, entriesPeriodMode, entriesSelectedMonthKey, selectedEntriesWeek]);
  const studentsById = useMemo(() => {
    const map = new Map<string, StudentItem>();
    students.forEach((student) => {
      map.set(student.id, student);
    });
    return map;
  }, [students]);
  const visibleExceptionEntries = useMemo(() => {
    let filtered = [...allEntries];
    filtered = filterExceptionEntriesByType(filtered, exceptionMealFilter);
    if (exceptionPeriodMode === "today") {
      filtered = filtered.filter((entry) => isSameDay(entry.recorded_at, todayKey));
    } else if (exceptionPeriodMode === "week") {
      filtered = filtered.filter((entry) => {
        if (!isSameMonth(entry.recorded_at, exceptionSelectedMonthKey) || !selectedExceptionWeek) {
          return false;
        }
        const day = new Date(entry.recorded_at).getDate();
        return day >= selectedExceptionWeek.startDay && day <= selectedExceptionWeek.endDay;
      });
    } else {
      filtered = filtered.filter((entry) => isSameMonth(entry.recorded_at, exceptionSelectedMonthKey));
    }
    const normalizedExceptionYearFilter = normalizeYearFilter(exceptionYearFilter);
    if (normalizedExceptionYearFilter !== "all") {
      filtered = filtered.filter((entry) => entry.school_year === normalizedExceptionYearFilter);
    }
    if (exceptionClassFilter !== "all") {
      filtered = filtered.filter((entry) => entry.class_id === exceptionClassFilter);
    }
    return filtered.sort((first, second) => new Date(second.recorded_at).getTime() - new Date(first.recorded_at).getTime());
  }, [
    allEntries,
    exceptionClassFilter,
    exceptionMealFilter,
    exceptionPeriodMode,
    exceptionSelectedMonthKey,
    exceptionYearFilter,
    selectedExceptionWeek,
    todayKey,
  ]);
  const shouldEnableHistoryScroll = visibleExceptionEntries.length > 6;

  const studentEntries = useMemo(() => {
    if (!selectedStudentForStats) {
      return [];
    }
    return allEntries
      .filter((entry) => entry.student_id === selectedStudentForStats.id)
      .sort((first, second) => new Date(second.recorded_at).getTime() - new Date(first.recorded_at).getTime());
  }, [allEntries, selectedStudentForStats]);

  const studentEntriesToday = useMemo(
    () => studentEntries.filter((entry) => isSameDay(entry.recorded_at, todayKey)),
    [studentEntries, todayKey],
  );

  const visibleStudentEntries = studentRecordsFilter === "today" ? studentEntriesToday : studentEntries;

  const studentAttendanceDays = useMemo(() => {
    const daySet = new Set<string>();
    studentEntries.forEach((entry) => daySet.add(toDayKey(new Date(entry.recorded_at))));
    return daySet.size;
  }, [studentEntries]);

  const studentTotals = useMemo(
    () => ({
      almoco: studentEntries.filter((entry) => entry.meal_type === "almoco").length,
      merenda: studentEntries.filter((entry) => entry.meal_type === "merenda").length,
      sem_rodizio: studentEntries.filter((entry) => entry.meal_type === "sem_rodizio").length,
    }),
    [studentEntries],
  );

  const availableDayKeysCurrentMonth = useMemo(() => {
    const totalDays = getDaysInMonth(currentMonthKey);
    const result: string[] = [];
    for (let day = 1; day <= totalDays; day += 1) {
      result.push(`${currentMonthKey}-${pad2(day)}`);
    }
    return result;
  }, [currentMonthKey]);

  const isStudentFilterReadyToApply = Boolean(
    studentFilterDraftYear || studentFilterDraftClassId,
  );

  const openStudentFilter = () => {
    setStudentFilterDraftYear(appliedStudentFilter?.year ?? "");
    setStudentFilterDraftClassId(appliedStudentFilter?.classId ?? "");
    setIsStudentFilterOpen(true);
  };

  const applyStudentFilter = () => {
    if (!studentFilterDraftYear && !studentFilterDraftClassId) {
      return;
    }
    setAppliedStudentFilter({
      year: studentFilterDraftYear,
      classId: studentFilterDraftClassId,
    });
    setIsStudentFilterOpen(false);
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-600">
              <BarChart3 className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900">Estatisticas</h2>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void loadData(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCcw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "Atualizando..." : "Atualizar"}
          </button>
        </div>

        {isLoading ? (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
            Carregando indicadores...
          </div>
        ) : errorMessage ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">{errorMessage}</div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <OverviewStatCard title="Entradas hoje" value={todayEntries.length} tone="dark" />
            <OverviewStatCard title="Ultimos 7 dias" value={entriesLast7Days.length} tone="orange" />
            <OverviewStatCard title="Alunos" value={students.length} tone="green" />
          </div>
        )}
      </section>

      {!isLoading && !errorMessage && (
        <>
          <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-500">{totalsTitle}</p>
                <p className="mt-1 text-sm text-slate-500">Resumo por tipo de refeicao.</p>
              </div>
              <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-white">
                {totalsEntries.length} atendimento(s)
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 sm:max-w-md">
              <button
                type="button"
                onClick={() => setTotalsView("today")}
                className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  totalsView === "today"
                    ? "bg-slate-950 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Hoje
              </button>
              <button
                type="button"
                onClick={() => setTotalsView("week")}
                className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  totalsView === "week"
                    ? "bg-slate-950 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Semana
              </button>
              <button
                type="button"
                onClick={() => setTotalsView("month")}
                className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  totalsView === "month"
                    ? "bg-slate-950 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Mes
              </button>
            </div>

            <p className="mt-3 text-sm text-slate-600">{totalsPeriodLabel}</p>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <TodayMealCard title="Almoco" value={totalsEntries.filter((entry) => entry.meal_type === "almoco").length} tone="orange" />
              <TodayMealCard title="Merenda" value={totalsEntries.filter((entry) => entry.meal_type === "merenda").length} tone="green" />
              <TodayMealCard
                title="Sem rodizio"
                value={totalsEntries.filter((entry) => entry.meal_type === "sem_rodizio").length}
                tone="blue"
              />
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-500">
                  {entriesPeriodMode === "month" ? "Entradas e saida por mes" : "Entradas e saida por dia"}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {entriesPeriodMode === "week"
                    ? selectedEntriesWeek?.label ?? "Semana atual"
                    : `Mes ${formatMonthLabel(entriesSelectedMonthKey)}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsEntriesFilterOpen(true)}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
              >
                <Filter className="h-4 w-4" />
                Filtro periodo
              </button>
            </div>

            <div className="mt-4">
              <MealFilterPills value={dailyMealFilter} onChange={setDailyMealFilter} />
            </div>

            <div className="mt-6">
              {dailyEntriesChartPoints.length > 0 ? (
                <ChartColumn points={dailyEntriesChartPoints} />
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                  Sem dados no periodo selecionado.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-500">Historico de refeicoes</p>
                <p className="mt-1 text-sm text-slate-500">{exceptionPeriodLabel}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsExceptionFilterOpen(true)}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
              >
                <Filter className="h-4 w-4" />
                Filtro
              </button>
            </div>

            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Ano: <span className="font-semibold">{normalizeYearFilter(exceptionYearFilter) === "all" ? "Todos" : normalizeYearFilter(exceptionYearFilter)}</span> | Turma:{" "}
              <span className="font-semibold">
                {exceptionClassFilter === "all"
                  ? "Todas"
                  : classes.find((classItem) => classItem.id === exceptionClassFilter)?.name ?? "Todas"}
              </span>
            </div>

            <div className="mt-4">
              <ExceptionFilterPills value={exceptionMealFilter} onChange={setExceptionMealFilter} />
            </div>

            <div className={`mt-5 space-y-3 pr-1 ${shouldEnableHistoryScroll ? "max-h-[34rem] overflow-y-auto" : ""}`}>
              {visibleExceptionEntries.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                  Nenhuma entrada para o filtro selecionado.
                </div>
              ) : (
                visibleExceptionEntries.map((entry) => (
                  <ExceptionEntryCard
                    key={entry.id}
                    entry={entry}
                    photoUrl={studentsById.get(entry.student_id)?.photo_url ?? null}
                    photoVersion={studentPhotoVersion(studentsById.get(entry.student_id))}
                  />
                ))
              )}
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <RankingCard
              title="Turmas com mais refeicoes"
              periodLabel={rankPeriodLabel}
              filterValue={classRankMealFilter}
              onFilterChange={setClassRankMealFilter}
              onOpenPeriodFilter={() => setIsRankFilterOpen(true)}
              points={classRankingPoints}
              showPosition
            />
            <RankingCard
              title="Ano com mais refeicao"
              periodLabel={rankPeriodLabel}
              filterValue={yearRankMealFilter}
              onFilterChange={setYearRankMealFilter}
              onOpenPeriodFilter={() => setIsRankFilterOpen(true)}
              points={yearRankingPoints}
              showPosition={false}
            />
          </div>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Users className="h-6 w-6 text-orange-500" />
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-500">Estatisticas dos alunos</p>
                </div>
              </div>
              <button
                type="button"
                onClick={openStudentFilter}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
              >
                <Filter className="h-4 w-4" />
                Filtro ano/turma
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {appliedStudentFilter ? (
                <>
                  Ano: <span className="font-semibold">{appliedStudentFilter.year || "Todos"}</span> | Turma:{" "}
                  <span className="font-semibold">
                    {classes.find((classItem) => classItem.id === appliedStudentFilter.classId)?.name ??
                      (appliedStudentFilter.classId ? "Turma nao encontrada" : "Todas")}
                  </span>{" "}
                </>
              ) : (
                "Ano: Todos | Turma: Todas"
              )}
            </div>

            <div className="mt-5 max-h-[48vh] space-y-3 overflow-y-auto pr-1">
              {!appliedStudentFilter ? null : filteredStudents.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                  Nenhum aluno encontrado para o filtro selecionado.
                </div>
              ) : (
                filteredStudents.map((student) => (
                  <button
                    key={student.id}
                    type="button"
                    onClick={() => {
                      setSelectedStudentForStats(student);
                      setStudentRecordsFilter("today");
                      setIsStudentStatsOpen(true);
                    }}
                    className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    {student.photo_url ? (
                      <img
                        src={withCacheBust(student.photo_url, studentPhotoVersion(student)) ?? student.photo_url}
                        alt={student.full_name}
                        className="h-12 w-12 rounded-xl object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-200 text-slate-500">
                        <Users className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">{student.full_name}</p>
                      <p className="truncate text-sm text-slate-500">{student.class_display_name}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>
        </>
      )}

      {isRankFilterOpen && (
        <div className="fixed inset-0 z-[75] flex items-end justify-center bg-slate-950/55 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4">
          <div className="w-full max-w-md rounded-[2rem] border border-white/70 bg-white p-6 shadow-2xl shadow-slate-900/20 sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xl font-black text-slate-900">Filtro do ranking</h3>
              <button
                type="button"
                onClick={() => setIsRankFilterOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-slate-700 transition hover:bg-slate-200"
                aria-label="Fechar filtro"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRankPeriodMode("day")}
                className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  rankPeriodMode === "day"
                    ? "bg-slate-950 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Por dia
              </button>
              <button
                type="button"
                onClick={() => setRankPeriodMode("month")}
                className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  rankPeriodMode === "month"
                    ? "bg-slate-950 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Por mes
              </button>
            </div>

            {rankPeriodMode === "day" ? (
              <div className="mt-4">
                <label className="mb-2 block text-sm font-semibold text-slate-700">Dia ({formatMonthLabel(currentMonthKey)})</label>
                <select
                  value={rankSelectedDayKey}
                  onChange={(event) => setRankSelectedDayKey(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-400"
                >
                  {availableDayKeysCurrentMonth.map((dayKey) => (
                    <option key={dayKey} value={dayKey}>
                      {formatDayLabel(dayKey)}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="mt-4">
                <label className="mb-2 block text-sm font-semibold text-slate-700">Mes</label>
                <select
                  value={rankSelectedMonthKey}
                  onChange={(event) => setRankSelectedMonthKey(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-400"
                >
                  {availableMonthKeys.map((monthKey) => (
                    <option key={monthKey} value={monthKey}>
                      {formatMonthLabel(monthKey)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={() => setIsRankFilterOpen(false)}
              className="mt-6 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Aplicar filtro
            </button>
          </div>
        </div>
      )}

      {isEntriesFilterOpen && (
        <div className="fixed inset-0 z-[76] flex items-end justify-center bg-slate-950/55 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4">
          <div className="w-full max-w-md rounded-[2rem] border border-white/70 bg-white p-6 shadow-2xl shadow-slate-900/20 sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xl font-black text-slate-900">
                {entriesPeriodMode === "month" ? "Filtro de entradas e saida por mes" : "Filtro de entradas e saida por dia"}
              </h3>
              <button
                type="button"
                onClick={() => setIsEntriesFilterOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-slate-700 transition hover:bg-slate-200"
                aria-label="Fechar filtro"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setEntriesPeriodMode("week")}
                className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  entriesPeriodMode === "week"
                    ? "bg-slate-950 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Semana
              </button>
              <button
                type="button"
                onClick={() => setEntriesPeriodMode("month")}
                className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  entriesPeriodMode === "month"
                    ? "bg-slate-950 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Mes
              </button>
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-sm font-semibold text-slate-700">Mes</label>
              <select
                value={entriesSelectedMonthKey}
                onChange={(event) => setEntriesSelectedMonthKey(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-400"
              >
                {availableMonthKeys.map((monthKey) => (
                  <option key={monthKey} value={monthKey}>
                    {formatMonthLabel(monthKey)}
                  </option>
                ))}
              </select>
            </div>

            {entriesPeriodMode === "week" && (
              <div className="mt-4">
                <label className="mb-2 block text-sm font-semibold text-slate-700">Semana</label>
                <select
                  value={entriesSelectedWeekIndex}
                  onChange={(event) => setEntriesSelectedWeekIndex(Number(event.target.value))}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-400"
                >
                  {entriesWeeksForSelectedMonth.map((week) => (
                    <option key={week.index} value={week.index}>
                      {week.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={() => setIsEntriesFilterOpen(false)}
              className="mt-6 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Aplicar filtro
            </button>
          </div>
        </div>
      )}

      {isExceptionFilterOpen && (
        <div className="fixed inset-0 z-[77] flex items-end justify-center bg-slate-950/55 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4">
          <div className="w-full max-w-md rounded-[2rem] border border-white/70 bg-white p-6 shadow-2xl shadow-slate-900/20 sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xl font-black text-slate-900">Filtro do historico</h3>
              <button
                type="button"
                onClick={() => setIsExceptionFilterOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-slate-700 transition hover:bg-slate-200"
                aria-label="Fechar filtro"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setExceptionPeriodMode("today")}
                className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  exceptionPeriodMode === "today"
                    ? "bg-slate-950 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Hoje
              </button>
              <button
                type="button"
                onClick={() => setExceptionPeriodMode("week")}
                className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  exceptionPeriodMode === "week"
                    ? "bg-slate-950 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Semana
              </button>
              <button
                type="button"
                onClick={() => setExceptionPeriodMode("month")}
                className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  exceptionPeriodMode === "month"
                    ? "bg-slate-950 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Mes
              </button>
            </div>

            {exceptionPeriodMode !== "today" ? (
              <div className="mt-4">
                <label className="mb-2 block text-sm font-semibold text-slate-700">Mes</label>
                <select
                  value={exceptionSelectedMonthKey}
                  onChange={(event) => setExceptionSelectedMonthKey(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-400"
                >
                  {availableMonthKeys.map((monthKey) => (
                    <option key={monthKey} value={monthKey}>
                      {formatMonthLabel(monthKey)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {exceptionPeriodMode === "week" && (
              <div className="mt-4">
                <label className="mb-2 block text-sm font-semibold text-slate-700">Semana</label>
                <select
                  value={exceptionSelectedWeekIndex}
                  onChange={(event) => setExceptionSelectedWeekIndex(Number(event.target.value))}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-400"
                >
                  {exceptionWeeksForSelectedMonth.map((week) => (
                    <option key={week.index} value={week.index}>
                      {week.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mt-4">
              <label className="mb-2 block text-sm font-semibold text-slate-700">Ano</label>
              <select
                value={exceptionYearFilter}
                onChange={(event) => setExceptionYearFilter(event.target.value as StudentYearFilter)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-400"
              >
                <option value="all">Todos</option>
                <option value="1 ano">1 ano</option>
                <option value="2 ano">2 ano</option>
                <option value="3 ano">3 ano</option>
              </select>
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-sm font-semibold text-slate-700">Turma</label>
              <select
                value={exceptionClassFilter}
                onChange={(event) => setExceptionClassFilter(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-400"
              >
                <option value="all">Todas</option>
                {exceptionClassFilterOptions.map((classItem) => (
                  <option key={classItem.id} value={classItem.id}>
                    {classItem.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => setIsExceptionFilterOpen(false)}
              className="mt-6 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Aplicar filtro
            </button>
          </div>
        </div>
      )}

      {isStudentFilterOpen && (
        <div className="fixed inset-0 z-[77] flex items-end justify-center bg-slate-950/55 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4">
          <div className="w-full max-w-md rounded-[2rem] border border-white/70 bg-white p-6 shadow-2xl shadow-slate-900/20 sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xl font-black text-slate-900">Filtro de alunos</h3>
              <button
                type="button"
                onClick={() => setIsStudentFilterOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-slate-700 transition hover:bg-slate-200"
                aria-label="Fechar filtro"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Ano</label>
                <select
                  value={studentFilterDraftYear}
                  onChange={(event) => setStudentFilterDraftYear(event.target.value as SchoolYear | "")}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-400"
                >
                  <option value="">Selecione</option>
                  <option value="1 ano">1 ano</option>
                  <option value="2 ano">2 ano</option>
                  <option value="3 ano">3 ano</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Turma</label>
                <select
                  value={studentFilterDraftClassId}
                  onChange={(event) => setStudentFilterDraftClassId(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-400"
                >
                  <option value="">Todas</option>
                  {classFilterOptions.map((classItem) => (
                    <option key={classItem.id} value={classItem.id}>
                      {classItem.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="button"
              onClick={applyStudentFilter}
              disabled={!isStudentFilterReadyToApply}
              className="mt-6 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Aplicar filtro
            </button>
          </div>
        </div>
      )}

      {isStudentStatsOpen && selectedStudentForStats && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[2rem] border border-white/70 bg-white p-6 shadow-2xl shadow-slate-900/20 sm:p-7">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-600">Aluno</p>
                <h3 className="mt-2 truncate text-2xl font-black text-slate-900">{selectedStudentForStats.full_name}</h3>
                <p className="mt-1 truncate text-sm text-slate-500">{selectedStudentForStats.class_display_name}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsStudentStatsOpen(false);
                  setSelectedStudentForStats(null);
                }}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-slate-700 transition hover:bg-slate-200"
                aria-label="Fechar estatisticas do aluno"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <TodayMealCard title="Dias com entrada" value={studentAttendanceDays} tone="blue" />
              <TodayMealCard title="Almoco" value={studentTotals.almoco} tone="orange" />
              <TodayMealCard title="Merenda" value={studentTotals.merenda} tone="green" />
              <TodayMealCard title="Sem rodizio" value={studentTotals.sem_rodizio} tone="blue" />
            </div>

            <div className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h4 className="text-sm font-black uppercase tracking-[0.2em] text-slate-700">Registros</h4>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setStudentRecordsFilter("today")}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                      studentRecordsFilter === "today"
                        ? "bg-slate-950 text-white"
                        : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    Hoje
                  </button>
                  <button
                    type="button"
                    onClick={() => setStudentRecordsFilter("all")}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                      studentRecordsFilter === "all"
                        ? "bg-slate-950 text-white"
                        : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    Todos
                  </button>
                </div>
              </div>

              <div className="mt-3 max-h-[36vh] space-y-3 overflow-y-auto pr-1">
                {visibleStudentEntries.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                    {studentRecordsFilter === "today"
                      ? "Sem registros para hoje."
                      : "Nenhum registro encontrado para este aluno."}
                  </div>
                ) : (
                  visibleStudentEntries.map((entry) => <MealEntryCard key={entry.id} entry={entry} compact />)
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
