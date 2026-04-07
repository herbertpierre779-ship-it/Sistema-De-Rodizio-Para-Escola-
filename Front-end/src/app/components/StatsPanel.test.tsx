import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mealEntriesListMock = vi.fn();
const studentsListMock = vi.fn();
const classesListMock = vi.fn();

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
  mealEntriesApi: {
    list: (...args: unknown[]) => mealEntriesListMock(...args),
  },
  studentsApi: {
    list: (...args: unknown[]) => studentsListMock(...args),
  },
  classesApi: {
    list: (...args: unknown[]) => classesListMock(...args),
  },
}));

import StatsPanel from "./StatsPanel";

describe("StatsPanel historico de refeicoes", () => {
  beforeEach(() => {
    mealEntriesListMock.mockReset();
    studentsListMock.mockReset();
    classesListMock.mockReset();
    const now = new Date();
    const todayAtLunch = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      12,
      0,
      0,
    ).toISOString();
    const [dayOne, dayTwo, dayThree] = now.getDate() <= 20 ? [27, 26, 25] : [4, 3, 2];
    const atDay = (day: number, hour: number, minute: number) =>
      new Date(
        now.getFullYear(),
        now.getMonth(),
        day,
        hour,
        minute,
        0,
      ).toISOString();

    classesListMock.mockResolvedValue([
      {
        id: "class-a",
        name: "A",
        school_year: "1 ano",
        display_name: "1 ano - A",
        student_count: 1,
        created_at: "2026-03-01T00:00:00Z",
        updated_at: "2026-03-01T00:00:00Z",
      },
      {
        id: "class-b",
        name: "B",
        school_year: "2 ano",
        display_name: "2 ano - B",
        student_count: 1,
        created_at: "2026-03-01T00:00:00Z",
        updated_at: "2026-03-01T00:00:00Z",
      },
    ]);

    studentsListMock.mockResolvedValue([
      {
        id: "student-1",
        full_name: "ALUNO EXC 1",
        class_id: "class-a",
        class_name: "A",
        class_display_name: "1 ano - A",
        school_year: "1 ano",
        photo_url: "/media/student-1.jpg",
        has_face_enrolled: true,
        created_at: "2026-03-01T00:00:00Z",
        updated_at: "2026-03-01T00:00:00Z",
      },
      {
        id: "student-2",
        full_name: "ALUNO EXC 2",
        class_id: "class-b",
        class_name: "B",
        class_display_name: "2 ano - B",
        school_year: "2 ano",
        photo_url: "/media/student-2.jpg",
        has_face_enrolled: true,
        created_at: "2026-03-01T00:00:00Z",
        updated_at: "2026-03-01T00:00:00Z",
      },
      {
        id: "student-3",
        full_name: "ALUNO NORMAL",
        class_id: "class-a",
        class_name: "A",
        class_display_name: "1 ano - A",
        school_year: "1 ano",
        photo_url: null,
        has_face_enrolled: true,
        created_at: "2026-03-01T00:00:00Z",
        updated_at: "2026-03-01T00:00:00Z",
      },
    ]);

    mealEntriesListMock.mockResolvedValue([
      {
        id: "10",
        student_id: "student-1",
        student_name: "ALUNO EXC 1",
        class_id: "class-a",
        class_name: "A",
        class_display_name: "1 ano - A",
        school_year: "1 ano",
        meal_type: "almoco",
        recorded_at: atDay(dayOne, 12, 30),
        recorded_by_user_id: "1",
        recorded_by_name: "Diretor",
        source: "excecao",
        confidence: 0.8,
      },
      {
        id: "11",
        student_id: "student-2",
        student_name: "ALUNO EXC 2",
        class_id: "class-b",
        class_name: "B",
        class_display_name: "2 ano - B",
        school_year: "2 ano",
        meal_type: "merenda",
        recorded_at: atDay(dayTwo, 10, 10),
        recorded_by_user_id: "1",
        recorded_by_name: "Diretor",
        source: "excecao",
        confidence: null,
      },
      {
        id: "12",
        student_id: "student-3",
        student_name: "ALUNO NORMAL",
        class_id: "class-a",
        class_name: "A",
        class_display_name: "1 ano - A",
        school_year: "1 ano",
        meal_type: "almoco",
        recorded_at: atDay(dayThree, 12, 15),
        recorded_by_user_id: "1",
        recorded_by_name: "Diretor",
        source: "reconhecimento",
        confidence: 0.95,
      },
      {
        id: "13",
        student_id: "student-1",
        student_name: "ALUNO HOJE",
        class_id: "class-a",
        class_name: "A",
        class_display_name: "1 ano - A",
        school_year: "1 ano",
        meal_type: "almoco",
        recorded_at: todayAtLunch,
        recorded_by_user_id: "1",
        recorded_by_name: "Diretor",
        source: "manual",
        confidence: null,
      },
    ]);
  });

  it("mostra historico com todas as entradas por padrao e filtro por excecao", async () => {
    render(<StatsPanel />);

    const sectionTitle = await screen.findByText(/historico de refeicoes/i);
    const exceptionSection = sectionTitle.closest("section");
    expect(exceptionSection).toBeTruthy();
    if (!exceptionSection) {
      return;
    }

    const scoped = within(exceptionSection);
    await waitFor(() => {
      expect(scoped.getByText("ALUNO HOJE")).toBeTruthy();
    });
    expect(scoped.getByText("ALUNO EXC 1")).toBeTruthy();
    expect(scoped.getByText("ALUNO EXC 2")).toBeTruthy();
    expect(scoped.getByText("ALUNO NORMAL")).toBeTruthy();

    const sectionText = exceptionSection.textContent ?? "";
    expect(sectionText.indexOf("ALUNO EXC 1")).toBeLessThan(sectionText.indexOf("ALUNO EXC 2"));

    fireEvent.click(scoped.getByRole("button", { name: /excecao/i }));
    expect(scoped.getByText("ALUNO EXC 1")).toBeTruthy();
    expect(scoped.getByText("ALUNO EXC 2")).toBeTruthy();
    expect(scoped.queryByText("ALUNO NORMAL")).toBeNull();
  });

  it("aplica filtro hoje no modal do historico", async () => {
    render(<StatsPanel />);

    const sectionTitle = await screen.findByText(/historico de refeicoes/i);
    const exceptionSection = sectionTitle.closest("section");
    expect(exceptionSection).toBeTruthy();
    if (!exceptionSection) {
      return;
    }

    fireEvent.click(within(exceptionSection).getByRole("button", { name: /^filtro$/i }));
    const modalTitle = screen.getByText(/filtro do historico/i);
    const modalContainer = modalTitle.closest("div")?.parentElement;
    expect(modalContainer).toBeTruthy();
    if (!modalContainer) {
      return;
    }
    const modalScoped = within(modalContainer);
    fireEvent.click(modalScoped.getByRole("button", { name: /^hoje$/i }));
    fireEvent.click(modalScoped.getByRole("button", { name: /aplicar filtro/i }));

    const scoped = within(exceptionSection);
    await waitFor(() => {
      expect(scoped.getByText("ALUNO HOJE")).toBeTruthy();
    });
    expect(scoped.queryByText("ALUNO EXC 1")).toBeNull();
    expect(scoped.queryByText("ALUNO EXC 2")).toBeNull();
    expect(scoped.queryByText("ALUNO NORMAL")).toBeNull();
  });

  it("ativa rolagem interna quando historico passa de 6 entradas", async () => {
    const now = new Date();
    const entries = Array.from({ length: 7 }, (_, index) => ({
      id: String(100 + index),
      student_id: "student-1",
      student_name: `ALUNO ${index + 1}`,
      class_id: "class-a",
      class_name: "A",
      class_display_name: "1 ano - A",
      school_year: "1 ano",
      meal_type: "almoco" as const,
      recorded_at: new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        11,
        index,
        0,
      ).toISOString(),
      recorded_by_user_id: "1",
      recorded_by_name: "Diretor",
      source: "manual",
      confidence: null,
    }));
    mealEntriesListMock.mockResolvedValue(entries);

    render(<StatsPanel />);

    const sectionTitle = await screen.findByText(/historico de refeicoes/i);
    const historySection = sectionTitle.closest("section");
    expect(historySection).toBeTruthy();
    if (!historySection) {
      return;
    }
    const scoped = within(historySection);
    await waitFor(() => {
      expect(scoped.getByText("ALUNO 7")).toBeTruthy();
    });

    const listContainer = scoped.getByText("ALUNO 1").closest("article")?.parentElement;
    expect(listContainer).toBeTruthy();
    expect(listContainer?.className.includes("overflow-y-auto")).toBe(true);
  });

  it("so exibe lista de alunos apos aplicar filtro e aceita ano ou turma separadamente", async () => {
    render(<StatsPanel />);

    const sectionTitle = await screen.findByText(/estatisticas dos alunos/i);
    const studentSection = sectionTitle.closest("section");
    expect(studentSection).toBeTruthy();
    if (!studentSection) {
      return;
    }

    const studentScoped = within(studentSection);
    expect(studentScoped.getByText(/ano: todos \| turma: todas/i)).toBeTruthy();
    expect(studentScoped.queryByRole("button", { name: /ALUNO EXC 2/i })).toBeNull();

    fireEvent.click(studentScoped.getByRole("button", { name: /filtro ano\/turma/i }));

    const modalTitle = screen.getByText(/filtro de alunos/i);
    const modalContainer = modalTitle.closest("div")?.parentElement;
    expect(modalContainer).toBeTruthy();
    if (!modalContainer) {
      return;
    }

    const modalScoped = within(modalContainer);
    const [yearSelect, classSelect] = modalScoped.getAllByRole("combobox");
    const applyButton = modalScoped.getByRole("button", { name: /aplicar filtro/i }) as HTMLButtonElement;

    expect(applyButton.disabled).toBe(true);
    expect(within(classSelect as HTMLSelectElement).queryByRole("option", { name: "A" })).toBeTruthy();
    expect(within(classSelect as HTMLSelectElement).queryByRole("option", { name: "B" })).toBeTruthy();
    expect(within(classSelect as HTMLSelectElement).queryByRole("option", { name: /1 ano - A/i })).toBeNull();

    fireEvent.change(yearSelect, { target: { value: "1 ano" } });
    expect(applyButton.disabled).toBe(false);
    fireEvent.click(applyButton);

    await waitFor(() => {
      expect(studentScoped.getByRole("button", { name: /ALUNO EXC 1/i })).toBeTruthy();
    });
    expect(studentScoped.getByRole("button", { name: /ALUNO NORMAL/i })).toBeTruthy();
    expect(studentScoped.queryByRole("button", { name: /ALUNO EXC 2/i })).toBeNull();

    fireEvent.click(studentScoped.getByRole("button", { name: /filtro ano\/turma/i }));
    const reopenedModalTitle = screen.getByText(/filtro de alunos/i);
    const reopenedModalContainer = reopenedModalTitle.closest("div")?.parentElement;
    expect(reopenedModalContainer).toBeTruthy();
    if (!reopenedModalContainer) {
      return;
    }
    const reopenedModalScoped = within(reopenedModalContainer);
    const [reopenedYearSelect, reopenedClassSelect] = reopenedModalScoped.getAllByRole("combobox");
    const reopenedApplyButton = reopenedModalScoped.getByRole("button", { name: /aplicar filtro/i }) as HTMLButtonElement;

    fireEvent.change(reopenedYearSelect, { target: { value: "" } });
    fireEvent.change(reopenedClassSelect, { target: { value: "class-b" } });
    expect(reopenedApplyButton.disabled).toBe(false);
    fireEvent.click(reopenedApplyButton);

    await waitFor(() => {
      expect(studentScoped.getByRole("button", { name: /ALUNO EXC 2/i })).toBeTruthy();
    });
    expect(studentScoped.queryByRole("button", { name: /ALUNO EXC 1/i })).toBeNull();
  });
});
