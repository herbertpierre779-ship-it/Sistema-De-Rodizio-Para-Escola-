import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  RefreshCcw,
  UserRound,
  XCircle,
} from "lucide-react";
import CameraCapture from "./CameraCapture";
import { ApiError, mealEntriesApi, recognitionApi, settingsApi } from "../lib/api";
import { formatCpf, isValidCpf, normalizeCpf } from "../lib/cpf";
import { useFeedback } from "../hooks/useFeedback";
import {
  DEFAULT_MEAL_SCHEDULE,
  formatMealWindowSummary,
  isMealVisibleForRole,
} from "../lib/mealSchedule";
import {
  formatConfidence,
  getMealTypeLabel,
  getRecognitionLabel,
  getRecognitionTone,
} from "../lib/constants";
import { useAuth } from "../hooks/useAuth";
import type { FeedbackEventId, FeedbackPayload } from "../lib/feedback";
import type { MealScheduleSettings, MealType, RecognitionResult } from "../types/api";

const mealOptions: Array<{
  value: MealType;
  title: string;
}> = [
  { value: "almoco", title: "Almoço" },
  { value: "merenda", title: "Merenda" },
  { value: "sem_rodizio", title: "Sem rodízio" },
];

type OperationStep = "choose_meal" | "camera" | "result";
type CaptureMode = "manual" | "auto" | "hybrid";
type ToastTone = "success" | "warning" | "error";

type ToastState = {
  id: number;
  tone: ToastTone;
  title: string;
  message: string;
} | null;

type CompactReviewState = {
  result: RecognitionResult;
  alreadyRecorded: boolean;
} | null;

const captureModeOptions: Array<{
  value: CaptureMode;
  title: string;
  description: string;
}> = [
  {
    value: "manual",
    title: "Manual",
    description: "Você decide o momento de capturar a imagem.",
  },
  {
    value: "auto",
    title: "Automático",
    description: "A captura acontece sozinha quando a imagem ficar estável.",
  },
  {
    value: "hybrid",
    title: "Híbrido",
    description: "Automático com botão manual para capturar na hora que você quiser.",
  },
];

