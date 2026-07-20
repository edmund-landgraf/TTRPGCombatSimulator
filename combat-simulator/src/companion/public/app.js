const $ = (id) => document.getElementById(id);

const els = {
  title: $("title"),
  meta: $("meta"),
  phase: $("phase"),
  model: $("model"),
  status: $("status"),
  map: $("map"),
  log: $("log"),
  messages: $("messages"),
  form: $("chatForm"),
  input: $("input"),
  send: $("send"),
  clear: $("clearChat"),
  chatMeta: $("chatMeta"),
  chatCombatPill: $("chatCombatPill"),
  clearCombatBtn: $("clearCombatBtn"),
  advanceRoundBtn: $("advanceRoundBtn"),
  roundStage: $("roundStage"),
  shell: document.querySelector(".shell"),
  pcsList: $("pcsList"),
  enemiesList: $("enemiesList"),
  mapImg: $("mapImg"),
  mapAscii: $("mapAscii"),
  mapSize: $("mapSize"),
  mapBorder: $("mapBorder"),
  genMapBtn: $("genMapBtn"),
  loadSampleBtn: $("loadSampleBtn"),
  readyPill: $("readyPill"),
  setupMsg: $("setupMsg"),
  buildBtn: $("buildBtn"),
  runBtn: $("runBtn"),
  resetBtn: $("resetBtn"),
  runList: $("runList"),
  refreshRunsBtn: $("refreshRunsBtn"),
  historyPanel: $("historyPanel"),
  historyTitle: $("historyTitle"),
  historyLog: $("historyLog"),
  closeHistoryBtn: $("closeHistoryBtn"),
  startLoopBtn: $("startLoopBtn"),
  loopPill: $("loopPill"),
  loopMeta: $("loopMeta"),
  loopProgress: $("loopProgress"),
  loopReportFrame: $("loopReportFrame"),
  loopParams: $("loopParams"),
  loopSeedCount: $("loopSeedCount"),
  loopBaseSeed: $("loopBaseSeed"),
  loopMaxRounds: $("loopMaxRounds"),
  loopFightCount: $("loopFightCount"),
  sampleCanvas: $("sampleCanvas"),
};

function readLoopParams() {
  const seedCount = Math.min(20, Math.max(1, Number(els.loopSeedCount?.value || 3)));
  const baseSeed = Math.max(1, Number(els.loopBaseSeed?.value || 201));
  const maxRounds = Math.min(100, Math.max(1, Number(els.loopMaxRounds?.value || 20)));
  const partySizes = [...document.querySelectorAll('input[name="loopParty"]:checked')].map((el) =>
    Number(el.value),
  );
  const threats = [...document.querySelectorAll('input[name="loopThreat"]:checked')].map(
    (el) => el.value,
  );
  return { seedCount, baseSeed, maxRounds, partySizes, threats };
}

function updateLoopFightCount() {
  if (!els.loopFightCount) return;
  const p = readLoopParams();
  const parties = p.partySizes.length || 0;
  const threats = p.threats.length || 0;
  const total = parties * threats * p.seedCount;
  const seeds = Array.from({ length: p.seedCount }, (_, i) => p.baseSeed + i);
  els.loopFightCount.textContent =
    parties && threats
      ? `${total} fights · party ${p.partySizes.join("/")} × ${p.threats.join("/")} × seeds [${seeds.join(", ")}] · max ${p.maxRounds} rounds`
      : "Select at least one party size and threat";
  if (els.startLoopBtn && lastLoopPhase !== "running") {
    els.startLoopBtn.disabled = !(parties && threats);
  }
}

let selectedRunId = null;
let lastPhase = null;
let lastLoopPhase = null;

