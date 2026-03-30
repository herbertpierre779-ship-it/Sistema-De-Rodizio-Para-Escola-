import { describe, expect, it } from "vitest";
import { formatCpf, isValidCpf, normalizeCpf } from "./cpf";

describe("cpf utils", () => {
  it("normaliza e aplica máscara até o limite de 11 dígitos", () => {
    expect(normalizeCpf("529.982.247-25abc")).toBe("52998224725");
    expect(normalizeCpf("52998224725123")).toBe("52998224725");
    expect(formatCpf("52998224725")).toBe("529.982.247-25");
    expect(formatCpf("52998")).toBe("529.98");
  });

  it("valida CPF correto e rejeita CPF inválido", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("123.456.789-00")).toBe(false);
  });
});
