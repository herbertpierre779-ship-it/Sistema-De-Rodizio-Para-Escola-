import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PermissionMap, UserRole } from "../types/api";

const getRegistrationCaptureModeMock = vi.fn();
const setRegistrationCaptureModeMock = vi.fn();
const getMealScheduleMock = vi.fn();
const setMealScheduleMock = vi.fn();
const getPermissionsMock = vi.fn();
const setPermissionsMock = vi.fn();
const getEmbeddingsRebuildStatusMock = vi.fn();
const startEmbeddingsRebuildMock = vi.fn();
const listUsersMock = vi.fn();

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    token: "test-token",
  }),
}));

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  settingsApi: {
    getRegistrationCaptureMode: (...args: unknown[]) => getRegistrationCaptureModeMock(...args),
    setRegistrationCaptureMode: (...args: unknown[]) => setRegistrationCaptureModeMock(...args),
    getMealSchedule: (...args: unknown[]) => getMealScheduleMock(...args),
    setMealSchedule: (...args: unknown[]) => setMealScheduleMock(...args),
    getPermissions: (...args: unknown[]) => getPermissionsMock(...args),
    setPermissions: (...args: unknown[]) => setPermissionsMock(...args),
    getEmbeddingsRebuildStatus: (...args: unknown[]) => getEmbeddingsRebuildStatusMock(...args),
    startEmbeddingsRebuild: (...args: unknown[]) => startEmbeddingsRebuildMock(...args),
  },
  usersApi: {
    list: (...args: unknown[]) => listUsersMock(...args),
  },
}));

import ConfigurationPanel from "./ConfigurationPanel";

const basePermissions: PermissionMap = {
  operacao: true,
  cadastro_aluno: true,
  criar_turma: true,
  estatisticas: true,
  config_usuarios: false,
  config_modo_captura: false,
  config_horarios_refeicoes: false,
  config_permissoes: false,
};

function renderPanel(role: UserRole, permissions: PermissionMap) {
  return render(<ConfigurationPanel role={role} permissions={permissions} onOpenUsers={vi.fn()} />);
}