function showTab(name) {
  const tab = name || "setup";
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === tab);
  });
  document.querySelectorAll(".view").forEach((v) => {
    const on = v.id === `view-${tab}`;
    v.classList.toggle("active", on);
    if (on) v.removeAttribute("hidden");
    else v.setAttribute("hidden", "");
  });
  els.shell?.classList.toggle(
    "combat-focus",
    tab === "combat" && document.body.dataset.combatFocus === "1",
  );
  if (tab === "combat") {
    els.roundStage?.focus({ preventScroll: true });
  }
}

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    showTab(btn.dataset.tab);
    if (btn.dataset.tab === "logs") {
      refreshRuns().catch(() => {});
    }
    if (btn.dataset.tab === "loop") {
      refreshLoopStatus();
      if (els.loopReportFrame) {
        els.loopReportFrame.src = `/api/loop/report.html?t=${Date.now()}`;
      }
    }
  });
});

function renderMessages(chat) {
  els.messages.innerHTML = "";
  if (!chat?.length) {
    const hint = document.createElement("div");
    hint.className = "empty-hint";
    hint.textContent =
      "Ask anything about the current fight — distances, who is hurt, spell options, PF2e rules.";
    els.messages.appendChild(hint);
    return;
  }
  for (const m of chat) {
    const div = document.createElement("div");
    div.className = `bubble ${m.role}`;
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = m.role === "user" ? "You" : "Companion";
    div.appendChild(who);
    div.appendChild(document.createTextNode(m.content));
    els.messages.appendChild(div);
  }
  els.messages.scrollTop = els.messages.scrollHeight;
}

function renderList(el, items) {
  el.innerHTML = "";
  if (!items?.length) {
    el.innerHTML = `<li class="muted">None imported</li>`;
    return;
  }
  for (const c of items) {
    const li = document.createElement("li");
    li.textContent = `${c.name} (${c.id}) HP ${c.hp} AC ${c.ac} @ ${c.start.x},${c.start.y}`;
    el.appendChild(li);
  }
}

function renderStudio(studio, mapImage, opts = {}) {
  if (!studio) return;
  renderList(els.pcsList, studio.pcs);
  renderList(els.enemiesList, studio.enemies);
  // Only sync Size from server when asked — polling must not clobber the picker.
  if (opts.syncSize && studio.map?.width) {
    els.mapSize.value = String(studio.map.width);
  }
  const header =
    studio.map
      ? `${studio.map.width}×${studio.map.height} · ${studio.map.source}` +
        (studio.map.imageName ? ` · ${studio.map.imageName}` : "") +
        ` · ${studio.map.cellCount} cells`
      : "";
  els.mapAscii.textContent = studio.asciiPreview
    ? `${header}\n\n${studio.asciiPreview}`
    : header || "—";
  if (mapImage) {
    els.mapImg.hidden = false;
    els.mapImg.src = mapImage;
  } else if (studio.map?.hasImage === false) {
    els.mapImg.hidden = true;
  }
  const ready = studio.encounterReady;
  els.readyPill.textContent = ready ? "ready" : "not ready";
  els.readyPill.className = ready ? "pill" : "pill muted";
  els.runBtn.disabled = !ready;
  if (studio.lastError) els.setupMsg.textContent = studio.lastError;
}

function setCombatFocus(on) {
  document.body.dataset.combatFocus = on ? "1" : "";
  const onCombat = document.querySelector(".tab.active")?.dataset.tab === "combat";
  els.shell?.classList.toggle("combat-focus", !!(on && onCombat));
}

