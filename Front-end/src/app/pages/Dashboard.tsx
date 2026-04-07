import { useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Database,
  Home,
  LogOut,
  Menu,
  ScanFace,
  SlidersHorizontal,
  UserPlus2,
  UtensilsCrossed,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import ConfigurationPanel from "../components/ConfigurationPanel";
import IdentificationPanel from "../components/IdentificationPanel";
import Sidebar from "../components/Sidebar";
import StatsPanel from "../components/StatsPanel";
import StudentRegistration from "../components/StudentRegistration";
import TurmasPanel from "../components/TurmasPanel";
import UserManagementPanel from "../components/UserManagementPanel";
import { useAuth } from "../hooks/useAuth";
import { useFeedback } from "../hooks/useFeedback";
import { dashboardMenuItems, getRoleLabel } from "../lib/constants";
import { EMPTY_PERMISSION_MAP, hasAnyConfigurationAccess } from "../lib/permissions";
import type { PermissionMap, UserRole } from "../types/api";

type MenuItemId = "inicio" | "identificacao" | "cadastro" | "turmas" | "estatisticas" | "configuracao";
type ConfigurationView = "root" | "usuarios";

const iconById: Record<MenuItemId, LucideIcon> = {
  inicio: Home,
  identificacao: ScanFace,
  cadastro: UserPlus2,
  turmas: Database,
  estatisticas: BarChart3,
  configuracao: SlidersHorizontal,
};

type QuickAction = {
  id: MenuItemId;
  title: string;
  description: string;
};

type QuickActionTheme = {
  cardClass: string;
  iconClass: string;
  descriptionClass: string;
};

const quickActionThemes: Partial<Record<MenuItemId, QuickActionTheme>> = {
  identificacao: {
    cardClass: "border-orange-200 bg-gradient-to-br from-orange-500 to-amber-300 text-slate-950",
    iconClass: "bg-white/25 text-slate-900",
    descriptionClass: "text-slate-900/80",
  },
  cadastro: {
    cardClass: "border-emerald-200 bg-gradient-to-br from-emerald-500 to-lime-300 text-slate-950",
    iconClass: "bg-white/25 text-slate-900",
    descriptionClass: "text-slate-900/80",
  },
  turmas: {
    cardClass: "border-cyan-200 bg-gradient-to-br from-sky-500 to-cyan-300 text-slate-950",
    iconClass: "bg-white/25 text-slate-900",
    descriptionClass: "text-slate-900/80",
  },
  estatisticas: {
    cardClass: "border-violet-200 bg-gradient-to-br from-violet-500 to-fuchsia-400 text-white",
    iconClass: "bg-white/20 text-white",
    descriptionClass: "text-white/90",
  },
  configuracao: {
    cardClass: "border-slate-300 bg-gradient-to-br from-slate-700 to-slate-500 text-white",
    iconClass: "bg-white/20 text-white",
    descriptionClass: "text-white/90",
  },
};

const moduleByMenuItem: Partial<Record<MenuItemId, keyof PermissionMap>> = {
  identificacao: "operacao",
  cadastro: "cadastro_aluno",
  turmas: "criar_turma",
  estatisticas: "estatisticas",
};

function canAccessMenuItem(
  menuItem: MenuItemId,
  role: UserRole,
  permissions: PermissionMap | null,
): boolean {
  if (menuItem === "inicio") {
    return true;
  }
  if (menuItem === "configuracao") {
    if (!permissions) {
      return role !== "funcionario";
    }
    return hasAnyConfigurationAccess(permissions);
  }

  const moduleName = moduleByMenuItem[menuItem];
  if (!moduleName) {
    return false;
  }

  if (!permissions) {
    if (menuItem === "identificacao" || menuItem === "cadastro") {
      return true;
    }
    return role !== "funcionario";
  }

  return Boolean(permissions[moduleName]);
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, logout, effectivePermissions, isLoadingPermissions } = useAuth();
  const { emit } = useFeedback();
  const [activeMenuItem, setActiveMenuItem] = useState<MenuItemId>("inicio");
  const [configurationView, setConfigurationView] = useState<ConfigurationView>("root");
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [isMobileTopMenuVisible, setIsMobileTopMenuVisible] = useState(false);
  const mobileSwipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastMobileScrollYRef = useRef(0);
  const permissionsForUi = isLoadingPermissions ? EMPTY_PERMISSION_MAP : effectivePermissions;

  useEffect(() => {
    if (!user || isLoadingPermissions) {
      return;
    }

    if (!canAccessMenuItem(activeMenuItem, user.role, permissionsForUi)) {
      setActiveMenuItem("inicio");
      return;
    }

    if (configurationView === "usuarios" && !Boolean(permissionsForUi?.config_usuarios)) {
      setConfigurationView("root");
    }
  }, [activeMenuItem, configurationView, isLoadingPermissions, permissionsForUi, user]);

  useEffect(() => {
    if (activeMenuItem !== "configuracao" && configurationView !== "root") {
      setConfigurationView("root");
    }
  }, [activeMenuItem, configurationView]);

  useEffect(() => {
    if (!showExitConfirm) {
      return;
    }

    void emit("notification.generic", {
      dedupeKey: "dashboard-exit-confirm",
    });
  }, [emit, showExitConfirm]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    lastMobileScrollYRef.current = window.scrollY;
    const handleScroll = () => {
      if (window.innerWidth >= 1024) {
        return;
      }
      const currentY = window.scrollY;
      const previousY = lastMobileScrollYRef.current;
      if (currentY <= 96) {
        setIsMobileTopMenuVisible(false);
        lastMobileScrollYRef.current = currentY;
        return;
      }
      if (currentY < previousY - 8) {
        setIsMobileTopMenuVisible(true);
      } else if (currentY > previousY + 8) {
        setIsMobileTopMenuVisible(false);
      }
      lastMobileScrollYRef.current = currentY;
    };
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setIsMobileDrawerOpen(false);
        setIsMobileTopMenuVisible(false);
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (!isMobileDrawerOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileDrawerOpen]);

  const menuItems = useMemo(
    () =>
      dashboardMenuItems(user?.role ?? "funcionario", permissionsForUi).map((item) => ({
        ...item,
        icon: iconById[item.id as MenuItemId] ?? Home,
      })),
    [permissionsForUi, user?.role],
  );

  const quickActions = useMemo<QuickAction[]>(() => {
    if (!user) {
      return [];
    }

    const actions: QuickAction[] = [];
    const pushAction = (action: QuickAction) => {
      actions.push(action);
    };

    if (canAccessMenuItem("identificacao", user.role, permissionsForUi)) {
      pushAction({
        id: "identificacao",
        title: "Começar",
        description: "Iniciar a operação do dia.",
      });
    }

    if (canAccessMenuItem("cadastro", user.role, permissionsForUi)) {
      pushAction({
        id: "cadastro",
        title: "Cadastro aluno",
        description: "Registrar aluno no sistema.",
      });
    }

    if (canAccessMenuItem("turmas", user.role, permissionsForUi)) {
      pushAction({
        id: "turmas",
        title: "Turmas",
        description: "Organizar turmas e acompanhar alunos.",
      });
    }

    if (canAccessMenuItem("estatisticas", user.role, permissionsForUi)) {
      pushAction({
        id: "estatisticas",
        title: "Estatísticas",
        description: "Ver totais e gráficos de atendimento.",
      });
    }

    if (canAccessMenuItem("configuracao", user.role, permissionsForUi)) {
      pushAction({
        id: "configuracao",
        title: "Configuração",
        description: "Abrir as configurações do sistema.",
      });
    }

    return actions;
  }, [permissionsForUi, user]);

  const handleMenuNavigation = (target: MenuItemId) => {
    setActiveMenuItem(target);
    setIsMobileDrawerOpen(false);
    if (target === "configuracao") {
      setConfigurationView("root");
    }
  };

  const handleMobileTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch || touch.clientX > 24 || isMobileDrawerOpen) {
      mobileSwipeStartRef.current = null;
      return;
    }
    mobileSwipeStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleMobileTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (!mobileSwipeStartRef.current || isMobileDrawerOpen) {
      return;
    }
    const touch = event.touches[0];
    if (!touch) {
      return;
    }
    const deltaX = touch.clientX - mobileSwipeStartRef.current.x;
    const deltaY = touch.clientY - mobileSwipeStartRef.current.y;
    if (deltaX > 70 && Math.abs(deltaX) > Math.abs(deltaY)) {
      setIsMobileDrawerOpen(true);
      mobileSwipeStartRef.current = null;
    }
  };

  const handleMobileTouchEnd = () => {
    mobileSwipeStartRef.current = null;
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#fff7ed_0%,#f8fafc_40%,#e0f2fe_100%)] text-slate-900">
      <div className="hidden lg:flex lg:min-h-screen">
        <Sidebar
          activeItem={activeMenuItem}
          onItemClick={(item) => handleMenuNavigation(item as MenuItemId)}
          onLogout={() => setShowExitConfirm(true)}
          role={user.role}
          fullName={user.full_name}
          permissions={permissionsForUi}
        />

        <main className="flex-1">
          <div className="mx-auto max-w-7xl px-6 py-8 xl:px-10">
            <HeaderCard
              fullName={user.full_name}
              role={user.role}
              onOpenMenu={() => setIsMobileDrawerOpen(true)}
              showMenuButton={false}
              showSessionCard
            />
            <DashboardContent
              activeMenuItem={activeMenuItem}
              quickActions={quickActions}
              userRole={user.role}
              permissions={permissionsForUi}
              configurationView={configurationView}
              onNavigate={handleMenuNavigation}
              onOpenConfigurationUsers={() => setConfigurationView("usuarios")}
              onBackFromConfigurationUsers={() => setConfigurationView("root")}
              showQuickActions
            />
          </div>
        </main>
      </div>

      <div
        className="lg:hidden"
        onTouchStart={handleMobileTouchStart}
        onTouchMove={handleMobileTouchMove}
        onTouchEnd={handleMobileTouchEnd}
      >
        <button
          type="button"
          onClick={() => setIsMobileDrawerOpen(true)}
          data-testid="mobile-scroll-menu-trigger"
          className={`fixed right-4 top-4 z-[72] inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 shadow-lg shadow-slate-300 transition ${
            isMobileTopMenuVisible && !isMobileDrawerOpen
              ? "translate-y-0 opacity-100"
              : "-translate-y-3 opacity-0 pointer-events-none"
          }`}
        >
          <Menu className="h-4 w-4" />
          Menu
        </button>

        <div
          className={`fixed inset-0 z-[70] bg-slate-950/45 transition ${
            isMobileDrawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          onClick={() => setIsMobileDrawerOpen(false)}
        />

        <aside
          className={`fixed inset-y-0 left-0 z-[71] w-[82vw] max-w-xs transform border-r border-slate-200 bg-white p-5 shadow-2xl transition duration-300 ${
            isMobileDrawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
          aria-label="Menu lateral mobile"
        >
          <div className="rounded-2xl bg-slate-950 px-4 py-4 text-white">
            <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Sessao ativa</p>
            <p className="mt-2 text-base font-black">{user.full_name}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] text-orange-300">
              {getRoleLabel(user.role)}
            </p>
          </div>

          <div className="mt-4 space-y-2">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeMenuItem === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleMenuNavigation(item.id as MenuItemId)}
                  className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition ${
                    isActive
                      ? "bg-slate-950 text-white shadow-lg shadow-slate-300"
                      : "border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => {
              setIsMobileDrawerOpen(false);
              setShowExitConfirm(true);
            }}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </aside>

        <main className="mx-auto max-w-5xl px-4 py-4 sm:px-6">
          <HeaderCard
            fullName={user.full_name}
            role={user.role}
            onOpenMenu={() => setIsMobileDrawerOpen(true)}
            showSessionCard={false}
          />

          <div className="mt-4">
            <DashboardContent
              activeMenuItem={activeMenuItem}
              quickActions={quickActions}
              userRole={user.role}
              permissions={permissionsForUi}
              configurationView={configurationView}
              onNavigate={handleMenuNavigation}
              onOpenConfigurationUsers={() => setConfigurationView("usuarios")}
              onBackFromConfigurationUsers={() => setConfigurationView("root")}
              showQuickActions
            />
          </div>
        </main>
      </div>

      {showExitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[2rem] border border-white/60 bg-white p-8 shadow-2xl shadow-slate-900/20">
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-orange-600">
              Confirmar saída
            </p>
            <h2 className="mt-4 text-3xl font-black text-slate-900">Deseja encerrar a sessão?</h2>
            <p className="mt-4 text-sm leading-7 text-slate-600">
              O painel vai voltar para a tela inicial e o token da sessão será removido.
            </p>

            <div className="mt-8 flex gap-3">
              <button
                type="button"
                onClick={() => setShowExitConfirm(false)}
                className="flex-1 rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 font-semibold text-slate-700 transition hover:bg-slate-200"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  logout();
                  navigate("/");
                }}
                className="flex-1 rounded-xl bg-orange-500 px-4 py-3 font-semibold text-white shadow-lg shadow-orange-100 transition hover:bg-orange-600"
              >
                Sair
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type HeaderCardProps = {
  fullName: string;
  role: UserRole;
  onOpenMenu: () => void;
  showSessionCard?: boolean;
  showMenuButton?: boolean;
};

