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
  battleMapWrap: $("battleMapWrap"),
  battleMap: $("battleMap"),
  battleLegend: $("battleLegend"),
  battleMapTitle: $("battleMapTitle"),
  deployHint: $("deployHint"),
  setupMap: $("setupMap"),
  setupLegend: $("setupLegend"),
  setupMapHint: $("setupMapHint"),
  mapToolbox: $("mapToolbox"),
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
  loopBriefing: $("loopBriefing"),
  loopBriefingHeadline: $("loopBriefingHeadline"),
  loopBriefingHow: $("loopBriefingHow"),
  loopBriefingBest: $("loopBriefingBest"),
  loopBriefingWorst: $("loopBriefingWorst"),
  loopBriefingAdvice: $("loopBriefingAdvice"),
  loopParams: $("loopParams"),
  loopSeedCount: $("loopSeedCount"),
  loopBaseSeed: $("loopBaseSeed"),
  loopMaxRounds: $("loopMaxRounds"),
  loopFightCount: $("loopFightCount"),
  sampleCanvas: $("sampleCanvas"),
  settingsBtn: $("settingsBtn"),
  settingsModal: $("settingsModal"),
  saveTacticsLogs: $("saveTacticsLogs"),
  pauseEachRound: $("pauseEachRound"),
  pauseEachTurn: $("pauseEachTurn"),
  settingsSaveBtn: $("settingsSaveBtn"),
  settingsMsg: $("settingsMsg"),
};

const SETTINGS_KEY = "combatStudio.settings";

function defaultSettings() {
  return { saveTacticsLogs: true, pauseEachRound: true, pauseEachTurn: false };
}

function readLocalSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings();
    const parsed = JSON.parse(raw);
    return {
      saveTacticsLogs:
        typeof parsed.saveTacticsLogs === "boolean" ? parsed.saveTacticsLogs : true,
      pauseEachRound:
        typeof parsed.pauseEachRound === "boolean" ? parsed.pauseEachRound : true,
      pauseEachTurn:
        typeof parsed.pauseEachTurn === "boolean" ? parsed.pauseEachTurn : false,
    };
  } catch {
    return defaultSettings();
  }
}

function writeLocalSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function openSettingsModal() {
  if (!els.settingsModal) return;
  els.settingsModal.hidden = false;
  els.settingsModal.setAttribute("aria-hidden", "false");
  if (els.settingsMsg) els.settingsMsg.textContent = "";
  els.saveTacticsLogs?.focus();
}

function closeSettingsModal() {
  if (!els.settingsModal) return;
  els.settingsModal.hidden = true;
  els.settingsModal.setAttribute("aria-hidden", "true");
}

async function loadSettingsIntoModal() {
  let settings = readLocalSettings();
  try {
    const remote = await apiJson("/api/settings");
    settings = {
      saveTacticsLogs:
        typeof remote.saveTacticsLogs === "boolean"
          ? remote.saveTacticsLogs
          : settings.saveTacticsLogs,
      pauseEachRound:
        typeof remote.pauseEachRound === "boolean"
          ? remote.pauseEachRound
          : settings.pauseEachRound,
      pauseEachTurn:
        typeof remote.pauseEachTurn === "boolean"
          ? remote.pauseEachTurn
          : settings.pauseEachTurn,
    };
    writeLocalSettings(settings);
  } catch {
    /* use local */
  }
  if (els.saveTacticsLogs) els.saveTacticsLogs.checked = !!settings.saveTacticsLogs;
  if (els.pauseEachRound) els.pauseEachRound.checked = !!settings.pauseEachRound;
  if (els.pauseEachTurn) els.pauseEachTurn.checked = !!settings.pauseEachTurn;
}

function settingsSummary(settings) {
  const bits = [];
  bits.push(settings.saveTacticsLogs ? "tactical logs on" : "tactical logs off");
  bits.push(settings.pauseEachRound ? "pause rounds" : "no round pause");
  bits.push(settings.pauseEachTurn ? "pause turns" : "no turn pause");
  return bits.join(" · ") + ".";
}

async function persistSettingsFromModal() {
  const settings = {
    saveTacticsLogs: !!els.saveTacticsLogs?.checked,
    pauseEachRound: !!els.pauseEachRound?.checked,
    pauseEachTurn: !!els.pauseEachTurn?.checked,
  };
  writeLocalSettings(settings);
  const remote = await apiJson("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (els.settingsMsg) {
    els.settingsMsg.textContent = settingsSummary(remote);
  }
  return remote;
}

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
/** @type {Set<string>} */
const expandedRunContainers = new Set();
let lastPhase = null;
let lastLoopPhase = null;

const MAIN_TABS = new Set(["setup", "combat", "logs", "loop"]);

function showTab(name) {
  const tab = MAIN_TABS.has(name) ? name : "setup";
  document.querySelectorAll(".tab[data-tab]").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === tab);
  });
  // Only swap main views — chat dock stays visible with live context.
  document.querySelectorAll(".main-views > .view").forEach((v) => {
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

document.querySelectorAll(".tab[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    showTab(btn.dataset.tab);
    if (btn.dataset.tab === "logs") {
      refreshRuns().catch(() => {});
    }
    if (btn.dataset.tab === "loop") {
      refreshLoopStatus();
      refreshLoopBriefing().catch(() => {});
      if (els.loopReportFrame) {
        els.loopReportFrame.src = `/api/loop/report.html?t=${Date.now()}`;
      }
    }
  });
});