function renderRoundStage(ctx) {
  if (!els.roundStage) return;
  const rounds = ctx?.rounds?.length ? ctx.rounds : null;
  if (!rounds) {
    els.roundStage.innerHTML =
      '<p class="round-empty meta">Run combat from Setup — each round pauses here. Press Enter for the next.</p>';
    delete els.roundStage.dataset.roundCount;
    delete els.roundStage.dataset.fp;
    return;
  }

  const waiting = !!ctx.waitingForAdvance;
  const ended = ctx.phase === "ended";
  const last = rounds[rounds.length - 1];
  // Polling must not rewrite/scroll when nothing changed — that yanked the view back to the latest round.
  const fp = [
    rounds.length,
    waiting ? 1 : 0,
    ended ? 1 : 0,
    ctx.endReason || "",
    ctx.winner || "",
    last?.round ?? "",
    last?.actionLog?.length ?? 0,
    last?.statusText?.length ?? 0,
    last?.summaryText?.length ?? 0,
    last?.mapText?.length ?? 0,
  ].join("|");
  if (els.roundStage.dataset.fp === fp) return;

  const parts = rounds.map((r, i) => {
    const isCurrent = i === rounds.length - 1;
    return `<article class="round-card ${isCurrent ? "current" : "past"}" data-round="${r.round}" id="round-${r.round}">
      <h2>Round ${r.round}${isCurrent && waiting ? " — waiting" : ""}${isCurrent && ended ? " — final" : ""}</h2>
      <div class="round-grid">
        <section class="panel"><h2>Status</h2><pre class="mono">${escapeHtml(r.statusText || "—")}</pre></section>
        <section class="panel"><h2>Map</h2><pre class="mono">${escapeHtml(r.mapText || "—")}</pre></section>
        <section class="panel full"><h2>Actions</h2><pre class="mono">${escapeHtml(r.actionLog || "—")}</pre></section>
        <section class="panel full"><h2>Summary</h2><pre class="mono">${escapeHtml(r.summaryText || "—")}</pre></section>
      </div>
    </article>`;
  });

  if (waiting) {
    parts.push(
      `<div class="advance-banner" id="advanceBanner">Press <kbd>Enter</kbd> for Round ${ctx.round + 1}</div>`,
    );
  } else if (ended) {
    parts.push(
      `<div class="advance-banner">Combat ended — ${escapeHtml(ctx.endReason || "done")} (${escapeHtml(
        ctx.winner || "—",
      )})</div>`,
    );
  }

  const prevLen = Number(els.roundStage.dataset.roundCount || 0);
  const scrollTop = els.roundStage.scrollTop;
  // Only jump to the latest card when a new round arrives (or first paint).
  const shouldScrollToCurrent = prevLen === 0 || rounds.length > prevLen;
  els.roundStage.innerHTML = parts.join("");
  els.roundStage.dataset.roundCount = String(rounds.length);
  els.roundStage.dataset.fp = fp;
  if (shouldScrollToCurrent) {
    const current = els.roundStage.querySelector(".round-card.current");
    current?.scrollIntoView({ behavior: "smooth", block: "center" });
  } else {
    els.roundStage.scrollTop = scrollTop;
  }
}

function updateChatCombatState(ctx, runInFlight) {
  if (!els.chatCombatPill) return;
  if (!ctx) {
    els.chatCombatPill.textContent = runInFlight ? "resolving…" : "no combat";
    els.chatCombatPill.className = "pill muted";
    if (els.chatMeta) {
      els.chatMeta.textContent = runInFlight
        ? "Round is resolving — ask again at the pause (Enter wait)."
        : "Ask during a round pause (Combat waits for Enter). Knows paused vs ended. Does not change combat.";
    }
    return;
  }
  if (ctx.phase === "ended") {
    els.chatCombatPill.textContent = "ended";
    els.chatCombatPill.className = "pill ended";
    if (els.chatMeta) {
      els.chatMeta.textContent = `Combat ended — ${ctx.endReason || "done"} (${ctx.winner || "—"}). Chat can discuss what happened; it cannot change the fight.`;
    }
    return;
  }
  if (ctx.waitingForAdvance || ctx.phase === "waiting") {
    els.chatCombatPill.textContent = `paused · R${ctx.round}`;
    els.chatCombatPill.className = "pill";
    if (els.chatMeta) {
      els.chatMeta.textContent = `Paused after Round ${ctx.round}. Ask tactics now — the round log is final. Press Enter on Combat for Round ${ctx.round + 1}.`;
    }
    return;
  }
  els.chatCombatPill.textContent = runInFlight ? "resolving…" : "in combat";
  els.chatCombatPill.className = "pill muted";
  if (els.chatMeta) {
    els.chatMeta.textContent = runInFlight
      ? `Round ${ctx.round} is resolving. Best questions are at the pause between rounds.`
      : "Live combat context loaded. Does not change combat.";
  }
}