function HeaderCard({
  fullName,
  role,
  onOpenMenu,
  showSessionCard = true,
  showMenuButton = true,
}: HeaderCardProps) {
  return (
    <header className="rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-xl shadow-slate-200 backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-200">
            <UtensilsCrossed className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-600">
              Cantina escolar
            </p>
            <h1 className="text-xl font-black text-slate-950">Painel da equipe</h1>
          </div>
        </div>

        {showMenuButton ? (
          <button
            type="button"
            onClick={onOpenMenu}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            <Menu className="h-4 w-4" />
            Menu
          </button>
        ) : null}
      </div>

      {showSessionCard ? (
        <div className="mt-4 rounded-[1.5rem] bg-slate-950 px-4 py-4 text-white">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Sessão ativa</p>
          <p className="mt-2 text-lg font-black">{fullName}</p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] text-orange-300">
            {getRoleLabel(role)}
          </p>
        </div>
      ) : null}
    </header>
  );
}

type DashboardContentProps = {
  userRole: UserRole;
  permissions: PermissionMap | null;
  activeMenuItem: MenuItemId;
  quickActions: QuickAction[];
  configurationView: ConfigurationView;
  onNavigate: (section: MenuItemId) => void;
  onOpenConfigurationUsers: () => void;
  onBackFromConfigurationUsers: () => void;
  showQuickActions?: boolean;
};