describe("ConfigurationPanel role visibility", () => {
  beforeEach(() => {
    getRegistrationCaptureModeMock.mockReset();
    setRegistrationCaptureModeMock.mockReset();
    getMealScheduleMock.mockReset();
    setMealScheduleMock.mockReset();
    getPermissionsMock.mockReset();
    setPermissionsMock.mockReset();
    getEmbeddingsRebuildStatusMock.mockReset();
    startEmbeddingsRebuildMock.mockReset();
    listUsersMock.mockReset();

    getRegistrationCaptureModeMock.mockResolvedValue({ mode: "hundred_photos" });
    getMealScheduleMock.mockResolvedValue({
      profiles: ["funcionario", "coordenadora"],
      meals: {
        almoco: { enabled: true, windows: [{ start: "12:20", end: "14:20" }] },
        merenda: { enabled: true, windows: [{ start: "10:00", end: "10:20" }] },
        sem_rodizio: { enabled: false, windows: [] },
      },
    });
    setMealScheduleMock.mockResolvedValue({
      profiles: ["funcionario", "coordenadora"],
      meals: {
        almoco: { enabled: true, windows: [{ start: "12:20", end: "14:20" }] },
        merenda: { enabled: true, windows: [{ start: "10:00", end: "10:20" }] },
        sem_rodizio: { enabled: false, windows: [] },
      },
    });
    getPermissionsMock.mockResolvedValue({
      profiles: {
        coordenadora: {
          ...basePermissions,
          criar_turma: true,
          estatisticas: true,
          config_horarios_refeicoes: true,
        },
        funcionario: {
          ...basePermissions,
          criar_turma: false,
          estatisticas: false,
        },
      },
      user_overrides: {},
    });
    listUsersMock.mockResolvedValue([
      {
        id: "2",
        username: "coord",
        full_name: "Coord",
        role: "coordenadora",
        is_active: true,
        created_at: "2026-03-01T00:00:00Z",
        updated_at: "2026-03-01T00:00:00Z",
      },
    ]);
    setPermissionsMock.mockResolvedValue({
      profiles: {
        coordenadora: {
          ...basePermissions,
          criar_turma: true,
          estatisticas: true,
          config_horarios_refeicoes: true,
        },
        funcionario: {
          ...basePermissions,
          criar_turma: false,
          estatisticas: false,
        },
      },
      user_overrides: {},
    });
    getEmbeddingsRebuildStatusMock.mockResolvedValue({
      running: false,
      total_students: 0,
      processed_students: 0,
      total_samples: 0,
      processed_samples: 0,
      failed_students: 0,
      started_at: null,
      finished_at: null,
      last_error: null,
    });
    startEmbeddingsRebuildMock.mockResolvedValue({
      running: true,
      total_students: 10,
      processed_students: 0,
      total_samples: 500,
      processed_samples: 0,
      failed_students: 0,
      started_at: "2026-03-31T12:00:00+00:00",
      finished_at: null,
      last_error: null,
    });
  });

  it("diretor ve todos os cards de configuracao", async () => {
    renderPanel("diretor", {
      ...basePermissions,
      config_usuarios: true,
      config_modo_captura: true,
      config_horarios_refeicoes: true,
      config_permissoes: true,
    });

    await waitFor(() => {
      expect(screen.getByText(/gest[aã]o de usu[áa]rios/i)).toBeTruthy();
    });
    expect(screen.getByText(/modo de captura no cadastro/i)).toBeTruthy();
    expect(screen.getByText(/hor[aá]rios das refei[çc][õo]es/i)).toBeTruthy();
    expect(screen.getByText(/configura[çc][ãa]o de permiss[õo]es/i)).toBeTruthy();
  });

  it("coordenadora ve apenas horarios e sem texto fixo antigo", async () => {
    renderPanel("coordenadora", {
      ...basePermissions,
      config_horarios_refeicoes: true,
    });

    await waitFor(() => {
      expect(screen.getByText(/hor[aá]rios das refei[çc][õo]es/i)).toBeTruthy();
    });
    expect(screen.queryByText(/gest[aã]o de usu[áa]rios/i)).toBeNull();
    expect(screen.queryByText(/modo de captura no cadastro/i)).toBeNull();
    expect(screen.queryByText(/configura[çc][ãa]o de permiss[õo]es/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /abrir configura[çc][ãa]o/i }));
    await waitFor(() => {
      expect(screen.getAllByText(/habilitar controle por hor[aá]rio/i).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/regra aplicada para funcion[aá]rio e coordenadora/i)).toBeNull();
  });

  it("funcionario nao ve cards de configuracao restritos", async () => {
    renderPanel("funcionario", {
      ...basePermissions,
      config_usuarios: false,
      config_modo_captura: false,
      config_horarios_refeicoes: false,
      config_permissoes: false,
    });

    await waitFor(() => {
      expect(screen.getByText(/sem configura[çc][õo]es dispon[íi]veis/i)).toBeTruthy();
    });
    expect(screen.queryByText(/gest[aã]o de usu[áa]rios/i)).toBeNull();
    expect(screen.queryByText(/hor[aá]rios das refei[çc][õo]es/i)).toBeNull();
    expect(screen.queryByText(/modo de captura no cadastro/i)).toBeNull();
  });

  it("nao cria override automaticamente ao apenas abrir excecao por usuario", async () => {
    renderPanel("diretor", {
      ...basePermissions,
      config_permissoes: true,
    });

    await waitFor(() => {
      expect(screen.getByText(/configura.*de permis/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /abrir configura/i }));

    await waitFor(() => {
      expect(screen.getByText(/exce.*por usu/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /salvar permis/i }));

    await waitFor(() => {
      expect(setPermissionsMock).toHaveBeenCalledTimes(1);
    });

    const payload = setPermissionsMock.mock.calls[0]?.[1];
    expect(payload?.user_overrides).toEqual({});
  });
});