function renderContext(payload) {
  const ctx = payload.context;
  els.model.textContent = payload.model || "ollama";
  renderStudio(payload.studio, null);

  const live =
    payload.runInFlight ||
    (ctx && (ctx.phase === "active" || ctx.phase === "waiting")) ||
    false;
  setCombatFocus(!!live || !!(ctx && ctx.phase === "ended" && ctx.rounds?.length));
  updateChatCombatState(ctx, !!payload.runInFlight);

  if (!ctx) {
    els.title.textContent = "Combat";
    els.meta.textContent = payload.runInFlight
      ? "Combat running — resolving round…"
      : "Cleared — ready for a new run (Setup → Run combat)";
    els.phase.textContent = payload.runInFlight ? "running" : "idle";
    els.phase.className = "pill muted";
    if (els.advanceRoundBtn) els.advanceRoundBtn.hidden = true;
    if (!payload.runInFlight) {
      renderRoundStage(null);
      setCombatFocus(false);
    }
    renderMessages(payload.chat);
    if (lastPhase && lastPhase !== "idle") refreshRuns().catch(() => {});
    lastPhase = payload.runInFlight ? "running" : "idle";
    return;
  }

  els.title.textContent = ctx.encounterName;
  els.meta.textContent = `${ctx.encounterId} · seed ${ctx.seed} · round ${ctx.round} · updated ${new Date(
    ctx.updatedAt,
  ).toLocaleTimeString()}`;
  els.phase.textContent = ctx.waitingForAdvance ? "waiting" : ctx.phase;
  els.phase.className = ctx.phase === "ended" ? "pill ended" : "pill";
  if (els.status) els.status.textContent = ctx.statusText || "—";
  if (els.map) els.map.textContent = ctx.mapText || "—";
  if (els.log) els.log.textContent = ctx.recentLog || "—";
  if (els.advanceRoundBtn) {
    els.advanceRoundBtn.hidden = !ctx.waitingForAdvance;
  }
  renderRoundStage(ctx);
  renderMessages(payload.chat);
  if (ctx.phase === "ended" && lastPhase !== "ended") {
    refreshRuns().catch(() => {});
    setCombatFocus(true);
  }
  lastPhase = ctx.waitingForAdvance ? "waiting" : ctx.phase;
}

async function advanceRound() {
  try {
    await apiJson("/api/combat/advance", { method: "POST" });
    if (els.advanceRoundBtn) els.advanceRoundBtn.hidden = true;
    els.phase.textContent = "running";
    await refresh();
  } catch (err) {
    els.meta.textContent = err.message || String(err);
  }
}

function renderRunList(runs) {
  els.runList.innerHTML = "";
  if (!runs?.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No saved runs yet. Finish a combat to populate this list.";
    els.runList.appendChild(li);
    return;
  }
  for (const run of runs) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = run.id === selectedRunId ? "active" : "";
    btn.dataset.runId = run.id;
    const when = run.createdAt ? new Date(run.createdAt).toLocaleString() : "";
    btn.innerHTML = `${escapeHtml(run.label)}<span class="run-meta">${escapeHtml(when)}${
      run.seed != null ? ` · seed ${run.seed}` : ""
    }</span>`;
    btn.addEventListener("click", () => loadHistory(run.id));
    li.appendChild(btn);
    els.runList.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function refreshRuns() {
  const data = await apiJson("/api/runs");
  renderRunList(data.runs);
}

async function loadHistory(id) {
  selectedRunId = id;
  const detail = await apiJson(`/api/runs/detail?id=${encodeURIComponent(id)}`);
  els.historyPanel.hidden = false;
  els.historyTitle.textContent = detail.label || detail.id;
  els.historyLog.textContent = detail.walkthrough || "(empty)";
  renderRunList((await apiJson("/api/runs")).runs);
}

async function apiJson(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      res.ok
        ? `Bad JSON from ${url}`
        : `${res.status} ${url}: ${text.slice(0, 120) || "empty response"}`,
    );
  }
  if (!res.ok) throw new Error(data.error || `${res.status} ${url}`);
  return data;
}

