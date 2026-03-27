from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass

from app.models.entities import RecognitionStatus


@dataclass(slots=True)
class FaceExtractionResult:
    status: RecognitionStatus
    vector: list[float] | None
    message: str
    engine: str


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
                )

        digest = hashlib.sha256(image_bytes).digest()
        vector = [byte / 255 for byte in (digest * 4)[:128]]
        return FaceExtractionResult(
            status=RecognitionStatus.success,
            vector=vector,
            message="Embedding gerado em modo mock.",
            engine=self.engine_name,
        )


class FaceRecognitionLibraryEngine(BaseFaceEngine):
    engine_name = "face_recognition"

    def __init__(self) -> None:
        import face_recognition  # type: ignore[import-not-found]
        import numpy as np

        self.face_recognition = face_recognition
        self.np = np

    def _detect_locations(self, image) -> list[tuple[int, int, int, int]]:
        for upsample in (0, 1, 2):
            locations = self.face_recognition.face_locations(
                image,
                number_of_times_to_upsample=upsample,
                model="hog",
            )
            if locations:
                return locations
        return []

    def extract_embedding(self, image_bytes: bytes) -> FaceExtractionResult:
        image = self.face_recognition.load_image_file(io.BytesIO(image_bytes))
        locations = self._detect_locations(image)
        if len(locations) == 0:
            # Low-light fallback: stretch contrast and retry.
            enhanced = self.np.clip((image.astype("float32") - 110.0) * 1.35 + 128.0, 0, 255).astype("uint8")
            locations = self._detect_locations(enhanced)
            if len(locations) == 1:
                image = enhanced

        if len(locations) == 0:
            return FaceExtractionResult(
                status=RecognitionStatus.no_face_detected,
                vector=None,
                message="Nenhum rosto detectado na imagem enviada.",
                engine=self.engine_name,
            )
        if len(locations) > 1:
            return FaceExtractionResult(
                status=RecognitionStatus.multiple_faces_detected,
                vector=None,
                message="Mais de um rosto foi detectado na imagem enviada.",
                engine=self.engine_name,
            )

        encodings = self.face_recognition.face_encodings(
            image,
            known_face_locations=locations,
            num_jitters=2,
            model="small",
        )
        if not encodings:
            return FaceExtractionResult(
                status=RecognitionStatus.no_face_detected,
                vector=None,
                message="Não foi possível gerar o embedding facial.",
                engine=self.engine_name,
            )

        vector = [float(value) for value in encodings[0].tolist()]
        return FaceExtractionResult(
            status=RecognitionStatus.success,
            vector=vector,
            message="Embedding facial gerado com face_recognition.",
            engine=self.engine_name,
        )


class OpenCvHistogramFaceEngine(BaseFaceEngine):
    engine_name = "opencv"

    def __init__(self) -> None:
        import cv2  # type: ignore[import-not-found]
        import numpy as np

        self.cv2 = cv2
        self.np = np
        cascade_path = self.cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        self.detector = self.cv2.CascadeClassifier(cascade_path)

    def _detect_faces(self, grayscale):
        attempts = (
            (grayscale, 1.1, 5, (48, 48)),
            (grayscale, 1.1, 4, (40, 40)),
            (self.cv2.equalizeHist(grayscale), 1.1, 4, (36, 36)),
            (self.cv2.equalizeHist(grayscale), 1.2, 3, (32, 32)),
        )
        for image, scale_factor, min_neighbors, min_size in attempts:
            faces = self.detector.detectMultiScale(
                image,
                scaleFactor=scale_factor,
                minNeighbors=min_neighbors,
                minSize=min_size,
            )
            if len(faces) > 0:
                return faces, image
        return (), grayscale

    def _build_vector(self, grayscale_face) -> list[float]:
        resized = self.cv2.resize(grayscale_face, (32, 32))
        equalized = self.cv2.equalizeHist(resized)
        normalized = equalized.astype("float32") / 255.0

        histogram = self.cv2.calcHist([equalized], [0], None, [32], [0, 256]).flatten().astype("float32")
        hist_norm = histogram.sum()
        if hist_norm > 0:
            histogram /= hist_norm

        small = self.cv2.resize(normalized, (16, 8))
        grad_x = self.cv2.Sobel(small, self.cv2.CV_32F, 1, 0, ksize=3)
        grad_y = self.cv2.Sobel(small, self.cv2.CV_32F, 0, 1, ksize=3)
        gradient = self.np.sqrt((grad_x * grad_x) + (grad_y * grad_y))
        gradient = gradient / (float(gradient.max()) + 1e-6)

        vector = self.np.concatenate([histogram, small.flatten(), gradient.flatten()])
        return [float(value) for value in vector.tolist()]

    def extract_embedding(self, image_bytes: bytes) -> FaceExtractionResult:
        np_buffer = self.np.frombuffer(image_bytes, dtype=self.np.uint8)
        image = self.cv2.imdecode(np_buffer, self.cv2.IMREAD_COLOR)
        if image is None:
            return FaceExtractionResult(
                status=RecognitionStatus.no_face_detected,
                vector=None,
                message="A imagem enviada não pode ser lida.",
                engine=self.engine_name,
            )

        grayscale = self.cv2.cvtColor(image, self.cv2.COLOR_BGR2GRAY)
        faces, reference_image = self._detect_faces(grayscale)
        if len(faces) == 0:
            return FaceExtractionResult(
                status=RecognitionStatus.no_face_detected,
                vector=None,
                message="Nenhum rosto detectado na imagem enviada.",
                engine=self.engine_name,
            )

        if len(faces) > 1:
            ordered_faces = sorted(faces, key=lambda face: int(face[2]) * int(face[3]), reverse=True)
            largest_area = int(ordered_faces[0][2]) * int(ordered_faces[0][3])
            second_area = int(ordered_faces[1][2]) * int(ordered_faces[1][3])
            if second_area == 0 or (largest_area / second_area) >= 1.8:
                faces = [ordered_faces[0]]
            else:
                return FaceExtractionResult(
                    status=RecognitionStatus.multiple_faces_detected,
                    vector=None,
                    message="Mais de um rosto foi detectado na imagem enviada.",
                    engine=self.engine_name,
                )

        x, y, width, height = [int(value) for value in faces[0]]
        face_crop = reference_image[y : y + height, x : x + width]
        if face_crop.size == 0:
            return FaceExtractionResult(
                status=RecognitionStatus.no_face_detected,
                vector=None,
                message="Não foi possível recortar o rosto detectado.",
                engine=self.engine_name,
            )

        vector = self._build_vector(face_crop)
        return FaceExtractionResult(
            status=RecognitionStatus.success,
            vector=vector,
            message="Embedding visual gerado com OpenCV.",
            engine=self.engine_name,
        )


def build_face_engine(engine_name: str) -> BaseFaceEngine:
    normalized = engine_name.casefold().strip()
    if normalized == "mock":
        return MockFaceEngine()
    if normalized == "face_recognition":
        try:
            return FaceRecognitionLibraryEngine()
        except Exception:
            return OpenCvHistogramFaceEngine()
    if normalized == "opencv":
        return OpenCvHistogramFaceEngine()

    for candidate in (FaceRecognitionLibraryEngine, OpenCvHistogramFaceEngine, MockFaceEngine):
        try:
            return candidate()
        except Exception:
            continue
    return MockFaceEngine()
