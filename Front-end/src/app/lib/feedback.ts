import type { MealType } from "../types/api";

export type FeedbackSelectionMode = "single" | "random";

export type FeedbackEventId =
  | "notification.generic"
  | "recognition.not_found"
  | "recognition.rejected"
  | "recognition.confirmed"
  | "recognition.duplicate"
  | "student.registered"
  | "sem_rodizio.first_confirmed"
  | "sem_rodizio.repeat_confirmed";

export type FeedbackEventConfig = {
  sounds: string[];
  selection: FeedbackSelectionMode;
  speech: boolean;
  priority: number;
};

export type FeedbackPreferences = {
  soundEnabled: boolean;
  speechEnabled: boolean;
};

export type FeedbackPayload = {
  studentName?: string;
  mealType?: MealType;
  speechText?: string;
  dedupeKey?: string;
};

export const feedbackEventMap: Record<FeedbackEventId, FeedbackEventConfig> = {
  "notification.generic": {
    sounds: [],
    selection: "single",
    speech: false,
    priority: 1,
  },
  "recognition.not_found": {
    sounds: ["error_CDOxCYm.mp3"],
    selection: "single",
    speech: false,
    priority: 3,
  },
  "recognition.rejected": {
    sounds: ["error_CDOxCYm.mp3"],
    selection: "single",
    speech: false,
    priority: 3,
  },
  "recognition.confirmed": {
    sounds: ["plimplim.mp3"],
    selection: "single",
    speech: false,
    priority: 4,
  },
  "recognition.duplicate": {
    sounds: [],
    selection: "single",
    speech: true,
    priority: 4,
  },
  "student.registered": {
    sounds: [],
    selection: "single",
    speech: false,
    priority: 4,
  },
  "sem_rodizio.first_confirmed": {
    sounds: ["plimplim.mp3"],
    selection: "single",
    speech: false,
    priority: 4,
  },
  "sem_rodizio.repeat_confirmed": {
    sounds: [],
    selection: "single",
    speech: false,
    priority: 4,
  },
};

export function resolveFeedbackAssetPath(fileName: string) {
  const baseUrl = import.meta.env.BASE_URL || "/";

  if (typeof window === "undefined") {
    return `${baseUrl}${fileName}`;
  }

  return new URL(fileName, `${window.location.origin}${baseUrl}`).toString();
}

export function getDefaultFeedbackPreferences(): FeedbackPreferences {
  return {
    soundEnabled: readBooleanEnv(import.meta.env.VITE_FEEDBACK_SOUND_ENABLED, true),
    speechEnabled: readBooleanEnv(import.meta.env.VITE_FEEDBACK_SPEECH_ENABLED, true),
  };
}

export function pickFeedbackSound(eventId: FeedbackEventId, random = Math.random) {
  const config = feedbackEventMap[eventId];
  if (!config || config.sounds.length === 0) {
    return null;
  }

  if (config.selection === "random" && config.sounds.length > 1) {
    const index = Math.max(0, Math.floor(random() * config.sounds.length)) % config.sounds.length;
    return config.sounds[index];
  }

  return config.sounds[0];
}

export function buildFeedbackSpeechText(eventId: FeedbackEventId, payload: FeedbackPayload = {}) {
  if (payload.speechText) {
    return payload.speechText;
  }

  const studentName = getStudentCallName(payload.studentName);

  switch (eventId) {
    case "recognition.duplicate":
      if (payload.mealType === "almoco") {
        return `Aluno ${studentName} já almoçou.`;
      }
      if (payload.mealType === "merenda") {
        return `Aluno ${studentName} já merendou.`;
      }
      return null;
    case "notification.generic":
    case "recognition.not_found":
    case "recognition.rejected":
    case "recognition.confirmed":
    case "student.registered":
    case "sem_rodizio.first_confirmed":
    case "sem_rodizio.repeat_confirmed":
      return null;
  }
}

function getStudentCallName(fullName?: string) {
  if (!fullName) {
    return "Aluno";
  }

  return fullName.trim().split(/\s+/)[0] || fullName;
}

function readBooleanEnv(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === null || value.trim() === "") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}
