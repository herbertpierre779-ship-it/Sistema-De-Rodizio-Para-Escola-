import { describe, expect, it } from "vitest";
import { dashboardMenuItems } from "../src/app/lib/constants";
import type { PermissionMap } from "../src/app/types/api";

const denyAll: PermissionMap = {
  operacao: false,
  cadastro_aluno: false,
  criar_turma: false,
  estatisticas: false,
  config_usuarios: false,
  config_modo_captura: false,
  config_horarios_refeicoes: false,
  config_permissoes: false,
};

describe("dashboardMenuItems", () => {
  it("oculta configuracao quando nao ha nenhum modulo de config", () => {
    const items = dashboardMenuItems("funcionario", {
      ...denyAll,
      operacao: true,
      cadastro_aluno: true,
    });
    const ids = items.map((item) => item.id);
    expect(ids).toEqual(["inicio", "identificacao", "cadastro"]);
    expect(ids.includes("configuracao")).toBe(false);
  });

  it("mostra configuracao quando ha pelo menos um modulo config ativo", () => {
    const items = dashboardMenuItems("coordenadora", {
      ...denyAll,
      operacao: true,
      config_horarios_refeicoes: true,
    });
    const ids = items.map((item) => item.id);
    expect(ids.includes("configuracao")).toBe(true);
  });
});
