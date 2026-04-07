import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecognitionResult } from "../types/api";

const emitMock = vi.fn(async () => undefined);
const primeAudioMock = vi.fn(async () => undefined);
const identifyMock = vi.fn();
const identifyByCpfMock = vi.fn();
const mealCreateMock = vi.fn();
const getMealScheduleMock = vi.fn();

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    token: "test-token",
    user: { role: "funcionario" },
  }),
}));

vi.mock("../hooks/useFeedback", () => ({
  useFeedback: () => ({
    emit: emitMock,
    primeAudio: primeAudioMock,
  }),
}));

vi.mock("./CameraCapture", () => ({
  default: ({ onCapture }: { onCapture: (file: File) => void | Promise<void> }) => (
    <button
      type="button"
      onClick={() => {
        void onCapture(new File(["face"], "capture.jpg", { type: "image/jpeg" }));
      }}
    >
      Capturar mock
    </button>
  ),
}));

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  recognitionApi: {
    identify: (...args: unknown[]) => identifyMock(...args),
    identifyByCpf: (...args: unknown[]) => identifyByCpfMock(...args),
  },
  mealEntriesApi: {
    create: (...args: unknown[]) => mealCreateMock(...args),
  },
  settingsApi: {
    getMealSchedule: (...args: unknown[]) => getMealScheduleMock(...args),
  },
}));

import IdentificationPanel from "./IdentificationPanel";

function buildRecognitionResult(overrides: Partial<RecognitionResult>): RecognitionResult {
  return {
    status: "not_found",
    matched: false,
    confidence: null,
    threshold: 0.9,
    message: "Nenhum aluno foi confirmado.",
    meal_type: "almoco",
    already_recorded_today: false,
    already_recorded_message: null,
    student: null,
    ...overrides,
  };
}

async function goToResultScreen(mealButtonName: RegExp = /almo/i) {
  await waitFor(() => {
    expect(screen.getByRole("button", { name: mealButtonName })).toBeTruthy();
  });
  fireEvent.click(screen.getByRole("button", { name: mealButtonName }));
  fireEvent.click(screen.getByRole("button", { name: /abrir c/i }));
  fireEvent.click(screen.getByRole("button", { name: /capturar mock/i }));
  await screen.findByRole("button", { name: /validar com cpf/i });
}

