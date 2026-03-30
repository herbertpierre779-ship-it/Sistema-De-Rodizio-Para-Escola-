import type {
  AuthUser,
  ClassItem,
  FaceEnrollResponse,
  LoginResponse,
  MealEntry,
  MealType,
  MealScheduleSettings,
  PermissionsEffectiveResponse,
  PermissionsSettingsResponse,
  RecognitionResult,
  RegistrationCaptureMode,
  RegistrationCaptureModeResponse,
  SchoolYear,
  StatsCharts,
  StatsOverview,
  StudentAttendanceSummary,
  StudentFaceAssetsResponse,
  StudentItem,
  UserRole,
} from "../types/api";

const configuredApiBaseUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
const API_BASE_URL = configuredApiBaseUrl ? configuredApiBaseUrl.replace(/\/+$/, "") : "";
const TOKEN_STORAGE_KEY = "cantina-auth-token";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: BodyInit | object;
  token?: string | null;
  isFormData?: boolean;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getStoredToken() {
  return window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

export function storeToken(token: string) {
  window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearStoredToken() {
  window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}

async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers();
  if (!options.isFormData) {
    headers.set("Content-Type", "application/json");
  }
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body instanceof FormData
      ? options.body
      : options.body
        ? JSON.stringify(options.body)
        : undefined,
    credentials: "same-origin",
  });

  if (!response.ok) {
    let message = "Nao foi possivel concluir a solicitacao.";
    try {
      const data = (await response.json()) as { detail?: string };
      if (data.detail) {
        message = data.detail;
      }
    } catch {
      message = response.statusText || message;
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const authApi = {
  login: (payload: { username: string; password: string }) =>
    apiRequest<LoginResponse>("/auth/login", { method: "POST", body: payload }),
  me: (token: string) => apiRequest<AuthUser>("/auth/me", { token }),
};

export const usersApi = {
  list: (token: string) => apiRequest<AuthUser[]>("/users", { token }),
  create: (
    token: string,
    payload: { username: string; full_name: string; password: string; role: UserRole; is_active: boolean },
  ) => apiRequest<AuthUser>("/users", { method: "POST", token, body: payload }),
  update: (
    token: string,
    userId: string,
    payload: Partial<{ full_name: string; password: string; role: UserRole; is_active: boolean }>,
  ) => apiRequest<AuthUser>(`/users/${userId}`, { method: "PATCH", token, body: payload }),
  remove: (token: string, userId: string) => apiRequest<void>(`/users/${userId}`, { method: "DELETE", token }),
};

export const classesApi = {
  list: (token: string) => apiRequest<ClassItem[]>("/classes", { token }),
  create: (token: string, payload: { name: string; school_year: SchoolYear }) =>
    apiRequest<ClassItem>("/classes", { method: "POST", token, body: payload }),
  update: (token: string, classId: string, payload: { name: string; school_year: SchoolYear }) =>
    apiRequest<ClassItem>(`/classes/${classId}`, { method: "PATCH", token, body: payload }),
  remove: (token: string, classId: string) =>
    apiRequest<void>(`/classes/${classId}`, { method: "DELETE", token }),
};

export const studentsApi = {
  list: (token: string) => apiRequest<StudentItem[]>("/students", { token }),
  get: (token: string, studentId: string) => apiRequest<StudentItem>(`/students/${studentId}`, { token }),
  attendanceSummary: (token: string, studentId: string, month?: string) => {
    const suffix = month ? `?month=${encodeURIComponent(month)}` : "";
    return apiRequest<StudentAttendanceSummary>(`/students/${studentId}/attendance-summary${suffix}`, { token });
  },
  create: (token: string, payload: { full_name: string; class_id: string; cpf: string }) =>
    apiRequest<StudentItem>("/students", { method: "POST", token, body: payload }),
  update: (
    token: string,
    studentId: string,
    payload: Partial<{ full_name: string; class_id: string; cpf: string }>,
  ) => apiRequest<StudentItem>(`/students/${studentId}`, { method: "PATCH", token, body: payload }),
  remove: (token: string, studentId: string) =>
    apiRequest<void>(`/students/${studentId}`, { method: "DELETE", token }),
  enrollFace: (token: string, studentId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return apiRequest<FaceEnrollResponse>(`/students/${studentId}/face-enroll`, {
      method: "POST",
      token,
      body: formData,
      isFormData: true,
    });
  },
  getFaceAssets: (token: string, studentId: string) =>
    apiRequest<StudentFaceAssetsResponse>(`/students/${studentId}/face-assets`, { token }),
  reenrollFace: (
    token: string,
    studentId: string,
    payload: { mode: RegistrationCaptureMode; files: File[] },
  ) => {
    const formData = new FormData();
    formData.append("mode", payload.mode);
    payload.files.forEach((file) => {
      formData.append("files", file);
    });
    return apiRequest<FaceEnrollResponse>(`/students/${studentId}/face-reenroll`, {
      method: "POST",
      token,
      body: formData,
      isFormData: true,
    });
  },
};

export const recognitionApi = {
  identify: (token: string, file: File, mealType: MealType) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("meal_type", mealType);
    return apiRequest<RecognitionResult>("/recognition/identify", {
      method: "POST",
      token,
      body: formData,
      isFormData: true,
    });
  },
  identifyByCpf: (token: string, payload: { cpf: string; meal_type: MealType }) =>
    apiRequest<RecognitionResult>("/recognition/identify-by-cpf", {
      method: "POST",
      token,
      body: payload,
    }),
};

export const mealEntriesApi = {
  create: (
    token: string,
    payload: { student_id: string; meal_type: MealType; source?: string; confidence?: number | null },
  ) => apiRequest<MealEntry>("/meal-entries", { method: "POST", token, body: payload }),
  list: (
    token: string,
    filters: Partial<{ date: string; class_id: string; student_id: string; meal_type: MealType }> = {},
  ) => {
    const search = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) {
        search.set(key, value);
      }
    });
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return apiRequest<MealEntry[]>(`/meal-entries${suffix}`, { token });
  },
};

export const statsApi = {
  overview: (token: string) => apiRequest<StatsOverview>("/stats/overview", { token }),
  charts: (token: string, mealType?: MealType) => {
    const suffix = mealType ? `?meal_type=${encodeURIComponent(mealType)}` : "";
    return apiRequest<StatsCharts>(`/stats/charts${suffix}`, { token });
  },
};

export const settingsApi = {
  getRegistrationCaptureMode: (token: string) =>
    apiRequest<RegistrationCaptureModeResponse>("/settings/registration-capture-mode", { token }),
  setRegistrationCaptureMode: (token: string, mode: RegistrationCaptureMode) =>
    apiRequest<RegistrationCaptureModeResponse>("/settings/registration-capture-mode", {
      method: "PUT",
      token,
      body: { mode },
    }),
  getMealSchedule: (token: string) =>
    apiRequest<MealScheduleSettings>("/settings/meal-schedule", { token }),
  setMealSchedule: (token: string, payload: MealScheduleSettings) =>
    apiRequest<MealScheduleSettings>("/settings/meal-schedule", {
      method: "PUT",
      token,
      body: payload,
    }),
  getPermissionsEffective: (token: string) =>
    apiRequest<PermissionsEffectiveResponse>("/settings/permissions/effective", { token }),
  getPermissions: (token: string) =>
    apiRequest<PermissionsSettingsResponse>("/settings/permissions", { token }),
  setPermissions: (token: string, payload: PermissionsSettingsResponse) =>
    apiRequest<PermissionsSettingsResponse>("/settings/permissions", {
      method: "PUT",
      token,
      body: payload,
    }),
};
