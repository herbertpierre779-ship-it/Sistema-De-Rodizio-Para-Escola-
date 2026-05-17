import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(__dirname, "..", "src", "app");
const badPattern = /Ã[§£¡àâãéêíóôõú]|Ãƒ|Â[\u0080-\u00BF]?|�/g;

function listSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(absolute));
      continue;
    }
    if (absolute.endsWith(".ts") || absolute.endsWith(".tsx")) {
      files.push(absolute);
    }
  }
  return files;
}

describe("frontend encoding", () => {
  it("does not contain mojibake markers", () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(appRoot)) {
      const content = fs.readFileSync(file, "utf-8");
      badPattern.lastIndex = 0;
      if (badPattern.test(content)) offenders.push(path.relative(appRoot, file));
    }
    expect(offenders, `Arquivos com possível mojibake: ${offenders.join(", ")}`).toEqual([]);
  });
});
