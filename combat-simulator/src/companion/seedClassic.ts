import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clampMapSize } from "../map/buildOpenSquareMap.js";
import {
  applyAutoPlacement,
  buildEncounterFromStudio,
  generateAsciiSquareMap,
  importCombatantsJson,
  studioState,
} from "./studio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveExamplesDir(): string {
  const candidates = [
    path.join(process.cwd(), "examples"),
    path.join(process.cwd(), "..", "examples"),
    path.join(__dirname, "..", "..", "..", "examples"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(path.join(p, "pcs-classic-four.json"))) return p;
  }
  throw new Error("examples/ folder with pcs-classic-four.json not found");
}

/** Load classic PCs/enemies into studio, square map, build encounter ready to run. */
export function seedClassicStudio(size = 12): void {
  const dir = resolveExamplesDir();
  const pcs = JSON.parse(fs.readFileSync(path.join(dir, "pcs-classic-four.json"), "utf8"));
  const enemies = JSON.parse(
    fs.readFileSync(path.join(dir, "enemies-goblin-patrol.json"), "utf8"),
  );
  generateAsciiSquareMap(studioState, clampMapSize(size || 12), true);
  studioState.pcs = importCombatantsJson(pcs, "party", studioState.map);
  studioState.enemies = importCombatantsJson(enemies, "enemy", studioState.map);
  applyAutoPlacement(studioState);
  studioState.encounter = buildEncounterFromStudio(studioState);
  studioState.lastError = undefined;
}
