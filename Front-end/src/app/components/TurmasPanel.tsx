import { useEffect, useMemo, useState } from "react";
import { Layers3, PencilLine, Save, Trash2, UserRound, Users } from "lucide-react";
import { ApiError, classesApi, studentsApi } from "../lib/api";
import { useFeedback } from "../hooks/useFeedback";
import { SCHOOL_YEARS } from "../lib/constants";
import { useAuth } from "../hooks/useAuth";
import type { ClassItem, SchoolYear, StudentItem } from "../types/api";

type ClassForm = { name: string; school_year: SchoolYear };
type YearFilter = SchoolYear | "all";
type MobileSection = "turmas" | "alunos" | "detalhes";

function isMobileViewport() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 1279px)").matches;
}

export default function TurmasPanel() {
  const { token, user, effectivePermissions, isLoadingPermissions } = useAuth();
  const { emit } = useFeedback();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [classYearFilter, setClassYearFilter] = useState<YearFilter>("all");
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [classForm, setClassForm] = useState<ClassForm>({ name: "", school_year: "1 ano" });
  const [isCreatingClass, setIsCreatingClass] = useState(false);
  const [isClassFormOpen, setIsClassFormOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingClass, setIsSavingClass] = useState(false);
  const [showDeleteClassConfirm, setShowDeleteClassConfirm] = useState(false);
  const [isDeletingClass, setIsDeletingClass] = useState(false);
  const [mobileSection, setMobileSection] = useState<MobileSection>("turmas");
  const canManageClasses = Boolean(effectivePermissions?.criar_turma);

  const loadData = async () => {
    if (!token) return;
    setIsLoading(true);
    setErrorMessage("");
    try {
      const [classResponse, studentResponse] = await Promise.all([classesApi.list(token), studentsApi.list(token)]);
      setClasses(classResponse);
      setStudents(studentResponse);
      setSelectedClassId((current) => {
        if (current && classResponse.some((classItem) => classItem.id === current)) return current;
        return classResponse[0]?.id ?? null;
      });
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : "Nao foi possivel carregar as turmas.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [token]);

  const selectedClass = useMemo(
    () => classes.find((classItem) => classItem.id === selectedClassId) ?? null,
    [classes, selectedClassId],
  );
  const filteredClasses = useMemo(() => {
    const classesByYear =
      classYearFilter === "all"
        ? classes
        : classes.filter((classItem) => classItem.school_year === classYearFilter);
    return [...classesByYear].sort((first, second) => first.display_name.localeCompare(second.display_name, "pt-BR"));
  }, [classYearFilter, classes]);
  const visibleStudents = useMemo(() => {
    if (!selectedClassId) return [];
    return students
      .filter((student) => student.class_id === selectedClassId)
      .sort((first, second) => first.full_name.localeCompare(second.full_name, "pt-BR"));
  }, [selectedClassId, students]);
  const selectedStudent = useMemo(
    () => students.find((student) => student.id === selectedStudentId) ?? null,
    [selectedStudentId, students],
  );
  const selectedClassStudentCount = useMemo(
    () => students.filter((student) => student.class_id === selectedClassId).length,
    [selectedClassId, students],
  );

  useEffect(() => {
    if (!selectedClass || isCreatingClass) return;
    setClassForm({ name: selectedClass.name, school_year: selectedClass.school_year });
  }, [isCreatingClass, selectedClass]);

  useEffect(() => {
    setSelectedClassId((current) => {
      if (current && filteredClasses.some((classItem) => classItem.id === current)) return current;
      return filteredClasses[0]?.id ?? null;
    });
  }, [filteredClasses]);

  useEffect(() => {
    if (selectedStudentId && visibleStudents.some((student) => student.id === selectedStudentId)) return;
    setSelectedStudentId(visibleStudents[0]?.id ?? null);
  }, [selectedStudentId, visibleStudents]);

  useEffect(() => {
    if (!isClassFormOpen) return;
    void emit("notification.generic", {
      dedupeKey: isCreatingClass ? "class-form-create" : `class-form-edit-${selectedClassId ?? "none"}`,
    });
  }, [emit, isClassFormOpen, isCreatingClass, selectedClassId]);

  useEffect(() => {
    if (!showDeleteClassConfirm || !selectedClass) return;
    void emit("notification.generic", { dedupeKey: `class-delete-modal-${selectedClass.id}` });
  }, [emit, selectedClass, showDeleteClassConfirm]);

  useEffect(() => {
    if (!statusMessage) return;
    void emit("notification.generic", { dedupeKey: `class-status-${statusMessage}` });
  }, [emit, statusMessage]);

  useEffect(() => {
    if (!errorMessage) return;
    void emit("notification.generic", { dedupeKey: `class-error-${errorMessage}` });
  }, [emit, errorMessage]);

  useEffect(() => {
    if (mobileSection === "alunos" && !selectedClass) {
      setMobileSection("turmas");
      return;
    }
    if (mobileSection === "detalhes" && !selectedStudent) {
      setMobileSection(selectedClass ? "alunos" : "turmas");
    }
  }, [mobileSection, selectedClass, selectedStudent]);

  const handleSelectClass = (classItem: ClassItem) => {
    setSelectedClassId(classItem.id);
    setIsCreatingClass(false);
    setIsClassFormOpen(false);
    setShowDeleteClassConfirm(false);
    setStatusMessage("");
    setErrorMessage("");
    setClassForm({ name: classItem.name, school_year: classItem.school_year });
    if (isMobileViewport()) setMobileSection("alunos");
  };

  const handleCreateClass = () => {
    setIsCreatingClass(true);
    setIsClassFormOpen(true);
    setShowDeleteClassConfirm(false);
    setStatusMessage("");
    setErrorMessage("");
    setClassForm({ name: "", school_year: selectedClass?.school_year ?? "1 ano" });
  };

  const handleEditClass = () => {
    if (!selectedClass) return;
    setIsCreatingClass(false);
    setIsClassFormOpen(true);
    setShowDeleteClassConfirm(false);
    setStatusMessage("");
    setErrorMessage("");
    setClassForm({ name: selectedClass.name, school_year: selectedClass.school_year });
  };

  const handleSaveClass = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token || !canManageClasses) return;
    setIsSavingClass(true);
    setStatusMessage("");
    setErrorMessage("");
    try {
      if (isCreatingClass || !selectedClass) {
        const created = await classesApi.create(token, classForm);
        setStatusMessage("Turma criada com sucesso.");
        setSelectedClassId(created.id);
      } else {
        await classesApi.update(token, selectedClass.id, classForm);
        setStatusMessage("Turma atualizada com sucesso.");
      }
      setIsCreatingClass(false);
      setIsClassFormOpen(false);
      if (isMobileViewport()) setMobileSection("turmas");
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : "Nao foi possivel salvar a turma.");
    } finally {
      setIsSavingClass(false);
    }
  };

  const handleDeleteClass = async () => {
    if (!token || !selectedClass || !canManageClasses) return;
    setStatusMessage("");
    setErrorMessage("");
    setIsDeletingClass(true);
    try {
      await classesApi.remove(token, selectedClass.id);
      setStatusMessage("Turma removida com sucesso.");
      setSelectedClassId(null);
      setSelectedStudentId(null);
      setIsCreatingClass(false);
      setIsClassFormOpen(false);
      setClassForm({ name: "", school_year: "1 ano" });
      if (isMobileViewport()) setMobileSection("turmas");
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : "Nao foi possivel remover a turma.");
    } finally {
      setIsDeletingClass(false);
      setShowDeleteClassConfirm(false);
    }
  };

  const yearFilterButtons: Array<{ value: YearFilter; label: string }> = [
    { value: "all", label: "Todas" },
    { value: "1 ano", label: "1 ano" },
    { value: "2 ano", label: "2 ano" },
    { value: "3 ano", label: "3 ano" },
  ];

  if (!isLoadingPermissions && !canManageClasses) {
    return (
      <section className="rounded-[2rem] border border-slate-200 bg-white p-7 shadow-lg shadow-slate-200">
        <p className="text-sm text-slate-600">Seu usuário não tem permissão para o módulo de turmas.</p>
      </section>
    );
  }

  return (
    <>
      <div className="sticky top-2 z-20 rounded-[1.5rem] border border-slate-200 bg-white/95 p-3 shadow-lg shadow-slate-200 backdrop-blur xl:hidden">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMobileSection("turmas")}
            className={`min-h-[3.1rem] rounded-2xl px-2 py-2 text-xs font-semibold leading-tight transition ${
              mobileSection === "turmas"
                ? "bg-slate-950 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <span className="block uppercase tracking-[0.16em]">Turmas</span>
            <span className="mt-1 block text-[11px] opacity-80">{filteredClasses.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileSection("alunos")}
            disabled={!selectedClass}
            className={`min-h-[3.1rem] rounded-2xl px-2 py-2 text-xs font-semibold leading-tight transition ${
              mobileSection === "alunos"
                ? "bg-slate-950 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <span className="block uppercase tracking-[0.16em]">Alunos</span>
            <span className="mt-1 block text-[11px] opacity-80">{visibleStudents.length}</span>
          </button>
        </div>

        {selectedClass ? (
          <div className="mt-3 rounded-[1.25rem] border border-slate-200 bg-slate-50 p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Turma selecionada</p>
            <div className="mt-2">
              <div className="min-w-0">
                <p className="text-lg font-black text-slate-900">{selectedClass.display_name}</p>
                <p className="mt-1 text-sm text-slate-500">{selectedClassStudentCount} aluno(s) nesta turma</p>
              </div>
            </div>
            {canManageClasses && (
              <div className="mt-3 grid grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={handleCreateClass}
                  className="rounded-2xl bg-emerald-500 px-3 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-200/70 transition hover:bg-emerald-600"
                >
                  Criar turma
                </button>
                <button
                  type="button"
                  onClick={handleEditClass}
                  className="rounded-2xl bg-orange-500 px-3 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-200/70 transition hover:bg-orange-600"
                >
                  Editar turma
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteClassConfirm(true)}
                  className="rounded-2xl bg-rose-500 px-3 py-3 text-sm font-semibold text-white shadow-lg shadow-rose-200/70 transition hover:bg-rose-600"
                >
                  Excluir
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 rounded-[1.25rem] border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">
            Nenhuma turma disponivel.
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-4 xl:mt-0 xl:grid-cols-[0.95fr_0.9fr_1.15fr] xl:gap-6">
        <section className={`space-y-4 xl:space-y-6 ${mobileSection === "turmas" ? "block" : "hidden"} xl:block`}>
          <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Layers3 className="h-6 w-6 text-orange-500" />
                <div>
                  <h2 className="text-xl font-black text-slate-900">Turmas</h2>
                  <p className="text-sm text-slate-500">Selecione uma turma para ver os alunos.</p>
                </div>
              </div>
              {canManageClasses && (
                <div className="hidden flex-wrap gap-2 xl:flex">
                  <button
                    type="button"
                    onClick={handleCreateClass}
                    className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600"
                  >
                    Criar turma
                  </button>
                  {selectedClass && (
                    <>
                      <button
                        type="button"
                        onClick={handleEditClass}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        Editar turma
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowDeleteClassConfirm(true)}
                        className="rounded-2xl bg-rose-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-rose-600"
                      >
                        Excluir turma
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {yearFilterButtons.map((buttonItem) => {
                const isActive = classYearFilter === buttonItem.value;
                return (
                  <button
                    key={buttonItem.value}
                    type="button"
                    onClick={() => setClassYearFilter(buttonItem.value)}
                    className={`whitespace-nowrap rounded-full px-3 py-2 text-xs font-semibold transition ${
                      isActive
                        ? "bg-slate-950 text-white shadow-lg shadow-slate-200"
                        : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {buttonItem.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 max-h-[48svh] space-y-3 overflow-y-auto pr-1 sm:max-h-[52vh] xl:max-h-[24rem]">
              {isLoading ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
                  Carregando turmas...
                </div>
              ) : filteredClasses.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
                  Nenhuma turma encontrada.
                </div>
              ) : (
                filteredClasses.map((classItem) => {
                  const isActive = classItem.id === selectedClassId;
                  return (
                    <button
                      key={classItem.id}
                      type="button"
                      onClick={() => handleSelectClass(classItem)}
                      className={`w-full rounded-[1.5rem] border p-4 text-left transition ${
                        isActive
                          ? "border-orange-300 bg-orange-50"
                          : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                      }`}
                    >
                      <p className="text-lg font-black text-slate-900">{classItem.display_name}</p>
                      <p className="mt-2 text-sm text-slate-500">{classItem.student_count} aluno(s) cadastrado(s)</p>
                    </button>
                  );
                })
              )}
            </div>

            {statusMessage && (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {statusMessage}
              </div>
            )}
            {errorMessage && (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {errorMessage}
              </div>
            )}
          </div>
        </section>

        <section
          className={`rounded-[2rem] border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200 sm:p-6 ${
            mobileSection === "alunos" ? "block" : "hidden"
          } xl:block`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Users className="h-6 w-6 text-orange-500" />
              <div>
                <h3 className="text-xl font-black text-slate-900">Alunos da turma</h3>
                <p className="text-sm text-slate-500">
                  {selectedClass ? selectedClass.display_name : "Selecione uma turma para listar os alunos."}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 max-h-[48svh] space-y-3 overflow-y-auto pr-1 sm:max-h-[52vh] xl:max-h-[28rem]">
            {selectedClass && visibleStudents.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
                Nenhum aluno encontrado nesta turma.
              </div>
            ) : !selectedClass ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
                Escolha uma turma para continuar.
              </div>
            ) : (
              visibleStudents.map((student) => {
                const isActive = student.id === selectedStudentId;
                return (
                  <button
                    key={student.id}
                    type="button"
                    onClick={() => {
                      setSelectedStudentId(student.id);
                      setMobileSection("detalhes");
                    }}
                    className={`flex w-full items-center gap-4 rounded-[1.5rem] border p-4 text-left transition ${
                      isActive
                        ? "border-orange-300 bg-orange-50"
                        : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                    }`}
                  >
                    {student.photo_url ? (
                      <img
                        src={student.photo_url}
                        alt={student.full_name}
                        className="h-14 w-14 rounded-2xl object-cover"
                      />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-200 text-slate-500">
                        <UserRound className="h-6 w-6" />
                      </div>
                    )}
                    <div>
                      <p className="font-semibold text-slate-900">{student.full_name}</p>
                      <p className="mt-1 text-sm text-slate-500">{student.class_display_name}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>

        </section>

        <section className={`space-y-4 xl:space-y-6 ${mobileSection === "detalhes" ? "block" : "hidden"} xl:block`}>
          <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200 sm:p-6">
            <div className="flex items-start gap-4">
              {selectedStudent?.photo_url ? (
                <img
                  src={selectedStudent.photo_url}
                  alt={selectedStudent.full_name}
                  className="h-20 w-20 rounded-[1.5rem] object-cover shadow-lg shadow-slate-200"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-[1.5rem] bg-slate-200 text-slate-500">
                  <UserRound className="h-9 w-9" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Aluno</p>
                <h3 className="mt-2 text-2xl font-black text-slate-900">
                  {selectedStudent?.full_name ?? "Selecione um aluno"}
                </h3>
                <p className="mt-2 text-sm text-slate-500">
                  {selectedStudent?.class_display_name ?? "Escolha um aluno para ver os detalhes."}
                </p>
                {selectedStudent && (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-orange-700">
                      {selectedStudent.school_year}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
                      Face {selectedStudent.has_face_enrolled ? "cadastrada" : "pendente"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

        </section>
      </div>

      {canManageClasses && isClassFormOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4">
          <form
            onSubmit={handleSaveClass}
            className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-[2rem] border border-white/70 bg-white p-6 shadow-2xl shadow-slate-900/20 sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <PencilLine className="h-6 w-6 text-orange-500" />
                <div>
                  <h3 className="text-xl font-black text-slate-900">
                    {isCreatingClass ? "Cadastro da turma" : "Editar turma"}
                  </h3>
                  <p className="text-sm text-slate-500">Usuários com permissão podem criar, editar e remover turmas.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsClassFormOpen(false)}
                className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
              >
                Fechar
              </button>
            </div>

            <div className="mt-5 grid gap-4">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Ano</label>
                <select
                  value={classForm.school_year}
                  onChange={(event) =>
                    setClassForm((current) => ({ ...current, school_year: event.target.value as SchoolYear }))
                  }
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-400"
                >
                  {SCHOOL_YEARS.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Nome da turma</label>
                <input
                  type="text"
                  value={classForm.name}
                  onChange={(event) =>
                    setClassForm((current) => ({ ...current, name: event.target.value.toLocaleUpperCase("pt-BR") }))
                  }
                  placeholder="Ex.: A, B, ADS"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-400"
                  required
                />
              </div>
            </div>

            {statusMessage && (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {statusMessage}
              </div>
            )}
            {errorMessage && (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {errorMessage}
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={isSavingClass || !classForm.name.trim()}
                className={`inline-flex items-center gap-2 rounded-2xl px-5 py-3 font-semibold text-white shadow-lg transition disabled:cursor-not-allowed disabled:bg-slate-300 ${
                  isCreatingClass
                    ? "bg-emerald-500 shadow-emerald-100 hover:bg-emerald-600"
                    : "bg-orange-500 shadow-orange-100 hover:bg-orange-600"
                }`}
              >
                <Save className="h-4 w-4" />
                {isSavingClass ? "Salvando..." : isCreatingClass ? "Criar turma" : "Salvar turma"}
              </button>

              {!isCreatingClass && selectedClass && (
                <button
                  type="button"
                  onClick={() => setShowDeleteClassConfirm(true)}
                  disabled={isDeletingClass}
                  className="inline-flex items-center gap-2 rounded-2xl bg-rose-500 px-5 py-3 font-semibold text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                  Excluir
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {canManageClasses && showDeleteClassConfirm && selectedClass && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/55 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4">
          <div className="w-full max-w-md rounded-[2rem] border border-white/70 bg-white p-6 shadow-2xl shadow-slate-900/20 sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-rose-600">Confirmar exclusao</p>
            <h3 className="mt-3 text-2xl font-black text-slate-900">Voce tem certeza que deseja excluir a turma?</h3>

            <div className="mt-5 space-y-3 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Nome</p>
                <p className="mt-1 font-semibold text-slate-900">{selectedClass.name}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Serie</p>
                <p className="mt-1 font-semibold text-slate-900">{selectedClass.school_year}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Total de alunos</p>
                <p className="mt-1 font-semibold text-slate-900">{selectedClassStudentCount}</p>
              </div>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowDeleteClassConfirm(false)}
                disabled={isDeletingClass}
                className="w-full rounded-2xl border border-slate-200 bg-slate-100 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteClass()}
                disabled={isDeletingClass}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                <Trash2 className="h-4 w-4" />
                {isDeletingClass ? "Excluindo..." : "Excluir turma"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
