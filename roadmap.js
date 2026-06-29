const { PHASES, ITEMS, PHASE_COLORS } = window.CHECKLIST_DATA;
const SYNC = window.SYNC_CONFIG || { enabled: false };
const TOTAL_DAYS = 13;
const POLL_MS = 3000;
const DAY_NAMES = ["Lun", "Mar", "Mer", "Jeu", "Ven"];

const DEFAULT_LAYOUT = {
  "project-mgmt": { startDay: 0, span: 2 },
  infra: { startDay: 1, span: 3 },
  governance: { startDay: 3, span: 3 },
  lookml: { startDay: 5, span: 5 },
  cicd: { startDay: 8, span: 3 },
  content: { startDay: 10, span: 2 },
  adoption: { startDay: 11, span: 2 },
  platform: { startDay: 11, span: 2 },
};

const syncEnabled = SYNC.enabled && SYNC.token;
let roomId = getRoomId();
let checks = {};
let layout = loadLayout();
let layoutSha = null;
let startDate = loadStartDate();
let dragPhaseId = null;
let resizeState = null;
let selectedPhaseId = null;
let saveQueue = Promise.resolve();

function getRoomId() {
  const params = new URLSearchParams(window.location.search);
  let room = (params.get("room") || "").trim();
  if (!room) {
    room = "audit-looker";
    params.set("room", room);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  }
  return room.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
}

function layoutStorageKey() {
  return `looker-roadmap-layout-${roomId}`;
}

function startDateStorageKey() {
  return `looker-roadmap-start-${roomId}`;
}

function checklistPath() {
  return `sync/${roomId}.json`;
}

function roadmapPath() {
  return `sync/roadmap-${roomId}.json`;
}

