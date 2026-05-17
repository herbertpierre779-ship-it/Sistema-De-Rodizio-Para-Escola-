declare module "@mediapipe/tasks-vision" {
  export const FilesetResolver: {
    forVisionTasks(wasmRoot: string): Promise<unknown>;
  };
  export const FaceDetector: {
    createFromOptions(
      vision: unknown,
      options: {
        baseOptions: { modelAssetPath: string };
        runningMode: "VIDEO";
        minDetectionConfidence?: number;
      },
    ): Promise<{
      detectForVideo(video: HTMLVideoElement, timestampMs: number): unknown;
      close(): void;
    }>;
  };
}
