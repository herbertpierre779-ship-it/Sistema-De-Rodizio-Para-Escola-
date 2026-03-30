export type UserRole = "diretor" | "coordenadora" | "funcionario";
export type SchoolYear = "1 ano" | "2 ano" | "3 ano";
export type MealType = "almoco" | "merenda" | "sem_rodizio";
export type RecognitionStatus =
  | "success"
  | "low_confidence"
  | "not_found"
  | "no_face_detected"
  | "multiple_faces_detected";
export type RegistrationCaptureMode = "three_photos" | "hundred_photos";
export type PermissionModule =
  | "operacao"
  | "cadastro_aluno"
  | "criar_turma"
  | "estatisticas"
  | "config_usuarios"
  | "config_modo_captura"
  | "config_horarios_refeicoes"
  | "config_permissoes";

export type AuthUser = {
  id: string;
  username: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type LoginResponse = {
  access_token: string;
  token_type: string;
  expires_at: string;
  user: AuthUser;
};

export type ClassItem = {
  id: string;
  name: string;
  school_year: SchoolYear;
  display_name: string;
  student_count: number;
  created_at: string;
  updated_at: string;
};

export type StudentItem = {
  id: string;
  full_name: string;
  class_id: string;
  class_name: string;
  class_display_name: string;
  school_year: SchoolYear;
  photo_url: string | null;
  has_face_enrolled: boolean;
  created_at: string;
  updated_at: string;
};

export type FaceEnrollResponse = {
  student: StudentItem;
  engine: string;
  enrolled_at: string;
};

export type RecognitionStudent = {
  id: string;
  full_name: string;
  class_id: string;
  class_name: string;
  class_display_name: string;
  school_year: SchoolYear;
  photo_url: string | null;
};

export type RecognitionResult = {
  status: RecognitionStatus;
  matched: boolean;
  confidence: number | null;
  threshold: number;
  message: string;
  meal_type: MealType | null;
  already_recorded_today: boolean;
  already_recorded_message: string | null;
  student: RecognitionStudent | null;
};

export type MealEntry = {
  id: string;
  student_id: string;
  student_name: string;
  class_id: string;
  class_name: string;
  class_display_name: string;
  school_year: SchoolYear;
  meal_type: MealType;
  recorded_at: string;
  recorded_by_user_id: string;
  recorded_by_name: string;
  source: string;
  confidence: number | null;
};

export type RecognitionSummary = {
  success: number;
  low_confidence: number;
  not_found: number;
};

export type StatsOverview = {
  total_students: number;
  total_classes: number;
  total_users: number;
  entries_today: number;
  entries_last_7_days: number;
  lunch_today: number;
  snack_today: number;
  no_rotation_today: number;
  recognition_summary: RecognitionSummary;
  recent_entries: MealEntry[];
};

export type ChartPoint = {
  label: string;
  value: number;
};

export type StatsCharts = {
  daily_entries: ChartPoint[];
  meal_breakdown: ChartPoint[];
  class_breakdown: ChartPoint[];
  year_breakdown: ChartPoint[];
  recognition_breakdown: ChartPoint[];
};

export type AttendanceTotals = {
  almoco: number;
  merenda: number;
  sem_rodizio: number;
};

export type AttendanceCalendarDay = {
  date: string;
  meal_types: MealType[];
};

export type StudentAttendanceSummary = {
  student: StudentItem;
  month: string;
  attendance_days: number;
  totals_by_meal: AttendanceTotals;
  calendar_days: AttendanceCalendarDay[];
  recent_entries: MealEntry[];
};

export type RegistrationCaptureModeResponse = {
  mode: RegistrationCaptureMode;
};

export type MealScheduleProfileScope = "funcionario" | "coordenadora";

export type MealScheduleWindow = {
  start: string;
  end: string;
};

export type MealScheduleMealConfig = {
  enabled: boolean;
  windows: MealScheduleWindow[];
};

export type MealScheduleSettings = {
  profiles: MealScheduleProfileScope[];
  meals: {
    almoco: MealScheduleMealConfig;
    merenda: MealScheduleMealConfig;
    sem_rodizio: MealScheduleMealConfig;
  };
};

export type PermissionMap = Record<PermissionModule, boolean>;

export type PermissionProfileSettings = {
  coordenadora: PermissionMap;
  funcionario: PermissionMap;
};

export type PermissionUserOverride = Partial<Record<PermissionModule, boolean>>;

export type PermissionsSettingsResponse = {
  profiles: PermissionProfileSettings;
  user_overrides: Record<string, PermissionUserOverride>;
};

export type PermissionsEffectiveResponse = {
  modules: PermissionMap;
};