els.settingsBtn?.addEventListener("click", () => {
  loadSettingsIntoModal()
    .then(() => openSettingsModal())
    .catch(() => openSettingsModal());
});

els.settingsModal?.querySelectorAll("[data-close-settings]").forEach((el) => {
  el.addEventListener("click", () => closeSettingsModal());
});

els.settingsSaveBtn?.addEventListener("click", async () => {
  try {
    await persistSettingsFromModal();
    setTimeout(() => closeSettingsModal(), 450);
  } catch (err) {
    if (els.settingsMsg) {
      els.settingsMsg.textContent = err instanceof Error ? err.message : String(err);
    }
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && els.settingsModal && !els.settingsModal.hidden) {
    closeSettingsModal();
  }
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

function fillTacticsSelect(sel, groups, selectedId, { includeNone = false } = {}) {
  sel.innerHTML = "";
  if (includeNone) {
    const none = document.createElement("option");
    none.value = "none";
    none.textContent = "None";
    if (!selectedId) none.selected = true;
    sel.appendChild(none);
  }
  for (const g of groups) {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.label;
    if (g.hint) opt.title = g.hint;
    if (g.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  }
}

function renderList(el, items, tacticsGroups = []) {
  el.innerHTML = "";
  if (!items?.length) {
    el.innerHTML = `<li class="muted">None imported</li>`;
    return;
  }
  const groups = tacticsGroups?.length
    ? tacticsGroups
    : [
        { id: "frontliner", label: "Frontliner (melee)", hint: "" },
        { id: "archer", label: "Archer tactics", hint: "" },
        { id: "flanker", label: "Flanker / sneak", hint: "" },
        { id: "buff_debuff", label: "Buff / debuff tactics", hint: "" },
        { id: "battlefield_control", label: "Battlefield control", hint: "" },
        { id: "blaster", label: "Blaster / direct damage", hint: "" },
        { id: "healer", label: "Healer / triage", hint: "" },
      ];
  for (const c of items) {
    const li = document.createElement("li");
    li.className = "unit-row";
    const meta = document.createElement("div");
    meta.className = "unit-meta";
    meta.textContent = `${c.name} (${c.id}) HP ${c.hp} AC ${c.ac} @ ${c.start.x},${c.start.y}`;

    const stack = document.createElement("div");
    stack.className = "tactics-stack";

    const primaryLabel = document.createElement("label");
    primaryLabel.className = "tactics-label";
    primaryLabel.textContent = "Primary";
    const primarySel = document.createElement("select");
    primarySel.className = "tactics-select";
    primarySel.dataset.unitId = c.id;
    primarySel.title = "Primary tactics group";
    fillTacticsSelect(primarySel, groups, c.tacticsGroup);
    primaryLabel.appendChild(primarySel);

    const secondaryLabel = document.createElement("label");
    secondaryLabel.className = "tactics-label secondary";
    secondaryLabel.textContent = "Secondary";
    const secondarySel = document.createElement("select");
    secondarySel.className = "tactics-select";
    secondarySel.dataset.unitId = c.id;
    secondarySel.title = "Optional secondary tactics blended under primary";
    fillTacticsSelect(secondarySel, groups, c.tacticsSecondary || null, { includeNone: true });
    secondaryLabel.appendChild(secondarySel);

    const saveTactics = () => {
      const secondary = secondarySel.value === "none" ? null : secondarySel.value;
      setUnitTacticsGroup(c.id, primarySel.value, secondary).catch((err) => {
        if (els.setupMsg) els.setupMsg.textContent = err.message || String(err);
      });
    };
    primarySel.addEventListener("change", () => {
      // Clear secondary if it matches the new primary.
      if (secondarySel.value === primarySel.value) secondarySel.value = "none";
      saveTactics();
    });
    secondarySel.addEventListener("change", saveTactics);

    stack.appendChild(primaryLabel);
    stack.appendChild(secondaryLabel);
    li.appendChild(meta);
    li.appendChild(stack);
    el.appendChild(li);
  }
}

async function setUnitTacticsGroup(id, tacticsGroup, tacticsSecondary = null) {
  const data = await apiJson("/api/studio/set-tactics-group", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, tacticsGroup, tacticsSecondary }),
  });
  renderStudio(data, data.mapImage);
  if (els.setupMsg) {
    const sec = tacticsSecondary ? ` + ${tacticsSecondary}` : "";
    els.setupMsg.textContent = `${id} → ${tacticsGroup}${sec}`;
  }
}

