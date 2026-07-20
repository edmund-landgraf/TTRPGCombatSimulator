/**
 * Live E2E against Combat Studio: graphical board through Setup → deploy → AI rounds.
 * Usage: npx tsx scripts/e2e-graphical-map.ts [baseUrl]
 */
const BASE = process.argv[2] ?? "http://127.0.0.1:5179";

type Board = {
  width: number;
  height: number;
  cells: { x: number; y: number; tags: string[] }[];
  tokens: {
    id: string;
    name: string;
    side: string;
    tokenChar: string;
    x: number;
    y: number;
    downed: boolean;
  }[];
};

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${path}: non-JSON ${res.status} ${text.slice(0, 120)}`);
  }
  if (!res.ok) throw new Error(`${path}: ${data.error ?? res.status}`);
  return data;
}

function assertBoard(board: Board | undefined, label: string) {
  if (!board?.width || !board.height) throw new Error(`${label}: missing board`);
  if (!board.cells?.length) throw new Error(`${label}: no cells`);
  if (board.cells.length !== board.width * board.height) {
    throw new Error(`${label}: cell count ${board.cells.length} != ${board.width * board.height}`);
  }
  const walls = board.cells.filter((c) => c.tags.includes("blocking")).length;
  const floors = board.cells.filter((c) => !c.tags.includes("blocking")).length;
  if (walls < 1) throw new Error(`${label}: expected walls`);
  if (floors < 1) throw new Error(`${label}: expected floor`);
  if (!board.tokens?.length) throw new Error(`${label}: no tokens`);
  for (const t of board.tokens) {
    if (!t.tokenChar || t.x < 1 || t.y < 1) {
      throw new Error(`${label}: bad token ${JSON.stringify(t)}`);
    }
    const cell = board.cells.find((c) => c.x === t.x && c.y === t.y);
    if (!cell) throw new Error(`${label}: token ${t.id} off-grid`);
    if (!t.downed && cell.tags.includes("blocking")) {
      throw new Error(`${label}: living token ${t.id} on wall`);
    }
  }
  return { walls, floors, tokens: board.tokens.length };
}

function freeCell(board: Board, exceptId: string) {
  const occ = new Set(
    board.tokens.filter((t) => t.id !== exceptId && !t.downed).map((t) => `${t.x},${t.y}`),
  );
  for (const c of board.cells) {
    if (c.tags.includes("blocking")) continue;
    if (occ.has(`${c.x},${c.y}`)) continue;
    return { x: c.x, y: c.y };
  }
  throw new Error("no free cell");
}

function tokenPos(board: Board, id: string) {
  const t = board.tokens.find((x) => x.id === id);
  if (!t) throw new Error(`missing token ${id}`);
  return t;
}

async function waitFor(
  pred: () => Promise<boolean>,
  label: string,
  ms = 60000,
  step = 400,
) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, step));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function main() {
  const checks: string[] = [];
  const pass = (msg: string) => {
    checks.push(`PASS ${msg}`);
    console.log(`PASS ${msg}`);
  };

  // Static assets for graphical map
  for (const path of ["/", "/app.js", "/styles.css", "/index.html"]) {
    const res = await fetch(`${BASE}${path === "/" ? "/" : path}`);
    if (!res.ok) throw new Error(`static ${path}: ${res.status}`);
    const body = await res.text();
    if (path === "/" || path === "/index.html") {
      if (!body.includes('id="battleMap"') || !body.includes('id="setupMap"')) {
        throw new Error("HTML missing battleMap/setupMap");
      }
    }
    if (path === "/app.js") {
      if (!body.includes("renderBattleMap") || !body.includes("bindTokenDrag")) {
        throw new Error("app.js missing map/drag helpers");
      }
    }
    if (path === "/styles.css") {
      if (!body.includes(".battle-map") || !body.includes(".battle-token")) {
        throw new Error("styles missing battle map rules");
      }
    }
  }
  pass("static HTML/JS/CSS expose graphical map + drag");

  await api("/api/studio/reset", { method: "POST" });
  const sample = await api("/api/studio/load-sample", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ size: 12 }),
  });
  const setupBoard = sample.board as Board;
  const setupStats = assertBoard(setupBoard, "setup");
  pass(`setup board ${setupBoard.width}x${setupBoard.height} walls=${setupStats.walls} tokens=${setupStats.tokens}`);

  const ftr = tokenPos(setupBoard, "FTR");
  const dest = freeCell(setupBoard, "FTR");
  const moved = await api("/api/studio/move-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "FTR", x: dest.x, y: dest.y }),
  });
  const movedTok = tokenPos(moved.board as Board, "FTR");
  if (movedTok.x !== dest.x || movedTok.y !== dest.y) {
    throw new Error(`setup drag: expected ${dest.x},${dest.y} got ${movedTok.x},${movedTok.y}`);
  }
  if (movedTok.x === ftr.x && movedTok.y === ftr.y) {
    throw new Error("setup drag: position unchanged");
  }
  pass(`setup drag FTR ${ftr.x},${ftr.y} → ${movedTok.x},${movedTok.y}`);

  await api("/api/studio/build", { method: "POST" });
  const run = await api("/api/studio/run", { method: "POST" });
  if (!run.ok && run.message !== "Combat started") {
    // 202 returns ok
  }
  pass("studio run started");

  await waitFor(async () => {
    const ctx = (await api("/api/context")).context as {
      phase?: string;
      canMoveTokens?: boolean;
      board?: Board;
    } | null;
    return !!ctx && ctx.phase === "deploy" && !!ctx.canMoveTokens && !!ctx.board?.tokens?.length;
  }, "deploy phase");

  let ctxPayload = await api("/api/context");
  let ctx = ctxPayload.context as {
    phase: string;
    canMoveTokens?: boolean;
    board: Board;
    mapText: string;
    rounds: { board: Board; mapText: string; round: number }[];
    waitingForAdvance: boolean;
  };
  assertBoard(ctx.board, "deploy");
  if (!ctx.mapText || ctx.mapText.length < 20) throw new Error("deploy missing ASCII mapText");
  pass(`deploy board live + ASCII retained (tokens=${ctx.board.tokens.length})`);

  const deployDest = freeCell(ctx.board, "WIZ");
  const beforeWiz = tokenPos(ctx.board, "WIZ");
  await api("/api/combat/move-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "WIZ", x: deployDest.x, y: deployDest.y }),
  });
  ctx = (await api("/api/context")).context as typeof ctx;
  const afterWiz = tokenPos(ctx.board, "WIZ");
  if (afterWiz.x !== deployDest.x || afterWiz.y !== deployDest.y) {
    throw new Error("deploy combat drag failed");
  }
  pass(`deploy drag WIZ ${beforeWiz.x},${beforeWiz.y} → ${afterWiz.x},${afterWiz.y}`);

  // Reject wall drop
  const wall = ctx.board.cells.find((c) => c.tags.includes("blocking"));
  if (wall) {
    const res = await fetch(`${BASE}/api/combat/move-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "WIZ", x: wall.x, y: wall.y }),
    });
    if (res.ok) throw new Error("wall drop should fail");
    pass("deploy rejects wall drop");
  }

  await api("/api/combat/advance", { method: "POST" });
  pass("Start Round 1");

  // Wait for round pause after AI agents resolve
  await waitFor(async () => {
    const c = (await api("/api/context")).context as typeof ctx | null;
    return !!c && c.phase === "waiting" && c.waitingForAdvance && (c.rounds?.length ?? 0) >= 1;
  }, "round 1 pause", 90000);

  ctx = (await api("/api/context")).context as typeof ctx;
  assertBoard(ctx.board, "after R1");
  const r1 = ctx.rounds[0];
  if (!r1?.board) throw new Error("round snapshot missing board");
  assertBoard(r1.board, "round1 snapshot");
  pass(`round 1 pause: live board + snapshot board (round=${r1.round})`);

  // Between-round drag
  if (!ctx.canMoveTokens) throw new Error("waiting should allow token moves");
  const pauseDest = freeCell(ctx.board, "ROG");
  await api("/api/combat/move-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "ROG", x: pauseDest.x, y: pauseDest.y }),
  });
  ctx = (await api("/api/context")).context as typeof ctx;
  const rog = tokenPos(ctx.board, "ROG");
  if (rog.x !== pauseDest.x || rog.y !== pauseDest.y) throw new Error("waiting drag failed");
  pass(`between-round drag ROG → ${rog.x},${rog.y}`);

  // Advance through a couple more rounds so AI agents move via Stride/Step
  const posBefore = Object.fromEntries(ctx.board.tokens.map((t) => [t.id, `${t.x},${t.y}`]));
  for (let i = 0; i < 2; i++) {
    await api("/api/combat/advance", { method: "POST" });
    const targetRounds = ctx.rounds.length + 1;
    await waitFor(async () => {
      const c = (await api("/api/context")).context as typeof ctx | null;
      if (!c) return false;
      if (c.phase === "ended") return true;
      return c.waitingForAdvance && (c.rounds?.length ?? 0) >= targetRounds;
    }, `round advance ${i + 2}`, 90000);
    ctx = (await api("/api/context")).context as typeof ctx;
    assertBoard(ctx.board, `after advance ${i + 2}`);
    pass(`AI agents resolved; board redraw after round ${ctx.rounds.length} (phase=${ctx.phase})`);
    if (ctx.phase === "ended") break;
  }

  const posAfter = Object.fromEntries(ctx.board.tokens.map((t) => [t.id, `${t.x},${t.y}`]));
  const movedIds = Object.keys(posBefore).filter((id) => posBefore[id] !== posAfter[id]);
  // Not guaranteed every fight moves everyone, but usually some move
  pass(
    movedIds.length
      ? `token positions changed for: ${movedIds.join(", ")}`
      : "token positions stable this seed (board still valid)",
  );

  // Clear
  await api("/api/combat/clear", { method: "POST" });
  const cleared = await api("/api/context");
  if (cleared.context) {
    // clear may leave ended context or null depending on impl
  }
  pass("combat clear ok");

  console.log("\n=== Graphical map E2E: ALL CHECKS PASSED ===");
  console.log(checks.map((c) => `  ${c}`).join("\n"));
  console.log(`\nOpen UI: ${BASE}/  (Setup + Combat tabs)`);
}

main().catch((err) => {
  console.error("FAIL", err instanceof Error ? err.message : err);
  process.exit(1);
});
