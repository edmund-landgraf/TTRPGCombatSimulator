import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { elasticFeatsToHtml, fetchElasticFeats } from "./fetchElastic.js";
import { ingestFeatsFromHtml } from "./ingestFeats.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "../../..");

function printHelp(): void {
  console.log(`Usage:
  npm run ingest-feats -- --from data/aon/Feats.aspx.html [--out data/feats]
  npm run ingest-feats -- --from data/aon/Feats.aspx.html --fetch-elastic

Reads a saved AoN Feats.aspx HTML page (or bootstraps it from Elastic), writes:
  <out>/index.json     — full ID index (~thousands of feats)
  <out>/catalog.json   — first combat-attempt stub set joined to AoN IDs
  <out>/unmapped.json  — stubs that required an AoN match but failed

--fetch-elastic  Download category:feat -trait:mythic into --from as HTML, then ingest.
`);
}

function parseArgs(argv: string[]) {
  const opts = {
    from: "" as string,
    out: path.join(packageRoot, "data", "feats"),
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

  if (opts.fetchElastic) {
    console.log("Fetching feats from elasticsearch.aonprd.com …");
    const feats = await fetchElasticFeats();
    fs.mkdirSync(path.dirname(fromPath), { recursive: true });
    fs.writeFileSync(fromPath, elasticFeatsToHtml(feats), "utf8");
    console.log(`Wrote ${feats.length} feats → ${path.relative(process.cwd(), fromPath)}`);
  }

  const result = ingestFeatsFromHtml({ fromPath, outDir });
  console.log(
    [
      `Ingested ${result.indexCount} AoN feat IDs from ${result.source}`,
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
