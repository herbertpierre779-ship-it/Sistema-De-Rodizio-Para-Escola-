import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PermissionMap } from "../types/api";

const navigateMock = vi.fn();
const logoutMock = vi.fn();
const emitMock = vi.fn();

const allEnabledPermissions: PermissionMap = {
  operacao: true,
  cadastro_aluno: true,
  criar_turma: true,
  estatisticas: true,
  config_usuarios: true,
  config_modo_captura: true,
  config_horarios_refeicoes: true,
  config_permissoes: true,
};

const authState: {
  user: {
    id: string;
    username: string;
    full_name: string;
    role: "diretor" | "coordenadora" | "funcionario";
    is_active: boolean;
    created_at: string;
    updated_at: string;
  } | null;
  logout: () => void;
  effectivePermissions: PermissionMap;
  isLoadingPermissions: boolean;
} = {
  user: {
    id: "user-1",
    username: "diretor",
    full_name: "Diretor Teste",
    role: "diretor",
    is_active: true,
    created_at: "2026-03-01T00:00:00Z",
    updated_at: "2026-03-01T00:00:00Z",
  },
  logout: logoutMock,
  effectivePermissions: allEnabledPermissions,
  isLoadingPermissions: false,
};

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => authState,
}));

vi.mock("../hooks/useFeedback", () => ({
  useFeedback: () => ({
    emit: emitMock,
  }),
}));

vi.mock("../components/Sidebar", () => ({
  default: () => <div data-testid="sidebar-desktop-mock" />,
}));

vi.mock("../components/ConfigurationPanel", () => ({
  default: () => <div>ConfigurationPanelMock</div>,
}));

vi.mock("../components/IdentificationPanel", () => ({
  default: () => <div>IdentificationPanelMock</div>,
}));

vi.mock("../components/StatsPanel", () => ({
  default: () => <div>StatsPanelMock</div>,
}));

vi.mock("../components/StudentRegistration", () => ({
  default: () => <div>StudentRegistrationMock</div>,
}));

vi.mock("../components/TurmasPanel", () => ({
  default: () => <div>TurmasPanelMock</div>,
}));

vi.mock("../components/UserManagementPanel", () => ({
  default: () => <div>UserManagementPanelMock</div>,
}));

import Dashboard from "./Dashboard";

function setMobileViewport() {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 390,
  });
  window.dispatchEvent(new Event("resize"));
}

function setScrollY(value: number) {
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    writable: true,
    value,
  });
}

describe("Dashboard mobile drawer", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    logoutMock.mockReset();
    emitMock.mockReset();
    authState.user = {
      id: "user-1",
      username: "diretor",
      full_name: "Diretor Teste",
      role: "diretor",
      is_active: true,
      created_at: "2026-03-01T00:00:00Z",
      updated_at: "2026-03-01T00:00:00Z",
    };
    authState.effectivePermissions = {
      ...allEnabledPermissions,
    };
    authState.isLoadingPermissions = false;
    setMobileViewport();
  });

  it("remove a barra horizontal no mobile e usa drawer com permissoes", () => {
    authState.effectivePermissions = {
      ...allEnabledPermissions,
      cadastro_aluno: true,
      criar_turma: false,
      estatisticas: false,
      config_usuarios: false,
      config_modo_captura: false,
      config_horarios_refeicoes: false,
      config_permissoes: false,
    };

    const { container } = render(<Dashboard />);
    expect(container.querySelector("nav")).toBeNull();

    const mobileRoot = container.querySelector("div.lg\\:hidden") as HTMLElement | null;
    expect(mobileRoot).toBeTruthy();
    if (!mobileRoot) {
      return;
    }
    const mobileMain = mobileRoot.querySelector("main") as HTMLElement | null;
    expect(mobileMain).toBeTruthy();
    if (!mobileMain) {
      return;
    }
    fireEvent.click(within(mobileMain).getByRole("button", { name: /^menu$/i }));

    const drawer = screen.getByLabelText(/menu lateral mobile/i);
    const drawerScoped = within(drawer);
    expect(drawerScoped.getByText(/cadastro aluno/i)).toBeTruthy();
    expect(drawerScoped.queryByText(/criar turma/i)).toBeNull();
    expect(drawerScoped.queryByText(/estat/i)).toBeNull();
    expect(drawerScoped.queryByText(/configur/i)).toBeNull();
  });

  it("mostra o botao de menu do topo ao rolar para cima e abre o drawer", async () => {
    const { container } = render(<Dashboard />);
    const mobileRoot = container.querySelector("div.lg\\:hidden") as HTMLElement | null;
    expect(mobileRoot).toBeTruthy();
    if (!mobileRoot) {
      return;
    }

    const floatingMenu = screen.getByTestId("mobile-scroll-menu-trigger");
    expect(floatingMenu.className.includes("opacity-0")).toBe(true);

    setScrollY(240);
    fireEvent.scroll(window);
    setScrollY(140);
    fireEvent.scroll(window);

    await waitFor(() => {
      expect(floatingMenu.className.includes("opacity-100")).toBe(true);
    });

    fireEvent.click(floatingMenu);
    await waitFor(() => {
      const drawer = screen.getByLabelText(/menu lateral mobile/i);
      expect(drawer.className.includes("translate-x-0")).toBe(true);
    });
  });

  it("abre menu com swipe lateral da esquerda", async () => {
    const { container } = render(<Dashboard />);
    const mobileRoot = container.querySelector("div.lg\\:hidden");
    expect(mobileRoot).toBeTruthy();
    if (!mobileRoot) {
      return;
    }

    fireEvent.touchStart(mobileRoot, {
      touches: [{ clientX: 8, clientY: 120 }],
    });
    fireEvent.touchMove(mobileRoot, {
      touches: [{ clientX: 110, clientY: 122 }],
    });
    fireEvent.touchEnd(mobileRoot);

    await waitFor(() => {
      const drawer = screen.getByLabelText(/menu lateral mobile/i);
      expect(drawer.className.includes("translate-x-0")).toBe(true);
    });
  });
});