function renderStudio(studio, mapImage, opts = {}) {
  if (!studio) return;
  renderList(els.pcsList, studio.pcs, studio.tacticsGroups);
  renderList(els.enemiesList, studio.enemies, studio.tacticsGroups);
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
  if (els.mapAscii) {
    els.mapAscii.textContent = studio.asciiPreview
      ? `${header}\n\n${studio.asciiPreview}`
      : header || "—";
  }
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

  const hasTokens = (studio.board?.tokens?.length || 0) > 0;
  const hasMap = !!(studio.board?.width);
  const canEditSetup = !opts.lockTokens && hasTokens;
  const canPaint = !opts.lockTokens && hasMap && !opts.disablePaint;
  renderLegend(els.setupLegend, studio.board);
  syncBrushToolbar(canPaint);
  if (els.setupMapHint) {
    const brush = activeBrush();
    if (opts.lockTokens) {
      els.setupMapHint.textContent =
        "Combat is live — drag tokens on the Combat map while paused (deploy, between turns, or between rounds).";
    } else if (brush === "wall") {
      els.setupMapHint.textContent =
        "Wall brush — click: horizontal → vertical → clear. Blocks movement and LOS.";
    } else if (brush === "barricade") {
      els.setupMapHint.textContent =
        "Barricade brush — click to place B (soft cover, shoot over). B B B ≈ 15 ft. Click again to clear.";
    } else if (canEditSetup) {
      els.setupMapHint.textContent = opts.allowDeployEdit
        ? "Deploy — drag tokens here or on the Combat tab, then Start Round 1."
        : "Drag tokens to place them (enemies north / party south by default). Use Objects to paint walls/barricades.";
    } else {
      els.setupMapHint.textContent = hasMap
        ? "Paint walls/barricades with Objects, or load combatants to drag tokens."
        : "Load sample or import combatants — then drag tokens on the grid.";
    }
  }
  renderBoardInto(els.setupMap, studio.board, {
    editable: canEditSetup,
    paintable: canPaint,
    endpoint: opts.moveEndpoint || "/api/studio/move-token",
    onMoved:
      opts.onMoved ||
      (async () => {
        await refreshStudio();
      }),
  });
}

/** Selected Setup object brush: "" | "wall" | "barricade" */
let setupBrush = "";

function activeBrush() {
  return setupBrush === "wall" || setupBrush === "barricade" ? setupBrush : "";
}

function syncBrushToolbar(enabled) {
  const bar = els.mapToolbox;
  if (!bar) return;
  bar.hidden = false;
  bar.classList.toggle("disabled", !enabled);
  for (const btn of bar.querySelectorAll(".brush-btn")) {
    btn.disabled = !enabled;
    const b = btn.dataset.brush || "";
    btn.classList.toggle("active", (setupBrush || "") === b);
  }
}

function bindMapToolbox() {
  const bar = els.mapToolbox;
  if (!bar || bar.dataset.bound === "1") return;
  bar.dataset.bound = "1";
  bar.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.(".brush-btn");
    if (!btn || btn.disabled) return;
    setupBrush = btn.dataset.brush || "";
    syncBrushToolbar(true);
    // Refresh hint + paint cursor class
    refreshStudio().catch(() => {});
  });
}

function setCombatFocus(on) {
  document.body.dataset.combatFocus = on ? "1" : "";
  const onCombat = document.querySelector(".tab.active")?.dataset.tab === "combat";
  els.shell?.classList.toggle("combat-focus", !!(on && onCombat));
}

function cellTerrainClass(tags) {
  if (!tags?.length) return "cell-floor";
  if (tags.includes("wall_h")) return "cell-wall-h";
  if (tags.includes("wall_v")) return "cell-wall-v";
  if (tags.includes("blocking")) return "cell-blocking";
  if (tags.includes("grease")) return "cell-grease";
  if (tags.includes("barricade")) return "cell-barricade";
  if (tags.includes("cover")) return "cell-cover";
  if (tags.includes("hazardous")) return "cell-hazardous";
  if (tags.includes("difficult")) return "cell-difficult";
  return "cell-floor";
}

function boardFingerprint(board) {
  if (!board?.width) return "";
  const toks = (board.tokens || [])
    .map((t) => `${t.id}:${t.x},${t.y},${t.downed ? 1 : 0}`)
    .sort()
    .join(";");
  const terrain = (board.cells || [])
    .map((c) => `${c.x},${c.y}:${(c.tags || []).join("+")}`)
    .sort()
    .join(";");
  return `${board.width}x${board.height}|${toks}|${terrain}`;
}

const TERRAIN_LEGEND = [
  { cls: "cell-floor", label: "floor" },
  { cls: "cell-difficult", label: "difficult" },
  { cls: "cell-grease", label: "grease (G)" },
  { cls: "cell-hazardous", label: "hazardous" },
  { cls: "cell-cover", label: "cover" },
  { cls: "cell-barricade", label: "barricade (B)" },
  { cls: "cell-wall-h", label: "wall —" },
  { cls: "cell-wall-v", label: "wall |" },
  { cls: "cell-blocking", label: "wall" },
  { cls: "token party", label: "party" },
  { cls: "token enemy", label: "enemy" },
];

function renderLegend(el, board) {
  if (!el) return;
  const parts = TERRAIN_LEGEND.map(
    (t) =>
      `<li><span class="lg-swatch ${t.cls}"></span> ${escapeHtml(t.label)}</li>`,
  );
  const toks = [...(board?.tokens || [])].sort((a, b) => a.id.localeCompare(b.id));
  for (const t of toks) {
    parts.push(
      `<li><span class="lg-token-char ${t.side}">${escapeHtml(t.tokenChar)}</span> ${escapeHtml(
        t.id,
      )} ${escapeHtml(t.name)}</li>`,
    );
  }
  el.innerHTML = parts.join("");
}