function loadLayout() {
  try {
    const raw = localStorage.getItem(layoutStorageKey());
    if (raw) return { ...DEFAULT_LAYOUT, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return structuredClone(DEFAULT_LAYOUT);
}

function saveLayoutLocal() {
  localStorage.setItem(layoutStorageKey(), JSON.stringify(layout));
}

function loadStartDate() {
  const stored = localStorage.getItem(startDateStorageKey());
  if (stored) return stored;
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 1 : day === 6 ? 2 : day === 1 ? 0 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function saveStartDate() {
  localStorage.setItem(startDateStorageKey(), startDate);
}

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function setSyncStatus(kind, label) {
  const el = document.getElementById("syncStatus");
  el.className = `sync-badge sync-${kind}`;
  el.textContent = label;
}

function phaseItems(phaseId) {
  return ITEMS.filter((i) => i.phaseId === phaseId);
}

function phaseProgress(phaseId) {
  const items = phaseItems(phaseId);
  const done = items.filter((i) => checks[i.id]?.checked).length;
  return { done, total: items.length };
}

function globalProgress() {
  const done = ITEMS.filter((i) => checks[i.id]?.checked).length;
  return { done, total: ITEMS.length };
}

function phaseStatus(phaseId) {
  const { done, total } = phaseProgress(phaseId);
  if (done === 0) return "pending";
  if (done === total) return "done";
  return "progress";
}

function addBusinessDays(baseIso, offset) {
  const d = new Date(`${baseIso}T12:00:00`);
  let added = 0;
  while (added < offset) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return d;
}

function dateForDayIndex(index) {
  let count = 0;
  const d = new Date(`${startDate}T12:00:00`);
  while (count < index) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) count += 1;
  }
  return d;
}

function formatShortDate(d) {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

function isToday(dayIndex) {
  const d = dateForDayIndex(dayIndex);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function clampLayout() {
  PHASES.forEach((phase) => {
    const entry = layout[phase.id] || { startDay: 0, span: 2 };
    entry.span = Math.max(1, Math.min(entry.span, TOTAL_DAYS));
    entry.startDay = Math.max(0, Math.min(entry.startDay, TOTAL_DAYS - entry.span));
    layout[phase.id] = entry;
  });
}

function queueSave(fn) {
  saveQueue = saveQueue.then(fn).catch(() => setSyncStatus("error", "Erreur enregistrement"));
}

async function githubGet(path) {
  const url = `https://api.github.com/repos/${SYNC.owner}/${SYNC.repo}/contents/${path}?ref=${SYNC.branch}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${SYNC.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  return res;
}

async function githubPut(path, payload, sha, message) {
  const body = {
    message,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2)))),
    branch: SYNC.branch,
  };
  if (sha) body.sha = sha;

  const url = `https://api.github.com/repos/${SYNC.owner}/${SYNC.repo}/contents/${path}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${SYNC.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("save failed");
  const data = await res.json();
  return data.content?.sha || sha;
}

async function fetchChecklist() {
  if (!syncEnabled) return;
  try {
    const res = await githubGet(checklistPath());
    if (res.status === 404) {
      checks = {};
      render();
      return;
    }
    if (!res.ok) throw new Error("fetch failed");
    const meta = await res.json();
    const json = JSON.parse(atob(meta.content.replace(/\n/g, "")));
    checks = json.checks || {};
    setSyncStatus("synced", "Synchronisé");
    render();
  } catch {
    setSyncStatus("error", "Erreur sync");
  }
}

async function fetchRoadmapLayout() {
  if (!syncEnabled) return;
  try {
    const res = await githubGet(roadmapPath());
    if (res.status === 404) {
      layoutSha = null;
      return;
    }
    if (!res.ok) throw new Error("fetch failed");
    const meta = await res.json();
    layoutSha = meta.sha;
    const json = JSON.parse(atob(meta.content.replace(/\n/g, "")));
    if (json.layout) {
      layout = { ...DEFAULT_LAYOUT, ...json.layout };
      if (json.startDate) {
        startDate = json.startDate;
        document.getElementById("startDate").value = startDate;
        saveStartDate();
      }
      saveLayoutLocal();
      render();
    }
  } catch {
    // keep local layout
  }
}

async function persistRoadmapLayout() {
  if (!syncEnabled) return;
  const payload = {
    layout,
    startDate,
    updatedAt: Date.now(),
  };
  layoutSha = await githubPut(
    roadmapPath(),
    payload,
    layoutSha,
    `Sync roadmap ${roomId}`
  );
}

function persistLayout() {
  clampLayout();
  saveLayoutLocal();
  if (syncEnabled) {
    setSyncStatus("connecting", "Enregistrement…");
    queueSave(async () => {
      await persistRoadmapLayout();
      setSyncStatus("synced", "Synchronisé");
    });
  }
  render();
}

function renderSummary() {
  const global = globalProgress();
  const phasesDone = PHASES.filter((p) => phaseStatus(p.id) === "done").length;
  const phasesProgress = PHASES.filter((p) => phaseStatus(p.id) === "progress").length;
  const pct = global.total ? Math.round((global.done / global.total) * 100) : 0;

  document.getElementById("summary").innerHTML = `
    <div class="card stat">
      <div class="stat-value">${global.done}/${global.total}</div>
      <div class="stat-label">Points validés</div>
    </div>
    <div class="card stat">
      <div class="stat-value">${pct}%</div>
      <div class="stat-label">Progression globale</div>
    </div>
    <div class="card stat">
      <div class="stat-value success">${phasesDone}</div>
      <div class="stat-label">Phases terminées</div>
    </div>
    <div class="card stat">
      <div class="stat-value">${phasesProgress}</div>
      <div class="stat-label">Phases en cours</div>
    </div>
  `;
}

function renderGrid() {
  const grid = document.getElementById("roadmapGrid");
  grid.innerHTML = "";

  const corner = document.createElement("div");
  corner.className = "week-band corner";
  grid.appendChild(corner);

  let col = 2;
  const weekRow = [
    { label: "Semaine 1", span: 5 },
    { label: "Semaine 2", span: 5 },
    { label: "Semaine 3", span: 3 },
  ];
  weekRow.forEach((w) => {
    const el = document.createElement("div");
    el.className = `week-band span-${w.span}`;
    el.textContent = w.label;
    el.style.gridColumn = `${col} / span ${w.span}`;
    col += w.span;
    grid.appendChild(el);
  });

  const corner2 = document.createElement("div");
  corner2.className = "week-band corner";
  grid.appendChild(corner2);

  for (let i = 0; i < TOTAL_DAYS; i += 1) {
    const d = dateForDayIndex(i);
    const header = document.createElement("div");
    header.className = `day-header${isToday(i) ? " today" : ""}`;
    header.dataset.day = String(i);
    header.innerHTML = `
      <span class="day-label">${DAY_NAMES[i % 5]} · J${i + 1}</span>
      <span class="day-date">${formatShortDate(d)}</span>
    `;
    grid.appendChild(header);
  }

  PHASES.forEach((phase) => {
    const entry = layout[phase.id] || { startDay: 0, span: 2 };
    const { done, total } = phaseProgress(phase.id);
    const status = phaseStatus(phase.id);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const color = PHASE_COLORS[phase.id] || "#4a8fd4";

    const label = document.createElement("div");
    label.className = "lane-label";
    label.innerHTML = `
      <span class="lane-label-dot" style="background:${color}"></span>
      <span>${escHtml(phase.title)}</span>
    `;
    grid.appendChild(label);

    const lane = document.createElement("div");
    lane.className = "lane-track";
    lane.dataset.phaseId = phase.id;

    lane.addEventListener("dragover", (e) => {
      e.preventDefault();
      lane.classList.add("drop-target");
    });
    lane.addEventListener("dragleave", (e) => {
      if (!lane.contains(e.relatedTarget)) lane.classList.remove("drop-target");
    });
    lane.addEventListener("drop", (e) => {
      e.preventDefault();
      lane.classList.remove("drop-target");
      if (!dragPhaseId) return;
      const rect = lane.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const day = Math.min(TOTAL_DAYS - 1, Math.floor(ratio * TOTAL_DAYS));
      const target = layout[dragPhaseId];
      if (!target) return;
      target.startDay = Math.min(day, TOTAL_DAYS - target.span);
      dragPhaseId = null;
      persistLayout();
    });

    const block = document.createElement("div");
    block.className = `roadmap-block status-${status}`;
    block.draggable = true;
    block.dataset.phaseId = phase.id;
    block.style.gridColumn = `${entry.startDay + 1} / span ${entry.span}`;
    block.style.borderLeft = `3px solid ${color}`;

    block.innerHTML = `
      <div class="block-top">
        <span class="block-dot" style="background:${color}"></span>
        <div>
          <div class="block-title">${escHtml(phase.title)}</div>
          <div class="block-meta">J${entry.startDay + 1} → J${entry.startDay + entry.span} · ${entry.span} j</div>
        </div>
      </div>
      <div class="block-progress">
        <div class="block-progress-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <div class="block-stats">
        <span>${done}/${total} points</span>
        <span>${pct}%</span>
      </div>
      <div class="block-resize" data-resize-phase="${phase.id}" title="Ajuster la durée"></div>
    `;

    block.addEventListener("dragstart", (e) => {
      dragPhaseId = phase.id;
      block.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", phase.id);
    });
    block.addEventListener("dragend", () => {
      block.classList.remove("dragging");
      dragPhaseId = null;
      document.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
    });
    block.addEventListener("click", (e) => {
      if (e.target.classList.contains("block-resize")) return;
      showPhaseDetail(phase.id);
    });

    const resizeHandle = block.querySelector(".block-resize");
    resizeHandle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const laneRect = lane.getBoundingClientRect();
      resizeState = {
        phaseId: phase.id,
        startX: e.clientX,
        startSpan: entry.span,
        trackWidth: laneRect.width,
      };
      document.body.style.cursor = "ew-resize";
    });

    lane.appendChild(block);
    grid.appendChild(lane);
  });
}

function showPhaseDetail(phaseId) {
  selectedPhaseId = phaseId;
  const phase = PHASES.find((p) => p.id === phaseId);
  const items = phaseItems(phaseId);
  const { done, total } = phaseProgress(phaseId);

  document.getElementById("detailTitle").textContent = `${phase.title} — ${done}/${total} validés`;
  document.getElementById("detailList").innerHTML = items
    .map((item) => {
      const checked = !!checks[item.id]?.checked;
      return `
        <div class="detail-item${checked ? " done" : ""}">
          <div class="detail-check ${checked ? "done" : "pending"}">${checked ? "✓" : ""}</div>
          <div>
            <div class="detail-item-title">${escHtml(item.title)}</div>
            <div class="detail-item-sub">${escHtml(item.category)} · ${item.priority}</div>
          </div>
        </div>
      `;
    })
    .join("");

  document.getElementById("phaseDetail").classList.remove("hidden");
}

function hidePhaseDetail() {
  selectedPhaseId = null;
  document.getElementById("phaseDetail").classList.add("hidden");
}

function render() {
  renderSummary();
  renderGrid();
  if (selectedPhaseId) showPhaseDetail(selectedPhaseId);
}

function resetLayout() {
  if (!confirm("Réinitialiser le planning sur 2,5 semaines ?")) return;
  layout = structuredClone(DEFAULT_LAYOUT);
  persistLayout();
}

function copyShareLink() {
  navigator.clipboard.writeText(window.location.href).then(() => {
    const btn = document.getElementById("shareBtn");
    const prev = btn.textContent;
    btn.textContent = "Lien copié !";
    setTimeout(() => {
      btn.textContent = prev;
    }, 2000);
  });
}

async function initSync() {
  if (!syncEnabled) {
    setSyncStatus("offline", "Sync locale");
    return;
  }
  setSyncStatus("connecting", "Connexion…");
  await fetchChecklist();
  await fetchRoadmapLayout();
  setInterval(fetchChecklist, POLL_MS);
}

document.getElementById("roomLabel").value = roomId;
const checklistLink = document.querySelector('.page-nav a[href="index.html"]');
if (checklistLink) checklistLink.href = `index.html?room=${encodeURIComponent(roomId)}`;
document.getElementById("startDate").value = startDate;
document.getElementById("footer").textContent =
  `Roadmap Looker — ${PHASES.length} phases · ${TOTAL_DAYS} jours ouvrés — salle « ${roomId} »`;

document.getElementById("startDate").addEventListener("change", (e) => {
  startDate = e.target.value || startDate;
  saveStartDate();
  persistLayout();
});

document.getElementById("resetLayoutBtn").addEventListener("click", resetLayout);
document.getElementById("shareBtn").addEventListener("click", copyShareLink);
document.getElementById("closeDetailBtn").addEventListener("click", hidePhaseDetail);

document.addEventListener("mousemove", (e) => {
  if (!resizeState) return;
  const dayWidth = resizeState.trackWidth / TOTAL_DAYS;
  const deltaDays = Math.round((e.clientX - resizeState.startX) / dayWidth);
  const entry = layout[resizeState.phaseId];
  if (!entry) return;
  entry.span = Math.max(1, Math.min(TOTAL_DAYS - entry.startDay, resizeState.startSpan + deltaDays));
  const block = document.querySelector(`.roadmap-block[data-phase-id="${resizeState.phaseId}"]`);
  if (block) {
    block.style.gridColumn = `${entry.startDay + 1} / span ${entry.span}`;
    block.querySelector(".block-meta").textContent =
      `J${entry.startDay + 1} → J${entry.startDay + entry.span} · ${entry.span} j`;
  }
});

document.addEventListener("mouseup", () => {
  if (!resizeState) return;
  document.body.style.cursor = "";
  resizeState = null;
  persistLayout();
});

clampLayout();
initSync();
render();