async function refresh() {
  try {
    const data = await apiJson("/api/context");
    renderContext(data);
  } catch {
    els.meta.textContent = "Lost connection to companion server";
  }
}

async function refreshStudio(opts = {}) {
  const data = await apiJson("/api/studio");
  renderStudio(data, data.mapImage, opts);
  return data;
}

async function readJsonFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}

function classifyPixel(r, g, b, a) {
  if (a < 40) return ["blocking"];
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (luma < 45) return ["blocking"];
  // green-ish difficult
  if (g > r + 25 && g > b + 15 && g > 70) return ["floor", "difficult"];
  // brown / warm gray cover
  if (Math.abs(r - g) < 35 && r > b + 15 && luma > 50 && luma < 170) return ["floor", "cover"];
  // cool gray cover
  if (Math.abs(r - g) < 18 && Math.abs(g - b) < 18 && luma > 55 && luma < 140) {
    return ["floor", "cover"];
  }
  return ["floor"];
}

function sampleImageToCells(img, width, height, borderWalls) {
  const canvas = els.sampleCanvas;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  const cells = [];
  for (let y = 1; y <= height; y++) {
    for (let x = 1; x <= width; x++) {
      const border = borderWalls && (x === 1 || y === 1 || x === width || y === height);
      if (border) {
        cells.push({ x, y, tags: ["blocking"] });
        continue;
      }
      const i = ((y - 1) * width + (x - 1)) * 4;
      const tags = classifyPixel(data[i], data[i + 1], data[i + 2], data[i + 3]);
      cells.push({ x, y, tags });
    }
  }
  return cells;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = url;
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

$("pcsFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  els.setupMsg.textContent = "Importing PCs…";
  try {
    const raw = await readJsonFile(file);
    const res = await fetch("/api/import/pcs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(raw),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "PC import failed");
    renderStudio(data, null);
    els.setupMsg.textContent = `Imported ${data.pcs.length} PC(s) from ${file.name}`;
  } catch (err) {
    els.setupMsg.textContent = err.message || String(err);
  }
  e.target.value = "";
});

$("enemiesFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  els.setupMsg.textContent = "Importing enemies…";
  try {
    const raw = await readJsonFile(file);
    const res = await fetch("/api/import/enemies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(raw),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Enemy import failed");
    renderStudio(data, null);
    els.setupMsg.textContent = `Imported ${data.enemies.length} enemy(ies) from ${file.name}`;
  } catch (err) {
    els.setupMsg.textContent = err.message || String(err);
  }
  e.target.value = "";
});

function mapSizeValue() {
  const n = Number(els.mapSize.value) || 12;
  return Math.max(4, Math.min(24, Math.floor(n)));
}

els.loadSampleBtn?.addEventListener("click", async () => {
  els.setupMsg.textContent = "Loading sample combat…";
  try {
    const size = mapSizeValue();
    els.mapSize.value = String(size);
    const data = await apiJson("/api/studio/load-sample", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ size }),
    });
    els.mapImg.hidden = true;
    renderStudio(data, null, { syncSize: true });
    els.setupMsg.textContent = `Loaded sample: ${data.pcs.length} PCs vs ${data.enemies.length} enemies`;
  } catch (err) {
    els.setupMsg.textContent = err.message || String(err);
  }
});