/** Cell markup for a board snapshot (full redraw; no animation). */
function battleMapCellsHtml(board, editable = false) {
  const byCell = new Map();
  for (const t of board.tokens || []) {
    const key = `${t.x},${t.y}`;
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key).push(t);
  }
  const tagByCell = new Map();
  for (const c of board.cells || []) {
    tagByCell.set(`${c.x},${c.y}`, c.tags || []);
  }
  const cells = [];
  for (let y = 1; y <= board.height; y++) {
    for (let x = 1; x <= board.width; x++) {
      const key = `${x},${y}`;
      const tags = tagByCell.get(key) || ["blocking"];
      const terrain = cellTerrainClass(tags);
      const toks = byCell.get(key) || [];
      let inner = "";
      if (toks.length === 0 && tags.includes("grease")) {
        inner = `<span class="cell-marker grease" title="Grease (difficult)">G</span>`;
      } else if (toks.length === 0 && tags.includes("barricade")) {
        inner = `<span class="cell-marker barricade" title="Barricade (soft cover)">B</span>`;
      } else if (toks.length === 1) {
        const t = toks[0];
        const drag =
          editable && !t.downed
            ? ` draggable="true" data-token-id="${escapeHtml(t.id)}"`
            : "";
        const vital = t.vitalLabel && t.vitalState && t.vitalState !== "ok" ? ` — ${t.vitalLabel}` : "";
        const deadCls = t.vitalState === "dead" ? " dead" : t.downed ? " downed" : "";
        inner = `<span class="battle-token ${t.side}${deadCls}"${drag} title="${escapeHtml(
          `${t.name} (${t.id})${vital}`,
        )}">${escapeHtml(t.tokenChar)}</span>`;
      } else if (toks.length > 1) {
        // Slash join so "b"+"a" reads "b/a" (not "ba" mistaken for one unit).
        const label = toks.map((t) => t.tokenChar).join("/");
        const title = toks
          .map((t) =>
            t.vitalLabel && t.vitalState && t.vitalState !== "ok"
              ? `${t.name} (${t.vitalLabel})`
              : t.name,
          )
          .join(", ");
        const side = toks.some((t) => t.side === "enemy") ? "enemy" : "party";
        const downed = toks.every((t) => t.downed) ? " downed" : "";
        const deadCls = toks.every((t) => t.vitalState === "dead") ? " dead" : downed;
        // Stacked: drag the first living token
        const live = toks.find((t) => !t.downed);
        const drag =
          editable && live
            ? ` draggable="true" data-token-id="${escapeHtml(live.id)}"`
            : "";
        inner = `<span class="battle-token stack ${side}${deadCls}"${drag} title="${escapeHtml(
          title,
        )}">${escapeHtml(label.slice(0, 5))}</span>`;
      }
      cells.push(
        `<div class="battle-cell ${terrain}" data-x="${x}" data-y="${y}" title="x${String(x).padStart(2, "0")}y${String(y).padStart(2, "0")}">${inner}</div>`,
      );
    }
  }
  return cells.join("");
}

function cellFromDragEvent(mapEl, target) {
  const el = target?.closest?.(".battle-cell");
  if (
    !el ||
    !mapEl.contains(el) ||
    el.classList.contains("cell-blocking") ||
    el.classList.contains("cell-wall-h") ||
    el.classList.contains("cell-wall-v")
  ) {
    return null;
  }
  return el;
}

function clearDropTargets(mapEl) {
  mapEl.querySelectorAll(".drop-target").forEach((c) => c.classList.remove("drop-target"));
}

/** Clear drag UI state (also recovers if a drag was cancelled oddly). */
function endTokenDrag(mapEl, tok) {
  tok?.classList.remove("dragging");
  mapEl?.classList.remove("dragging-token");
  clearDropTargets(mapEl);
  tokenDragActive = false;
}

