import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, Save, Trash2, UserRound } from "lucide-react";
import CameraCapture, { type CameraGuideDirection } from "./CameraCapture";
import { ApiError, classesApi, settingsApi, studentsApi } from "../lib/api";
import { formatCpf, isValidCpf, normalizeCpf } from "../lib/cpf";
import { useFeedback } from "../hooks/useFeedback";
import { SCHOOL_YEARS } from "../lib/constants";
import { useAuth } from "../hooks/useAuth";
import type {
  ClassItem,
  RegistrationCaptureMode,
  SchoolYear,
  StudentFaceAssetsResponse,
  StudentItem,
} from "../types/api";

type CapturePhoto = { file: File; previewUrl: string };
type CaptureStep = { id: string; title: string; instruction: string };
type ClearScope = "all" | "cycle";
type RegistrationIntent = "novo_cadastro" | "recaptura_aluno";

const STEPS_3: CaptureStep[] = [
  { id: "front", title: "Frente", instruction: "Olhe para frente, com rosto centralizado." },
  { id: "right", title: "Lado direito", instruction: "Vire a cabeça levemente para o lado direito." },
  { id: "left", title: "Lado esquerdo", instruction: "Vire a cabeça levemente para o lado esquerdo." },
];
const STEP_LABELS_3 = ["Foto frontal", "Foto direita", "Foto esquerda"] as const;

const TOTAL_100 = 50;
const CYCLE_SIZE = 25;
const CYCLES = 2;
const INSTRUCTION_100 = "Durante a foto, faça leves movimentos de cabeça para os dois lados, indo e voltando.";

function emptyPhotos(total: number) {
  return Array.from({ length: total }, () => null) as Array<CapturePhoto | null>;
}

function revoke(previewUrl: string | null | undefined) {
  if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
}

function withCacheBust(url: string | null | undefined, versionHint?: string | number | null) {
  if (!url) return null;
  const separator = url.includes("?") ? "&" : "?";
  const version = encodeURIComponent(String(versionHint ?? Date.now()));
  return `${url}${separator}v=${version}`;
}

function studentPhotoVersion(student: Pick<StudentItem, "id" | "updated_at"> | null | undefined) {
  if (!student) return null;
  return `${student.id}-${student.updated_at}`;
}

function stepDirection(stepId: string): CameraGuideDirection {
  if (stepId === "right") return "right";
  if (stepId === "left") return "left";
  return "center";
}

function enrollmentFile(photo: CapturePhoto, index: number, mode: RegistrationCaptureMode) {
  const ext = photo.file.name.includes(".") ? photo.file.name.slice(photo.file.name.lastIndexOf(".")) : ".jpg";
  const name =
    mode === "hundred_photos"
      ? `cycle-${String(Math.floor(index / CYCLE_SIZE) + 1).padStart(2, "0")}-${String((index % CYCLE_SIZE) + 1).padStart(3, "0")}${ext}`
      : `face-${STEPS_3[index]?.id ?? `sample-${index + 1}`}${ext}`;
  return new File([photo.file], name, { type: photo.file.type || "image/jpeg" });
}

function enrollmentProgressLabel(index: number, mode: RegistrationCaptureMode) {
  if (mode === "hundred_photos") {
    const cycle = Math.floor(index / CYCLE_SIZE) + 1;
    const photoInCycle = (index % CYCLE_SIZE) + 1;
    return `ciclo ${cycle}, foto ${photoInCycle}/25`;
  }
  return `foto ${index + 1}/3`;
}

function totalByMode(mode: RegistrationCaptureMode) {
  return mode === "hundred_photos" ? TOTAL_100 : STEPS_3.length;
}