function DashboardContent({
  userRole,
  permissions,
  activeMenuItem,
  quickActions,
  configurationView,
  onNavigate,
  onOpenConfigurationUsers,
  onBackFromConfigurationUsers,
  showQuickActions = true,
}: DashboardContentProps) {
  if (activeMenuItem === "inicio") {
    const heroActionCandidates: Array<{
      id: MenuItemId;
      label: string;
      icon: LucideIcon;
    }> = [
      { id: "identificacao", label: "Começar", icon: ArrowRight },
      { id: "cadastro", label: "Novo cadastro", icon: UserPlus2 },
      { id: "turmas", label: "Turmas", icon: Database },
      { id: "estatisticas", label: "Estatísticas", icon: BarChart3 },
      { id: "configuracao", label: "Configuração", icon: SlidersHorizontal },
    ];
    const heroActions = heroActionCandidates
      .filter((action) => canAccessMenuItem(action.id, userRole, permissions))
      .slice(0, 2);

    return (
      <div className="mt-6 space-y-6">
        <section className="overflow-hidden rounded-[2rem] bg-[linear-gradient(140deg,#0f172a_0%,#172554_52%,#ea580c_150%)] p-6 text-white shadow-2xl shadow-slate-300 sm:p-8">
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
            <p className="mx-auto text-xs font-semibold uppercase tracking-[0.25em] text-orange-200">
              Atendimento
            </p>
            <h2 className="mx-auto mt-3 max-w-[12ch] text-center text-3xl font-black tracking-tight sm:max-w-none sm:text-4xl">
              Tudo pronto para começar?
            </h2>

            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {heroActions.map((action, index) => {
                const Icon = action.icon;
                const isPrimary = index === 0;
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => onNavigate(action.id)}
                    className={`inline-flex items-center gap-2 rounded-2xl px-5 py-4 text-base font-semibold transition ${
                      isPrimary
                        ? "bg-orange-500 text-white shadow-lg shadow-orange-300/30 hover:bg-orange-600"
                        : "border border-white/15 bg-white/10 text-white hover:bg-white/15"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {action.label}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {showQuickActions ? (
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Módulos rápidos</p>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {quickActions.map((action) => {
                const Icon = iconById[action.id] ?? Home;
                const theme = quickActionThemes[action.id] ?? {
                  cardClass: "border-slate-200 bg-white text-slate-900",
                  iconClass: "bg-orange-100 text-orange-600",
                  descriptionClass: "text-slate-600",
                };

                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => onNavigate(action.id)}
                    className={`w-full rounded-[1.75rem] border p-5 text-left shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl ${theme.cardClass}`}
                  >
                    <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${theme.iconClass}`}>
                      <Icon className="h-6 w-6" />
                    </div>
                    <h3 className="mt-4 text-xl font-black">{action.title}</h3>
                    <p className={`mt-3 text-sm leading-7 ${theme.descriptionClass}`}>{action.description}</p>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  const showingConfigurationUsers =
    activeMenuItem === "configuracao" && configurationView === "usuarios" && Boolean(permissions?.config_usuarios);

  return (
    <div className="mt-6 space-y-6">
      <section className="flex items-center justify-start rounded-[1.75rem] border border-slate-200 bg-white px-5 py-4 shadow-lg shadow-slate-200">
        {showingConfigurationUsers ? (
          <button
            type="button"
            onClick={onBackFromConfigurationUsers}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onNavigate("inicio")}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            <Home className="h-4 w-4" />
            Início
          </button>
        )}
      </section>

      {activeMenuItem === "cadastro" && canAccessMenuItem("cadastro", userRole, permissions) && <StudentRegistration />}
      {activeMenuItem === "identificacao" && canAccessMenuItem("identificacao", userRole, permissions) && (
        <IdentificationPanel />
      )}
      {activeMenuItem === "configuracao" && configurationView === "root" && (
        <ConfigurationPanel
          role={userRole}
          permissions={permissions}
          onOpenUsers={onOpenConfigurationUsers}
        />
      )}
      {activeMenuItem === "configuracao" &&
        configurationView === "usuarios" &&
        Boolean(permissions?.config_usuarios) && <UserManagementPanel />}
      {activeMenuItem === "turmas" && canAccessMenuItem("turmas", userRole, permissions) && <TurmasPanel />}
      {activeMenuItem === "estatisticas" && canAccessMenuItem("estatisticas", userRole, permissions) && (
        <StatsPanel />
      )}
    </div>
  );
}
