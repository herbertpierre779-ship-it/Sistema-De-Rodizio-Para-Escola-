import type { PermissionMap, PermissionModule, UserRole } from "../types/api";

export const PERMISSION_MODULES: PermissionModule[] = [
  "operacao",
  "cadastro_aluno",
  "criar_turma",
  "estatisticas",
  "config_usuarios",
  "config_modo_captura",
  "config_horarios_refeicoes",
  "config_permissoes",
];

export const EMPTY_PERMISSION_MAP: PermissionMap = {
  operacao: false,
  cadastro_aluno: false,
  criar_turma: false,
  estatisticas: false,
  config_usuarios: false,
  config_modo_captura: false,
  config_horarios_refeicoes: false,
  config_permissoes: false,
};

export const FULL_PERMISSION_MAP: PermissionMap = {
  operacao: true,
  cadastro_aluno: true,
  criar_turma: true,
  estatisticas: true,
  config_usuarios: true,
  config_modo_captura: true,
  config_horarios_refeicoes: true,
  config_permissoes: true,
};

export function getDefaultPermissionsForRole(role: UserRole): PermissionMap {
  if (role === "diretor") {
    return { ...FULL_PERMISSION_MAP };
  }
  if (role === "coordenadora") {
    return {
      ...EMPTY_PERMISSION_MAP,
      operacao: true,
      cadastro_aluno: true,
      criar_turma: true,
      estatisticas: true,
      config_horarios_refeicoes: true,
    };
  }
  return {
    ...EMPTY_PERMISSION_MAP,
    operacao: true,
    cadastro_aluno: true,
  };
}

export function hasAnyConfigurationAccess(permissions: PermissionMap | null): boolean {
  if (!permissions) {
    return false;
  }
  return Boolean(
    permissions.config_usuarios ||
      permissions.config_modo_captura ||
      permissions.config_horarios_refeicoes ||
      permissions.config_permissoes,
  );
}

export function mergePermissionMap(input: Partial<PermissionMap> | null | undefined): PermissionMap {
  return {
    ...EMPTY_PERMISSION_MAP,
    ...(input ?? {}),
  };
}