els.genMapBtn.addEventListener("click", async () => {
  els.setupMsg.textContent = "Generating square ASCII map…";
  try {
    const size = mapSizeValue();
    els.mapSize.value = String(size);
    const data = await apiJson("/api/studio/generate-map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ size, borderWalls: els.mapBorder.checked }),
    });
    els.mapImg.hidden = true;
    renderStudio(data, null, { syncSize: true });
    els.setupMsg.textContent = `Square ${size}×${size} map ready — party south, enemies north`;
  } catch (err) {
    els.setupMsg.textContent = err.message || String(err);
  }
});

$("mapFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  els.setupMsg.textContent = "Sampling map image…";
  try {
    const size = mapSizeValue();
    els.mapSize.value = String(size);
    const { img } = await loadImageFromFile(file);
    const cells = sampleImageToCells(img, size, size, els.mapBorder.checked);
    const imageDataUrl = await fileToDataUrl(file);
    const res = await fetch("/api/import/map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        width: size,
        height: size,
        cells,
        imageDataUrl,
        imageName: file.name,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Map import failed");
    renderStudio(data, data.mapImage, { syncSize: true });
    els.setupMsg.textContent = `Map imported from ${file.name} (${size}×${size})`;
  } catch (err) {
    els.setupMsg.textContent = err.message || String(err);
  }
  e.target.value = "";
});

els.buildBtn.addEventListener("click", async () => {
  els.setupMsg.textContent = "Building…";
  try {
    const data = await apiJson("/api/studio/build", { method: "POST" });
    renderStudio(data, null);
    els.setupMsg.textContent = `Built: ${data.encounter?.name ?? "encounter"}`;
  } catch (err) {
    els.setupMsg.textContent = err.message || String(err);
  }
});

els.runBtn.addEventListener("click", async () => {
  els.setupMsg.textContent = "Starting combat…";
  els.runBtn.disabled = true;
  try {
    const data = await apiJson("/api/studio/run", { method: "POST" });
    els.setupMsg.textContent = data.message || "Combat started — pausing each round";
    setCombatFocus(true);
    showTab("combat");
    els.roundStage?.focus({ preventScroll: true });
    await refresh();
  } catch (err) {
    els.setupMsg.textContent = err.message || String(err);
    els.runBtn.disabled = false;
  }
});

els.clearCombatBtn?.addEventListener("click", async () => {
  try {
    await apiJson("/api/combat/clear", { method: "POST" });
    lastPhase = "idle";
    setCombatFocus(false);
    await refresh();
    els.meta.textContent = "Cleared — ready for a new run";
    showTab("setup");
  } catch (err) {
    els.meta.textContent = err.message || String(err);
  }
});

els.advanceRoundBtn?.addEventListener("click", () => advanceRound());

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "TEXTAREA" || tag === "INPUT" || e.target?.isContentEditable) return;
  const onCombat = document.querySelector(".tab.active")?.dataset.tab === "combat";
  if (!onCombat) return;
  if (els.advanceRoundBtn && !els.advanceRoundBtn.hidden) {
    e.preventDefault();
    advanceRound();
  }
});

els.refreshRunsBtn?.addEventListener("click", () => {
  refreshRuns().catch((err) => {
    els.runList.innerHTML = `<li class="empty">${escapeHtml(err.message || String(err))}</li>`;
  });
});

els.closeHistoryBtn?.addEventListener("click", () => {
  selectedRunId = null;
  els.historyPanel.hidden = true;
  els.historyLog.textContent = "";
  refreshRuns().catch(() => {});
});