/** HTML5 drag/drop for deploy / Setup placement (event delegation). */
function bindTokenDrag(mapEl) {
  if (!mapEl || mapEl.dataset.dragBound === "1") return;
  mapEl.dataset.dragBound = "1";
  let dragId = null;

  mapEl.addEventListener("dragstart", (ev) => {
    const tok = ev.target?.closest?.(".battle-token[data-token-id]");
    if (!tok || !mapEl.classList.contains("editable")) return;
    dragId = tok.dataset.tokenId;
    tokenDragActive = true;
    tok.classList.add("dragging");
    mapEl.classList.add("dragging-token");
    try {
      ev.dataTransfer.setData("text/plain", dragId);
      ev.dataTransfer.effectAllowed = "move";
    } catch {
      /* ignore */
    }
  });

  mapEl.addEventListener("dragend", (ev) => {
    const tok = ev.target?.closest?.(".battle-token");
    dragId = null;
    endTokenDrag(mapEl, tok);
  });

  mapEl.addEventListener("dragover", (ev) => {
    if (!mapEl.classList.contains("editable")) return;
    const cell = cellFromDragEvent(mapEl, ev.target);
    if (!cell) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    if (!cell.classList.contains("drop-target")) {
      clearDropTargets(mapEl);
      cell.classList.add("drop-target");
    }
  });

  mapEl.addEventListener("dragleave", (ev) => {
    if (!mapEl.contains(ev.relatedTarget)) clearDropTargets(mapEl);
  });

  mapEl.addEventListener("drop", async (ev) => {
    if (!mapEl.classList.contains("editable")) return;
    const cell = cellFromDragEvent(mapEl, ev.target);
    if (!cell) return;
    ev.preventDefault();
    const id = dragId || ev.dataTransfer?.getData("text/plain");
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    dragId = null;
    endTokenDrag(mapEl, mapEl.querySelector(".battle-token.dragging"));
    const endpoint = mapEl._tokenMoveEndpoint;
    if (!id || !x || !y || !endpoint) return;
    try {
      await apiJson(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, x, y }),
      });
      const onMoved = mapEl._tokenMoveOnMoved;
      if (onMoved) await onMoved();
    } catch (err) {
      if (els.setupMsg) els.setupMsg.textContent = err.message || String(err);
      if (els.meta) els.meta.textContent = err.message || String(err);
    }
  });
}

/** Skip board DOM rebuild while a token drag is in progress. */
let tokenDragActive = false;

function renderBoardInto(mapEl, board, opts = {}) {
  if (!mapEl) return;
  mapEl._tokenMoveEndpoint = opts.endpoint;
  mapEl._tokenMoveOnMoved = opts.onMoved;
  mapEl._paintable = !!opts.paintable;
  if (!board?.width) {
    endTokenDrag(mapEl);
    mapEl.innerHTML = "";
    mapEl.classList.remove("editable", "paint-mode");
    delete mapEl.dataset.fp;
    return;
  }
  // Don't tear down the grid mid-drag (would cancel HTML5 DnD).
  if (tokenDragActive || mapEl.classList.contains("dragging-token")) {
    return;
  }
  const editable = !!opts.editable;
  const brush = mapEl === els.setupMap ? activeBrush() : "";
  const fp = `${boardFingerprint(board)}|e${editable ? 1 : 0}|b${brush}|p${opts.paintable ? 1 : 0}`;
  if (mapEl.dataset.fp === fp) {
    mapEl.classList.toggle("editable", editable);
    mapEl.classList.toggle("paint-mode", !!brush && !!opts.paintable);
    bindTokenDrag(mapEl);
    bindCellPaint(mapEl);
    return;
  }
  mapEl.style.gridTemplateColumns = `repeat(${board.width}, var(--cell))`;
  mapEl.innerHTML = battleMapCellsHtml(board, editable);
  mapEl.dataset.fp = fp;
  mapEl.classList.toggle("editable", editable);
  mapEl.classList.toggle("paint-mode", !!brush && !!opts.paintable);
  bindTokenDrag(mapEl);
  bindCellPaint(mapEl);
}

/** Click-to-paint walls / barricades on the Setup map when a brush is selected. */
function bindCellPaint(mapEl) {
  if (!mapEl || mapEl.dataset.paintBound === "1") return;
  mapEl.dataset.paintBound = "1";
  mapEl.addEventListener("click", async (ev) => {
    if (mapEl !== els.setupMap || !mapEl._paintable) return;
    const brush = activeBrush();
    if (!brush) return;
    // Don't paint when the intent was dragging a token.
    if (ev.target?.closest?.(".battle-token")) return;
    const cell = ev.target?.closest?.(".battle-cell");
    if (!cell || !mapEl.contains(cell)) return;
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    if (!x || !y) return;
    try {
      const data = await apiJson("/api/studio/paint-cell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x, y, brush }),
      });
      renderStudio(data, data.mapImage);
    } catch (err) {
      if (els.setupMsg) els.setupMsg.textContent = err.message || String(err);
    }
  });
}

/** Wrapped grid for embedding in round cards. */
function battleMapHtml(board) {
  if (!board?.width || !board?.height) {
    return '<p class="meta">No map data</p>';
  }
  return `<div class="battle-map" style="grid-template-columns: repeat(${board.width}, var(--cell));">${battleMapCellsHtml(board, false)}</div>`;
}

/** Sticky theater map — snap-redraw when board fingerprint changes. */
function renderBattleMap(board, opts = {}) {
  if (!els.battleMap || !els.battleMapWrap) return;
  if (!board?.width) {
    els.battleMapWrap.hidden = true;
    els.battleMap.innerHTML = "";
    delete els.battleMap.dataset.fp;
    if (els.deployHint) els.deployHint.hidden = true;
    return;
  }
  const editable = !!opts.editable;
  renderLegend(els.battleLegend, board);
  if (els.battleMapTitle) {
    els.battleMapTitle.textContent = editable ? "Battle map (drag tokens)" : "Map";
  }
  if (els.deployHint) {
    els.deployHint.hidden = !editable;
    els.deployHint.innerHTML = editable
      ? "Drag tokens onto walkable cells, then continue with <strong>Enter</strong>."
      : els.deployHint.innerHTML;
  }
  els.battleMapWrap.hidden = false;
  renderBoardInto(els.battleMap, board, {
    editable,
    endpoint: "/api/combat/move-token",
    onMoved: async () => {
      await refresh();
    },
  });
}

