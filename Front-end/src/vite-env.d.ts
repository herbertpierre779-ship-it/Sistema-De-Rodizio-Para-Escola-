/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FEEDBACK_SOUND_ENABLED?: string;
  readonly VITE_FEEDBACK_SPEECH_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
