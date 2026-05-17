import {
  BarChart3,
  Database,
  Home,
  LogOut,
  ScanFace,
  SlidersHorizontal,
  UserPlus2,
  Utensils,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { dashboardMenuItems, getRoleLabel } from "../lib/constants";
import type { PermissionMap, UserRole } from "../types/api";

type SidebarProps = {
  activeItem: string;
  onItemClick: (item: string) => void;
  onLogout: () => void;
  role: UserRole;
  fullName: string;
  permissions: PermissionMap | null;
};

export default function Sidebar({
  activeItem,
  onItemClick,
  onLogout,
  role,
  fullName,
  permissions,
}: SidebarProps) {
  const iconById: Record<string, LucideIcon> = {
    inicio: Home,
    cadastro: UserPlus2,
    identificacao: ScanFace,
    configuracao: SlidersHorizontal,
    turmas: Database,
    estatisticas: BarChart3,
  };

  const menuItems = dashboardMenuItems(role, permissions).map((item) => ({
    ...item,
    icon: iconById[item.id] ?? Home,
  }));

  return (
    <aside className="sticky top-0 flex h-screen w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-500 text-white">
            <Utensils className="h-6 w-6" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Cantina Escolar</h2>
            <p className="text-xs text-slate-500">Ceti Zacarias</p>
          </div>
        </div>

        <div className="mt-5 rounded-2xl bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-black">Sessão</p>
          <p className="mt-2 font-semibold text-black">{fullName}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-black">{getRoleLabel(role)}</p>
        </div>
      </div>

      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeItem === item.id;

            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onItemClick(item.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition ${
                    isActive
                      ? "bg-orange-500 text-white shadow-lg shadow-orange-100"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="font-medium">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-slate-200 p-4">
        <button
          type="button"
          onClick={onLogout}
          className="mb-4 flex w-full items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
        >
          <LogOut className="h-5 w-5" />
          <span>Sair</span>
        </button>
        <p className="text-center text-xs text-slate-500">Projeto escolar 2026</p>
      </div>
    </aside>
  );
}