function renderRoundStage(ctx) {
  if (!els.roundStage) return;
  if (ctx?.phase === "deploy") {
    els.roundStage.innerHTML =
      '<p class="round-empty meta">Deploy phase — drag tokens on the map above, then press <strong>Start Round 1</strong> (Enter).</p>';
    delete els.roundStage.dataset.roundCount;
    delete els.roundStage.dataset.fp;
    return;
  }
  const rounds = ctx?.rounds?.length ? ctx.rounds : null;
  const waiting = !!ctx?.waitingForAdvance;
  const turnPause = ctx?.pauseKind === "turn";
  if (!rounds) {
    const emptyFp = `empty|${waiting ? 1 : 0}|${ctx?.pauseKind || ""}|${ctx?.round || 0}|${boardFingerprint(ctx?.board)}|${(ctx?.recentLog || "").length}`;
    if (els.roundStage.dataset.fp === emptyFp) return;
    els.roundStage.dataset.fp = emptyFp;
    if (waiting && turnPause) {
      const log = ctx.recentLog
        ? `<section class="panel full"><h2>Last turn</h2><pre class="mono">${escapeHtml(ctx.recentLog)}</pre></section>`
        : "";
      els.roundStage.innerHTML = `<article class="round-card current"><h2>Round ${ctx.round} — turn pause</h2><div class="round-grid">${log}<p class="meta full">Map above is live. Press <kbd>Enter</kbd> for the next combatant.</p></div></article>`;
    } else {
      els.roundStage.innerHTML =
        '<p class="round-empty meta">Run combat from Setup — deploy tokens, then pause after rounds and/or turns (Settings). Press Enter to continue.</p>';
    }
    delete els.roundStage.dataset.roundCount;
    return;
  }

  const ended = ctx.phase === "ended";
  const last = rounds[rounds.length - 1];
  // Polling must not rewrite/scroll when nothing changed — that yanked the view back to the latest round.
  const fp = [
    rounds.length,
    waiting ? 1 : 0,
    turnPause ? 1 : 0,
    ended ? 1 : 0,
    ctx.endReason || "",
    ctx.winner || "",
    last?.round ?? "",
    last?.actionLog?.length ?? 0,
    last?.statusText?.length ?? 0,
    last?.summaryText?.length ?? 0,
    last?.mapText?.length ?? 0,
    boardFingerprint(last?.board || ctx.board),
    boardFingerprint(ctx.board),
    (ctx.recentLog || "").length,
  ].join("|");
  if (els.roundStage.dataset.fp === fp) return;

  const parts = rounds.map((r, i) => {
    const isCurrent = i === rounds.length - 1;
    const mapPanel = r.board?.width
      ? `<section class="panel"><h2>Map</h2>${battleMapHtml(r.board)}</section>`
      : `<section class="panel"><h2>Map</h2><pre class="mono">${escapeHtml(r.mapText || "—")}</pre></section>`;
    const waitLabel =
      isCurrent && waiting ? (turnPause ? " — turn pause" : " — waiting") : "";
    return `<article class="round-card ${isCurrent ? "current" : "past"}" data-round="${r.round}" id="round-${r.round}">
      <h2>Round ${r.round}${waitLabel}${isCurrent && ended ? " — final" : ""}</h2>
      <div class="round-grid">
        <section class="panel"><h2>Status</h2><pre class="mono">${escapeHtml(r.statusText || "—")}</pre></section>
        ${mapPanel}
        <section class="panel full"><h2>Actions</h2><pre class="mono">${escapeHtml(r.actionLog || "—")}</pre></section>
        <section class="panel full"><h2>Summary</h2><pre class="mono">${escapeHtml(r.summaryText || "—")}</pre></section>
      </div>
    </article>`;
  });

  if (waiting && turnPause) {
    const turnLog = ctx.recentLog
      ? `<section class="panel full"><h2>Last turn</h2><pre class="mono">${escapeHtml(ctx.recentLog)}</pre></section>`
      : "";
    parts.push(
      `<article class="round-card current" id="turn-pause-live"><h2>Live — turn pause</h2><div class="round-grid"><section class="panel full"><h2>Map</h2>${battleMapHtml(ctx.board)}</section>${turnLog}<p class="meta full">Press <kbd>Enter</kbd> for the next combatant.</p></div></article>`,
    );
  } else if (waiting) {
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
        ? "Combat is resolving — ask again at the next pause (Enter wait)."
        : "Always on — ask about studio setup, live combat, or the latest loop briefing.";
    }
    return;
  }
  if (ctx.phase === "ended") {
    els.chatCombatPill.textContent = `ended · R${ctx.round}`;
    els.chatCombatPill.className = "pill ended";
    if (els.chatMeta) {
      els.chatMeta.textContent = `Combat ended after round ${ctx.round} — ${ctx.endReason || "done"} (${ctx.winner || "—"}). Chat knows the aftermath; it cannot change the fight.`;
    }
    return;
  }
  if (ctx.phase === "deploy") {
    els.chatCombatPill.textContent = "deploy";
    els.chatCombatPill.className = "pill";
    if (els.chatMeta) {
      els.chatMeta.textContent =
        "Deploy — drag tokens on the Combat map, then Start Round 1. Chat cannot move tokens.";
    }
    return;
  }
  if (ctx.waitingForAdvance || ctx.phase === "waiting") {
    const turnPause = ctx.pauseKind === "turn";
    els.chatCombatPill.textContent = turnPause
      ? `turn pause · end R${ctx.round}`
      : `paused · end of round ${ctx.round}`;
    els.chatCombatPill.className = "pill";
    if (els.chatMeta) {
      els.chatMeta.textContent = turnPause
        ? `You are paused after a turn in Round ${ctx.round}. Map is live — Enter for the next combatant.`
        : `You are at the end of Round ${ctx.round}. Chat context matches this pause — Enter starts Round ${ctx.round + 1}.`;
    }
    return;
  }
  els.chatCombatPill.textContent = runInFlight
    ? `resolving · R${ctx.round}`
    : `in combat · R${ctx.round}`;
  els.chatCombatPill.className = "pill muted";
  if (els.chatMeta) {
    els.chatMeta.textContent = runInFlight
      ? `Round ${ctx.round} is resolving. Best questions are at the next pause.`
      : `Live combat context (around round ${ctx.round}). Does not change combat.`;
  }
}

