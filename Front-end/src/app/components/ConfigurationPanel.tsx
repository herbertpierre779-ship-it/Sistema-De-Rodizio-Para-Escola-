import { ArrowLeft, Clock3, Plus, Settings, Shield, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { ApiError, settingsApi, usersApi } from "../lib/api";
import { DEFAULT_MEAL_SCHEDULE } from "../lib/mealSchedule";
import type {
  AuthUser,
  MealType,
  PermissionMap,
  PermissionModule,
  PermissionsSettingsResponse,
  RegistrationCaptureMode,
  UserRole,
  MealScheduleSettings,
} from "../types/api";

type ConfigurationPanelProps = {
  role: UserRole;
  permissions: PermissionMap | null;
  onOpenUsers: () => void;
};

type ScheduleView = "root" | "meal_schedule" | "permissions";
type PermissionProfile = "coordenadora" | "funcionario";

const MEAL_SECTIONS: Array<{ mealType: MealType; title: string }> = [
  { mealType: "almoco", title: "Almoço" },
  { mealType: "merenda", title: "Merenda" },
  { mealType: "sem_rodizio", title: "Sem rodízio" },
];

const FIXED_MEAL_PROFILES = ["funcionario", "coordenadora"] as const;

const PERMISSION_MODULE_ORDER: PermissionModule[] = [
  "operacao",
  "cadastro_aluno",
  "criar_turma",
  "estatisticas",
  "config_usuarios",
  "config_modo_captura",
  "config_horarios_refeicoes",
  "config_permissoes",
];

const PERMISSION_MODULE_LABELS: Record<PermissionModule, string> = {
  operacao: "Operação",
  cadastro_aluno: "Cadastro aluno",
  criar_turma: "Criar turma",
  estatisticas: "Estatísticas",
  config_usuarios: "Configuração: usuários",
  config_modo_captura: "Configuração: modo de captura",
  config_horarios_refeicoes: "Configuração: horários das refeições",
  config_permissoes: "Configuração: permissões",
};

export default function ConfigurationPanel({ role, permissions, onOpenUsers }: ConfigurationPanelProps) {
  const { token } = useAuth();
  const canOpenUsers = Boolean(permissions?.config_usuarios);
  const canEditCaptureMode = Boolean(permissions?.config_modo_captura);
  const canAccessMealSchedule = Boolean(permissions?.config_horarios_refeicoes);
  const canEditMealSchedule = canAccessMealSchedule;
  const canManagePermissions = role === "diretor" && Boolean(permissions?.config_permissoes);

  const [view, setView] = useState<ScheduleView>("root");
  const [captureMode, setCaptureMode] = useState<RegistrationCaptureMode>("hundred_photos");
  const [mealSchedule, setMealSchedule] = useState<MealScheduleSettings>(DEFAULT_MEAL_SCHEDULE);
  const [isLoadingMode, setIsLoadingMode] = useState(true);
  const [isLoadingSchedule, setIsLoadingSchedule] = useState(true);
  const [isSavingMode, setIsSavingMode] = useState(false);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [scheduleErrorMessage, setScheduleErrorMessage] = useState("");

  const [permissionsSettings, setPermissionsSettings] = useState<PermissionsSettingsResponse | null>(null);
  const [permissionsUsers, setPermissionsUsers] = useState<AuthUser[]>([]);
  const [selectedUserOverrideId, setSelectedUserOverrideId] = useState("");
  const [isLoadingPermissionsSettings, setIsLoadingPermissionsSettings] = useState(false);
  const [isSavingPermissionsSettings, setIsSavingPermissionsSettings] = useState(false);
  const [permissionsErrorMessage, setPermissionsErrorMessage] = useState("");

  useEffect(() => {
    if (!token) {
      return;
    }
    let mounted = true;
    setIsLoadingMode(true);
    setIsLoadingSchedule(true);
    Promise.all([settingsApi.getRegistrationCaptureMode(token), settingsApi.getMealSchedule(token)])
      .then(([captureResponse, scheduleResponse]) => {
        if (!mounted) return;
        setCaptureMode(captureResponse.mode);
        setMealSchedule(scheduleResponse);
      })
      .catch((error) => {
        if (!mounted) return;
        const message = error instanceof ApiError ? error.message : "Não foi possível carregar as configurações.";
        setErrorMessage(message);
        setScheduleErrorMessage(message);
      })
      .finally(() => {
        if (!mounted) return;
        setIsLoadingMode(false);
        setIsLoadingSchedule(false);
      });
    return () => {
      mounted = false;
    };
  }, [token]);

  const loadPermissionsSettings = async () => {
    if (!token || !canManagePermissions) {
      return;
    }
    setPermissionsErrorMessage("");
    setIsLoadingPermissionsSettings(true);
    try {
      const [settingsResponse, usersResponse] = await Promise.all([
        settingsApi.getPermissions(token),
        usersApi.list(token),
      ]);
      const nonDirectorUsers = usersResponse.filter((userItem) => userItem.role !== "diretor");
      setPermissionsUsers(nonDirectorUsers);
      setPermissionsSettings(settingsResponse);
      setSelectedUserOverrideId((current) => {
        if (current && nonDirectorUsers.some((userItem) => userItem.id === current)) {
          return current;
        }
        return nonDirectorUsers[0]?.id ?? "";
      });
    } catch (error) {
      setPermissionsErrorMessage(
        error instanceof ApiError ? error.message : "Não foi possível carregar as permissões.",
      );
    } finally {
      setIsLoadingPermissionsSettings(false);
    }
  };

  const selectedOverrideUser = useMemo(
    () => permissionsUsers.find((userItem) => userItem.id === selectedUserOverrideId) ?? null,
    [permissionsUsers, selectedUserOverrideId],
  );

  const selectedUserProfile: PermissionProfile | null = useMemo(() => {
    if (!selectedOverrideUser) {
      return null;
    }
    if (selectedOverrideUser.role === "coordenadora") {
      return "coordenadora";
    }
    if (selectedOverrideUser.role === "funcionario") {
      return "funcionario";
    }
    return null;
  }, [selectedOverrideUser]);

  const selectedUserOverrides = useMemo(() => {
    if (!permissionsSettings || !selectedUserOverrideId) {
      return {};
    }
    return permissionsSettings.user_overrides[selectedUserOverrideId] ?? {};
  }, [permissionsSettings, selectedUserOverrideId]);

  const handleModeChange = async (nextMode: RegistrationCaptureMode) => {
    if (!token || !canEditCaptureMode || isSavingMode) {
      return;
    }
    setErrorMessage("");
    setIsSavingMode(true);
    try {
      const response = await settingsApi.setRegistrationCaptureMode(token, nextMode);
      setCaptureMode(response.mode);
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : "Não foi possível salvar a configuração.");
    } finally {
      setIsSavingMode(false);
    }
  };

  const handleMealEnabledChange = (mealType: MealType, enabled: boolean) => {
    if (!canEditMealSchedule) return;
    setMealSchedule((current) => ({
      ...current,
      profiles: [...FIXED_MEAL_PROFILES],
      meals: {
        ...current.meals,
        [mealType]: {
          ...current.meals[mealType],
          enabled,
        },
      },
    }));
  };

  const handleWindowChange = (
    mealType: MealType,
    index: number,
    field: "start" | "end",
    value: string,
  ) => {
    if (!canEditMealSchedule) return;
    setMealSchedule((current) => {
      const windows = [...current.meals[mealType].windows];
      const currentWindow = windows[index];
      if (!currentWindow) return current;
      windows[index] = { ...currentWindow, [field]: value };
      return {
        ...current,
        profiles: [...FIXED_MEAL_PROFILES],
        meals: {
          ...current.meals,
          [mealType]: {
            ...current.meals[mealType],
            windows,
          },
        },
      };
    });
  };

  const handleAddWindow = (mealType: MealType) => {
    if (!canEditMealSchedule) return;
    setMealSchedule((current) => ({
      ...current,
      profiles: [...FIXED_MEAL_PROFILES],
      meals: {
        ...current.meals,
        [mealType]: {
          ...current.meals[mealType],
          windows: [...current.meals[mealType].windows, { start: "12:00", end: "12:30" }],
        },
      },
    }));
  };

  const handleRemoveWindow = (mealType: MealType, index: number) => {
    if (!canEditMealSchedule) return;
    setMealSchedule((current) => ({
      ...current,
      profiles: [...FIXED_MEAL_PROFILES],
      meals: {
        ...current.meals,
        [mealType]: {
          ...current.meals[mealType],
          windows: current.meals[mealType].windows.filter((_, windowIndex) => windowIndex !== index),
        },
      },
    }));
  };

  const handleSaveMealSchedule = async () => {
    if (!token || !canEditMealSchedule || isSavingSchedule) {
      return;
    }
    setScheduleErrorMessage("");
    setIsSavingSchedule(true);
    try {
      const response = await settingsApi.setMealSchedule(token, {
        ...mealSchedule,
        profiles: [...FIXED_MEAL_PROFILES],
      });
      setMealSchedule(response);
    } catch (error) {
      setScheduleErrorMessage(error instanceof ApiError ? error.message : "Não foi possível salvar os horários.");
    } finally {
      setIsSavingSchedule(false);
    }
  };

  const handleProfilePermissionToggle = (
    profile: PermissionProfile,
    moduleName: PermissionModule,
    nextValue: boolean,
  ) => {
    setPermissionsSettings((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        profiles: {
          ...current.profiles,
          [profile]: {
            ...current.profiles[profile],
            [moduleName]: nextValue,
          },
        },
      };
    });
  };

  const handleUserOverrideToggle = (moduleName: PermissionModule, nextValue: boolean) => {
    if (!selectedUserOverrideId || !selectedUserProfile) {
      return;
    }
    setPermissionsSettings((current) => {
      if (!current) {
        return current;
      }
      const profileValue = Boolean(current.profiles[selectedUserProfile][moduleName]);
      const currentOverride = current.user_overrides[selectedUserOverrideId] ?? {};
      const nextOverride: Partial<Record<PermissionModule, boolean>> = { ...currentOverride };

      if (nextValue === profileValue) {
        delete nextOverride[moduleName];
      } else {
        nextOverride[moduleName] = nextValue;
      }

      const hasAnyOverride = PERMISSION_MODULE_ORDER.some(
        (permissionModule) => typeof nextOverride[permissionModule] === "boolean",
      );
      const nextUserOverrides = { ...current.user_overrides };
      if (hasAnyOverride) {
        nextUserOverrides[selectedUserOverrideId] = nextOverride;
      } else {
        delete nextUserOverrides[selectedUserOverrideId];
      }

      return {
        ...current,
        user_overrides: nextUserOverrides,
      };
    });
  };

  const handleClearSelectedOverride = () => {
    if (!selectedUserOverrideId) {
      return;
    }
    setPermissionsSettings((current) => {
      if (!current) {
        return current;
      }
      const nextOverrides = { ...current.user_overrides };
      delete nextOverrides[selectedUserOverrideId];
      return {
        ...current,
        user_overrides: nextOverrides,
      };
    });
  };

  const handleApplyProfileToSelectedOverride = () => {
    if (!selectedUserOverrideId || !selectedUserProfile) {
      return;
    }
    setPermissionsSettings((current) => {
      if (!current) {
        return current;
      }
      const nextOverrides = { ...current.user_overrides };
      delete nextOverrides[selectedUserOverrideId];
      return {
        ...current,
        user_overrides: nextOverrides,
      };
    });
  };

  const handleSavePermissionsSettings = async () => {
    if (!token || !permissionsSettings || !canManagePermissions || isSavingPermissionsSettings) {
      return;
    }
    setPermissionsErrorMessage("");
    setIsSavingPermissionsSettings(true);
    try {
      const response = await settingsApi.setPermissions(token, permissionsSettings);
      setPermissionsSettings(response);
    } catch (error) {
      setPermissionsErrorMessage(
        error instanceof ApiError ? error.message : "Não foi possível salvar as permissões.",
      );
    } finally {
      setIsSavingPermissionsSettings(false);
    }
  };

  if (view === "meal_schedule") {
    if (!canAccessMealSchedule) {
      return (
        <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200 sm:rounded-[2rem] sm:p-6">
          <p className="text-sm font-semibold text-slate-600">
            Você não possui permissão para acessar esta configuração.
          </p>
        </section>
      );
    }

    return (
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200 sm:rounded-[2rem] sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => setView("root")}
            className="inline-flex min-h-11 items-center gap-2 self-start rounded-xl border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </button>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 sm:text-sm">Horários das refeições</p>
        </div>

        <div className="mt-4 space-y-4">
          {MEAL_SECTIONS.map((section) => {
            const config = mealSchedule.meals[section.mealType];
            return (
              <article key={section.mealType} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-lg font-black text-slate-900">{section.title}</h3>
                  <label className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={config.enabled}
                      onChange={(event) => handleMealEnabledChange(section.mealType, event.target.checked)}
                      disabled={!canEditMealSchedule}
                      className="h-5 w-5 rounded border-slate-300 accent-orange-500"
                    />
                    Habilitar controle por horário
                  </label>
                </div>

                <div className="mt-3 space-y-2">
                  {config.windows.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-3 text-sm text-slate-500">
                      Nenhum horário configurado.
                    </p>
                  ) : (
                    config.windows.map((windowItem, index) => (
                      <div key={`${section.mealType}-${index}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                        <input
                          type="time"
                          value={windowItem.start}
                          onChange={(event) =>
                            handleWindowChange(section.mealType, index, "start", event.target.value)
                          }
                          disabled={!canEditMealSchedule}
                          className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                        />
                        <input
                          type="time"
                          value={windowItem.end}
                          onChange={(event) =>
                            handleWindowChange(section.mealType, index, "end", event.target.value)
                          }
                          disabled={!canEditMealSchedule}
                          className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveWindow(section.mealType, index)}
                          disabled={!canEditMealSchedule}
                          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-600 disabled:opacity-60"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => handleAddWindow(section.mealType)}
                  disabled={!canEditMealSchedule}
                  className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60 sm:w-auto"
                >
                  <Plus className="h-4 w-4" />
                  Adicionar faixa
                </button>
              </article>
            );
          })}
        </div>

        {scheduleErrorMessage ? (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {scheduleErrorMessage}
          </div>
        ) : null}
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => void handleSaveMealSchedule()}
            disabled={!canEditMealSchedule || isSavingSchedule || isLoadingSchedule}
            className="w-full rounded-xl bg-orange-500 px-5 py-3 text-sm font-semibold text-white disabled:bg-slate-300 sm:w-auto"
          >
            {isSavingSchedule ? "Salvando..." : "Salvar horários"}
          </button>
        </div>
      </section>
    );
  }

  if (view === "permissions") {
    if (!canManagePermissions) {
      return (
        <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200 sm:rounded-[2rem] sm:p-6">
          <p className="text-sm font-semibold text-slate-600">
            Você não possui permissão para acessar esta configuração.
          </p>
        </section>
      );
    }

    return (
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200 sm:rounded-[2rem] sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => setView("root")}
            className="inline-flex min-h-11 items-center gap-2 self-start rounded-xl border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </button>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 sm:text-sm">Configuração de permissões</p>
        </div>

        {permissionsErrorMessage ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {permissionsErrorMessage}
          </div>
        ) : null}

        {isLoadingPermissionsSettings || !permissionsSettings ? (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
            Carregando configuração de permissões...
          </div>
        ) : (
          <div className="mt-5 space-y-4 sm:space-y-5">
            <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
              <h3 className="text-lg font-black text-slate-900 sm:text-xl">Permissões por perfil</h3>

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                {(["coordenadora", "funcionario"] as PermissionProfile[]).map((profile) => (
                  <div key={profile} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-black text-slate-900">
                        {profile === "coordenadora" ? "Coordenadora" : "Funcionário"}
                      </p>
                    </div>
                    <div className="mt-3 space-y-2.5">
                      {PERMISSION_MODULE_ORDER.map((moduleName) => (
                        <label
                          key={`${profile}-${moduleName}`}
                          className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700"
                        >
                          <span className="pr-2">{PERMISSION_MODULE_LABELS[moduleName]}</span>
                          <PermissionSwitch
                            checked={Boolean(permissionsSettings.profiles[profile][moduleName])}
                            onChange={(nextValue) => handleProfilePermissionToggle(profile, moduleName, nextValue)}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
              <h3 className="text-lg font-black text-slate-900 sm:text-xl">Exceção por usuário</h3>
              <p className="mt-1 text-sm text-slate-600">
                A exceção sobrescreve o perfil para o usuário selecionado.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto_auto]">
                <select
                  value={selectedUserOverrideId}
                  onChange={(event) => setSelectedUserOverrideId(event.target.value)}
                  className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  {permissionsUsers.length === 0 ? (
                    <option value="">Nenhum usuário disponível</option>
                  ) : (
                    permissionsUsers.map((userItem) => (
                      <option key={userItem.id} value={userItem.id}>
                        {userItem.full_name} ({userItem.role})
                      </option>
                    ))
                  )}
                </select>
                <button
                  type="button"
                  onClick={handleApplyProfileToSelectedOverride}
                  disabled={!selectedUserOverrideId || !selectedUserProfile}
                  className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
                >
                  Puxar do perfil
                </button>
                <button
                  type="button"
                  onClick={handleClearSelectedOverride}
                  disabled={!selectedUserOverrideId}
                  className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
                >
                  Limpar exceção
                </button>
              </div>

              {selectedUserOverrideId && selectedUserProfile ? (
                <div className="mt-3 space-y-2.5">
                  {PERMISSION_MODULE_ORDER.map((moduleName) => {
                    const overrideValue = selectedUserOverrides[moduleName];
                    const effectiveValue =
                      typeof overrideValue === "boolean"
                        ? overrideValue
                        : Boolean(permissionsSettings.profiles[selectedUserProfile][moduleName]);

                    return (
                      <label
                        key={`override-${selectedUserOverrideId}-${moduleName}`}
                        className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700"
                      >
                        <span className="pr-2">{PERMISSION_MODULE_LABELS[moduleName]}</span>
                        <PermissionSwitch
                          checked={effectiveValue}
                          onChange={(nextValue) => handleUserOverrideToggle(moduleName, nextValue)}
                        />
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-3 text-sm text-slate-500">
                  Selecione um usuário não-diretor para configurar exceções.
                </p>
              )}
            </article>
          </div>
        )}

        <div className="sticky bottom-0 z-10 -mx-4 mt-5 border-t border-slate-200 bg-white/95 px-4 pt-4 pb-1 backdrop-blur sm:static sm:m-0 sm:border-0 sm:bg-transparent sm:p-0 sm:pt-5">
          <button
            type="button"
            onClick={() => void handleSavePermissionsSettings()}
            disabled={!permissionsSettings || isSavingPermissionsSettings}
            className="w-full rounded-xl bg-orange-500 px-5 py-3 text-sm font-semibold text-white disabled:bg-slate-300 sm:ml-auto sm:w-auto"
          >
            {isSavingPermissionsSettings ? "Salvando..." : "Salvar permissões"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200 sm:rounded-[2rem] sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500 sm:text-sm">Configuração</p>
      <div className="mt-4 grid gap-3 sm:gap-4 lg:grid-cols-2">
        {canOpenUsers ? (
          <article className="h-full rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-600">Primeira configuração</p>
                <h3 className="mt-2 text-xl font-black text-slate-900">Gestão de usuários</h3>
                <p className="mt-2 text-sm text-slate-600">Abra para criar, editar, ativar e remover acessos.</p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
                <Shield className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onOpenUsers}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600 sm:w-auto"
              >
                <Settings className="h-4 w-4" />
                Abrir usuários
              </button>
            </div>
          </article>
        ) : null}

        {canEditCaptureMode ? (
          <article className="h-full rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-600">Cadastro facial</p>
            <h3 className="mt-2 text-xl font-black text-slate-900">Modo de captura no cadastro</h3>
            <p className="mt-2 text-sm text-slate-600">Defina o modo global usado para capturar fotos no cadastro de aluno.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void handleModeChange("three_photos")}
                disabled={isLoadingMode || isSavingMode || !canEditCaptureMode}
                className={`min-h-24 rounded-2xl border px-4 py-3 text-left transition ${
                  captureMode === "three_photos"
                    ? "border-orange-300 bg-orange-50"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <p className="text-sm font-black text-slate-900">3 fotos</p>
                <p className="mt-1 text-xs text-slate-600">Fluxo rápido por poses.</p>
              </button>
              <button
                type="button"
                onClick={() => void handleModeChange("hundred_photos")}
                disabled={isLoadingMode || isSavingMode || !canEditCaptureMode}
                className={`min-h-24 rounded-2xl border px-4 py-3 text-left transition ${
                  captureMode === "hundred_photos"
                    ? "border-orange-300 bg-orange-50"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <p className="text-sm font-black text-slate-900">100 fotos</p>
                <p className="mt-1 text-xs text-slate-600">4 ciclos de 25 capturas.</p>
              </button>
            </div>
            {errorMessage ? (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {errorMessage}
              </div>
            ) : null}
          </article>
        ) : null}

        {canAccessMealSchedule ? (
          <article className="h-full rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-600">Operação</p>
                <h3 className="mt-2 text-xl font-black text-slate-900">Horários das refeições</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Defina as faixas de horário de almoço, merenda e sem rodízio.
                </p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
                <Clock3 className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setView("meal_schedule")}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 sm:w-auto"
              >
                <Clock3 className="h-4 w-4" />
                Abrir configuração
              </button>
            </div>
          </article>
        ) : null}

        {canManagePermissions ? (
          <article className="h-full rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-600">Segurança</p>
                <h3 className="mt-2 text-xl font-black text-slate-900">Configuração de permissões</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Ajuste módulos por perfil e defina exceções por usuário.
                </p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
                <Shield className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-4">
              <button
                type="button"
                onClick={() => {
                  setView("permissions");
                  void loadPermissionsSettings();
                }}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 sm:w-auto"
              >
                <Shield className="h-4 w-4" />
                Abrir configuração
              </button>
            </div>
          </article>
        ) : null}

        {!canOpenUsers && !canEditCaptureMode && !canAccessMealSchedule && !canManagePermissions ? (
          <article className="h-full rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
            <h3 className="text-lg font-black text-slate-900">Sem configurações disponíveis</h3>
            <p className="mt-2 text-sm text-slate-600">
              Seu perfil não possui acesso aos módulos de configuração.
            </p>
          </article>
        ) : null}
      </div>
    </section>
  );
}

function PermissionSwitch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (nextValue: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`inline-flex min-h-9 min-w-[112px] items-center justify-center rounded-full border px-3 py-1.5 text-xs font-bold transition ${
        checked
          ? "border-emerald-300 bg-emerald-100 text-emerald-800"
          : "border-rose-200 bg-rose-50 text-rose-700"
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {checked ? "Permitido" : "Bloqueado"}
    </button>
  );
}
