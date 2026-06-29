const { PHASES, ITEMS, PHASE_COLORS } = window.CHECKLIST_DATA;
const SYNC = window.SYNC_CONFIG || { enabled: false };
const TOTAL_DAYS = 13;
const POLL_MS = 3000;
const DAY_NAMES = ["Lun", "Mar", "Mer", "Jeu", "Ven"];
const DEFAULT_LAYOUT = RoomStore.DEFAULT_ROADMAP_LAYOUT;

const roomId = PageUtils.getRoomIdFromUrl();
const store = RoomStore.create(roomId, SYNC);
const syncEnabled = store.syncEnabled;

let dragPhaseId = null;
let resizeState = null;
let selectedPhaseId = null;

function layout() {
  return store.state.roadmap.layout;
}

function startDate() {
  return store.state.roadmap.startDate;
}

function checks() {
  return store.state.checks;
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
  const done = items.filter((i) => checks()[i.id]?.checked).length;
  return { done, total: items.length };
}

function globalProgress() {
  const done = ITEMS.filter((i) => checks()[i.id]?.checked).length;
  return { done, total: ITEMS.length };
}

function phaseStatus(phaseId) {
  const { done, total } = phaseProgress(phaseId);
  if (done === 0) return "pending";
  if (done === total) return "done";
  return "progress";
}

function dateForDayIndex(index) {
  let count = 0;
  const d = new Date(`${startDate()}T12:00:00`);
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

function clampLayout(currentLayout) {
  PHASES.forEach((phase) => {
    const entry = currentLayout[phase.id] || { startDay: 0, span: 2 };
    entry.span = Math.max(1, Math.min(entry.span, TOTAL_DAYS));
    entry.startDay = Math.max(0, Math.min(entry.startDay, TOTAL_DAYS - entry.span));
    currentLayout[phase.id] = entry;
  });
}

function persistLayout() {
  if (syncEnabled) setSyncStatus("connecting", "Enregistrement…");
  store.patch(
    (state) => {
      clampLayout(state.roadmap.layout);
    },
    { roadmapTouch: true }
  );
  if (syncEnabled) {
    store.queueSave()
      .then(() => setSyncStatus("synced", "Synchronisé"))
      .catch(() => setSyncStatus("error", "Erreur enregistrement"));
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
  const currentLayout = layout();
  const grid = document.getElementById("roadmapGrid");
  grid.innerHTML = "";

  const corner = document.createElement("div");
  corner.className = "week-band corner";
  grid.appendChild(corner);

  let col = 2;
  [
    { label: "Semaine 1", span: 5 },
    { label: "Semaine 2", span: 5 },
    { label: "Semaine 3", span: 3 },
  ].forEach((w) => {
    const el = document.createElement("div");
    el.className = `week-band span-${w.span}`;
    el.textContent = w.label;
    el.style.gridColumn = `${col} / span ${w.span}`;
    col += w.span;
    grid.appendChild(el);
  });

  grid.appendChild(Object.assign(document.createElement("div"), { className: "week-band corner" }));

  for (let i = 0; i < TOTAL_DAYS; i += 1) {
    const d = dateForDayIndex(i);
    const header = document.createElement("div");
    header.className = `day-header${isToday(i) ? " today" : ""}`;
    header.innerHTML = `
      <span class="day-label">${DAY_NAMES[i % 5]} · J${i + 1}</span>
      <span class="day-date">${formatShortDate(d)}</span>
    `;
    grid.appendChild(header);
  }

  PHASES.forEach((phase) => {
    const entry = currentLayout[phase.id] || { startDay: 0, span: 2 };
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
      store.patch(
        (state) => {
          const target = state.roadmap.layout[dragPhaseId];
          if (!target) return;
          target.startDay = Math.min(day, TOTAL_DAYS - target.span);
        },
        { roadmapTouch: true, save: false }
      );
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
      <div class="block-resize" title="Ajuster la durée"></div>
    `;

    block.addEventListener("dragstart", (e) => {
      dragPhaseId = phase.id;
      block.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
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

    block.querySelector(".block-resize").addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      resizeState = {
        phaseId: phase.id,
        startX: e.clientX,
        startSpan: entry.span,
        trackWidth: lane.getBoundingClientRect().width,
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
      const checked = !!checks()[item.id]?.checked;
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
  document.getElementById("startDate").value = startDate();
  renderSummary();
  renderGrid();
  if (selectedPhaseId) showPhaseDetail(selectedPhaseId);
}

function resetLayout() {
  if (!confirm("Réinitialiser le planning sur 2,5 semaines ?")) return;
  store.patch(
    (state) => {
      state.roadmap.layout = structuredClone(DEFAULT_LAYOUT);
    },
    { roadmapTouch: true }
  );
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

document.getElementById("roomLabel").value = roomId;
PageUtils.setupPageNav(roomId, "roadmap.html");
document.getElementById("footer").textContent =
  `Roadmap Looker — ${PHASES.length} phases · ${TOTAL_DAYS} jours ouvrés — salle « ${roomId} »`;

document.getElementById("startDate").addEventListener("change", (e) => {
  store.patch(
    (state) => {
      state.roadmap.startDate = e.target.value || state.roadmap.startDate;
    },
    { roadmapTouch: true }
  );
  persistLayout();
});

document.getElementById("resetLayoutBtn").addEventListener("click", resetLayout);
document.getElementById("shareBtn").addEventListener("click", copyShareLink);
document.getElementById("closeDetailBtn").addEventListener("click", hidePhaseDetail);

document.addEventListener("mousemove", (e) => {
  if (!resizeState) return;
  const dayWidth = resizeState.trackWidth / TOTAL_DAYS;
  const deltaDays = Math.round((e.clientX - resizeState.startX) / dayWidth);
  const entry = layout()[resizeState.phaseId];
  if (!entry) return;
  const nextSpan = Math.max(1, Math.min(TOTAL_DAYS - entry.startDay, resizeState.startSpan + deltaDays));
  store.patch(
    (state) => {
      state.roadmap.layout[resizeState.phaseId].span = nextSpan;
    },
    { roadmapTouch: true, save: false }
  );
  const block = document.querySelector(`.roadmap-block[data-phase-id="${resizeState.phaseId}"]`);
  if (block) {
    block.style.gridColumn = `${entry.startDay + 1} / span ${nextSpan}`;
    block.querySelector(".block-meta").textContent =
      `J${entry.startDay + 1} → J${entry.startDay + nextSpan} · ${nextSpan} j`;
  }
});

document.addEventListener("mouseup", () => {
  if (!resizeState) return;
  document.body.style.cursor = "";
  resizeState = null;
  persistLayout();
});

store.subscribe(() => render());

(async function init() {
  const status = await store.init();
  if (!syncEnabled) setSyncStatus("offline", "Sauvegardé localement");
  else if (status === "synced") {
    setSyncStatus("synced", "Synchronisé");
    store.startPolling(POLL_MS);
  } else setSyncStatus("error", "Erreur sync");
  render();
})();