function fillBriefingList(ul, items, mode) {
  if (!ul) return;
  ul.innerHTML = "";
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    const li = document.createElement("li");
    li.textContent = "(none)";
    li.className = "meta";
    ul.appendChild(li);
    return;
  }
  for (const item of list) {
    const li = document.createElement("li");
    if (mode === "scenario" && item && typeof item === "object") {
      const strong = document.createElement("strong");
      strong.textContent = item.label || "scenario";
      li.appendChild(strong);
      li.appendChild(document.createTextNode(` — ${item.detail || ""}`));
    } else {
      li.textContent = typeof item === "string" ? item : String(item?.detail || item);
    }
    ul.appendChild(li);
  }
}

function renderLoopBriefing(briefing) {
  if (!els.loopBriefing) return;
  if (!briefing) {
    els.loopBriefing.hidden = true;
    return;
  }
  els.loopBriefing.hidden = false;
  if (els.loopBriefingHeadline) {
    els.loopBriefingHeadline.textContent = briefing.headline || "";
  }
  fillBriefingList(els.loopBriefingHow, briefing.howItWent, "text");
  fillBriefingList(els.loopBriefingBest, briefing.best, "scenario");
  fillBriefingList(els.loopBriefingWorst, briefing.worst, "scenario");
  fillBriefingList(els.loopBriefingAdvice, briefing.advice, "text");
}

async function refreshLoopBriefing() {
  try {
    const report = await apiJson("/api/loop/report");
    renderLoopBriefing(report.briefing || null);
  } catch {
    renderLoopBriefing(null);
  }
}

function renderContext(payload) {
  const ctx = payload.context;
  els.model.textContent = payload.model || "ollama";
  const deploying = ctx?.phase === "deploy";
  const canDragTokens = !!(
    ctx?.canMoveTokens &&
    (ctx.phase === "deploy" || ctx.phase === "waiting")
  );
  // Lock Setup during active/waiting; keep Setup editable in deploy (mirrors combat).
  const lockSetupTokens = !!(ctx && (ctx.phase === "active" || ctx.phase === "waiting"));
  renderStudio(payload.studio, null, {
    lockTokens: lockSetupTokens,
    allowDeployEdit: canDragTokens && deploying,
    moveEndpoint: canDragTokens ? "/api/combat/move-token" : "/api/studio/move-token",
    onMoved: async () => {
      if (canDragTokens) await refresh();
      else await refreshStudio();
    },
  });

  const live =
    payload.runInFlight ||
    (ctx &&
      (ctx.phase === "active" ||
        ctx.phase === "waiting" ||
        ctx.phase === "deploy")) ||
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
    setAdvanceRoundVisible(false);
    if (!payload.runInFlight) {
      renderRoundStage(null);
      renderBattleMap(null);
      setCombatFocus(false);
    }
    renderMessages(payload.chat);
    if (lastPhase && lastPhase !== "idle") refreshRuns().catch(() => {});
    lastPhase = payload.runInFlight ? "running" : "idle";
    return;
  }

  els.title.textContent = ctx.encounterName;
  const turnPause = ctx.pauseKind === "turn";
  els.meta.textContent = deploying
    ? `${ctx.encounterId} · seed ${ctx.seed} · deploy — drag tokens, then Start Round 1`
    : canDragTokens
      ? turnPause
        ? `${ctx.encounterId} · seed ${ctx.seed} · round ${ctx.round} — turn done, map updated; Enter for next`
        : `${ctx.encounterId} · seed ${ctx.seed} · round ${ctx.round} — drag tokens, then Enter`
      : `${ctx.encounterId} · seed ${ctx.seed} · round ${ctx.round} · updated ${new Date(
          ctx.updatedAt,
        ).toLocaleTimeString()}`;
  els.phase.textContent = deploying
    ? "deploy"
    : ctx.waitingForAdvance
      ? turnPause
        ? "turn pause"
        : "waiting"
      : ctx.phase;
  els.phase.className = ctx.phase === "ended" ? "pill ended" : "pill";
  if (els.status) els.status.textContent = ctx.statusText || "—";
  if (els.map) els.map.textContent = ctx.mapText || "—";
  if (els.log) els.log.textContent = ctx.recentLog || "—";
  setAdvanceRoundVisible(!!ctx.waitingForAdvance, {
    deploying,
    turnPause,
  });
  const liveBoard = ctx.board?.width
    ? ctx.board
    : ctx.rounds?.length
      ? ctx.rounds[ctx.rounds.length - 1].board
      : null;
  renderBattleMap(liveBoard, { editable: canDragTokens });
  renderRoundStage(ctx);
  renderMessages(payload.chat);
  if (ctx.phase === "ended" && lastPhase !== "ended") {
    refreshRuns().catch(() => {});
    setCombatFocus(true);
  }
  lastPhase = deploying ? "deploy" : ctx.waitingForAdvance ? "waiting" : ctx.phase;
}

