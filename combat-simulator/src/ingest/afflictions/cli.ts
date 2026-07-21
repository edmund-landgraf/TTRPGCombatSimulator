import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  elasticAfflictionsToHtml,
  fetchElasticAfflictions,
} from "./fetchElastic.js";
import {
  indexFromElastic,
  ingestAfflictionsFromHtml,
  writeAfflictionArtifacts,
} from "./ingestAfflictions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "../../..");

function printHelp(): void {
  console.log(`Usage:
  npm run ingest-afflictions -- --fetch-elastic [--out data/afflictions]
  npm run ingest-afflictions -- --from data/aon/Afflictions.html [--out data/afflictions]

Builds:
  <out>/index.json     — AoN affliction ID index (poisons/diseases/curses)
  <out>/catalog.json   — combat-ready AfflictionSchema stubs
  <out>/unmapped.json  — stubs that failed to match

--fetch-elastic  Query trait_group:Affliction from elasticsearch.aonprd.com
                 (also writes data/aon/Afflictions.html for offline --from).
`);
}

function parseArgs(argv: string[]) {
  const opts = {
    from: "" as string,
    out: path.join(packageRoot, "data", "afflictions"),
    fetchElastic: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--from") opts.from = argv[++i] ?? "";
    else if (a === "--out") opts.out = argv[++i] ?? opts.out;
    else if (a === "--fetch-elastic") opts.fetchElastic = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || (!opts.from && !opts.fetchElastic)) {
    printHelp();
    if (!opts.help) {
      console.error("Error: --fetch-elastic or --from <path> is required.");
      process.exitCode = 1;
    }
    return;
  }

  const outDir = path.isAbsolute(opts.out)
    ? opts.out
    : path.resolve(process.cwd(), opts.out);

  if (opts.fetchElastic) {
    console.log("Fetching afflictions from elasticsearch.aonprd.com …");
    const hits = await fetchElasticAfflictions();
    const htmlPath = path.join(packageRoot, "data", "aon", "Afflictions.html");
    fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
    fs.writeFileSync(htmlPath, elasticAfflictionsToHtml(hits), "utf8");
    console.log(`Wrote ${hits.length} → ${path.relative(process.cwd(), htmlPath)}`);

    const result = writeAfflictionArtifacts({
      index: indexFromElastic(hits),
      outDir,
      source: "elastic:trait_group:Affliction",
    });
    console.log(
      [
        `Ingested ${result.indexCount} affliction IDs`,
        `Catalog stubs: ${result.catalogCount}`,
        `Unmapped stubs: ${result.unmappedCount}`,
        `Wrote:`,
        `  ${path.relative(process.cwd(), result.indexPath)}`,
        `  ${path.relative(process.cwd(), result.catalogPath)}`,
        `  ${path.relative(process.cwd(), result.unmappedPath)}`,
      ].join("\n"),
    );
    return;
  }

  const fromPath = path.isAbsolute(opts.from)
    ? opts.from
    : path.resolve(process.cwd(), opts.from);
  const result = ingestAfflictionsFromHtml({ fromPath, outDir });
  console.log(
    [
      `Ingested ${result.indexCount} affliction IDs from ${result.source}`,
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
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
