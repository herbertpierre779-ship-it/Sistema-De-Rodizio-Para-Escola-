import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Shield, Trash2, UserCog } from "lucide-react";
import { ApiError, usersApi } from "../lib/api";
import { useFeedback } from "../hooks/useFeedback";
import { useAuth } from "../hooks/useAuth";
import { getRoleLabel } from "../lib/constants";
import type { AuthUser, UserRole } from "../types/api";

type UserForm = {
  username: string;
  full_name: string;
  password: string;
  role: UserRole | "";
  is_active: boolean;
};

const emptyForm: UserForm = {
  username: "",
  full_name: "",
  password: "",
  role: "",
  is_active: true,
};

export default function UserManagementPanel() {
  const { token, user } = useAuth();
  const { emit } = useFeedback();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeletingUser, setIsDeletingUser] = useState(false);

  const selectedUser = useMemo(
    () => users.find((item) => item.id === selectedUserId) ?? null,
    [selectedUserId, users],
  );
  const isEditingOwnUser = Boolean(selectedUser && user && selectedUser.id === user.id);

  const loadUsers = async () => {
    if (!token) {
      return;
    }

    const response = await usersApi.list(token);
    setUsers(response);
    setSelectedUserId((current) => {
      if (current && response.some((item) => item.id === current)) {
        return current;
      }
      return null;
    });
  };

  useEffect(() => {
    if (!token) {
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    usersApi
      .list(token)
      .then((response) => {
        if (!isMounted) {
          return;
        }
        setUsers(response);
        setSelectedUserId((current) => (current && response.some((item) => item.id === current) ? current : null));
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }
        setErrorMessage(error instanceof ApiError ? error.message : "Não foi possível carregar os usuários.");
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [token]);

  useEffect(() => {
    if (!selectedUser) {
      setForm(emptyForm);
      return;
    }

    setForm({
      username: selectedUser.username,
      full_name: selectedUser.full_name,
      password: "",
      role: selectedUser.role,
      is_active: selectedUser.is_active,
    });
  }, [selectedUser]);

  useEffect(() => {
    if (!showDeleteConfirm || !selectedUser) {
      return;
    }

    void emit("notification.generic", {
      dedupeKey: `user-delete-modal-${selectedUser.id}`,
    });
  }, [emit, selectedUser, showDeleteConfirm]);

  useEffect(() => {
    if (!statusMessage) {
      return;
    }

    void emit("notification.generic", {
      dedupeKey: `user-status-${statusMessage}`,
    });
  }, [emit, statusMessage]);

  useEffect(() => {
    if (!errorMessage) {
      return;
    }

    void emit("notification.generic", {
      dedupeKey: `user-error-${errorMessage}`,
    });
  }, [emit, errorMessage]);

  const resetFormForCreate = () => {
    setSelectedUserId(null);
    setForm(emptyForm);
    setStatusMessage("");
    setErrorMessage("");
    setShowDeleteConfirm(false);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token) {
      return;
    }

    setIsSubmitting(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      if (!form.role) {
        setErrorMessage("Selecione um perfil antes de salvar.");
        return;
      }
      if (isEditingOwnUser && form.is_active === false) {
        setErrorMessage("Você não pode desativar a conta que está usando no momento.");
        return;
      }

      if (selectedUser) {
        await usersApi.update(token, selectedUser.id, {
          full_name: form.full_name,
          password: form.password || undefined,
          role: form.role as UserRole,
          is_active: form.is_active,
        });
        setStatusMessage("Usuário atualizado com sucesso.");
      } else {
        const created = await usersApi.create(token, {
          ...form,
          role: form.role as UserRole,
        });
        setStatusMessage("Usuário criado com sucesso.");
        setSelectedUserId(created.id);
      }

      await loadUsers();
      setForm((current) => ({ ...current, password: "" }));
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : "Não foi possível salvar o usuário.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!token || !selectedUser) {
      return;
    }
    setIsDeletingUser(true);

    try {
      await usersApi.remove(token, selectedUser.id);
      setStatusMessage("Usuário removido com sucesso.");
      setErrorMessage("");
      resetFormForCreate();
      await loadUsers();
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : "Não foi possível remover o usuário.");
    } finally {
      setIsDeletingUser(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-7 shadow-lg shadow-slate-200">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-600">
            <Shield className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-900">Gestão de usuários</h2>
            <p className="text-sm text-slate-500">
              Área para criar, editar e remover acessos da equipe.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={resetFormForCreate}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              Novo usuário
            </button>
            {selectedUser && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isDeletingUser}
                className="inline-flex items-center gap-2 rounded-2xl bg-rose-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" />
                Remover
              </button>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Usuário</label>
            <input
              type="text"
              value={form.username}
              onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
              disabled={Boolean(selectedUser)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-400 disabled:bg-slate-100"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Nome completo</label>
            <input
              type="text"
              value={form.full_name}
              onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-400"
              required
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">{selectedUser ? "Nova senha" : "Senha"}</label>
              <input
                type="password"
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-400"
                required={!selectedUser}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Perfil</label>
              <select
                value={form.role}
                onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as UserRole }))}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-400"
                required
              >
                <option value="">Selecione um perfil</option>
                <option value="funcionario">Funcionário</option>
                <option value="coordenadora">Coordenadora</option>
                <option value="diretor">Diretor</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))}
              disabled={isEditingOwnUser}
              className="h-4 w-4 rounded border-slate-300 text-orange-500"
            />
            {form.is_active ? "Desativar usuário" : "Ativar usuário"}
          </label>
          {isEditingOwnUser ? (
            <p className="text-xs text-slate-500">A conta logada não pode ser desativada.</p>
          ) : null}

          {statusMessage && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {statusMessage}
            </div>
          )}

          {errorMessage && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 font-semibold text-white shadow-lg shadow-orange-100 transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Save className="h-4 w-4" />
            {isSubmitting ? "Salvando..." : selectedUser ? "Salvar alterações" : "Criar usuário"}
          </button>
        </form>
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-7 shadow-lg shadow-slate-200">
        <div className="flex items-center gap-3">
          <UserCog className="h-6 w-6 text-orange-500" />
          <div>
            <h3 className="text-xl font-black text-slate-900">Usuários cadastrados</h3>
            <p className="text-sm text-slate-500">Selecione um usuário para editar.</p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {isLoading ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
              Carregando usuários...
            </div>
          ) : users.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
              Nenhum usuário cadastrado ainda.
            </div>
          ) : (
            users.map((item) => {
              const isActive = item.id === selectedUserId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedUserId(item.id)}
                  className={`w-full rounded-[1.5rem] border p-4 text-left transition ${
                    isActive
                      ? "border-orange-300 bg-orange-50"
                      : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">{item.full_name}</p>
                      <p className="mt-1 text-sm text-slate-500">@{item.username}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-600">
                        {getRoleLabel(item.role)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{item.is_active ? "Ativo" : "Inativo"}</p>
                    </div>
                  </div>
                  {item.id === user?.id && (
                    <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Usuário atual
                    </p>
                  )}
                </button>
              );
            })
          )}
        </div>
      </section>

      {showDeleteConfirm && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4">
          <div className="w-full max-w-md rounded-[2rem] border border-white/70 bg-white p-6 shadow-2xl shadow-slate-900/20 sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-rose-600">Confirmar exclusão</p>
            <h3 className="mt-3 text-2xl font-black text-slate-900">Remover acesso do usuário?</h3>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Você está removendo o acesso de <span className="font-semibold">{selectedUser.full_name}</span>.
            </p>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeletingUser}
                className="w-full rounded-2xl border border-slate-200 bg-slate-100 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={isDeletingUser}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                <Trash2 className="h-4 w-4" />
                {isDeletingUser ? "Removendo..." : "Remover usuário"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
