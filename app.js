const { PHASES, ITEMS, PRIORITY_LABEL, PHASE_COLORS } = window.CHECKLIST_DATA;
const SYNC = window.SYNC_CONFIG || { enabled: false };
const PRENOM_KEY = "looker-checklist-prenom";
const POLL_MS = 3000;

let roomId = getRoomId();
let firstName = localStorage.getItem(PRENOM_KEY) || "";
let remoteState = { checks: {}, projectName: "", reviewer: "" };
let fileSha = null;
let applyingRemote = false;
let metaSaveTimer = null;
let pollTimer = null;
let saveQueue = Promise.resolve();

const syncEnabled = SYNC.enabled && SYNC.token;

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

function syncPath() {
  return `sync/${roomId}.json`;
}

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function formatDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getCheck(id) {
  return remoteState.checks[id] || null;
}

function isChecked(id) {
  const c = getCheck(id);
  return !!(c && c.checked);
}

function setSyncStatus(kind, label) {
  const el = document.getElementById("syncStatus");
  el.className = `sync-badge sync-${kind}`;
  el.textContent = label;
}

function showNameModal() {
  document.getElementById("nameModal").classList.remove("hidden");
  document.getElementById("modalFirstName").focus();
}

function hideNameModal() {
  document.getElementById("nameModal").classList.add("hidden");
}

function saveFirstName(name) {
  firstName = name.trim().slice(0, 40);
  if (!firstName) return false;
  localStorage.setItem(PRENOM_KEY, firstName);
  document.getElementById("firstName").value = firstName;
  return true;
}

function attributionHtml(check) {
  if (!check || !check.by) return "";
  const when = formatDate(check.at);
  if (check.checked) {
    return `<p class="item-attribution">Validé par <strong>${escHtml(check.by)}</strong>${when ? ` — ${when}` : ""}</p>`;
  }
  return `<p class="item-attribution unchecked">Décoché par <strong>${escHtml(check.by)}</strong>${when ? ` — ${when}` : ""}</p>`;
}

function applyRemoteData(data) {
  applyingRemote = true;
  remoteState = {
    checks: data.checks || {},
    projectName: data.projectName || "",
    reviewer: data.reviewer || "",
  };
  document.getElementById("projectName").value = remoteState.projectName;
  document.getElementById("reviewer").value = remoteState.reviewer;
  applyingRemote = false;
  render();
}

