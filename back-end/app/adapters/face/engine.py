from __future__ import annotations

import hashlib
import threading
from dataclasses import dataclass
from pathlib import Path

from app.models.entities import RecognitionStatus


@dataclass(slots=True)
class FaceExtractionResult:
    status: RecognitionStatus
    vector: list[float] | None
    message: str
    engine: str
    quality_score: float | None = None
    cropped_image_bytes: bytes | None = None
    normalized_image_bytes: bytes | None = None


class BaseFaceEngine:
    engine_name = "base"

    def extract_embedding(self, image_bytes: bytes) -> FaceExtractionResult:
        raise NotImplementedError


class MockFaceEngine(BaseFaceEngine):
    engine_name = "mock"

    def extract_embedding(self, image_bytes: bytes) -> FaceExtractionResult:
        lowered = image_bytes.lower()
        if b"no-face" in lowered:
            return FaceExtractionResult(
                status=RecognitionStatus.no_face_detected,
                vector=None,
                message="Nenhum rosto detectado na imagem enviada.",
                engine=self.engine_name,
            )
        if b"multiple-faces" in lowered:
            return FaceExtractionResult(
                status=RecognitionStatus.multiple_faces_detected,
                vector=None,
                message="Mais de um rosto foi detectado na imagem enviada.",
                engine=self.engine_name,
            )

        if lowered.startswith(b"vector:"):
            raw_vector = lowered.split(b":", maxsplit=1)[1].decode("utf-8")
            parsed_values = [float(value.strip()) for value in raw_vector.split(",") if value.strip()]
            if parsed_values:
                repeats = (128 // len(parsed_values)) + 1
                vector = (parsed_values * repeats)[:128]
                return FaceExtractionResult(
                    status=RecognitionStatus.success,
                    vector=vector,
                    message="Embedding gerado em modo mock a partir do vetor informado.",
                    engine=self.engine_name,
                    quality_score=0.75,
                )

        digest = hashlib.sha256(image_bytes).digest()
        vector = [byte / 255 for byte in (digest * 4)[:128]]
        return FaceExtractionResult(
            status=RecognitionStatus.success,
            vector=vector,
            message="Embedding gerado em modo mock.",
            engine=self.engine_name,
            quality_score=0.65,
        )


class NaoGazeiFaceEngine(BaseFaceEngine):
    engine_name = "naogazei_face"

    def __init__(self, models_dir: Path) -> None:
        import cv2  # type: ignore[import-not-found]
        import numpy as np

        self.cv2 = cv2
        self.np = np
        self.models_dir = models_dir
        self.detector_model_path = self._ensure_model_file("face_detection_yunet_2023mar.onnx")
        self.recognizer_model_path = self._ensure_model_file("face_recognition_sface_2021dec.onnx")
        self._engine_lock = threading.RLock()
        self.detector = self._create_detector()
        self.recognizer = self._create_recognizer()

    def _ensure_model_file(self, filename: str) -> str:
        model_path = (self.models_dir / filename).resolve()
        if not model_path.exists() or not model_path.is_file():
            raise RuntimeError(
                f"Modelo obrigatorio ausente: {filename}. "
                f"Esperado em {model_path}. Copie os modelos para back-end/models."
            )
        return str(model_path)

    @staticmethod
    def _clamp(value: float, low: float, high: float) -> float:
        return max(low, min(high, value))

    def _decode_image(self, image_bytes: bytes):
        np_buffer = self.np.frombuffer(image_bytes, dtype=self.np.uint8)
        return self.cv2.imdecode(np_buffer, self.cv2.IMREAD_COLOR)

    def _create_detector(self):
        try:
            return self.cv2.FaceDetectorYN.create(
                self.detector_model_path,
                "",
                (320, 320),
                score_threshold=0.45,
                nms_threshold=0.3,
                top_k=5000,
            )
        except Exception as exc:
            raise RuntimeError(f"Falha ao inicializar detector YuNet: {exc}") from exc

    def _create_recognizer(self):
        try:
            return self.cv2.FaceRecognizerSF.create(self.recognizer_model_path, "")
        except Exception as exc:
            raise RuntimeError(f"Falha ao inicializar reconhecedor SFace: {exc}") from exc

    def _detect_faces_once(self, image) -> list:
        if image is None or image.size == 0:
            return []
        if not image.flags["C_CONTIGUOUS"]:
            image = self.np.ascontiguousarray(image)
        height, width = image.shape[:2]
        self.detector.setInputSize((int(width), int(height)))
        _, faces = self.detector.detect(image)
        if faces is None:
            return []
        return [face for face in faces if face is not None and len(face) >= 4]

    def _detect_faces(self, image) -> list:
        if image is None or image.size == 0:
            return []
        with self._engine_lock:
            try:
                faces = self._detect_faces_once(image)
                if faces:
                    return faces

                # Fallback para imagens escuras/contraste ruim vindas de webcam.
                enhanced = self.cv2.convertScaleAbs(image, alpha=1.15, beta=12)
                return self._detect_faces_once(enhanced)
            except Exception:
                self.detector = self._create_detector()
                try:
                    faces = self._detect_faces_once(image)
                    if faces:
                        return faces
                    enhanced = self.cv2.convertScaleAbs(image, alpha=1.15, beta=12)
                    return self._detect_faces_once(enhanced)
                except Exception:
                    return []

    @staticmethod
    def _select_largest_face(faces: list):
        if len(faces) == 0:
            return None
        return max(faces, key=lambda face: float(face[2]) * float(face[3]))

    def _crop_with_margin(self, image, face, margin_ratio: float):
        height, width = image.shape[:2]
        x = int(face[0])
        y = int(face[1])
        w = int(face[2])
        h = int(face[3])
        mx = int(w * margin_ratio)
        my = int(h * margin_ratio)
        x1 = max(0, x - mx)
        y1 = max(0, y - my)
        x2 = min(width, x + w + mx)
        y2 = min(height, y + h + my)
        if x2 <= x1 or y2 <= y1:
            return None
        return image[y1:y2, x1:x2]

    def _l2_normalize(self, vector):
        normalized = self.np.asarray(vector, dtype=self.np.float32).flatten()
        norm = float(self.np.linalg.norm(normalized))
        if norm > 0:
            normalized = normalized / norm
        return normalized

    def _extract_feature(self, image, face):
        with self._engine_lock:
            try:
                aligned = self.recognizer.alignCrop(image, face)
                return aligned, self.recognizer.feature(aligned)
            except self.cv2.error:
                self.recognizer = self._create_recognizer()
                try:
                    aligned = self.recognizer.alignCrop(image, face)
                    return aligned, self.recognizer.feature(aligned)
                except self.cv2.error:
                    return None, None
            except Exception:
                return None, None

    def extract_embedding(self, image_bytes: bytes) -> FaceExtractionResult:
        try:
            image = self._decode_image(image_bytes)
        except Exception:
            image = None
        if image is None or image.size == 0:
            return FaceExtractionResult(
                status=RecognitionStatus.no_face_detected,
                vector=None,
                message="A imagem enviada nao pode ser lida.",
                engine=self.engine_name,
            )

        faces = self._detect_faces(image)
        selected_face = self._select_largest_face(faces)
        if selected_face is None:
            return FaceExtractionResult(
                status=RecognitionStatus.no_face_detected,
                vector=None,
                message="Nenhum rosto detectado na imagem enviada.",
                engine=self.engine_name,
            )

        aligned, feature = self._extract_feature(image, selected_face)
        if aligned is None or feature is None:
            return FaceExtractionResult(
                status=RecognitionStatus.no_face_detected,
                vector=None,
                message="Nao foi possivel gerar o embedding facial.",
                engine=self.engine_name,
            )

        normalized_feature = self._l2_normalize(feature)
        vector = [float(value) for value in normalized_feature.tolist()]
        if not vector:
            return FaceExtractionResult(
                status=RecognitionStatus.no_face_detected,
                vector=None,
                message="Nao foi possivel gerar o embedding facial.",
                engine=self.engine_name,
            )

        face_area = max(1.0, float(selected_face[2]) * float(selected_face[3]))
        frame_area = max(1.0, float(image.shape[0]) * float(image.shape[1]))
        area_ratio = self._clamp(face_area / frame_area, 0.0, 1.0)
        face_crop = self._crop_with_margin(image, selected_face, margin_ratio=0.35)
        if face_crop is None or face_crop.size == 0:
            face_crop = image
        gray = self.cv2.cvtColor(face_crop, self.cv2.COLOR_BGR2GRAY)
        sharpness = float(self.cv2.Laplacian(gray, self.cv2.CV_32F).var())
        sharpness_score = self._clamp(sharpness / 220.0, 0.0, 1.0)
        det_score = float(selected_face[14]) if len(selected_face) > 14 else 0.5
        quality_score = self._clamp((area_ratio * 0.35) + (sharpness_score * 0.4) + (det_score * 0.25), 0.0, 1.0)

        cropped_image_bytes: bytes | None = None
        try:
            encoded_crop_ok, encoded_crop = self.cv2.imencode(".jpg", face_crop)
            if encoded_crop_ok:
                cropped_image_bytes = bytes(encoded_crop.tobytes())
        except Exception:
            cropped_image_bytes = None

        normalized_image_bytes: bytes | None = None
        try:
            encoded_ok, encoded = self.cv2.imencode(".jpg", aligned)
            if encoded_ok:
                normalized_image_bytes = bytes(encoded.tobytes())
        except Exception:
            normalized_image_bytes = None

        return FaceExtractionResult(
            status=RecognitionStatus.success,
            vector=vector,
            message="Embedding facial gerado com pipeline NAOGAZEI.",
            engine=self.engine_name,
            quality_score=quality_score,
            cropped_image_bytes=cropped_image_bytes,
            normalized_image_bytes=normalized_image_bytes,
        )


def build_face_engine(engine_name: str, *, models_dir: Path | None = None) -> BaseFaceEngine:
    normalized = engine_name.casefold().strip()
    if normalized == "mock":
        return MockFaceEngine()

    if normalized in {"naogazei_face", "naogazei", "sface_yunet", "sface", "yunet", "auto"}:
        if models_dir is None:
            raise RuntimeError("Diretorio de modelos nao informado para engine naogazei_face.")
        return NaoGazeiFaceEngine(models_dir)

    raise ValueError(
        f"Engine facial nao suportada: '{engine_name}'. "
        "Use 'naogazei_face' (producao) ou 'mock' (testes)."
    )
