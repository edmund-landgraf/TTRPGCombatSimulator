/**
 * CLI wrapper: run PF2e threat ladder × party sizes and write JSON + HTML report.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runChallengeMatrix,
  writeChallengeMatrixArtifacts,
} from "../src/analysis/challengeMatrix.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

async function main() {
  const outDir = path.join(root, "runs", "challenge-matrix");
  const report = await runChallengeMatrix({
    onProgress: (p) => {
      process.stderr.write(`[${p.completed}/${p.total}] ${p.message}\n`);
    },
  });
  const { jsonPath, htmlPath } = writeChallengeMatrixArtifacts(report, outDir);
  process.stderr.write(`\nWrote ${jsonPath}\n`);
  process.stderr.write(`Wrote ${htmlPath}\n`);
  process.stderr.write(
    `Band OK: ${report.summary.cellsOk}/${report.summary.cellsTotal} (trivial clean ${report.summary.trivialClean}/3, extreme deadly ${report.summary.extremeDeadly}/3)\n`,
  );
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