describe("IdentificationPanel", () => {
  beforeEach(() => {
    emitMock.mockClear();
    primeAudioMock.mockClear();
    identifyMock.mockReset();
    identifyByCpfMock.mockReset();
    mealCreateMock.mockReset();
    getMealScheduleMock.mockReset();
    getMealScheduleMock.mockResolvedValue({
      profiles: ["funcionario", "coordenadora"],
      meals: {
        almoco: { enabled: true, windows: [{ start: "00:00", end: "23:59" }] },
        merenda: { enabled: true, windows: [{ start: "00:00", end: "23:59" }] },
        sem_rodizio: { enabled: false, windows: [] },
      },
    });
  });

  it("abre modal, valida CPF e preenche resultado manual quando encontra aluno", async () => {
    identifyMock.mockResolvedValueOnce(
      buildRecognitionResult({
        status: "not_found",
        message: "Nenhum rosto detectado na imagem enviada.",
      }),
    );

    identifyByCpfMock.mockResolvedValueOnce(
      buildRecognitionResult({
        status: "low_confidence",
        matched: true,
        message: "Aluno localizado por CPF. Conferencia manual obrigatoria.",
        student: {
          id: "student-cpf",
          full_name: "MARIA CPF",
          class_id: "class-1",
          class_name: "A",
          class_display_name: "1 ano - A",
          school_year: "1 ano",
          photo_url: null,
        },
      }),
    );

    render(<IdentificationPanel />);
    await goToResultScreen();

    fireEvent.click(screen.getByRole("button", { name: /validar com cpf/i }));
    expect(screen.getByText(/valide a entrada com o cpf/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/cpf do aluno/i), { target: { value: "111.111.111-11" } });
    fireEvent.click(screen.getByRole("button", { name: /validar cpf/i }));
    expect(screen.getByText(/cpf v/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/cpf do aluno/i), { target: { value: "529.982.247-25" } });
    fireEvent.click(screen.getByRole("button", { name: /validar cpf/i }));

    await waitFor(() => {
      expect(screen.getByText("MARIA CPF")).toBeTruthy();
    });
  });

  it("volta para camera quando CPF nao e encontrado", async () => {
    identifyMock.mockResolvedValueOnce(
      buildRecognitionResult({
        status: "not_found",
        message: "Nenhum aluno foi confirmado.",
      }),
    );
    identifyByCpfMock.mockResolvedValueOnce(
      buildRecognitionResult({
        status: "not_found",
        message: "Aluno com esse CPF nao foi encontrado.",
      }),
    );

    render(<IdentificationPanel />);
    await goToResultScreen();

    fireEvent.click(screen.getByRole("button", { name: /validar com cpf/i }));
    fireEvent.change(screen.getByLabelText(/cpf do aluno/i), { target: { value: "529.982.247-25" } });
    fireEvent.click(screen.getByRole("button", { name: /validar cpf/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /capturar mock/i })).toBeTruthy();
    });
  });

  it("sem rodizio com falha facial abre resultado e permite validar com CPF para revisao rapida", async () => {
    identifyMock.mockResolvedValueOnce(
      buildRecognitionResult({
        status: "no_face_detected",
        message: "Nenhum rosto detectado na imagem enviada.",
        meal_type: "sem_rodizio",
      }),
    );

    identifyByCpfMock.mockResolvedValueOnce(
      buildRecognitionResult({
        status: "low_confidence",
        matched: true,
        meal_type: "sem_rodizio",
        message: "Aluno localizado por CPF. Conferencia manual obrigatoria.",
        student: {
          id: "student-sem-cpf",
          full_name: "JOAO SEM RODIZIO",
          class_id: "class-2",
          class_name: "B",
          class_display_name: "2 ano - B",
          school_year: "2 ano",
          photo_url: null,
        },
      }),
    );

    render(<IdentificationPanel />);
    await goToResultScreen(/sem rod/i);

    fireEvent.click(screen.getByRole("button", { name: /validar com cpf/i }));
    fireEvent.change(screen.getByLabelText(/cpf do aluno/i), { target: { value: "529.982.247-25" } });
    fireEvent.click(screen.getByRole("button", { name: /validar cpf/i }));

    await waitFor(() => {
      expect(screen.getByText(/confirmar valida/i)).toBeTruthy();
    });
    expect(screen.getByText("JOAO SEM RODIZIO")).toBeTruthy();
  });

  it("mostra Validar com CPF no modal compacto de sem rodizio", async () => {
    identifyMock.mockResolvedValueOnce(
      buildRecognitionResult({
        status: "low_confidence",
        matched: true,
        meal_type: "sem_rodizio",
        message: "Correspondencia com baixa confianca.",
        student: {
          id: "student-sem-compact",
          full_name: "ANA COMPACTA",
          class_id: "class-3",
          class_name: "C",
          class_display_name: "3 ano - C",
          school_year: "3 ano",
          photo_url: null,
        },
      }),
    );

    render(<IdentificationPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /sem rod/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /sem rod/i }));
    fireEvent.click(screen.getByRole("button", { name: /abrir c/i }));
    fireEvent.click(screen.getByRole("button", { name: /capturar mock/i }));

    await waitFor(() => {
      expect(screen.getByText("ANA COMPACTA")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /validar com cpf/i }));
    expect(screen.getByText(/valide a entrada com o cpf/i)).toBeTruthy();
  });

  it("nao renderiza botoes de refeicao enquanto horarios carregam", async () => {
    getMealScheduleMock.mockReturnValueOnce(new Promise(() => undefined));

    render(<IdentificationPanel />);

    expect(screen.getByText(/atualizando horarios/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /almo/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /merenda/i })).toBeNull();
  });

  it("exibe janela da refeicao e texto livre quando desabilitada", async () => {
    getMealScheduleMock.mockResolvedValueOnce({
      profiles: ["funcionario", "coordenadora"],
      meals: {
        almoco: { enabled: true, windows: [{ start: "00:00", end: "23:59" }] },
        merenda: { enabled: true, windows: [{ start: "10:00", end: "10:20" }] },
        sem_rodizio: { enabled: false, windows: [] },
      },
    });

    render(<IdentificationPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /almo/i })).toBeTruthy();
    });

    expect(screen.getByText(/das 00:00 as 23:59/i)).toBeTruthy();
    expect(screen.getByText(/livre o dia todo/i)).toBeTruthy();
  });

  it("atualiza opcoes automaticamente na virada do horario", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-03-29T15:19:00.000Z"));
      getMealScheduleMock.mockResolvedValueOnce({
        profiles: ["funcionario", "coordenadora"],
        meals: {
          almoco: { enabled: true, windows: [{ start: "12:20", end: "14:20" }] },
          merenda: { enabled: true, windows: [{ start: "10:00", end: "10:10" }] },
          sem_rodizio: { enabled: true, windows: [{ start: "07:00", end: "07:05" }] },
        },
      });

      render(<IdentificationPanel />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByText(/nenhuma refeicao disponivel neste horario/i)).toBeTruthy();
      expect(screen.queryByRole("button", { name: /almo/i })).toBeNull();

      vi.setSystemTime(new Date("2026-03-29T15:20:10.000Z"));
      await act(async () => {
        vi.advanceTimersByTime(30000);
        await Promise.resolve();
      });

      expect(screen.getByRole("button", { name: /almo/i })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("oculta opcoes de refeicao fora do horario e mostra estado vazio", async () => {
    getMealScheduleMock.mockResolvedValueOnce({
      profiles: ["funcionario", "coordenadora"],
      meals: {
        almoco: { enabled: true, windows: [] },
        merenda: { enabled: true, windows: [] },
        sem_rodizio: { enabled: true, windows: [] },
      },
    });

    render(<IdentificationPanel />);
    await waitFor(() => {
      expect(screen.getByText(/nenhuma refeicao disponivel neste horario/i)).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /almo/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /merenda/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /sem rod/i })).toBeNull();
  });

  it("exibe o botao Excecao apenas quando almoco esta selecionado", async () => {
    render(<IdentificationPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /merenda/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /merenda/i }));
    expect(screen.queryByRole("button", { name: /excecao/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /trocar refei/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /almo/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /almo/i }));
    expect(screen.getByRole("button", { name: /excecao/i })).toBeTruthy();
  });

  it("fluxo de excecao por CPF so confirma com checkbox e salva source excecao", async () => {
    identifyByCpfMock.mockResolvedValueOnce(
      buildRecognitionResult({
        status: "low_confidence",
        matched: true,
        meal_type: "almoco",
        message: "Aluno localizado por CPF. Conferencia manual obrigatoria.",
        student: {
          id: "student-exception",
          full_name: "ALUNO EXCECAO",
          class_id: "class-1",
          class_name: "A",
          class_display_name: "1 ano - A",
          school_year: "1 ano",
          photo_url: null,
        },
      }),
    );
    mealCreateMock.mockResolvedValueOnce({
      id: "entry-1",
    });

    render(<IdentificationPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /almo/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /almo/i }));
    fireEvent.click(screen.getByRole("button", { name: /excecao/i }));
    fireEvent.click(screen.getByRole("button", { name: /cpf validar aluno/i }));

    fireEvent.change(screen.getByLabelText(/cpf do aluno/i), { target: { value: "529.982.247-25" } });
    fireEvent.click(screen.getByRole("button", { name: /confirmar cpf/i }));

    await waitFor(() => {
      expect(screen.getByText("ALUNO EXCECAO")).toBeTruthy();
    });

    const confirmButton = screen.getByRole("button", { name: /confirmar excecao/i });
    expect(confirmButton).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByLabelText(/confirmo que este e o aluno correto/i));
    expect(confirmButton).toHaveProperty("disabled", false);
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mealCreateMock).toHaveBeenCalledWith(
        "test-token",
        expect.objectContaining({
          student_id: "student-exception",
          meal_type: "almoco",
          source: "excecao",
        }),
      );
    });
  });

  it("fluxo de excecao por camera mostra erro e permite tentar novamente", async () => {
    identifyMock.mockResolvedValueOnce(
      buildRecognitionResult({
        status: "no_face_detected",
        meal_type: "almoco",
        message: "Nenhum rosto detectado na imagem enviada.",
      }),
    );

    render(<IdentificationPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /almo/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /almo/i }));
    fireEvent.click(screen.getByRole("button", { name: /excecao/i }));
    fireEvent.click(screen.getByRole("button", { name: /camera validar aluno/i }));
    fireEvent.click(screen.getByRole("button", { name: /capturar mock/i }));

    await waitFor(() => {
      expect(screen.getByText(/nenhum rosto detectado/i)).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /tentar novamente/i })).toBeTruthy();
  });
});
