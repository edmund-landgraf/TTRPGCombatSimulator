import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestSpellsFromHtml } from "./ingestSpells.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "../../..");

function printHelp(): void {
  console.log(`Usage:
  npm run ingest-spells -- --from data/aon/Spells.aspx.html [--out data/spells]

Reads a saved AoN Spells.aspx HTML page, writes:
  <out>/index.json     — full ID index (name, summary, category, listedRank)
  <out>/catalog.json   — first combat-ready SpellSchema stub set joined to AoN IDs
  <out>/unmapped.json  — stubs that could not be matched or validated
`);
}

function parseArgs(argv: string[]) {
  const opts = {
    from: "" as string,
    out: path.join(packageRoot, "data", "spells"),
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--from") opts.from = argv[++i] ?? "";
    else if (a === "--out") opts.out = argv[++i] ?? opts.out;
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }

  return opts;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.from) {
    printHelp();
    if (!opts.from && !opts.help) {
      console.error("Error: --from <path> is required.");
      process.exitCode = 1;
    }
    return;
  }

  const fromPath = path.isAbsolute(opts.from)
    ? opts.from
    : path.resolve(process.cwd(), opts.from);
  const outDir = path.isAbsolute(opts.out)
    ? opts.out
    : path.resolve(process.cwd(), opts.out);

  const result = ingestSpellsFromHtml({ fromPath, outDir });
  console.log(
    [
      `Ingested ${result.indexCount} AoN spell IDs from ${result.source}`,
      `Catalog stubs: ${result.catalogCount}`,
      `Unmapped stubs: ${result.unmappedCount}`,
      `Wrote:`,
      `  ${path.relative(process.cwd(), result.indexPath)}`,
      `  ${path.relative(process.cwd(), result.catalogPath)}`,
      `  ${path.relative(process.cwd(), result.unmappedPath)}`,
    ].join("\n"),
  );
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