function setAdvanceRoundVisible(show, opts = {}) {
  if (!els.advanceRoundBtn) return;
  const deploying = !!opts.deploying;
  const turnPause = !!opts.turnPause;
  els.advanceRoundBtn.hidden = !show;
  els.advanceRoundBtn.disabled = !show;
  els.advanceRoundBtn.textContent = deploying
    ? "Start Round 1 (Enter)"
    : turnPause
      ? "Next turn (Enter)"
      : "Next round (Enter)";
}

async function advanceRound() {
  if (!els.advanceRoundBtn || els.advanceRoundBtn.hidden || els.advanceRoundBtn.disabled) {
    return;
  }
  try {
    await apiJson("/api/combat/advance", { method: "POST" });
    setAdvanceRoundVisible(false);
    els.phase.textContent = "running";
    await refresh();
  } catch (err) {
    els.meta.textContent = err.message || String(err);
  }
}

function renderRunList(containers) {
  els.runList.innerHTML = "";
  if (!containers?.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No saved runs yet. Finish a combat to populate this list.";
    els.runList.appendChild(li);
    return;
  }

  // Keep the container holding the open run expanded.
  if (selectedRunId) {
    for (const c of containers) {
      if (c.runs?.some((r) => r.id === selectedRunId)) expandedRunContainers.add(c.key);
    }
  }

  for (const container of containers) {
    const li = document.createElement("li");
    li.className = "run-container";
    const open = expandedRunContainers.has(container.key);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "run-container-toggle";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.innerHTML = `<span class="run-toggle-mark">${open ? "−" : "+"}</span><span class="run-container-label">${escapeHtml(
      container.label,
    )}</span><span class="run-container-count">${container.runs?.length ?? 0}</span>`;
    toggle.addEventListener("click", () => {
      if (expandedRunContainers.has(container.key)) expandedRunContainers.delete(container.key);
      else expandedRunContainers.add(container.key);
      renderRunList(containers);
    });
    li.appendChild(toggle);

    if (open && container.runs?.length) {
      const childList = document.createElement("ul");
      childList.className = "run-children";
      for (const run of container.runs) {
        const child = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = run.id === selectedRunId ? "active" : "";
        btn.dataset.runId = run.id;
        const when = run.createdAt ? new Date(run.createdAt).toLocaleString() : "";
        btn.innerHTML = `${escapeHtml(run.label)}<span class="run-meta">${escapeHtml(when)}${
          run.seed != null ? ` · seed ${run.seed}` : ""
        }</span>`;
        btn.addEventListener("click", () => loadHistory(run.id));
        child.appendChild(btn);
        childList.appendChild(child);
      }
      li.appendChild(childList);
    }

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
  renderRunList(data.containers ?? []);
}

async function loadHistory(id) {
  selectedRunId = id;
  const detail = await apiJson(`/api/runs/detail?id=${encodeURIComponent(id)}`);
  els.historyPanel.hidden = false;
  els.historyTitle.textContent = detail.label || detail.id;
  els.historyLog.textContent = detail.walkthrough || "(empty)";
  renderRunList((await apiJson("/api/runs")).containers ?? []);
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
  if (els.advanceRoundBtn && !els.advanceRoundBtn.hidden && !els.advanceRoundBtn.disabled) {
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
        refreshLoopBriefing().catch(() => {});
      } else if (!els.loopBriefing || els.loopBriefing.hidden) {
        refreshLoopBriefing().catch(() => {});
      }
      lastLoopPhase = phase === "done" ? "ready" : phase;
    } else {
      renderLoopBriefing(null);
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
bindMapToolbox();
refresh();
refreshStudio().catch(() => {});
refreshRuns().catch(() => {});
refreshLoopStatus().catch(() => {});
// Push local preference to the server so runs respect Settings before the modal is opened.
apiJson("/api/settings", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(readLocalSettings()),
}).catch(() => {});
setInterval(refresh, 1500);
setInterval(() => {
  refreshRuns().catch(() => {});
}, 8000);
setInterval(() => {
  refreshLoopStatus().catch(() => {});
}, 2000);
