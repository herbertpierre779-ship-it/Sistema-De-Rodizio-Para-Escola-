import { describe, expect, it, vi, afterEach } from "vitest";
import { studentsApi } from "../src/app/lib/api";

describe("studentsApi recaptura", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("busca face-assets do aluno selecionado", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            student_id: "7",
            full_name: "ALUNO TESTE",
            cpf: "12345678909",
            class_id: "3",
            school_year: "1 ano",
            mode_hint: "three_photos",
            samples_count: 3,
            front_url: "/media/front.jpg",
            right_url: "/media/right.jpg",
            left_url: "/media/left.jpg",
            sample_urls: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    await studentsApi.getFaceAssets("token", "7");

    const [url, request] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/students/7/face-assets");
    expect(request?.method).toBe("GET");
    expect(request?.headers).toBeDefined();
  });

  it("envia recaptura em lote com mode e lista de arquivos", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            student: {
              id: "9",
              full_name: "ALUNO TESTE",
              class_id: "2",
              class_name: "A",
              class_display_name: "1 ano - A",
              school_year: "1 ano",
              photo_url: "/media/front.jpg",
              has_face_enrolled: true,
              created_at: "2026-03-30T12:00:00Z",
              updated_at: "2026-03-30T12:00:00Z",
            },
            engine: "mock",
            enrolled_at: "2026-03-30T12:00:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const files = [
      new File(["a"], "face-front.jpg", { type: "image/jpeg" }),
      new File(["b"], "face-right.jpg", { type: "image/jpeg" }),
      new File(["c"], "face-left.jpg", { type: "image/jpeg" }),
    ];

    await studentsApi.reenrollFace("token", "9", { mode: "three_photos", files });

    const [url, request] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/students/9/face-reenroll");
    expect(request?.method).toBe("POST");
    const formData = request?.body as FormData;
    expect(formData.get("mode")).toBe("three_photos");
    expect(formData.getAll("files")).toHaveLength(3);
  });
});
