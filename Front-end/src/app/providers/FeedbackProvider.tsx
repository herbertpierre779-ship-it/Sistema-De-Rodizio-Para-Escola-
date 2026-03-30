import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import {
  buildFeedbackSpeechText,
  feedbackEventMap,
  getDefaultFeedbackPreferences,
  pickFeedbackSound,
  resolveFeedbackAssetPath,
  type FeedbackEventId,
  type FeedbackPayload,
  type FeedbackPreferences,
} from "../lib/feedback";

type FeedbackContextValue = {
  preferences: FeedbackPreferences;
  primeAudio: () => Promise<void>;
  emit: (eventId: FeedbackEventId, payload?: FeedbackPayload) => Promise<void>;
};

export const FeedbackContext = createContext<FeedbackContextValue | null>(null);

const EMIT_DEDUPE_WINDOW_MS = 700;
const SPEECH_DELAY_MS = 120;
const SILENT_AUDIO_DATA_URI =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export function FeedbackProvider({ children }: PropsWithChildren) {
  const [preferences] = useState<FeedbackPreferences>(() => getDefaultFeedbackPreferences());
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const emitRegistryRef = useRef<Map<string, number>>(new Map());
  const preferencesRef = useRef(preferences);
  const speechTimeoutRef = useRef<number | null>(null);
  const audioUnlockedRef = useRef(false);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  const ensureAudioElement = useCallback(() => {
    if (typeof Audio === "undefined") {
      return null;
    }

    if (!audioElementRef.current) {
      audioElementRef.current = new Audio();
      audioElementRef.current.preload = "auto";
    }

    return audioElementRef.current;
  }, []);

  const ensureAudioContext = useCallback(async () => {
    if (typeof window === "undefined") {
      return null;
    }

    const AudioContextConstructor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextConstructor) {
      return null;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextConstructor();
    }

    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume().catch(() => undefined);
    }

    return audioContextRef.current;
  }, []);

  const resolvePreferredVoice = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      voiceRef.current = null;
      return null;
    }

    const synth = window.speechSynthesis;
    if (!synth) {
      voiceRef.current = null;
      return null;
    }

    const voices = synth.getVoices();
    if (voices.length === 0) {
      voiceRef.current = null;
      return null;
    }

    const preferredVoice = [...voices].sort((left, right) => scoreVoice(right) - scoreVoice(left))[0] ?? null;
    voiceRef.current = preferredVoice;
    return preferredVoice;
  }, []);

  const playSound = useCallback(
    async (eventId: FeedbackEventId) => {
      if (!preferencesRef.current.soundEnabled) {
        return;
      }

      const selectedSound = pickFeedbackSound(eventId);
      if (!selectedSound) {
        return;
      }

      try {
        const audioContext = await ensureAudioContext();
        if (audioContext?.state === "running") {
          const assetPath = resolveFeedbackAssetPath(selectedSound);
          let decodedBuffer = audioBufferCacheRef.current.get(assetPath);

          if (!decodedBuffer) {
            const response = await fetch(assetPath);
            if (!response.ok) {
              throw new Error("feedback-audio-fetch-failed");
            }

            const arrayBuffer = await response.arrayBuffer();
            decodedBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
            audioBufferCacheRef.current.set(assetPath, decodedBuffer);
          }

          const source = audioContext.createBufferSource();
          const gain = audioContext.createGain();
          gain.gain.value = 1;
          source.buffer = decodedBuffer;
          source.connect(gain);
          gain.connect(audioContext.destination);
          source.start(0);
          audioUnlockedRef.current = true;
          return;
        }
      } catch {
        audioUnlockedRef.current = false;
      }

      const audioElement = ensureAudioElement();
      if (!audioElement) {
        return;
      }

      try {
        audioElement.pause();
        audioElement.currentTime = 0;
        audioElement.src = resolveFeedbackAssetPath(selectedSound);
        if (typeof audioElement.load === "function") {
          audioElement.load();
        }
        const playback = audioElement.play();
        if (playback) {
          await playback;
        }
        audioUnlockedRef.current = true;
      } catch {
        audioUnlockedRef.current = false;
      }
    },
    [ensureAudioElement],
  );

  const speakText = useCallback(
    (eventId: FeedbackEventId, payload?: FeedbackPayload) => {
      const config = feedbackEventMap[eventId];
      if (!config?.speech || !preferencesRef.current.speechEnabled) {
        return;
      }

      const text = buildFeedbackSpeechText(eventId, payload);
      if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) {
        return;
      }

      if (typeof SpeechSynthesisUtterance === "undefined") {
        return;
      }

      const synth = window.speechSynthesis;
      if (!synth) {
        return;
      }
      const selectedVoice = resolvePreferredVoice();

      try {
        synth.cancel();

        if (speechTimeoutRef.current !== null) {
          window.clearTimeout(speechTimeoutRef.current);
        }

        speechTimeoutRef.current = window.setTimeout(() => {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = "pt-BR";
          utterance.rate = 0.96;
          utterance.pitch = 1;
          utterance.volume = 1;
          if (selectedVoice) {
            utterance.voice = selectedVoice;
          }
          utterance.onerror = () => undefined;
          synth.speak(utterance);
        }, SPEECH_DELAY_MS);
      } catch {
        return;
      }
    },
    [resolvePreferredVoice],
  );

  const primeAudio = useCallback(async () => {
      if (!preferencesRef.current.soundEnabled) {
        return;
      }

      try {
        const audioContext = await ensureAudioContext();
        if (audioContext) {
          const oscillator = audioContext.createOscillator();
          const gain = audioContext.createGain();
          gain.gain.value = 0.00001;
          oscillator.connect(gain);
          gain.connect(audioContext.destination);
          oscillator.start();
          oscillator.stop(audioContext.currentTime + 0.02);
          audioUnlockedRef.current = true;
          return;
        }
      } catch {
        audioUnlockedRef.current = false;
      }

      const audioElement = ensureAudioElement();
      if (!audioElement) {
        return;
      }

      try {
        audioElement.pause();
        audioElement.currentTime = 0;
        audioElement.src = SILENT_AUDIO_DATA_URI;
        audioElement.muted = true;
        audioElement.volume = 0;
        if (typeof audioElement.load === "function") {
          audioElement.load();
        }
        const playback = audioElement.play();
        if (playback) {
          await playback;
        }
        audioElement.pause();
        audioElement.currentTime = 0;
        audioUnlockedRef.current = true;
      } catch {
        audioUnlockedRef.current = false;
      } finally {
        audioElement.muted = false;
        audioElement.volume = 1;
      }
  }, [ensureAudioContext, ensureAudioElement]);

  const emit = useCallback(
    async (eventId: FeedbackEventId, payload: FeedbackPayload = {}) => {
      const dedupeBase =
        payload.dedupeKey ??
        buildFeedbackSpeechText(eventId, payload) ??
        pickFeedbackSound(eventId) ??
        eventId;
      const fingerprint = `${eventId}:${dedupeBase}`;
      const now = Date.now();
      const lastEmission = emitRegistryRef.current.get(fingerprint);

      if (lastEmission && now - lastEmission < EMIT_DEDUPE_WINDOW_MS) {
        return;
      }

      emitRegistryRef.current.set(fingerprint, now);
      await playSound(eventId);
      speakText(eventId, payload);
    },
    [playSound, speakText],
  );

  useEffect(() => {
    resolvePreferredVoice();

    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    const synth = window.speechSynthesis;
    if (!synth) {
      return;
    }
    const handleVoicesChanged = () => {
      resolvePreferredVoice();
    };

    synth.addEventListener?.("voiceschanged", handleVoicesChanged);
    return () => {
      synth.removeEventListener?.("voiceschanged", handleVoicesChanged);
    };
  }, [resolvePreferredVoice]);

  useEffect(() => {
    if (typeof document === "undefined" || audioUnlockedRef.current || !preferences.soundEnabled) {
      return;
    }

    const handleInteraction = () => {
      if (audioUnlockedRef.current) {
        return;
      }
      void primeAudio();
    };

    document.addEventListener("pointerdown", handleInteraction, { passive: true });
    document.addEventListener("touchstart", handleInteraction, { passive: true });
    document.addEventListener("keydown", handleInteraction);

    return () => {
      document.removeEventListener("pointerdown", handleInteraction);
      document.removeEventListener("touchstart", handleInteraction);
      document.removeEventListener("keydown", handleInteraction);
    };
  }, [preferences.soundEnabled, primeAudio]);

  useEffect(() => {
    return () => {
      if (speechTimeoutRef.current !== null) {
        window.clearTimeout(speechTimeoutRef.current);
      }

      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis?.cancel();
      }

      audioElementRef.current?.pause();
      void audioContextRef.current?.close?.();
    };
  }, []);

  const value = useMemo<FeedbackContextValue>(
    () => ({
      preferences,
      primeAudio,
      emit,
    }),
    [emit, preferences, primeAudio],
  );

  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>;
}

function scoreVoice(voice: SpeechSynthesisVoice) {
  const normalizedLang = voice.lang.toLowerCase();
  const normalizedName = voice.name.toLowerCase();
  let score = 0;

  if (normalizedLang === "pt-br") {
    score += 100;
  } else if (normalizedLang.startsWith("pt")) {
    score += 50;
  }

  if (voice.default) {
    score += 20;
  }

  if (
    normalizedName.includes("portugu") ||
    normalizedName.includes("brasil") ||
    normalizedName.includes("brazil") ||
    normalizedName.includes("francisca") ||
    normalizedName.includes("maria") ||
    normalizedName.includes("luciana")
  ) {
    score += 10;
  }

  return score;
}
