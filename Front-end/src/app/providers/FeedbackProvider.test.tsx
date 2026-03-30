import type { PropsWithChildren } from "react";
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFeedback } from "../hooks/useFeedback";
import { FeedbackProvider } from "./FeedbackProvider";

type MockAudioElement = {
  src: string;
  muted: boolean;
  volume: number;
  currentTime: number;
  preload: string;
  pause: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
};

class MockSpeechSynthesisUtterance {
  text: string;
  lang = "";
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;
  onerror: (() => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

const audioInstances: MockAudioElement[] = [];
const speechVoices = [
  { lang: "pt-BR", name: "Google português do Brasil", default: true },
  { lang: "en-US", name: "English", default: false },
] as SpeechSynthesisVoice[];

let playImplementation: () => Promise<void>;
let speechSynthesisMock: {
  getVoices: ReturnType<typeof vi.fn>;
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

function wrapper({ children }: PropsWithChildren) {
  return <FeedbackProvider>{children}</FeedbackProvider>;
}

describe("FeedbackProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    audioInstances.length = 0;
    playImplementation = () => Promise.resolve();

    class MockAudio {
      src = "";
      muted = false;
      volume = 1;
      currentTime = 0;
      preload = "";
      pause = vi.fn();
      load = vi.fn();
      play = vi.fn(() => playImplementation());

      constructor() {
        audioInstances.push(this as unknown as MockAudioElement);
      }
    }

    vi.stubGlobal("Audio", MockAudio);

    speechSynthesisMock = {
      getVoices: vi.fn(() => speechVoices),
      speak: vi.fn(),
      cancel: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: speechSynthesisMock,
    });
    vi.stubGlobal("SpeechSynthesisUtterance", MockSpeechSynthesisUtterance);
    vi.stubEnv("VITE_FEEDBACK_SOUND_ENABLED", "true");
    vi.stubEnv("VITE_FEEDBACK_SPEECH_ENABLED", "true");
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    window.localStorage.clear();
  });

  it("não toca som para notificação genérica", async () => {
    const { result } = renderHook(() => useFeedback(), { wrapper });

    await act(async () => {
      await result.current.emit("notification.generic", { dedupeKey: "generic-toast" });
    });

    expect(audioInstances).toHaveLength(0);
    expect(speechSynthesisMock.speak).not.toHaveBeenCalled();
  });

  it("toca som de erro sem usar voz quando o reconhecimento não encontra aluno", async () => {
    const { result } = renderHook(() => useFeedback(), { wrapper });

    await act(async () => {
      await result.current.emit("recognition.not_found", { dedupeKey: "not-found" });
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(audioInstances[0].src).toContain("error_CDOxCYm.mp3");
    expect(speechSynthesisMock.speak).not.toHaveBeenCalled();
  });

  it("toca plimplim na confirmação sem usar voz", async () => {
    const { result } = renderHook(() => useFeedback(), { wrapper });

    await act(async () => {
      await result.current.emit("recognition.confirmed", {
        studentName: "MARIA DAS DORES",
        mealType: "almoco",
        dedupeKey: "confirmed-1",
      });
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(audioInstances[0].src).toContain("plimplim.mp3");
    expect(speechSynthesisMock.speak).not.toHaveBeenCalled();
  });

  it("fala a duplicidade de almoço sem tocar som adicional", async () => {
    const { result } = renderHook(() => useFeedback(), { wrapper });

    await act(async () => {
      await result.current.emit("recognition.duplicate", {
        studentName: "MARIA DAS DORES",
        mealType: "almoco",
        dedupeKey: "duplicate-lunch",
      });
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(audioInstances).toHaveLength(0);
    expect(speechSynthesisMock.speak).toHaveBeenCalledTimes(1);
    const utterance = speechSynthesisMock.speak.mock.calls[0][0] as MockSpeechSynthesisUtterance;
    expect(utterance.text).toBe("Aluno MARIA já almoçou.");
  });

  it("não toca som nem voz na segunda validação de sem rodízio", async () => {
    const { result } = renderHook(() => useFeedback(), { wrapper });

    await act(async () => {
      await result.current.emit("sem_rodizio.repeat_confirmed", {
        studentName: "JOÃO PEREIRA",
        mealType: "sem_rodizio",
        dedupeKey: "sem-repeat-1",
      });
    });

    expect(audioInstances).toHaveLength(0);
    expect(speechSynthesisMock.speak).not.toHaveBeenCalled();
  });

  it("usa o .env como fonte de verdade para som e voz", async () => {
    vi.stubEnv("VITE_FEEDBACK_SOUND_ENABLED", "false");
    vi.stubEnv("VITE_FEEDBACK_SPEECH_ENABLED", "false");

    const { result } = renderHook(() => useFeedback(), { wrapper });

    await act(async () => {
      await result.current.emit("recognition.confirmed", {
        studentName: "ANA LIMA",
        mealType: "merenda",
        dedupeKey: "env-disabled",
      });
    });

    expect(result.current.preferences.soundEnabled).toBe(false);
    expect(result.current.preferences.speechEnabled).toBe(false);
    expect(audioInstances).toHaveLength(0);
    expect(speechSynthesisMock.speak).not.toHaveBeenCalled();
  });

  it("faz o prime de áudio sem usar um som real de feedback", async () => {
    const { result } = renderHook(() => useFeedback(), { wrapper });

    await act(async () => {
      await result.current.primeAudio();
    });

    expect(audioInstances).toHaveLength(1);
    expect(audioInstances[0].src).not.toContain("plimplim.mp3");
  });

  it("não duplica som no mesmo evento com a mesma deduplicação", async () => {
    const { result } = renderHook(() => useFeedback(), { wrapper });

    await act(async () => {
      await result.current.emit("recognition.confirmed", { dedupeKey: "dup-key" });
      await result.current.emit("recognition.confirmed", { dedupeKey: "dup-key" });
    });

    expect(audioInstances[0].play).toHaveBeenCalledTimes(1);
  });

  it("continua funcionando quando o play do áudio falha", async () => {
    playImplementation = () => Promise.reject(new DOMException("blocked", "NotAllowedError"));
    const { result } = renderHook(() => useFeedback(), { wrapper });

    await expect(
      act(async () => {
        await result.current.emit("recognition.confirmed", { dedupeKey: "blocked-audio" });
      }),
    ).resolves.toBeUndefined();

    expect(audioInstances[0].play).toHaveBeenCalledTimes(1);
  });

  it("continua funcionando sem speechSynthesis disponível", async () => {
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: undefined,
    });

    const { result } = renderHook(() => useFeedback(), { wrapper });

    await act(async () => {
      await result.current.emit("recognition.confirmed", {
        studentName: "ANA LIMA",
        mealType: "merenda",
        dedupeKey: "no-speech-api",
      });
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(audioInstances[0].src).toContain("plimplim.mp3");
  });
});
