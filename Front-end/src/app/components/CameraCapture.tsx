import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Camera, CameraOff, CheckCircle2, FlipHorizontal2, RefreshCcw, ScanFace, Users, Video } from "lucide-react";

export type CameraGuideDirection = "center" | "left" | "right" | "up" | "down";
export type FaceGuardMode = "off" | "hint" | "required";
type CameraFacingMode = "environment" | "user";

type CameraCaptureProps = {
  mode: "manual" | "auto" | "hybrid";
  isBusy?: boolean;
  onCapture: (file: File) => void | Promise<void>;
  onCancel?: () => void;
  guideDirection?: CameraGuideDirection;
  guideBadge?: string;
  guideTitle?: string;
  guideInstruction?: string;
  faceGuardMode?: FaceGuardMode;
  uiVariant?: "default" | "registration";
  captureInteraction?: "tap" | "hold";
  captureIntervalMs?: number;
  captureCooldownMs?: number;
  initialFacingMode?: CameraFacingMode;
  onFacingModeChange?: (nextFacingMode: CameraFacingMode) => void;
};

type CameraPhase = "requesting" | "ready" | "stabilizing" | "capturing" | "error";
type FaceStatus = "unsupported" | "searching" | "aligned" | "offframe" | "missing" | "multiple";
type DetectorSource = "none" | "native" | "mediapipe";
type FaceBox = { x: number; y: number; width: number; height: number };
type DetectFace = { boundingBox?: FaceBox };
type FaceState = {
  detectorAvailable: boolean;
  detectorSource: DetectorSource;
  status: FaceStatus;
  aligned: boolean;
  stableCount: number;
  message: string;
  box: FaceBox | null;
  frameWidth: number;
  frameHeight: number;
};
type Detector = {
  source: DetectorSource;
  detect: (video: HTMLVideoElement) => Promise<DetectFace[]>;
  dispose?: () => void;
};
type WindowWithFaceDetector = Window &
  typeof globalThis & {
    FaceDetector?: new (options?: { fastMode?: boolean; maxDetectedFaces?: number }) => {
      detect: (video: HTMLVideoElement) => Promise<Array<{ boundingBox?: FaceBox }>>;
    };
  };

const MP_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MP_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

const baseState = (
  status: FaceStatus,
  source: DetectorSource,
  detectorAvailable: boolean,
  stableCount = 0,
  box: FaceBox | null = null,
  frameWidth = 0,
  frameHeight = 0,
): FaceState => ({
  detectorAvailable,
  detectorSource: source,
  status,
  aligned: status === "aligned" || !detectorAvailable,
  stableCount,
  box,
  frameWidth,
  frameHeight,
  message: !detectorAvailable
    ? "Pré-checagem visual indisponível neste navegador."
    : status === "aligned"
      ? "Rosto alinhado para captura."
      : status === "offframe"
        ? "Centralize o rosto dentro da moldura."
        : status === "missing"
          ? "Nenhum rosto detectado."
          : status === "multiple"
            ? "Deixe apenas um rosto na câmera."
            : `Procurando um rosto válido${source === "mediapipe" ? " (MediaPipe)" : ""}.`,
});