async function refreshLoopStatus() {
  if (!els.loopPill) return;
  try {
    const st = await apiJson("/api/loop/status");
    if (st.running) {
      els.loopPill.textContent = "running";
      els.loopPill.className = "pill";
      els.startLoopBtn.disabled = true;
      const p = st.progress;
      els.loopProgress.textContent = p
        ? `${p.completed}/${p.total} — ${p.message}`
        : "Running matrix…";
    } else if (st.progress?.phase === "error") {
      els.loopPill.textContent = "error";
      els.loopPill.className = "pill ended";
      els.startLoopBtn.disabled = false;
      els.loopProgress.textContent = st.progress.error || st.progress.message;
    } else if (st.hasReport) {
      els.loopPill.textContent = "ready";
      els.loopPill.className = "pill";
      els.startLoopBtn.disabled = false;
      const s = st.summary;
      els.loopProgress.textContent = s
        ? `Band OK ${s.cellsOk}/${s.cellsTotal} · trivial ${s.trivialClean}/3 · extreme ${s.extremeDeadly}/3 · generated ${new Date(st.generatedAt).toLocaleString()}`
        : "Report ready";
      const phase = st.progress?.phase ?? "ready";
      if (els.loopReportFrame && lastLoopPhase === "running" && phase === "done") {
        els.loopReportFrame.src = `/api/loop/report.html?t=${Date.now()}`;
      }
      lastLoopPhase = phase === "done" ? "ready" : phase;
    } else {
      els.loopPill.textContent = "idle";
      els.loopPill.className = "pill muted";
      els.startLoopBtn.disabled = false;
      els.loopProgress.textContent = "";
      lastLoopPhase = "idle";
    }
    if (st.running) lastLoopPhase = "running";
  } catch {
    /* ignore */
  }
}

els.loopParams?.addEventListener("input", updateLoopFightCount);
els.loopParams?.addEventListener("change", updateLoopFightCount);
updateLoopFightCount();

els.startLoopBtn?.addEventListener("click", async () => {
  const params = readLoopParams();
  if (!params.partySizes.length || !params.threats.length) {
    els.loopProgress.textContent = "Pick at least one party size and one threat.";
    return;
  }
  const total = params.partySizes.length * params.threats.length * params.seedCount;
  els.loopProgress.textContent = `Starting ${total}-fight matrix…`;
  els.startLoopBtn.disabled = true;
  lastLoopPhase = "running";
  try {
    await apiJson("/api/loop/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    showTab("loop");
    els.loopPill.textContent = "running";
    els.loopPill.className = "pill";
  } catch (err) {
    els.loopProgress.textContent = err.message || String(err);
    els.startLoopBtn.disabled = false;
    lastLoopPhase = "idle";
    updateLoopFightCount();
  }
});

els.resetBtn.addEventListener("click", async () => {
  await apiJson("/api/studio/reset", { method: "POST" });
  els.mapImg.hidden = true;
  els.mapImg.removeAttribute("src");
  els.setupMsg.textContent = "Studio reset (classic empty map)";
  await refreshStudio({ syncSize: true });
});

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = els.input.value.trim();
  if (!message) return;
  els.send.disabled = true;
  els.input.value = "";
  const optimistic = document.createElement("div");
  optimistic.className = "bubble user";
  optimistic.innerHTML = `<span class="who">You</span>`;
  optimistic.appendChild(document.createTextNode(message));
  const empty = els.messages.querySelector(".empty-hint");
  if (empty) empty.remove();
  els.messages.appendChild(optimistic);
  els.messages.scrollTop = els.messages.scrollHeight;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Chat failed");
    renderMessages(data.chat);
  } catch (err) {
    const div = document.createElement("div");
    div.className = "bubble assistant";
    div.innerHTML = `<span class="who">Companion</span>`;
    div.appendChild(document.createTextNode(err.message || String(err)));
    els.messages.appendChild(div);
  } finally {
    els.send.disabled = false;
    els.input.focus();
  }
});

els.clear.addEventListener("click", async () => {
  await fetch("/api/chat/clear", { method: "POST" });
  await refresh();
});

els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    els.form.requestSubmit();
  }
});

showTab("setup");
refresh();
refreshStudio().catch(() => {});
refreshRuns().catch(() => {});
refreshLoopStatus().catch(() => {});
setInterval(refresh, 1500);
setInterval(() => {
  refreshRuns().catch(() => {});
}, 8000);
setInterval(() => {
  refreshLoopStatus().catch(() => {});
}, 2000);