async function fetchRemote() {
  if (!syncEnabled) return;

  try {
    const url = `https://api.github.com/repos/${SYNC.owner}/${SYNC.repo}/contents/${syncPath()}?ref=${SYNC.branch}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${SYNC.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (res.status === 404) {
      fileSha = null;
      remoteState = { checks: {}, projectName: "", reviewer: "" };
      render();
      return;
    }

    if (!res.ok) throw new Error("fetch failed");

    const meta = await res.json();
    fileSha = meta.sha;
    const json = JSON.parse(atob(meta.content.replace(/\n/g, "")));
    applyRemoteData(json);
    setSyncStatus("synced", "Synchronisé");
  } catch {
    setSyncStatus("error", "Erreur sync");
  }
}

async function persistRemote() {
  if (!syncEnabled) return;

  const payload = {
    projectName: remoteState.projectName,
    reviewer: remoteState.reviewer,
    checks: remoteState.checks,
    updatedAt: Date.now(),
  };

  const body = {
    message: `Sync checklist ${roomId} by ${firstName || "unknown"}`,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2)))),
    branch: SYNC.branch,
  };
  if (fileSha) body.sha = fileSha;

  const url = `https://api.github.com/repos/${SYNC.owner}/${SYNC.repo}/contents/${syncPath()}`;
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
  fileSha = data.content?.sha || fileSha;
  setSyncStatus("synced", "Synchronisé");
}

function queueSave(fn) {
  saveQueue = saveQueue.then(fn).catch(() => setSyncStatus("error", "Erreur enregistrement"));
}

async function initSync() {
  if (!syncEnabled) {
    setSyncStatus("offline", "Sync non configurée");
    document.getElementById("syncBanner").classList.remove("hidden");
    return;
  }

  document.getElementById("syncBanner").classList.add("hidden");
  setSyncStatus("connecting", "Connexion…");
  await fetchRemote();
  pollTimer = setInterval(fetchRemote, POLL_MS);
}

async function toggleCheck(id, val) {
  if (!firstName) {
    showNameModal();
    render();
    return;
  }

  remoteState.checks[id] = { checked: val, by: firstName, at: Date.now() };
  render();

  if (!syncEnabled) return;

  setSyncStatus("connecting", "Enregistrement…");
  queueSave(async () => {
    await persistRemote();
    await fetchRemote();
  });
}

function scheduleMetaSave() {
  if (applyingRemote) return;
  clearTimeout(metaSaveTimer);
  metaSaveTimer = setTimeout(() => {
    remoteState.projectName = document.getElementById("projectName").value;
    remoteState.reviewer = document.getElementById("reviewer").value;
    if (syncEnabled) {
      setSyncStatus("connecting", "Enregistrement…");
      queueSave(async () => {
        await persistRemote();
        await fetchRemote();
      });
    }
  }, 600);
}

function getFilteredItems() {
  const q = (document.getElementById("search").value || "").trim().toLowerCase();
  const priority = document.getElementById("priorityFilter").value;
  const phase = document.getElementById("phaseFilter").value;
  const hideCompleted = document.getElementById("hideCompleted").checked;
  return ITEMS.filter((item) => {
    if (priority !== "all" && item.priority !== priority) return false;
    if (phase !== "all" && item.phaseId !== phase) return false;
    if (hideCompleted && isChecked(item.id)) return false;
    if (q) {
      const hay = `${item.title}${item.category}${item.description}${item.verify}${item.setup}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function phaseProgress(phaseId) {
  const items = ITEMS.filter((i) => i.phaseId === phaseId);
  const done = items.filter((i) => isChecked(i.id)).length;
  return { done, total: items.length };
}

function renderStats() {
  const total = ITEMS.length;
  const done = ITEMS.filter((i) => isChecked(i.id)).length;
  const critical = ITEMS.filter((i) => i.priority === "critical");
  const criticalDone = critical.filter((i) => isChecked(i.id)).length;
  const pct = Math.round((done / total) * 100);

  document.getElementById("stats").innerHTML = `
    <div class="card stat">
      <div class="stat-value ${done === total ? "success" : ""}">${done}/${total}</div>
      <div class="stat-label">Points validés</div>
    </div>
    <div class="card stat">
      <div class="stat-value">${pct}%</div>
      <div class="stat-label">Progression globale</div>
    </div>
    <div class="card stat">
      <div class="stat-value ${criticalDone === critical.length ? "success" : "warning"}">${criticalDone}/${critical.length}</div>
      <div class="stat-label">Critiques validés</div>
    </div>
  `;

  document.getElementById("progressLeft").textContent = `${done} validés`;
  document.getElementById("progressRight").textContent = `${total - done} restants`;

  document.getElementById("progressBar").innerHTML = PHASES.map((p) => {
    const { done: pd } = phaseProgress(p.id);
    const w = total > 0 ? (pd / total) * 100 : 0;
    return `<div class="progress-seg" style="width:${w}%;background:${PHASE_COLORS[p.id]}"></div>`;
  }).join("");

  const callout = document.getElementById("callout");
  if (criticalDone < critical.length) {
    const rem = critical.length - criticalDone;
    callout.innerHTML = `<div class="callout callout-warning"><div class="callout-title">Points critiques en attente</div>${rem} point${rem > 1 ? "s" : ""} critique${rem > 1 ? "s" : ""} restant${rem > 1 ? "s" : ""} sur ${critical.length}.</div>`;
  } else if (done === total) {
    callout.innerHTML = `<div class="callout callout-success"><div class="callout-title">Checklist complète</div>Tous les points de contrôle sont validés.</div>`;
  } else {
    callout.innerHTML = "";
  }
}

function renderPhases() {
  const filtered = getFilteredItems();
  document.getElementById("itemsHeading").textContent = `Points de contrôle (${filtered.length} affichés)`;
  document.getElementById("noResults").classList.toggle("hidden", filtered.length > 0);

  const container = document.getElementById("phases");
  container.innerHTML = "";

  PHASES.forEach((phase) => {
    const phaseItems = filtered.filter((i) => i.phaseId === phase.id);
    if (phaseItems.length === 0) return;

    const { done, total } = phaseProgress(phase.id);
    const isOpen = phase.id === "infra" || phase.id === "lookml";
    const phaseEl = document.createElement("div");
    phaseEl.className = `phase${isOpen ? " open" : ""}`;
    phaseEl.innerHTML = `
      <button type="button" class="phase-header" aria-expanded="${isOpen}">
        <span class="chevron">▶</span>
        <span class="phase-dot" style="background:${PHASE_COLORS[phase.id]}"></span>
        <span>${escHtml(phase.title)}</span>
        <span class="phase-count">(${phaseItems.length})</span>
        <span class="phase-progress">${done}/${total}</span>
      </button>
      <div class="phase-body"></div>
    `;

    phaseEl.querySelector(".phase-header").addEventListener("click", (e) => {
      const btn = e.currentTarget;
      phaseEl.classList.toggle("open");
      btn.setAttribute("aria-expanded", phaseEl.classList.contains("open"));
    });

    const body = phaseEl.querySelector(".phase-body");
    phaseItems.forEach((item) => {
      const check = getCheck(item.id);
      const done = isChecked(item.id);
      const itemEl = document.createElement("div");
      itemEl.className = `item${done ? " done" : ""}`;
      itemEl.innerHTML = `
        <div class="item-check">
          <input type="checkbox" ${done ? "checked" : ""} aria-label="Marquer comme validé" />
        </div>
        <div class="item-content">
          <div class="item-title-row">
            <span class="item-title">${escHtml(item.title)}</span>
            <span class="pill pill-${item.priority}">${PRIORITY_LABEL[item.priority]}</span>
            <span class="pill">${escHtml(item.category)}</span>
          </div>
          <p class="item-desc">${escHtml(item.description)}</p>
          ${attributionHtml(check)}
          <button type="button" class="guide-toggle" aria-expanded="false">
            <span class="chevron">▶</span> Vérification et mise en place
          </button>
          <div class="guide-body">
            <div class="guide-section">
              <h3>Comment vérifier</h3>
              <p class="guide-text">${escHtml(item.verify)}</p>
            </div>
            <div class="guide-section">
              <h3>Comment mettre en place</h3>
              <p class="guide-text">${escHtml(item.setup)}</p>
            </div>
          </div>
        </div>
      `;

      itemEl.querySelector(".item-check input").addEventListener("change", (e) => {
        toggleCheck(item.id, e.target.checked);
      });

      const guideBtn = itemEl.querySelector(".guide-toggle");
      const guideBody = itemEl.querySelector(".guide-body");
      guideBtn.addEventListener("click", () => {
        guideBtn.classList.toggle("open");
        guideBody.classList.toggle("open");
        guideBtn.setAttribute("aria-expanded", guideBody.classList.contains("open"));
      });

      body.appendChild(itemEl);
    });

    container.appendChild(phaseEl);
  });
}

function render() {
  renderStats();
  renderPhases();
}

function populatePhaseFilter() {
  const select = document.getElementById("phaseFilter");
  PHASES.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.title;
    select.appendChild(opt);
  });
}

function copyShareLink() {
  navigator.clipboard.writeText(window.location.href).then(() => {
    const btn = document.getElementById("shareBtn");
    const prev = btn.textContent;
    btn.textContent = "Lien copié !";
    setTimeout(() => { btn.textContent = prev; }, 2000);
  });
}

function setupUI() {
  document.getElementById("roomLabel").value = roomId;
  document.getElementById("firstName").value = firstName;
  document.getElementById("footer").textContent = `Checklist Looker — ${ITEMS.length} points — salle « ${roomId} »`;

  populatePhaseFilter();
  if (!firstName) showNameModal();

  document.getElementById("modalSaveBtn").addEventListener("click", () => {
    if (saveFirstName(document.getElementById("modalFirstName").value)) hideNameModal();
    else document.getElementById("modalFirstName").focus();
  });
  document.getElementById("modalFirstName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("modalSaveBtn").click();
  });
  document.getElementById("firstName").addEventListener("change", (e) => saveFirstName(e.target.value));
  document.getElementById("projectName").addEventListener("input", scheduleMetaSave);
  document.getElementById("reviewer").addEventListener("input", scheduleMetaSave);
  ["search", "priorityFilter", "phaseFilter", "hideCompleted"].forEach((id) => {
    document.getElementById(id).addEventListener(id === "hideCompleted" ? "change" : "input", render);
    if (id !== "search") document.getElementById(id).addEventListener("change", render);
  });
  document.getElementById("shareBtn").addEventListener("click", copyShareLink);
  document.getElementById("resetBtn").addEventListener("click", () => {
    if (!confirm("Réinitialiser toutes les coches de cet espace partagé ?")) return;
    if (!firstName && !saveFirstName(prompt("Votre prénom :") || "")) return;
    const cleared = {};
    ITEMS.forEach((item) => {
      cleared[item.id] = { checked: false, by: firstName, at: Date.now() };
    });
    remoteState.checks = cleared;
    render();
    if (syncEnabled) {
      queueSave(async () => {
        await persistRemote();
        await fetchRemote();
      });
    }
  });
}

setupUI();
initSync();
render();