async function fetchCapturePhoto(url: string, filename: string): Promise<CapturePhoto | null> {
  try {
    const response = await fetch(withCacheBust(url, Date.now()) ?? url, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    const type = blob.type || "image/jpeg";
    const file = new File([blob], filename, { type });
    return { file, previewUrl: URL.createObjectURL(file) };
  } catch {
    return null;
  }
}

async function buildPrefilledPhotos(
  mode: RegistrationCaptureMode,
  assets: StudentFaceAssetsResponse,
): Promise<Array<CapturePhoto | null>> {
  const target = emptyPhotos(totalByMode(mode));

  if (mode === "hundred_photos") {
    if (assets.mode_hint === "hundred_photos" && assets.sample_urls.length > 0) {
      const sortedSamples = [...assets.sample_urls].sort((a, b) =>
        a.filename.localeCompare(b.filename, "pt-BR", { numeric: true }),
      );
      const count = Math.min(TOTAL_100, sortedSamples.length);
      for (let index = 0; index < count; index += 1) {
        const sample = sortedSamples[index];
        target[index] = await fetchCapturePhoto(sample.url, sample.filename);
      }
      return target;
    }

    const initialSources = [assets.front_url, assets.right_url, assets.left_url].filter(Boolean) as string[];
    for (let index = 0; index < Math.min(initialSources.length, 3); index += 1) {
      const filename = `cycle-01-${String(index + 1).padStart(3, "0")}.jpg`;
      target[index] = await fetchCapturePhoto(initialSources[index], filename);
    }
    return target;
  }

  if (assets.mode_hint === "hundred_photos") {
    const frontSource = assets.front_url ?? assets.sample_urls[0]?.url ?? null;
    if (frontSource) {
      target[0] = await fetchCapturePhoto(frontSource, "face-front.jpg");
    }
    return target;
  }

  const poseSources: Array<string | null> = [assets.front_url, assets.right_url, assets.left_url];
  const poseFilenames = ["face-front.jpg", "face-right.jpg", "face-left.jpg"];
  for (let index = 0; index < poseSources.length; index += 1) {
    const source = poseSources[index];
    if (!source) continue;
    target[index] = await fetchCapturePhoto(source, poseFilenames[index]);
  }
  return target;
}

export default function StudentRegistration() {
  const { token } = useAuth();
  const { emit, primeAudio } = useFeedback();

  const [systemMode, setSystemMode] = useState<RegistrationCaptureMode>("hundred_photos");
  const [mode, setMode] = useState<RegistrationCaptureMode>("hundred_photos");
  const [registrationIntent, setRegistrationIntent] = useState<RegistrationIntent>("novo_cadastro");
  const [recaptureStudentId, setRecaptureStudentId] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [cpf, setCpf] = useState("");
  const [year, setYear] = useState<SchoolYear>("1 ano");
  const [classId, setClassId] = useState("");
  const [photos, setPhotos] = useState<Array<CapturePhoto | null>>(() => emptyPhotos(TOTAL_100));
  const [activeIndex, setActiveIndex] = useState(0);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [registrationFacingMode, setRegistrationFacingMode] = useState<"environment" | "user">("environment");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [recentYear, setRecentYear] = useState<SchoolYear | "all">("all");
  const [recentClass, setRecentClass] = useState("all");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeletingStudent, setIsDeletingStudent] = useState(false);
  const [showReenrollModeModal, setShowReenrollModeModal] = useState(false);
  const [isPreparingReenroll, setIsPreparingReenroll] = useState(false);
  const [retryTargetIndex, setRetryTargetIndex] = useState<number | null>(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearScope, setClearScope] = useState<ClearScope | null>(null);
  const [clearCycle, setClearCycle] = useState<number | null>(null);
  const [clearFormFields, setClearFormFields] = useState<boolean | null>(null);
  const photosRef = useRef(photos);
  const skipModeResetRef = useRef(false);

  const isHundred = mode === "hundred_photos";
  const isRecapturing = registrationIntent === "recaptura_aluno" && Boolean(recaptureStudentId);
  const totalRequired = isHundred ? TOTAL_100 : STEPS_3.length;
  const capturedCount = useMemo(() => photos.filter(Boolean).length, [photos]);
  const done = capturedCount === totalRequired;

  const cycleProgress = useMemo(
    () =>
      Array.from({ length: CYCLES }, (_, i) =>
        photos.slice(i * CYCLE_SIZE, (i + 1) * CYCLE_SIZE).filter(Boolean).length,
      ),
    [photos],
  );
  const completedCycles = useMemo(() => cycleProgress.filter((v) => v >= CYCLE_SIZE).length, [cycleProgress]);
  const canApplyClear =
    clearScope !== null &&
    (clearScope === "all"
      ? clearFormFields !== null
      : isHundred && clearCycle !== null);

  const selectedStepIndex3 = Math.min(Math.max(activeIndex, 0), STEPS_3.length - 1);
  const activeStep = STEPS_3[selectedStepIndex3];
  const selectedStepCaptured = Boolean(photos[selectedStepIndex3]);
  const previewPhoto = isHundred
    ? retryTargetIndex !== null && !photos[retryTargetIndex]
      ? null
      : [...photos].reverse().find(Boolean) ?? null
    : photos[Math.min(Math.max(activeIndex, 0), STEPS_3.length - 1)] ?? null;
  const previewUrl = photos[0]?.previewUrl ?? photos.find(Boolean)?.previewUrl ?? null;

  const availableClasses = useMemo(
    () =>
      classes
        .filter((item) => item.school_year === year)
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [classes, year],
  );
  const selectedClass = useMemo(
    () => availableClasses.find((item) => item.id === classId) ?? null,
    [availableClasses, classId],
  );
  const selectedStudent = useMemo(
    () => students.find((item) => item.id === selectedStudentId) ?? students[0] ?? null,
    [selectedStudentId, students],
  );
  const recaptureStudent = useMemo(
    () => (recaptureStudentId ? students.find((item) => item.id === recaptureStudentId) ?? null : null),
    [recaptureStudentId, students],
  );
  const recentClassOptions = useMemo(() => {
    const base = recentYear === "all" ? classes : classes.filter((item) => item.school_year === recentYear);
    return [...base].sort((a, b) => a.display_name.localeCompare(b.display_name, "pt-BR"));
  }, [classes, recentYear]);
  const filteredRecentStudents = useMemo(
    () =>
      students
        .filter((item) => (recentYear === "all" ? true : item.school_year === recentYear))
        .filter((item) => (recentClass === "all" ? true : item.class_id === recentClass)),
    [recentClass, recentYear, students],
  );

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(
    () => () => {
      photosRef.current.forEach((photo) => revoke(photo?.previewUrl));
    },
    [],
  );

  useEffect(() => {
    if (skipModeResetRef.current) {
      skipModeResetRef.current = false;
      return;
    }
    setPhotos((current) => {
      current.forEach((photo) => revoke(photo?.previewUrl));
      return emptyPhotos(isHundred ? TOTAL_100 : STEPS_3.length);
    });
    setActiveIndex(0);
    setIsCameraOpen(false);
    setStatusMessage("");
    setErrorMessage("");
    setShowClearModal(false);
    setClearScope(null);
    setClearCycle(null);
    setClearFormFields(null);
  }, [isHundred]);

  useEffect(() => {
    if (!token) return;
    let mounted = true;
    setIsLoading(true);
    Promise.all([
      classesApi.list(token),
      studentsApi.list(token),
      settingsApi.getRegistrationCaptureMode(token).catch(() => ({ mode: "hundred_photos" as RegistrationCaptureMode })),
    ])
      .then(([classItems, studentItems, modeResponse]) => {
        if (!mounted) return;
        const sorted = [...studentItems].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setClasses(classItems);
        setStudents(sorted);
        setSelectedStudentId((current) => current || sorted[0]?.id || null);
        setSystemMode(modeResponse.mode);
        setMode(modeResponse.mode);
      })
      .catch((error) => {
        if (mounted) setErrorMessage(error instanceof ApiError ? error.message : "Não foi possível carregar os dados.");
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [token]);

  useEffect(() => {
    if (!classId && availableClasses[0]) setClassId(availableClasses[0].id);
    if (classId && !availableClasses.some((item) => item.id === classId)) setClassId(availableClasses[0]?.id ?? "");
  }, [availableClasses, classId]);

  useEffect(() => {
    if (recentClass === "all") return;
    if (!recentClassOptions.some((item) => item.id === recentClass)) setRecentClass("all");
  }, [recentClass, recentClassOptions]);

  const resetClearModalState = () => {
    setClearScope(null);
    setClearCycle(null);
    setClearFormFields(null);
  };

  const clearNameAndCpfFields = () => {
    setFullName("");
    setCpf("");
  };

  const resetCaptureGrid = (nextMode: RegistrationCaptureMode) => {
    skipModeResetRef.current = true;
    setMode(nextMode);
    setPhotos((current) => {
      current.forEach((photo) => revoke(photo?.previewUrl));
      return emptyPhotos(totalByMode(nextMode));
    });
    setActiveIndex(0);
    setIsCameraOpen(false);
    setShowClearModal(false);
    setClearScope(null);
    setClearCycle(null);
    setClearFormFields(null);
    setRetryTargetIndex(null);
  };

  const resetToNewRegistration = () => {
    setRegistrationIntent("novo_cadastro");
    setRecaptureStudentId(null);
    setShowReenrollModeModal(false);
    resetCaptureGrid(systemMode);
    clearNameAndCpfFields();
  };

  const syncRegistrationModeFromSettings = async (): Promise<RegistrationCaptureMode> => {
    if (!token || registrationIntent !== "novo_cadastro") return mode;
    let nextMode = mode;
    try {
      const response = await settingsApi.getRegistrationCaptureMode(token);
      setSystemMode(response.mode);
      if (mode !== response.mode) {
        resetCaptureGrid(response.mode);
        nextMode = response.mode;
      }
    } catch {
      // Mantém o modo atual se a leitura da configuração falhar.
    }
    return nextMode;
  };

  const clearPhotos = (scope: ClearScope, clearNameAndCpf: boolean, cycleNumber?: number) => {
    const currentPhotos = photosRef.current;
    const isFullClear = scope === "all" || !isHundred;
    const selectedCycle = cycleNumber ?? 1;
    const cycleIndex = Math.min(Math.max(selectedCycle, 1), CYCLES) - 1;
    const start = cycleIndex * CYCLE_SIZE;
    const end = start + CYCLE_SIZE;
    const hasCleared = isFullClear
      ? currentPhotos.some(Boolean)
      : currentPhotos.slice(start, end).some(Boolean);
    setPhotos((current) => {
      const next = [...current];
      if (isFullClear) {
        next.forEach((photo) => revoke(photo?.previewUrl));
        return emptyPhotos(totalRequired);
      }

      for (let index = start; index < end; index += 1) {
        if (next[index]) {
          revoke(next[index]?.previewUrl);
          next[index] = null;
        }
      }
      return next;
    });

    setIsCameraOpen(false);
    setActiveIndex(isFullClear ? 0 : (selectedCycle - 1) * CYCLE_SIZE);
    setRetryTargetIndex(null);

    if (isFullClear && clearNameAndCpf) clearNameAndCpfFields();

    if (isFullClear) {
      setStatusMessage("Capturas limpas.");
    } else if (hasCleared) {
      setStatusMessage(`Ciclo ${selectedCycle} limpo.`);
    } else {
      setStatusMessage(`Ciclo ${selectedCycle} já estava vazio.`);
    }
    setErrorMessage("");
  };

  const openClearModal = () => {
    resetClearModalState();
    setShowClearModal(true);
  };

  const closeClearModal = () => {
    setShowClearModal(false);
    resetClearModalState();
  };

  const applyClearModal = () => {
    if (!clearScope) return;
    if (clearScope === "all" && clearFormFields === null) return;
    if (clearScope === "cycle" && (clearCycle === null || !isHundred)) return;
    const shouldClearNameAndCpf = clearScope === "all" && clearFormFields === true;
    clearPhotos(
      clearScope,
      shouldClearNameAndCpf,
      clearCycle ?? undefined,
    );
    closeClearModal();
  };

  const beginReenroll = async (nextMode: RegistrationCaptureMode) => {
    if (!token || !selectedStudent) return;
    setShowReenrollModeModal(false);
    setIsPreparingReenroll(true);
    setErrorMessage("");
    setStatusMessage("Preparando recaptura do aluno...");
    try {
      const assets = await studentsApi.getFaceAssets(token, selectedStudent.id);
      const prefilled = await buildPrefilledPhotos(nextMode, assets);

      setRegistrationIntent("recaptura_aluno");
      setRecaptureStudentId(selectedStudent.id);
      setFullName(assets.full_name);
      setCpf(formatCpf(assets.cpf));
      setYear(assets.school_year);
      setClassId(assets.class_id);

      skipModeResetRef.current = true;
      setMode(nextMode);
      setPhotos((current) => {
        current.forEach((photo) => revoke(photo?.previewUrl));
        return prefilled;
      });
      setRetryTargetIndex(null);
      const firstPending = prefilled.findIndex((photo) => !photo);
      setActiveIndex(firstPending >= 0 ? firstPending : 0);
      setIsCameraOpen(false);
      setStatusMessage(
        nextMode === "hundred_photos"
          ? "Recaptura em 50 fotos pronta. Continue do ponto carregado."
          : "Recaptura em 3 fotos pronta. Revise frente, direita e esquerda.",
      );
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : "Nao foi possivel preparar a recaptura.");
      setStatusMessage("");
    } finally {
      setIsPreparingReenroll(false);
    }
  };

  const openCamera = async () => {
    void primeAudio();
    const syncedMode = await syncRegistrationModeFromSettings();
    const usingHundred = syncedMode === "hundred_photos";
    if (usingHundred) {
      if (syncedMode !== mode) {
        setActiveIndex(0);
      } else {
        const firstPending = photos.findIndex((photo) => !photo);
        if (firstPending < 0) {
          setStatusMessage("As 50 fotos já foram capturadas.");
          return;
        }
        setActiveIndex(firstPending);
      }
    }
    setErrorMessage("");
    setStatusMessage("");
    setIsCameraOpen(true);
  };

  const resolveFailedCaptureIndex = (message: string): number | null => {
    const threeMatch = message.match(/foto\s+(\d+)\/3/i);
    if (threeMatch) {
      const parsed = Number(threeMatch[1]);
      if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= STEPS_3.length) return parsed - 1;
    }

    const hundredCycleMatch = message.match(/foto\s+(\d+)\/25\s+do\s+ciclo\s+(\d+)/i);
    if (hundredCycleMatch) {
      const photoInCycle = Number(hundredCycleMatch[1]);
      const cycle = Number(hundredCycleMatch[2]);
      if (
        !Number.isNaN(photoInCycle) &&
        !Number.isNaN(cycle) &&
        cycle >= 1 &&
        cycle <= CYCLES &&
        photoInCycle >= 1 &&
        photoInCycle <= CYCLE_SIZE
      ) {
        return (cycle - 1) * CYCLE_SIZE + (photoInCycle - 1);
      }
    }

    const hundredInlineMatch = message.match(/ciclo\s+(\d+),\s*foto\s+(\d+)\/25/i);
    if (hundredInlineMatch) {
      const cycle = Number(hundredInlineMatch[1]);
      const photoInCycle = Number(hundredInlineMatch[2]);
      if (
        !Number.isNaN(photoInCycle) &&
        !Number.isNaN(cycle) &&
        cycle >= 1 &&
        cycle <= CYCLES &&
        photoInCycle >= 1 &&
        photoInCycle <= CYCLE_SIZE
      ) {
        return (cycle - 1) * CYCLE_SIZE + (photoInCycle - 1);
      }
    }

    return null;
  };

  const retryFromFailedCapture = (failedIndex: number, message: string) => {
    if (failedIndex < 0 || failedIndex >= totalRequired) return;
    const label = enrollmentProgressLabel(failedIndex, mode);
    setPhotos((current) => {
      const next = [...current];
      revoke(next[failedIndex]?.previewUrl);
      next[failedIndex] = null;
      return next;
    });
    setActiveIndex(failedIndex);
    setRetryTargetIndex(failedIndex);
    setIsCameraOpen(true);
    setStatusMessage(`Falha ao processar ${label}. Tire novamente.`);
    setErrorMessage(message);
  };

  const onCapture = async (file: File) => {
    let nextPending = -1;
    let nextCaptured = 0;
    let cycleCompleted = false;
    let allDone = false;
    let targetIndex = activeIndex;

    setPhotos((current) => {
      const next = [...current];
      if (isHundred) {
        const firstPending = next.findIndex((photo) => !photo);
        targetIndex = firstPending >= 0 ? firstPending : targetIndex;
      }
      revoke(next[targetIndex]?.previewUrl);
      next[targetIndex] = { file, previewUrl: URL.createObjectURL(file) };
      nextPending = next.findIndex((photo) => !photo);
      nextCaptured = next.filter(Boolean).length;
      allDone = nextPending < 0;
      cycleCompleted = isHundred && !allDone && nextCaptured > 0 && nextCaptured % CYCLE_SIZE === 0;
      return next;
    });
    setRetryTargetIndex((current) => (current === targetIndex ? null : current));

    if (isHundred) {
      if (allDone) {
        setStatusMessage("Captura concluída. As 50 fotos foram salvas.");
        setIsCameraOpen(false);
        return;
      }
      setActiveIndex(nextPending >= 0 ? nextPending : 0);
      if (cycleCompleted) {
        const cycle = Math.floor(nextCaptured / CYCLE_SIZE);
        setStatusMessage(`Ciclo ${cycle} concluído. Continue para o ciclo ${Math.min(CYCLES, cycle + 1)}.`);
        setIsCameraOpen(false);
        return;
      }
      const remaining = CYCLE_SIZE - (nextCaptured % CYCLE_SIZE);
      setStatusMessage(`Foto ${nextCaptured} de ${TOTAL_100} salva. Faltam ${remaining} neste ciclo.`);
      return;
    }

    if (nextPending >= 0) {
      setActiveIndex(nextPending);
      setStatusMessage(`Foto ${targetIndex + 1} de ${STEPS_3.length} salva.`);
      return;
    }
    setStatusMessage("Sequência facial concluída. Revise as 3 fotos e salve.");
    setIsCameraOpen(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token || !classId || !fullName.trim() || !done) return;
    const normalizedCpf = normalizeCpf(cpf);
    if (!isValidCpf(normalizedCpf)) {
      setErrorMessage("Informe um CPF válido.");
      return;
    }

    const files = photos.map((photo, index) => (photo ? enrollmentFile(photo, index, mode) : null)).filter(Boolean) as File[];
    if (files.length !== totalRequired) {
      setErrorMessage(`Finalize as ${totalRequired} fotos antes de salvar.`);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    let createdId: string | null = null;
    let failedCaptureIndex: number | null = null;
    try {
      if (isRecapturing && recaptureStudentId) {
        await studentsApi.update(token, recaptureStudentId, {
          full_name: fullName.trim().toLocaleUpperCase("pt-BR"),
          class_id: classId,
          cpf: normalizedCpf,
        });
        setStatusMessage("Dados atualizados. Reprocessando capturas...");
        const reenrollResult = await studentsApi.reenrollFace(token, recaptureStudentId, { mode, files });
        setStatusMessage(`Recaptura concluida com ${files.length} foto(s).`);
        setStudents((current) => {
          const next = current.map((item) => (item.id === reenrollResult.student.id ? reenrollResult.student : item));
          return next.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        });
        setSelectedStudentId(recaptureStudentId);
        void (async () => {
          try {
            const [classItems, studentItems] = await Promise.all([
              classesApi.list(token),
              studentsApi.list(token),
            ]);
            const sorted = [...studentItems].sort(
              (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
            );
            setClasses(classItems);
            setStudents(sorted);
          } catch {
            // Mantem o update otimista local; evita rejeicao sem tratamento no console.
          }
        })();
        resetToNewRegistration();
        return;
      }

      const student = await studentsApi.create(token, { full_name: fullName.trim().toLocaleUpperCase("pt-BR"), class_id: classId, cpf: normalizedCpf });
      createdId = student.id;
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const progressLabel = enrollmentProgressLabel(index, mode);
        setStatusMessage(`Processando ${progressLabel}...`);
        try {
          await studentsApi.enrollFace(token, student.id, file);
        } catch (error) {
          failedCaptureIndex = index;
          const detail =
            error instanceof ApiError
              ? error.message
              : "falha ao processar a imagem capturada.";
          throw new ApiError(`Falha no ${progressLabel}: ${detail}`, error instanceof ApiError ? error.status : 400);
        }
      }
      void emit("student.registered", { studentName: student.full_name, dedupeKey: `student-registered-${student.id}` });
      clearNameAndCpfFields();
      clearPhotos("all", false);
      setStatusMessage(`Cadastro concluído com ${files.length} foto(s).`);
      const [classItems, studentItems] = await Promise.all([classesApi.list(token), studentsApi.list(token)]);
      const sorted = [...studentItems].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setClasses(classItems);
      setStudents(sorted);
      setSelectedStudentId(sorted[0]?.id ?? null);
    } catch (error) {
      if (createdId) await studentsApi.remove(token, createdId).catch(() => undefined);
      const safeMessage = error instanceof ApiError ? error.message : "Nao foi possivel concluir o cadastro.";
      const safeFailedIndex = failedCaptureIndex ?? resolveFailedCaptureIndex(safeMessage);
      if (safeFailedIndex !== null) {
        retryFromFailedCapture(safeFailedIndex, safeMessage);
        return;
      }
      setErrorMessage(safeMessage);
      return;
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteSelectedStudent = async () => {
    if (!token || !selectedStudent) return;
    const deletingId = selectedStudent.id;
    setIsDeletingStudent(true);
    try {
      await studentsApi.remove(token, deletingId);
      const sorted = (await studentsApi.list(token)).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      setStudents(sorted);
      setSelectedStudentId(sorted[0]?.id ?? null);
      if (recaptureStudentId === deletingId) resetToNewRegistration();
      setStatusMessage("Aluno excluído com sucesso.");
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : "Não foi possível excluir o aluno.");
    } finally {
      setIsDeletingStudent(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200 lg:p-7">
        <h2 className="text-2xl font-black text-slate-900">Cadastro aluno</h2>
        {isRecapturing && recaptureStudent ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-800">
              Recaptura ativa para {recaptureStudent.full_name}.
            </p>
            <button
              type="button"
              onClick={resetToNewRegistration}
              className="mt-3 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800"
            >
              Cancelar recaptura
            </button>
          </div>
        ) : null}
        <form onSubmit={submit} className="mt-6 space-y-5">
          <input value={fullName} onChange={(e) => setFullName(e.target.value.toLocaleUpperCase("pt-BR"))} placeholder="Nome completo" className="w-full rounded-xl border border-slate-300 px-4 py-3" required />
          <input value={cpf} onChange={(e) => setCpf(formatCpf(e.target.value))} placeholder="000.000.000-00" maxLength={14} inputMode="numeric" className="w-full rounded-xl border border-slate-300 px-4 py-3" required />
          <div className="grid grid-cols-3 gap-3">{SCHOOL_YEARS.map((item) => <button key={item} type="button" onClick={() => setYear(item)} className={`rounded-2xl border px-3 py-3 text-sm font-semibold ${year === item ? "border-orange-400 bg-orange-500 text-white" : "border-slate-200 bg-slate-50 text-slate-700"}`}>{item}</button>)}</div>
          <select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3" required>
            {availableClasses.length === 0 ? <option value="">Crie uma turma para {year}</option> : availableClasses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>

          <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-4">
            <div className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-500">Captura facial</p>
              <p className="mt-2 text-base font-black text-slate-900">{isHundred ? "50 fotos para o cadastro." : isCameraOpen ? activeStep.title : "3 fotos para o cadastro."}</p>
              <p className="mt-1 text-sm text-slate-500">{isHundred ? INSTRUCTION_100 : activeStep.instruction}</p>
              <div className="mt-3 text-sm font-black text-orange-700">{capturedCount}/{totalRequired}</div>
              {!isHundred ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {STEPS_3.map((step, index) => {
                    const isSelected = index === selectedStepIndex3;
                    const isDone = Boolean(photos[index]);
                    return (
                      <button
                        key={step.id}
                        type="button"
                        onClick={() => setActiveIndex(index)}
                        disabled={isCameraOpen}
                        className={`rounded-2xl border px-3 py-3 text-left disabled:opacity-60 ${
                          isSelected
                            ? "border-orange-300 bg-orange-50"
                            : "border-slate-200 bg-slate-50"
                        }`}
                      >
                        <p className="text-sm font-semibold text-slate-900">{STEP_LABELS_3[index]}</p>
                        <p
                          className={`mt-1 text-xs font-bold uppercase tracking-[0.14em] ${
                            isDone ? "text-emerald-700" : "text-amber-700"
                          }`}
                        >
                          {isDone ? "Feita" : "Pendente"}
                        </p>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {isHundred ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{cycleProgress.map((value, index) => <div key={`cycle-${index + 1}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-700">Ciclo {index + 1}: {value}/25</div>)}</div> : null}
              {isHundred ? <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{completedCycles}/{CYCLES} ciclos concluídos</p> : null}
            </div>

            {isCameraOpen ? (
              <div className="mt-4">
                <CameraCapture
                  mode="manual"
                  onCapture={onCapture}
                  onCancel={() => setIsCameraOpen(false)}
                  initialFacingMode={registrationFacingMode}
                  onFacingModeChange={setRegistrationFacingMode}
                  guideDirection={isHundred ? "center" : stepDirection(activeStep.id)}
                  guideTitle={isHundred ? `Ciclo ${Math.min(CYCLES, completedCycles + 1)}` : activeStep.title}
                  guideInstruction={isHundred ? INSTRUCTION_100 : activeStep.instruction}
                  faceGuardMode="required"
                  uiVariant="registration"
                  captureInteraction={isHundred ? "hold" : "tap"}
                  captureIntervalMs={isHundred ? 220 : 280}
                  captureCooldownMs={isHundred ? 360 : 800}
                />
              </div>
            ) : (
              <div className="mt-4 rounded-[1.5rem] border border-slate-200 bg-white p-4">
                {previewPhoto ? <img src={previewPhoto.previewUrl} alt="Prévia da captura" className="aspect-[3/4] w-full rounded-[1.25rem] object-cover" /> : <div className="flex aspect-[3/4] items-center justify-center rounded-[1.25rem] border border-dashed border-slate-300 text-slate-500">Abra a câmera</div>}
                <div className="mt-4 flex flex-wrap gap-3">
                  <button type="button" onClick={openCamera} className="inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white"><Camera className="h-4 w-4" />{isHundred ? (capturedCount === 0 ? "Abrir câmera" : `Continuar ciclo ${Math.min(CYCLES, Math.floor(capturedCount / CYCLE_SIZE) + 1)}`) : (selectedStepCaptured ? `Refazer foto ${selectedStepIndex3 + 1}` : `Tirar foto ${selectedStepIndex3 + 1}`)}</button>
                  <button type="button" onClick={openClearModal} disabled={capturedCount === 0} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-60">Limpar capturas</button>
                </div>
              </div>
            )}
          </div>

          {statusMessage ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{statusMessage}</div> : null}
          {errorMessage ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</div> : null}
          <button type="submit" disabled={isSubmitting || isPreparingReenroll || !classId || !fullName.trim() || !done || normalizeCpf(cpf).length !== 11} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 py-4 font-semibold text-white disabled:bg-slate-300"><Save className="h-4 w-4" />{isSubmitting ? (isRecapturing ? "Salvando recaptura..." : "Salvando cadastro...") : isRecapturing ? "Salvar recaptura" : "Salvar cadastro"}</button>
        </form>
      </section>

      <section className="space-y-5">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-500">Prévia do cadastro</p>
          {previewUrl ? <div className="mt-4 flex items-center gap-4 rounded-2xl bg-slate-950 p-4 text-white"><img src={previewUrl} alt={fullName || "Prévia"} className="h-20 w-20 rounded-2xl object-cover" /><div><p className="text-lg font-black">{fullName || "Novo aluno"}</p><p className="text-sm text-slate-200">Turma: {selectedClass?.name ?? "Não selecionada"}</p></div></div> : <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">Conclua as capturas para gerar a foto principal.</div>}
        </div>

        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200">
          <h3 className="text-xl font-black text-slate-900">Últimos cadastrados</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <select value={recentYear} onChange={(e) => setRecentYear(e.target.value as SchoolYear | "all")} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3"><option value="all">Ano: Todos</option>{SCHOOL_YEARS.map((item) => <option key={item} value={item}>{item}</option>)}</select>
            <select value={recentClass} onChange={(e) => setRecentClass(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3"><option value="all">Turma: Todas</option>{recentClassOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          </div>
          <div className="mt-4 space-y-3">
            {isLoading ? <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">Carregando alunos...</div> : filteredRecentStudents.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">Nenhum aluno cadastrado ainda.</div> : <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">{filteredRecentStudents.map((student) => <button key={student.id} type="button" onClick={() => setSelectedStudentId(student.id)} className={`flex min-h-20 w-full items-center gap-4 rounded-2xl border p-4 text-left ${student.id === selectedStudent?.id ? "border-orange-300 bg-orange-50" : "border-slate-200 bg-slate-50"}`}>{student.photo_url ? <img src={withCacheBust(student.photo_url, studentPhotoVersion(student)) ?? student.photo_url} alt={student.full_name} className="h-12 w-12 rounded-2xl object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-200 text-slate-500"><UserRound className="h-5 w-5" /></div>}<div><p className="font-semibold text-slate-900">{student.full_name}</p><p className="text-sm text-slate-600">{student.class_name}</p></div></button>)}</div>}
          </div>
        </div>

        {selectedStudent ? (
          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200">
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-500">Aluno selecionado</p>
            <div className="mt-3 flex items-center gap-4">
              {selectedStudent.photo_url ? <img src={withCacheBust(selectedStudent.photo_url, studentPhotoVersion(selectedStudent)) ?? selectedStudent.photo_url} alt={selectedStudent.full_name} className="h-16 w-16 rounded-2xl object-cover" /> : <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-200 text-slate-500"><UserRound className="h-6 w-6" /></div>}
              <div><p className="font-black text-slate-900">{selectedStudent.full_name}</p><p className="text-sm text-slate-500">{selectedStudent.class_name}</p></div>
            </div>
            <button
              type="button"
              onClick={() => setShowReenrollModeModal(true)}
              disabled={isPreparingReenroll || isSubmitting}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 py-4 font-semibold text-white disabled:bg-slate-300"
            >
              <Camera className="h-4 w-4" />
              {isPreparingReenroll ? "Preparando recaptura..." : "Tirar foto novamente"}
            </button>
            <button type="button" onClick={() => setShowDeleteConfirm(true)} disabled={isDeletingStudent} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-500 px-5 py-4 font-semibold text-white disabled:bg-slate-300"><Trash2 className="h-4 w-4" />{isDeletingStudent ? "Excluindo aluno..." : "Excluir aluno"}</button>
          </div>
        ) : null}
      </section>

      {showReenrollModeModal && selectedStudent ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4">
          <div className="w-full max-w-md rounded-[2rem] border border-white/70 bg-white p-6 shadow-2xl shadow-slate-900/25">
            <h3 className="text-2xl font-black text-slate-900">Tirar foto novamente</h3>
            <p className="mt-2 text-sm text-slate-600">
              Escolha o modo para recapturar {selectedStudent.full_name}.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void beginReenroll("three_photos")}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-800"
              >
                3 fotos
              </button>
              <button
                type="button"
                onClick={() => void beginReenroll("hundred_photos")}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-800"
              >
                50 fotos
              </button>
            </div>
            <div className="mt-6">
              <button
                type="button"
                onClick={() => setShowReenrollModeModal(false)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-100 px-5 py-4 font-semibold text-slate-700"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showClearModal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4">
          <div className="w-full max-w-md rounded-[2rem] border border-white/70 bg-white p-6 shadow-2xl shadow-slate-900/25">
            <h3 className="text-2xl font-black text-slate-900">Limpar capturas</h3>
            <p className="mt-2 text-sm text-slate-600">Escolha como limpar. Todas as escolhas abaixo são obrigatórias para ativar o botão.</p>

            <div className="mt-5 space-y-3">
              <p className="text-sm font-semibold text-slate-800">1) O que deseja limpar?</p>
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <input type="radio" name="clearScope" checked={clearScope === "all"} onChange={() => { setClearScope("all"); setClearCycle(null); setClearFormFields(null); }} />
                <span className="text-sm font-semibold text-slate-700">Limpar tudo</span>
              </label>
              <label className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${isHundred ? "border-slate-200 bg-slate-50" : "border-slate-200/70 bg-slate-100 text-slate-400"}`}>
                <input type="radio" name="clearScope" checked={clearScope === "cycle"} onChange={() => { setClearScope("cycle"); setClearCycle(null); setClearFormFields(null); }} disabled={!isHundred} />
                <span className="text-sm font-semibold">Limpar ciclo específico</span>
              </label>
              {clearScope === "cycle" && isHundred ? (
                <select value={clearCycle ?? ""} onChange={(event) => setClearCycle(Number(event.target.value) || null)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
                  <option value="">Escolha o ciclo</option>
                  {Array.from({ length: CYCLES }, (_, index) => (
                    <option key={`clear-cycle-${index + 1}`} value={index + 1}>
                      Ciclo {index + 1}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

            {clearScope === "all" ? (
              <div className="mt-5 space-y-3">
                <p className="text-sm font-semibold text-slate-800">2) Limpar a caixa de nome e de CPF?</p>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => setClearFormFields(true)} className={`rounded-xl border px-4 py-3 text-sm font-semibold ${clearFormFields === true ? "border-orange-300 bg-orange-50 text-orange-700" : "border-slate-200 bg-white text-slate-700"}`}>Sim</button>
                  <button type="button" onClick={() => setClearFormFields(false)} className={`rounded-xl border px-4 py-3 text-sm font-semibold ${clearFormFields === false ? "border-orange-300 bg-orange-50 text-orange-700" : "border-slate-200 bg-white text-slate-700"}`}>Não</button>
                </div>
              </div>
            ) : null}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={closeClearModal} className="flex-1 rounded-2xl border border-slate-200 bg-slate-100 px-5 py-4 font-semibold text-slate-700">Cancelar</button>
              <button type="button" onClick={applyClearModal} disabled={!canApplyClear} className="flex-1 rounded-2xl bg-orange-500 px-5 py-4 font-semibold text-white disabled:bg-slate-300">Limpar</button>
            </div>
          </div>
        </div>
      ) : null}

      {showDeleteConfirm && selectedStudent ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4">
          <div className="w-full max-w-md rounded-[2rem] border border-white/70 bg-white p-6 shadow-2xl shadow-slate-900/25">
            <h3 className="text-2xl font-black text-slate-900">Tem certeza do que está fazendo?</h3>
            <p className="mt-2 text-sm text-slate-600">O cadastro e o histórico desse aluno serão removidos.</p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={() => setShowDeleteConfirm(false)} className="flex-1 rounded-2xl border border-slate-200 bg-slate-100 px-5 py-4 font-semibold text-slate-700">Não</button>
              <button type="button" onClick={() => void deleteSelectedStudent()} disabled={isDeletingStudent} className="flex-1 rounded-2xl bg-rose-500 px-5 py-4 font-semibold text-white disabled:bg-slate-300">{isDeletingStudent ? "Excluindo..." : "Sim"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
