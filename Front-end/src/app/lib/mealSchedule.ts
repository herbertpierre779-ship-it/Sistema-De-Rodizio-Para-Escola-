import type { MealType, MealScheduleSettings, UserRole } from "../types/api";

const SCHOOL_TIMEZONE = "America/Sao_Paulo";
const RESTRICTED_ROLES: Array<UserRole> = ["funcionario", "coordenadora"];

export const DEFAULT_MEAL_SCHEDULE: MealScheduleSettings = {
  profiles: ["funcionario", "coordenadora"],
  meals: {
    almoco: { enabled: true, windows: [{ start: "12:20", end: "14:20" }] },
    merenda: { enabled: true, windows: [{ start: "10:00", end: "10:20" }] },
    sem_rodizio: { enabled: false, windows: [] },
  },
};

function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function schoolMinutes(referenceDate: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SCHOOL_TIMEZONE,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(referenceDate);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

export function isMealVisibleForRole(
  schedule: MealScheduleSettings,
  mealType: MealType,
  role: UserRole,
  referenceDate = new Date(),
): boolean {
  if (role === "diretor") {
    return true;
  }
  if (!RESTRICTED_ROLES.includes(role)) {
    return true;
  }

  const config = schedule.meals[mealType];
  if (!config.enabled) {
    return true;
  }
  if (config.windows.length === 0) {
    return false;
  }

  const nowMinutes = schoolMinutes(referenceDate);
  return config.windows.some((windowItem) => {
    const start = parseTimeToMinutes(windowItem.start);
    const end = parseTimeToMinutes(windowItem.end);
    if (start === null || end === null || start >= end) return false;
    return start <= nowMinutes && nowMinutes < end;
  });
}

export function formatMealWindowSummary(schedule: MealScheduleSettings, mealType: MealType): string {
  const config = schedule.meals[mealType];
  if (!config.enabled) {
    return "Livre o dia todo";
  }

  if (!config.windows.length) {
    return "Sem horario configurado";
  }

  return config.windows.map((windowItem) => `Das ${windowItem.start} as ${windowItem.end}`).join(" | ");
}
