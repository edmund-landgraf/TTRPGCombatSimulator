import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { elasticHazardsToHtml, fetchElasticHazards } from "./fetchElastic.js";
import {
  indexFromElastic,
  ingestHazardsFromHtml,
  writeHazardArtifacts,
} from "./ingestHazards.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "../../..");

function printHelp(): void {
  console.log(`Usage:
  npm run ingest-hazards -- --fetch-elastic [--out data/hazards]
  npm run ingest-hazards -- --from data/aon/Hazards.aspx.html [--out data/hazards]

Builds:
  <out>/index.json     — AoN hazard ID index
  <out>/catalog.json   — combat-ready HazardSchema stubs
  <out>/unmapped.json  — stubs that failed to match

--fetch-elastic  Query category:hazard -trait:mythic (full index; UI "General" ~109 is a filter)
`);
}

function parseArgs(argv: string[]) {
  const opts = {
    from: "" as string,
    out: path.join(packageRoot, "data", "hazards"),
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
    console.log("Fetching hazards from elasticsearch.aonprd.com …");
    const hits = await fetchElasticHazards();
    const htmlPath = path.join(packageRoot, "data", "aon", "Hazards.aspx.html");
    fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
    fs.writeFileSync(htmlPath, elasticHazardsToHtml(hits), "utf8");
    console.log(`Wrote ${hits.length} → ${path.relative(process.cwd(), htmlPath)}`);

    const result = writeHazardArtifacts({
      index: indexFromElastic(hits),
      outDir,
      source: "elastic:category:hazard -trait:mythic",
    });
    console.log(
      [
        `Ingested ${result.indexCount} hazard IDs`,
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
  const result = ingestHazardsFromHtml({ fromPath, outDir });
  console.log(
    [
      `Ingested ${result.indexCount} hazard IDs from ${result.source}`,
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
