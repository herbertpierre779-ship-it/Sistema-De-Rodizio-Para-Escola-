import type { MealType, PermissionMap, RecognitionStatus, SchoolYear, UserRole } from "../types/api";

export const SCHOOL_YEARS: SchoolYear[] = ["1 ano", "2 ano", "3 ano"];

export function getMealTypeLabel(mealType: MealType) {
  switch (mealType) {
    case "almoco":
      return "Almoço";
    case "merenda":
      return "Merenda";
    case "sem_rodizio":
      return "Sem rodízio";
  }
}

export function getRecognitionLabel(status: RecognitionStatus) {
  switch (status) {
    case "success":
      return "Sucesso";
    case "low_confidence":
      return "Baixa confiança";
    case "no_face_detected":
      return "Nenhum rosto";
    case "multiple_faces_detected":
      return "Muitos rostos";
    case "not_found":
      return "Não encontrado";
  }
}

export function getRecognitionTone(status: RecognitionStatus | null) {
  if (status === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "low_confidence") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function formatConfidence(confidence: number | null | undefined) {
  if (confidence === null || confidence === undefined) {
    return "--";
  }
  return `${(confidence * 100).toFixed(1)}%`;
}

export function getRoleLabel(role: UserRole) {
  switch (role) {
    case "diretor":
      return "Diretor";
    case "coordenadora":
      return "Coordenadora";
    case "funcionario":
      return "Funcionário";
  }
}

export function dashboardMenuItems(role: UserRole, permissions?: PermissionMap | null) {
  const canAccess = (module: keyof PermissionMap, fallback: boolean) =>
    permissions ? Boolean(permissions[module]) : fallback;

  const canAccessConfiguration = permissions
    ? permissions.config_usuarios ||
      permissions.config_modo_captura ||
      permissions.config_horarios_refeicoes ||
      permissions.config_permissoes
    : role !== "funcionario";

  const items: Array<{ id: string; label: string }> = [{ id: "inicio", label: "Início" }];

  if (canAccess("operacao", true)) {
    items.push({ id: "identificacao", label: "Operação" });
  }

  if (canAccess("cadastro_aluno", true)) {
    items.push({ id: "cadastro", label: "Cadastro aluno" });
  }

  if (canAccess("criar_turma", role !== "funcionario")) {
    items.push({ id: "turmas", label: "Criar turma" });
  }

  if (canAccess("estatisticas", role !== "funcionario")) {
    items.push({ id: "estatisticas", label: "Estatísticas" });
  }

  if (canAccessConfiguration) {
    items.push({ id: "configuracao", label: "Configuração" });
  }

  return items;
}