export default function IdentificationPanel() {
  const { token, user } = useAuth();
  const { emit, primeAudio } = useFeedback();
  const [step, setStep] = useState<OperationStep>("choose_meal");
  const [selectedMealType, setSelectedMealType] = useState<MealType | null>(null);
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const [autoStartCamera, setAutoStartCamera] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>(() => {
    const stored = window.localStorage.getItem("cantina-capture-mode");
    if (stored === "manual" || stored === "auto" || stored === "hybrid") {
      return stored;
    }
    return "manual";
  });
  const [operatorOverrideAccepted, setOperatorOverrideAccepted] = useState(false);
  const [compactReview, setCompactReview] = useState<CompactReviewState>(null);
  const [compactReviewError, setCompactReviewError] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const [showCpfModal, setShowCpfModal] = useState(false);
  const [cpfInput, setCpfInput] = useState("");
  const [cpfModalError, setCpfModalError] = useState("");
  const [isCpfValidating, setIsCpfValidating] = useState(false);
  const [isCpfValidatedResult, setIsCpfValidatedResult] = useState(false);
  const [mealSchedule, setMealSchedule] = useState<MealScheduleSettings>(DEFAULT_MEAL_SCHEDULE);
  const [isLoadingMealSchedule, setIsLoadingMealSchedule] = useState(true);
  const [scheduleTick, setScheduleTick] = useState(() => Date.now());

  useEffect(() => {
    if (!toast?.id) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, 6000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [toast?.id]);

  useEffect(() => {
    window.localStorage.setItem("cantina-capture-mode", captureMode);
  }, [captureMode]);

  useEffect(() => {
    if (!token || step !== "choose_meal") return;
    let mounted = true;
    setIsLoadingMealSchedule(true);
    settingsApi
      .getMealSchedule(token)
      .then((response) => {
        if (!mounted) return;
        setMealSchedule(response);
      })
      .catch(() => {
        if (!mounted) return;
        setMealSchedule(DEFAULT_MEAL_SCHEDULE);
      })
      .finally(() => {
        if (mounted) setIsLoadingMealSchedule(false);
      });
    return () => {
      mounted = false;
    };
  }, [token, step]);

  useEffect(() => {
    if (step !== "choose_meal") {
      return;
    }

    const timerId = window.setInterval(() => {
      setScheduleTick(Date.now());
    }, 30000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [step]);

  const showToast = (
    tone: ToastTone,
    title: string,
    message: string,
    feedback?: {
      eventId?: FeedbackEventId;
      payload?: FeedbackPayload;
    },
  ) => {
    setToast({
      id: Date.now(),
      tone,
      title,
      message,
    });

    void emit(feedback?.eventId ?? "notification.generic", {
      dedupeKey: feedback?.payload?.dedupeKey ?? `toast-${tone}-${title}-${message}`,
      ...feedback?.payload,
    });
  };

  const resetToMealSelection = () => {
    setIsLoadingMealSchedule(true);
    setStep("choose_meal");
    setSelectedMealType(null);
    setResult(null);
    setStatusMessage("");
    setErrorMessage("");
    setIsIdentifying(false);
    setIsRegistering(false);
    setIsCameraEnabled(false);
    setOperatorOverrideAccepted(false);
    setCompactReview(null);
    setCompactReviewError("");
    setShowCpfModal(false);
    setCpfInput("");
    setCpfModalError("");
    setIsCpfValidating(false);
    setIsCpfValidatedResult(false);
  };

  const prepareNextCapture = () => {
    setResult(null);
    setStatusMessage("");
    setErrorMessage("");
    setIsIdentifying(false);
    setIsRegistering(false);
    setStep("camera");
    setIsCameraEnabled(autoStartCamera);
    setOperatorOverrideAccepted(false);
    setCompactReview(null);
    setCompactReviewError("");
    setShowCpfModal(false);
    setCpfInput("");
    setCpfModalError("");
    setIsCpfValidating(false);
    setIsCpfValidatedResult(false);
  };

  const restartCamera = () => {
    setResult(null);
    setErrorMessage("");
    setStatusMessage("");
    setStep("camera");
    setIsCameraEnabled(true);
    setOperatorOverrideAccepted(false);
    setCompactReview(null);
    setCompactReviewError("");
    setShowCpfModal(false);
    setCpfInput("");
    setCpfModalError("");
    setIsCpfValidating(false);
    setIsCpfValidatedResult(false);
  };

  const handleMealSelection = (mealType: MealType) => {
    void primeAudio();
    setSelectedMealType(mealType);
    setStatusMessage("");
    setErrorMessage("");
    setResult(null);
    setStep("camera");
    setIsCameraEnabled(autoStartCamera);
    setOperatorOverrideAccepted(false);
    setCompactReview(null);
    setCompactReviewError("");
    setShowCpfModal(false);
    setCpfInput("");
    setCpfModalError("");
    setIsCpfValidating(false);
    setIsCpfValidatedResult(false);
  };

  const toastToneForRecognition = (recognitionResult: RecognitionResult): ToastTone => {
    if (recognitionResult.status === "success") {
      return "success";
    }
    if (recognitionResult.status === "low_confidence") {
      return "warning";
    }
    return "error";
  };

  const handleSemRodizioResponse = (response: RecognitionResult) => {
    const matchedStudent =
      Boolean(response.student) && (response.status === "success" || response.status === "low_confidence");

    if (!matchedStudent) {
      const shouldOpenResultForCpf =
        response.status === "not_found" ||
        response.status === "no_face_detected" ||
        response.status === "multiple_faces_detected";

      if (shouldOpenResultForCpf) {
        void emit("recognition.not_found", {
          dedupeKey: `sem-rodizio-result-${response.status}-${response.message}`,
        });
        setCompactReview(null);
        setCompactReviewError("");
        setResult(response);
        setErrorMessage("");
        setStatusMessage(response.message);
        setStep("result");
        setIsCameraEnabled(false);
        setIsCpfValidatedResult(false);
        return;
      }

      showToast(toastToneForRecognition(response), getRecognitionLabel(response.status), response.message, {
        eventId: "recognition.not_found",
        payload: {
          dedupeKey: `sem-rodizio-unmatched-${response.status}-${response.message}`,
        },
      });
      prepareNextCapture();
      return;
    }

    setResult(null);
    setStatusMessage("");
    setErrorMessage("");
    setStep("camera");
    setIsCameraEnabled(false);
    setCompactReview({
      result: response,
      alreadyRecorded: response.already_recorded_today,
    });
    setCompactReviewError("");
  };

  const handleCapturedFrame = async (file: File) => {
    if (!token || !selectedMealType) {
      return;
    }

    setIsIdentifying(true);
    setErrorMessage("");
    setStatusMessage("Analisando imagem...");
    setOperatorOverrideAccepted(false);

    try {
      const response = await recognitionApi.identify(token, file, selectedMealType);

      if (selectedMealType === "sem_rodizio") {
        handleSemRodizioResponse(response);
        return;
      }

      if (
        captureMode !== "manual" &&
        (response.status === "no_face_detected" || response.status === "multiple_faces_detected")
      ) {
        showToast("warning", getRecognitionLabel(response.status), response.message, {
          eventId: "recognition.not_found",
          payload: {
            dedupeKey: `camera-${response.status}-${response.message}`,
          },
        });
        setResult(null);
        setErrorMessage("");
        setStatusMessage(response.message);
        setStep("camera");
        setIsCameraEnabled(true);
        return;
      }

      if (response.already_recorded_today) {
        showToast(
          "warning",
          "Refeição já registrada",
          response.already_recorded_message ?? "Esse aluno já recebeu essa refeição hoje.",
          {
            eventId: "recognition.duplicate",
            payload: {
              studentName: response.student?.full_name,
              mealType: selectedMealType,
              dedupeKey: `duplicate-${response.student?.id ?? "unknown"}-${selectedMealType}`,
            },
          },
        );
        prepareNextCapture();
        return;
      }

      if (
        response.status === "not_found" ||
        response.status === "no_face_detected" ||
        response.status === "multiple_faces_detected"
      ) {
        void emit("recognition.not_found", {
          dedupeKey: `result-${response.status}-${response.message}`,
        });
      }

      setCompactReview(null);
      setCompactReviewError("");
      setIsCpfValidatedResult(false);
      setResult(response);
      setStatusMessage(response.message);
      setStep("result");
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Não foi possível processar a identificação.";

      if (selectedMealType === "sem_rodizio") {
        showToast("error", "Falha na verificação", message, {
          payload: {
            dedupeKey: `verification-error-${message}`,
          },
        });
        prepareNextCapture();
        return;
      }

      if (captureMode !== "manual") {
        showToast("error", "Falha na identificação", message, {
          payload: {
            dedupeKey: `identification-error-${message}`,
          },
        });
        setResult(null);
        setErrorMessage("");
        setStatusMessage(message);
        setStep("camera");
        setIsCameraEnabled(true);
        return;
      }

      setResult(null);
      setErrorMessage(message);
      setStep("result");
    } finally {
      setIsIdentifying(false);
    }
  };

  const handleConfirm = async () => {
    if (!token || !result?.student || !selectedMealType) {
      return;
    }

    setIsRegistering(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      await mealEntriesApi.create(token, {
        student_id: result.student.id,
        meal_type: selectedMealType,
        source: result.status === "success" ? "reconhecimento" : "revisao_operador",
        confidence: result.confidence,
      });

      showToast("success", "Atendimento confirmado", "Próximo aluno pronto para identificação.", {
        eventId: "recognition.confirmed",
        payload: {
          studentName: result.student.full_name,
          mealType: selectedMealType,
          dedupeKey: `confirmed-${result.student.id}-${selectedMealType}`,
        },
      });
      prepareNextCapture();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        showToast("warning", "Refeição já registrada", error.message, {
          eventId: "recognition.duplicate",
          payload: {
            studentName: result.student.full_name,
            mealType: selectedMealType,
            dedupeKey: `confirm-duplicate-${result.student.id}-${selectedMealType}`,
          },
        });
        prepareNextCapture();
      } else {
        setErrorMessage(
          error instanceof ApiError ? error.message : "Não foi possível confirmar o atendimento.",
        );
      }
    } finally {
      setIsRegistering(false);
    }
  };

  const handleOpenCpfModal = () => {
    setCpfInput("");
    setCpfModalError("");
    setShowCpfModal(true);
  };

  const handleCloseCpfModal = () => {
    if (isCpfValidating) {
      return;
    }
    setShowCpfModal(false);
    setCpfInput("");
    setCpfModalError("");
  };

  const handleValidateByCpf = async () => {
    if (!token || !selectedMealType) {
      return;
    }

    const normalizedCpf = normalizeCpf(cpfInput);
    if (!isValidCpf(normalizedCpf)) {
      setCpfModalError("Informe um CPF válido para continuar.");
      return;
    }

    setCpfModalError("");
    setIsCpfValidating(true);

    try {
      const cpfResponse = await recognitionApi.identifyByCpf(token, {
        cpf: normalizedCpf,
        meal_type: selectedMealType,
      });

      setShowCpfModal(false);
      setCpfInput("");

      if (cpfResponse.already_recorded_today) {
        showToast(
          "warning",
          "Refeição já registrada",
          cpfResponse.already_recorded_message ?? "Esse aluno já recebeu essa refeição hoje.",
          {
            eventId: "recognition.duplicate",
            payload: {
              studentName: cpfResponse.student?.full_name,
              mealType: selectedMealType,
              dedupeKey: `duplicate-cpf-${cpfResponse.student?.id ?? "unknown"}-${selectedMealType}`,
            },
          },
        );
        prepareNextCapture();
        return;
      }

      if (!cpfResponse.student || cpfResponse.status === "not_found") {
        showToast("warning", "CPF não encontrado", cpfResponse.message, {
          eventId: "recognition.not_found",
          payload: {
            dedupeKey: `cpf-not-found-${normalizedCpf}`,
          },
        });
        restartCamera();
        return;
      }

      if (selectedMealType === "sem_rodizio") {
        setResult(null);
        setErrorMessage("");
        setStatusMessage("");
        setStep("camera");
        setIsCameraEnabled(false);
        setCompactReview({
          result: cpfResponse,
          alreadyRecorded: cpfResponse.already_recorded_today,
        });
        setCompactReviewError("");
        setIsCpfValidatedResult(false);
        return;
      }

      setOperatorOverrideAccepted(false);
      setErrorMessage("");
      setStatusMessage(cpfResponse.message);
      setCompactReview(null);
      setCompactReviewError("");
      setIsCpfValidatedResult(true);
      setResult(cpfResponse);
      setStep("result");
    } catch (error) {
      setCpfModalError(
        error instanceof ApiError ? error.message : "Não foi possível validar o CPF agora. Tente novamente.",
      );
    } finally {
      setIsCpfValidating(false);
    }
  };

  const handleCompactReviewConfirm = async () => {
    if (!token || !selectedMealType || selectedMealType !== "sem_rodizio" || !compactReview?.result.student) {
      return;
    }

    setIsRegistering(true);
    setCompactReviewError("");

    try {
      if (compactReview.alreadyRecorded) {
        showToast(
          "success",
          "Verificação concluída",
          "Esse aluno já foi contabilizado hoje no sem rodízio.",
          {
            eventId: "sem_rodizio.repeat_confirmed",
            payload: {
              studentName: compactReview.result.student.full_name,
              mealType: "sem_rodizio",
              dedupeKey: `sem-repeat-${compactReview.result.student.id}`,
            },
          },
        );
        prepareNextCapture();
        return;
      }

      await mealEntriesApi.create(token, {
        student_id: compactReview.result.student.id,
        meal_type: "sem_rodizio",
        source: compactReview.result.status === "success" ? "reconhecimento" : "revisao_operador",
        confidence: compactReview.result.confidence,
      });

      showToast("success", "Sem rodízio confirmado", "Aluno validado e contabilizado com sucesso.", {
        eventId: "sem_rodizio.first_confirmed",
        payload: {
          studentName: compactReview.result.student.full_name,
          mealType: "sem_rodizio",
          dedupeKey: `sem-first-${compactReview.result.student.id}`,
        },
      });
      prepareNextCapture();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        showToast(
          "warning",
          "Sem rodízio já contabilizado",
          "Esse aluno já foi contabilizado hoje no sem rodízio.",
          {
            eventId: "sem_rodizio.repeat_confirmed",
            payload: {
              studentName: compactReview.result.student.full_name,
              mealType: "sem_rodizio",
              dedupeKey: `sem-repeat-409-${compactReview.result.student.id}`,
            },
          },
        );
        prepareNextCapture();
      } else {
        setCompactReviewError(
          error instanceof ApiError ? error.message : "Não foi possível concluir a validação do sem rodízio.",
        );
      }
    } finally {
      setIsRegistering(false);
    }
  };

  const handleCompactReviewReject = () => {
    if (compactReview?.result.student) {
      void emit("recognition.rejected", {
        studentName: compactReview.result.student.full_name,
        dedupeKey: `sem-reject-${compactReview.result.student.id}`,
      });
    }
    prepareNextCapture();
  };

  useEffect(() => {
    if (!compactReview) {
      return;
    }

    void emit("notification.generic", {
      dedupeKey: `compact-review-${compactReview.result.student?.id ?? compactReview.result.status}`,
    });
  }, [compactReview, emit]);

  const isCpfResolvedResult = Boolean(isCpfValidatedResult && result?.student && result?.status === "low_confidence");
  const toneClass = isCpfResolvedResult
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : getRecognitionTone(result?.status ?? null);
  const needsManualReview =
    Boolean(result?.student) &&
    ((result?.status === "low_confidence") || (result?.status === "success" && (result.confidence ?? 0) < 0.93));
  const canConfirm =
    Boolean(result?.student) &&
    Boolean(selectedMealType) &&
    (result?.status === "success" || result?.status === "low_confidence") &&
    (!needsManualReview || operatorOverrideAccepted);
  const canValidateWithCpf =
    !isCpfValidatedResult &&
    (result?.status === "low_confidence" ||
      result?.status === "not_found" ||
      result?.status === "no_face_detected" ||
      result?.status === "multiple_faces_detected");
  const currentScheduleDate = new Date(scheduleTick);
  const visibleMealOptions = mealOptions
    .map((mealOption) => ({
      ...mealOption,
      scheduleSummary: formatMealWindowSummary(mealSchedule, mealOption.value),
    }))
    .filter((mealOption) =>
      user ? isMealVisibleForRole(mealSchedule, mealOption.value, user.role, currentScheduleDate) : true,
    );
  const noMealOptionsAvailable = visibleMealOptions.length === 0;

  return (
    <section className="space-y-6">
      {toast && <OperationToast toast={toast} onClose={() => setToast(null)} />}
      {compactReview && selectedMealType === "sem_rodizio" && (
        <CompactReviewModal
          review={compactReview}
          isSubmitting={isRegistering}
          errorMessage={compactReviewError}
          onConfirm={handleCompactReviewConfirm}
          onReject={handleCompactReviewReject}
          onValidateCpf={handleOpenCpfModal}
        />
      )}
      {showCpfModal && (
        <CpfValidationModal
          cpfValue={cpfInput}
          errorMessage={cpfModalError}
          isSubmitting={isCpfValidating}
          onChangeCpf={(value) => {
            setCpfInput(formatCpf(value));
            setCpfModalError("");
          }}
          onCancel={handleCloseCpfModal}
          onConfirm={() => void handleValidateByCpf()}
        />
      )}

      {step === "choose_meal" && (
        <>
          {!isLoadingMealSchedule ? (
            <div className="grid gap-4 md:grid-cols-3">
            {visibleMealOptions.map((mealOption) => (
              <button
                key={mealOption.value}
                type="button"
                onClick={() => handleMealSelection(mealOption.value)}
                className="rounded-[2rem] border border-slate-200 bg-white p-6 text-left shadow-lg shadow-slate-200 transition hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-xl"
              >
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-orange-600">Refeicao</p>
                <h3 className="mt-3 text-2xl font-black text-slate-900">{mealOption.title}</h3>
                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {mealOption.scheduleSummary}
                </p>
              </button>
            ))}
            </div>
          ) : null}
          {!isLoadingMealSchedule && noMealOptionsAvailable ? (
            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 text-center shadow-lg shadow-slate-200">
              <p className="text-base font-semibold text-slate-700">
                Nenhuma refeicao disponivel neste horario
              </p>
            </div>
          ) : null}
          {isLoadingMealSchedule ? (
            <p className="text-center text-sm font-semibold text-slate-500">Atualizando horarios...</p>
          ) : null}
        </>
      )}

      {step === "camera" && selectedMealType && (
        <div className="space-y-4">
          <div className="rounded-[1.75rem] border border-slate-200 bg-white px-5 py-4 shadow-lg shadow-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">Refeição</p>
                <p className="mt-2 text-lg font-black text-slate-900">{getMealTypeLabel(selectedMealType)}</p>
              </div>

              <button
                type="button"
                onClick={resetToMealSelection}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
              >
                <ArrowLeft className="h-4 w-4" />
                Trocar refeição
              </button>
            </div>

            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Modo de reconhecimento</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {captureModeOptions.map((modeOption) => {
                  const isActive = captureMode === modeOption.value;
                  return (
                    <button
                      key={modeOption.value}
                      type="button"
                      onClick={() => setCaptureMode(modeOption.value)}
                      className={`rounded-2xl border px-3 py-3 text-left transition ${
                        isActive
                          ? "border-orange-300 bg-orange-50 shadow-sm shadow-orange-100"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <p className={`text-sm font-black ${isActive ? "text-orange-700" : "text-slate-900"}`}>{modeOption.title}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{modeOption.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="mt-4 flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={autoStartCamera}
                onChange={(event) => setAutoStartCamera(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-orange-500"
              />
              Abrir câmera automaticamente na próxima leitura
            </label>
          </div>

          {!isCameraEnabled ? (
            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200">
              <div className="rounded-[1.75rem] border border-dashed border-orange-300 bg-orange-50 p-6 text-center">
                <Camera className="mx-auto h-10 w-10 text-orange-500" />
                <h3 className="mt-4 text-xl font-black text-slate-900">Câmera pronta para abrir</h3>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  A refeição continua selecionada. Abra a câmera quando o próximo aluno estiver posicionado.
                </p>

                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      void primeAudio();
                      setIsCameraEnabled(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-6 py-4 font-semibold text-white shadow-lg shadow-orange-200 transition hover:bg-orange-600"
                  >
                    <Camera className="h-5 w-5" />
                    Abrir câmera
                  </button>
                  <button
                    type="button"
                    onClick={resetToMealSelection}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-4 font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Escolher outra refeição
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <CameraCapture
              mode={captureMode}
              isBusy={isIdentifying}
              onCapture={handleCapturedFrame}
              onCancel={() => setIsCameraEnabled(false)}
            />
          )}
        </div>
      )}

      {step === "result" && (
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-5">
            <div className={`rounded-[2rem] border p-6 shadow-lg shadow-slate-200 ${toneClass}`}>
              <div className="flex items-center gap-3">
                {result?.status === "success" || isCpfResolvedResult ? (
                  <CheckCircle2 className="h-6 w-6" />
                ) : result?.status === "low_confidence" ? (
                  <AlertTriangle className="h-6 w-6" />
                ) : (
                  <XCircle className="h-6 w-6" />
                )}
                <h3 className="text-xl font-black">
                  {isCpfResolvedResult
                    ? "Aluno confirmado"
                    : result
                      ? getRecognitionLabel(result.status)
                      : "Identificação indisponível"}
                </h3>
              </div>

              <p className="mt-4 text-sm leading-7">{errorMessage || statusMessage || "Nenhum retorno recebido ainda."}</p>

              {result && !isCpfResolvedResult && (
                <div className="mt-4 grid gap-3 text-sm font-semibold md:grid-cols-2">
                  <div className="rounded-2xl bg-white/70 px-4 py-3 text-slate-700">
                    Confiança: {formatConfidence(result.confidence)}
                  </div>
                  <div className="rounded-2xl bg-white/70 px-4 py-3 text-slate-700">
                    Limite: {formatConfidence(result.threshold)}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <button
                  type="button"
                  onClick={restartCamera}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-100 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-200"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Tentar novamente
                </button>
                <button
                  type="button"
                  onClick={resetToMealSelection}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Trocar refeição
                </button>
                {canValidateWithCpf && (
                  <button
                    type="button"
                    onClick={handleOpenCpfModal}
                    className="inline-flex items-center gap-2 rounded-2xl border border-orange-200 bg-orange-50 px-5 py-3 font-semibold text-orange-700 transition hover:bg-orange-100"
                  >
                    Validar com CPF
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={!canConfirm || isRegistering}
                  className="inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-6 py-3 font-semibold text-white shadow-lg shadow-orange-200 transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {isRegistering
                    ? "Confirmando..."
                    : needsManualReview
                      ? "Aceitar mesmo assim"
                      : "Confirmar atendimento"}
                </button>
              </div>
            </div>
          </div>

          <aside className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200">
            <h3 className="text-xl font-black text-slate-900">Aluno identificado</h3>

            {result?.student ? (
              <div className="mt-5 rounded-[1.75rem] bg-[linear-gradient(135deg,#fff7ed_0%,#ffffff_50%,#eff6ff_100%)] p-5">
                <div className="flex items-center gap-4">
                  {result.student.photo_url ? (
                    <img
                      src={result.student.photo_url}
                      alt={result.student.full_name}
                      className="h-20 w-20 rounded-[1.25rem] object-cover shadow-lg shadow-slate-200"
                    />
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-[1.25rem] bg-slate-200 text-slate-500 shadow-lg shadow-slate-200">
                      <UserRound className="h-9 w-9" />
                    </div>
                  )}
                  <div>
                    <p className="text-2xl font-black text-slate-900">{result.student.full_name}</p>
                    <p className="mt-1 text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">
                      {result.student.class_display_name}
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm shadow-slate-200">
                    Refeição: <span className="font-semibold">{getMealTypeLabel(selectedMealType!)}</span>
                  </div>
                  <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm shadow-slate-200">
                    Confiança: <span className="font-semibold">{formatConfidence(result.confidence)}</span>
                  </div>
                </div>

                {needsManualReview && (
                  <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-7 text-amber-800">
                    <p className="font-semibold">Conferência manual obrigatória.</p>
                    <p className="mt-2">
                      Confira a foto, o nome e a turma antes de liberar o atendimento para evitar falso positivo.
                    </p>
                    <label className="mt-4 flex items-start gap-3 rounded-2xl bg-white/80 px-4 py-3 text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={operatorOverrideAccepted}
                        onChange={(event) => setOperatorOverrideAccepted(event.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-orange-500"
                      />
                      Confirmo que a pessoa e os dados exibidos estão corretos.
                    </label>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-5 rounded-[1.75rem] border border-dashed border-slate-300 bg-slate-50 p-6 text-sm leading-7 text-slate-500">
                Nenhum aluno foi confirmado. Ajuste o enquadramento e tente novamente.
              </div>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}

function CompactReviewModal({
  review,
  isSubmitting,
  errorMessage,
  onConfirm,
  onReject,
  onValidateCpf,
}: {
  review: NonNullable<CompactReviewState>;
  isSubmitting: boolean;
  errorMessage: string;
  onConfirm: () => void;
  onReject: () => void;
  onValidateCpf: () => void;
}) {
  const student = review.result.student;

  if (!student) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-[2rem] border border-white/70 bg-white p-6 shadow-2xl shadow-slate-900/25 sm:p-7">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-orange-600">Sem rodízio</p>
        <h3 className="mt-3 text-2xl font-black text-slate-900">
          {review.alreadyRecorded ? "Aluno já contabilizado hoje" : "Confirmar validação rápida"}
        </h3>
        <p className="mt-3 text-sm leading-7 text-slate-600">
          {review.alreadyRecorded
            ? "Confira se a pessoa reconhecida está correta. Essa nova passagem não será somada de novo."
            : "Confira os dados abaixo antes de liberar a entrada do sem rodízio."}
        </p>

        <div className="mt-5 rounded-[1.75rem] bg-[linear-gradient(135deg,#fff7ed_0%,#ffffff_55%,#eff6ff_100%)] p-5">
          <div className="flex items-center gap-4">
            {student.photo_url ? (
              <img
                src={student.photo_url}
                alt={student.full_name}
                className="h-20 w-20 rounded-[1.25rem] object-cover shadow-lg shadow-slate-200"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-[1.25rem] bg-slate-200 text-slate-500 shadow-lg shadow-slate-200">
                <UserRound className="h-9 w-9" />
              </div>
            )}

            <div className="min-w-0">
              <p className="truncate text-xl font-black text-slate-900">{student.full_name}</p>
              <p className="mt-1 text-sm font-semibold uppercase tracking-[0.18em] text-orange-600">
                {student.class_display_name}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm shadow-slate-200">
              Refeição: <span className="font-semibold">Sem rodízio</span>
            </div>
            <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm shadow-slate-200">
              Confiança: <span className="font-semibold">{formatConfidence(review.result.confidence)}</span>
            </div>
          </div>

          {review.result.status === "low_confidence" && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-7 text-amber-800">
              Reconhecimento com baixa confiança. Confirme apenas se a foto e os dados estiverem corretos.
            </div>
          )}

          {review.alreadyRecorded && (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm leading-7 text-emerald-800">
              Esse aluno já foi contabilizado hoje. A confirmação abaixo serve só para validar a passagem.
            </div>
          )}
        </div>

        {errorMessage && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onReject}
            className="flex-1 rounded-2xl border border-slate-200 bg-slate-100 px-5 py-4 font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            Não é essa pessoa
          </button>
          <button
            type="button"
            onClick={onValidateCpf}
            className="flex-1 rounded-2xl border border-orange-200 bg-orange-50 px-5 py-4 font-semibold text-orange-700 transition hover:bg-orange-100"
          >
            Validar com CPF
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="flex-1 rounded-2xl bg-orange-500 px-5 py-4 font-semibold text-white shadow-lg shadow-orange-100 transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSubmitting
              ? "Confirmando..."
              : review.alreadyRecorded
                ? "Confirmar pessoa"
                : "Liberar sem rodízio"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CpfValidationModal({
  cpfValue,
  errorMessage,
  isSubmitting,
  onChangeCpf,
  onCancel,
  onConfirm,
}: {
  cpfValue: string;
  errorMessage: string;
  isSubmitting: boolean;
  onChangeCpf: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cpfReady = normalizeCpf(cpfValue).length === 11;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-[2rem] border border-white/70 bg-white p-6 shadow-2xl shadow-slate-900/25 sm:p-7">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-orange-600">Validação manual</p>
        <h3 className="mt-3 text-2xl font-black text-slate-900">Valide a entrada com o CPF</h3>
        <p className="mt-3 text-sm leading-7 text-slate-600">
          Digite o CPF do aluno para localizar o cadastro e retornar para a confirmação manual.
        </p>

        <div className="mt-5">
          <label htmlFor="cpfValidation" className="mb-2 block text-sm font-semibold text-slate-700">
            CPF do aluno
          </label>
          <input
            id="cpfValidation"
            type="text"
            value={cpfValue}
            onChange={(event) => onChangeCpf(event.target.value)}
            placeholder="000.000.000-00"
            maxLength={14}
            inputMode="numeric"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-orange-400"
          />
        </div>

        {errorMessage && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="flex-1 rounded-2xl border border-slate-200 bg-slate-100 px-5 py-4 font-semibold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting || !cpfReady}
            className="flex-1 rounded-2xl bg-orange-500 px-5 py-4 font-semibold text-white shadow-lg shadow-orange-100 transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSubmitting ? "Validando..." : "Validar CPF"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OperationToast({
  toast,
  onClose,
}: {
  toast: NonNullable<ToastState>;
  onClose: () => void;
}) {
  const toneClass = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    error: "border-rose-200 bg-rose-50 text-rose-800",
  }[toast.tone];

  const icon = {
    success: <CheckCircle2 className="h-5 w-5" />,
    warning: <AlertTriangle className="h-5 w-5" />,
    error: <XCircle className="h-5 w-5" />,
  }[toast.tone];

  return (
    <div className="pointer-events-none fixed inset-x-4 top-4 z-50 flex justify-center sm:justify-end">
      <div className={`pointer-events-auto w-full max-w-md rounded-[1.5rem] border px-5 py-4 shadow-2xl ${toneClass}`}>
        <div className="flex items-start gap-3">
          <div className="mt-0.5">{icon}</div>
          <div className="min-w-0 flex-1">
            <p className="font-black">{toast.title}</p>
            <p className="mt-1 text-sm leading-6">{toast.message}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-2 py-1 text-xs font-semibold opacity-70 transition hover:opacity-100"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
