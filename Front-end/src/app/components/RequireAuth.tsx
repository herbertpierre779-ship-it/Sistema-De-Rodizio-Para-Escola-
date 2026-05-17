import type { PropsWithChildren } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

function FullscreenLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="rounded-[1.75rem] border border-slate-200 bg-white px-8 py-6 text-center shadow-lg shadow-slate-200">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-orange-600">
          Carregando
        </p>
        <p className="mt-3 text-sm text-slate-600">Validando acesso ao sistema.</p>
      </div>
    </div>
  );
}

export function RequireAuth({ children }: PropsWithChildren) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <FullscreenLoading />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export function GuestOnly({ children }: PropsWithChildren) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <FullscreenLoading />;
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