const normalizeBox = (raw: unknown): FaceBox | null => {
  if (!raw || typeof raw !== "object") return null;
  const box = raw as Record<string, unknown>;
  const x = Number(box.x ?? box.originX ?? 0);
  const y = Number(box.y ?? box.originY ?? 0);
  const width = Number(box.width ?? 0);
  const height = Number(box.height ?? 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
};

const evaluateFaces = (
  faces: DetectFace[],
  frameWidth: number,
  frameHeight: number,
  source: DetectorSource,
  prevStable: number,
): FaceState => {
  if (faces.length === 0) return baseState("missing", source, true);
  if (faces.length > 1) return baseState("multiple", source, true);
  const box = faces[0].boundingBox;
  if (!box) return baseState("searching", source, true);

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const ox = Math.abs(cx - frameWidth / 2) / frameWidth;
  const oy = Math.abs(cy - frameHeight / 2) / frameHeight;
  const area = (box.width * box.height) / (frameWidth * frameHeight);
  const inside =
    box.x > frameWidth * 0.05 &&
    box.y > frameHeight * 0.05 &&
    box.x + box.width < frameWidth * 0.95 &&
    box.y + box.height < frameHeight * 0.95;

  if (!inside || ox > 0.22 || oy > 0.24 || area < 0.05 || area > 0.8) {
    return baseState("offframe", source, true, 0, box, frameWidth, frameHeight);
  }
  return baseState("aligned", source, true, prevStable + 1, box, frameWidth, frameHeight);
};

function statusForMode(mode: CameraCaptureProps["mode"]) {
  return mode === "manual" ? "Câmera pronta." : "Aguardando estabilidade.";
}

function buildConstraints(preferred: "environment" | "user"): MediaTrackConstraints[] {
  const fallback = preferred === "environment" ? "user" : "environment";
  return [
    { facingMode: { ideal: preferred }, width: { ideal: 1280 }, height: { ideal: 720 } },
    { facingMode: { ideal: fallback }, width: { ideal: 1280 }, height: { ideal: 720 } },
    { width: { ideal: 1280 }, height: { ideal: 720 } },
    {},
  ];
}

export default function CameraCapture({
  mode,
  isBusy = false,
  onCapture,
  onCancel,
  guideBadge,
  guideTitle,
  guideInstruction,
  faceGuardMode = mode === "manual" ? "hint" : "required",
  uiVariant = "default",
  captureInteraction = "tap",
  captureIntervalMs = 280,
  captureCooldownMs = 900,
  initialFacingMode = "environment",
  onFacingModeChange,
}: CameraCaptureProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<Detector | null>(null);
  const detectorPromiseRef = useRef<Promise<Detector | null> | null>(null);
  const inFlightRef = useRef(false);
  const detectingRef = useRef(false);
  const cooldownRef = useRef(0);
  const mountedRef = useRef(true);
  const faceRef = useRef<FaceState>(baseState("unsupported", "none", false));

  const [phase, setPhase] = useState<CameraPhase>("requesting");
  const [statusMessage, setStatusMessage] = useState("Solicitando acesso à câmera...");
  const [errorMessage, setErrorMessage] = useState("");
  const [facingMode, setFacingMode] = useState<CameraFacingMode>(initialFacingMode);
  const [restartKey, setRestartKey] = useState(0);
  const [face, setFace] = useState<FaceState>(baseState("unsupported", "none", false));
  const [isHolding, setIsHolding] = useState(false);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });

  const strict = faceGuardMode === "required";
  const faceReady = faceGuardMode === "off" || !face.detectorAvailable || (face.aligned && face.stableCount >= 2);
  const manualDisabled = mode === "manual" && strict && !faceReady;

  const setFaceSafe = useCallback((next: FaceState) => {
    faceRef.current = next;
    setFace((current) =>
      current.status === next.status &&
      current.stableCount === next.stableCount &&
      current.detectorSource === next.detectorSource &&
      current.message === next.message &&
      current.frameWidth === next.frameWidth &&
      current.frameHeight === next.frameHeight &&
      current.box?.x === next.box?.x &&
      current.box?.y === next.box?.y &&
      current.box?.width === next.box?.width &&
      current.box?.height === next.box?.height
        ? current
        : next,
    );
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const ensureDetector = useCallback(async (): Promise<Detector | null> => {
    if (detectorRef.current) return detectorRef.current;
    if (detectorPromiseRef.current) return detectorPromiseRef.current;

    detectorPromiseRef.current = (async () => {
      const Native = (window as WindowWithFaceDetector).FaceDetector;
      if (Native) {
        try {
          const nativeDetector = new Native({ fastMode: true, maxDetectedFaces: 4 });
          const wrapped: Detector = {
            source: "native",
            detect: async (video) =>
              (await nativeDetector.detect(video)).map((item) => ({
                boundingBox: normalizeBox(item.boundingBox) ?? undefined,
              })),
          };
          detectorRef.current = wrapped;
          return wrapped;
        } catch {}
      }

      try {
        const mp = await import("@mediapipe/tasks-vision");
        const vision = await mp.FilesetResolver.forVisionTasks(MP_WASM);
        const mpDetector = await mp.FaceDetector.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MP_MODEL },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.5,
        });
        const wrapped: Detector = {
          source: "mediapipe",
          detect: async (video) => {
            const result = mpDetector.detectForVideo(video, performance.now()) as {
              detections?: Array<{ boundingBox?: unknown }>;
            };
            return (result.detections ?? [])
              .map((item) => ({ boundingBox: normalizeBox(item.boundingBox) ?? undefined }))
              .filter((item) => Boolean(item.boundingBox));
          },
          dispose: () => mpDetector.close(),
        };
        detectorRef.current = wrapped;
        return wrapped;
      } catch {
        return null;
      }
    })();

    const detector = await detectorPromiseRef.current;
    detectorPromiseRef.current = null;
    return detector;
  }, []);

  const captureFrame = useCallback(async () => {
    if (inFlightRef.current || isBusy || Date.now() < cooldownRef.current) return;
    if (strict && !faceReady) {
      setStatusMessage(faceRef.current.message);
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) return;

    // Revalidação imediata apenas quando o estado atual não estiver pronto.
    if (faceGuardMode !== "off" && (!faceRef.current.aligned || faceRef.current.stableCount < 2)) {
      const detector = await ensureDetector();
      if (detector) {
        try {
          const nowFaces = await detector.detect(video);
          const refreshed = evaluateFaces(
            nowFaces,
            video.videoWidth,
            video.videoHeight,
            detector.source,
            faceRef.current.status === "aligned" ? faceRef.current.stableCount : 0,
          );
          setFaceSafe(refreshed);
          if (refreshed.status !== "aligned") {
            setStatusMessage(refreshed.message);
            setPhase(mode === "manual" ? "ready" : "stabilizing");
            return;
          }
        } catch {
          // Mantém fallback para não travar captura se detector falhar pontualmente.
        }
      }
    }

    inFlightRef.current = true;
    setPhase("capturing");
    setStatusMessage("Capturando foto...");

    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.95),
      );
      if (!blob) return;
      await onCapture(new File([blob], `captura-${Date.now()}.jpg`, { type: "image/jpeg" }));
    } finally {
      inFlightRef.current = false;
      cooldownRef.current = Date.now() + captureCooldownMs;
      setPhase(mode === "manual" ? "ready" : "stabilizing");
      setStatusMessage(statusForMode(mode));
    }
  }, [
    captureCooldownMs,
    ensureDetector,
    faceGuardMode,
    faceReady,
    isBusy,
    mode,
    onCapture,
    setFaceSafe,
    strict,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopStream();
      detectorRef.current?.dispose?.();
      detectorRef.current = null;
    };
  }, [stopStream]);

  useEffect(() => {
    setFacingMode(initialFacingMode);
  }, [initialFacingMode]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const updateSize = () => {
      setFrameSize({ width: frame.clientWidth, height: frame.clientHeight });
    };

    updateSize();
    const observer = new ResizeObserver(() => updateSize());
    observer.observe(frame);
    window.addEventListener("resize", updateSize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  useEffect(() => {
    let active = true;

    const start = async () => {
      stopStream();
      setErrorMessage("");
      setPhase("requesting");
      setStatusMessage("Solicitando acesso à câmera...");

      const detector = await ensureDetector();
      if (!active || !mountedRef.current) return;
      setFaceSafe(
        detector
          ? baseState("searching", detector.source, true)
          : baseState("unsupported", "none", false),
      );

      try {
        let stream: MediaStream | null = null;
        for (const videoConstraints of buildConstraints(facingMode)) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: videoConstraints,
            });
            break;
          } catch {}
        }
        if (!stream) throw new Error("no-camera");

        const video = videoRef.current;
        if (!video) throw new Error("video-missing");

        streamRef.current = stream;
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();

        if (!active || !mountedRef.current) return;
        setPhase(mode === "manual" ? "ready" : "stabilizing");
        setStatusMessage(statusForMode(mode));
      } catch {
        if (!active || !mountedRef.current) return;
        setPhase("error");
        setErrorMessage("Não foi possível abrir a câmera. Verifique permissões e tente novamente.");
      }
    };

    void start();
    return () => {
      active = false;
      stopStream();
    };
  }, [ensureDetector, facingMode, mode, restartKey, setFaceSafe, stopStream]);

  useEffect(() => {
    if (phase !== "ready" && phase !== "stabilizing") return;
    let active = true;

    const run = async () => {
      if (!active || detectingRef.current || inFlightRef.current) return;
      const video = videoRef.current;
      if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

      detectingRef.current = true;
      try {
        const detector = await ensureDetector();
        if (!detector || !active) {
          if (active) setFaceSafe(baseState("unsupported", "none", false));
          return;
        }
        const faces = await detector.detect(video);
        if (!active) return;
        const next = evaluateFaces(
          faces,
          video.videoWidth,
          video.videoHeight,
          detector.source,
          faceRef.current.status === "aligned" ? faceRef.current.stableCount : 0,
        );
        setFaceSafe(next);
      } catch {
        if (active) setFaceSafe(baseState("unsupported", "none", false));
      } finally {
        detectingRef.current = false;
      }
    };

    void run();
    const interval = window.setInterval(() => {
      void run();
    }, 170);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [ensureDetector, phase, setFaceSafe]);

  useEffect(() => {
    if ((mode === "manual" && captureInteraction !== "hold") || !isHolding || isBusy) return;
    const interval = window.setInterval(() => {
      void captureFrame();
    }, Math.max(120, captureIntervalMs));
    return () => window.clearInterval(interval);
  }, [captureFrame, captureInteraction, captureIntervalMs, isBusy, isHolding, mode]);

  useEffect(() => {
    if (mode === "manual" || phase !== "stabilizing" || isBusy) return;
    const interval = window.setInterval(() => {
      if ((strict && !faceReady) || Date.now() < cooldownRef.current) return;
      void captureFrame();
    }, 240);
    return () => window.clearInterval(interval);
  }, [captureFrame, faceReady, isBusy, mode, phase, strict]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) return;
      event.preventDefault();
      void captureFrame();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [captureFrame]);

  const boxStyle = useMemo(() => {
    if (!face.box || !face.frameWidth || !face.frameHeight) return null;
    if (!frameSize.width || !frameSize.height) return null;

    const sourceWidth = face.frameWidth;
    const sourceHeight = face.frameHeight;
    const containerWidth = frameSize.width;
    const containerHeight = frameSize.height;

    const coverScale = Math.max(containerWidth / sourceWidth, containerHeight / sourceHeight);
    const drawWidth = sourceWidth * coverScale;
    const drawHeight = sourceHeight * coverScale;
    const offsetX = (containerWidth - drawWidth) / 2;
    const offsetY = (containerHeight - drawHeight) / 2;

    const rawLeft = offsetX + face.box.x * coverScale;
    const rawTop = offsetY + face.box.y * coverScale;
    const rawRight = rawLeft + face.box.width * coverScale;
    const rawBottom = rawTop + face.box.height * coverScale;

    const leftPx = Math.max(0, Math.min(containerWidth, rawLeft));
    const topPx = Math.max(0, Math.min(containerHeight, rawTop));
    const rightPx = Math.max(leftPx, Math.min(containerWidth, rawRight));
    const bottomPx = Math.max(topPx, Math.min(containerHeight, rawBottom));

    const widthPx = rightPx - leftPx;
    const heightPx = bottomPx - topPx;
    if (widthPx < 2 || heightPx < 2) return null;

    return {
      left: `${(leftPx / containerWidth) * 100}%`,
      top: `${(topPx / containerHeight) * 100}%`,
      width: `${(widthPx / containerWidth) * 100}%`,
      height: `${(heightPx / containerHeight) * 100}%`,
    };
  }, [face.box, face.frameHeight, face.frameWidth, frameSize.height, frameSize.width]);

  const isRegistrationUi = uiVariant === "registration";
  const holdButton = mode === "manual" && captureInteraction === "hold";
  const handleToggleFacingMode = () => {
    setFacingMode((value) => {
      const next = value === "environment" ? "user" : "environment";
      onFacingModeChange?.(next);
      return next;
    });
  };

  return (
    <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-slate-950 shadow-xl shadow-slate-300">
      <div
        className={`flex flex-wrap gap-2 border-b border-white/10 px-4 ${
          isRegistrationUi ? "justify-end py-2" : "items-center justify-between py-3"
        }`}
      >
        {!isRegistrationUi && (
          <div className="text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-200">
              {guideBadge ?? "Captura ao vivo"}
            </p>
            <p className="text-sm font-black">{guideTitle ?? "Câmera"}</p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setRestartKey((value) => value + 1)}
            className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white"
          >
            <RefreshCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleToggleFacingMode}
            className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white"
          >
            <FlipHorizontal2 className="h-4 w-4" />
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white"
            >
              <CameraOff className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className={`bg-[radial-gradient(circle_at_top,#164e63_0%,#020617_70%)] ${isRegistrationUi ? "p-2" : "p-3"}`}>
        <div ref={frameRef} className="relative mx-auto aspect-[3/4] w-full max-w-xl overflow-hidden rounded-[1.75rem] border border-cyan-300/30 bg-black">
          <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(15,23,42,0)_40%,rgba(15,23,42,0.38)_100%)]" />
          {boxStyle && (
            <div
              style={boxStyle}
              className={`pointer-events-none absolute rounded-xl border-2 ${
                face.status === "aligned"
                  ? "border-emerald-300 shadow-[0_0_20px_rgba(74,222,128,0.55)]"
                  : face.status === "multiple"
                    ? "border-rose-300 shadow-[0_0_20px_rgba(251,113,133,0.45)]"
                    : "border-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.45)]"
              }`}
            />
          )}
          {(phase === "requesting" || isBusy) && (
            <div className="absolute inset-0 grid place-items-center bg-slate-950/55 text-white">
              <div className="rounded-2xl border border-white/20 bg-white/10 px-5 py-4 text-center">
                <Video className="mx-auto h-6 w-6 text-cyan-200" />
                <p className="mt-2 text-sm font-semibold">
                  {isBusy ? "Analisando..." : "Preparando câmera..."}
                </p>
              </div>
            </div>
          )}
          {phase === "error" && (
            <div className="absolute inset-0 grid place-items-center bg-slate-950/75 px-4 text-center text-white">
              <div>
                <CameraOff className="mx-auto h-8 w-8 text-rose-300" />
                <p className="mt-3 text-sm">{errorMessage}</p>
              </div>
            </div>
          )}
          {(guideTitle || guideInstruction) && (
            <div className="absolute inset-x-3 bottom-3 rounded-xl border border-white/15 bg-slate-950/65 px-3 py-2 text-white">
              <p className="text-sm font-semibold">{guideTitle}</p>
              <p className="text-xs text-slate-200">{guideInstruction}</p>
            </div>
          )}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <StatusPill
            label="Câmera"
            message={statusMessage}
            icon={<Camera className="h-4 w-4" />}
            className="border-cyan-300/30 bg-cyan-500/10 text-cyan-50"
          />
          <StatusPill
            label="Rosto"
            message={face.message}
            icon={
              face.status === "aligned" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : face.status === "multiple" ? (
                <Users className="h-4 w-4" />
              ) : (
                <ScanFace className="h-4 w-4" />
              )
            }
            className={
              face.status === "aligned"
                ? "border-emerald-300/30 bg-emerald-500/10 text-emerald-50"
                : "border-amber-300/30 bg-amber-500/10 text-amber-50"
            }
          />
        </div>

        {mode === "manual" && phase === "ready" && !isBusy && (
          <div className="mt-3 flex justify-center">
            {holdButton ? (
              <button
                type="button"
                onPointerDown={() => {
                  setIsHolding(true);
                  void captureFrame();
                }}
                onPointerUp={() => setIsHolding(false)}
                onPointerCancel={() => setIsHolding(false)}
                onPointerLeave={() => setIsHolding(false)}
                disabled={manualDisabled}
                className="rounded-2xl bg-orange-500 px-6 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-500"
              >
                {isHolding ? "Capturando..." : "Segure para capturar"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void captureFrame()}
                disabled={manualDisabled}
                className="rounded-2xl bg-orange-500 px-6 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-500"
              >
                Capturar foto
              </button>
            )}
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

function StatusPill({
  label,
  message,
  className,
  icon,
}: {
  label: string;
  message: string;
  className: string;
  icon: ReactNode;
}) {
  return (
    <div className={`rounded-xl border px-3 py-3 ${className}`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em]">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-sm leading-5">{message}</p>
    </div>
  );
}
