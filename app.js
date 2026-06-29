import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore,
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const { PHASES, ITEMS, PRIORITY_LABEL, PHASE_COLORS } = window.CHECKLIST_DATA;
const PRENOM_KEY = "looker-checklist-prenom";
const LOCAL_FALLBACK_KEY = "looker-checklist-local-v2";

let roomId = getRoomId();
let firstName = localStorage.getItem(PRENOM_KEY) || "";
let remoteState = { checks: {}, projectName: "", reviewer: "" };
let firebaseReady = false;
let firestore = null;
let roomRef = null;
let applyingRemote = false;
let metaSaveTimer = null;

const syncEnabled =
  window.FIREBASE_ENABLED === true &&
  window.FIREBASE_CONFIG &&
  window.FIREBASE_CONFIG.apiKey &&
  window.FIREBASE_CONFIG.projectId;

function getRoomId() {
  const params = new URLSearchParams(window.location.search);
  let room = (params.get("room") || "").trim();
  if (!room) {
    room = "audit-looker";
    params.set("room", room);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, "", newUrl);
  }
  return room.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
}

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function formatDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString("fr-FR", {
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

async function initFirebase() {
  if (!syncEnabled) {
    setSyncStatus("offline", "Local uniquement");
    document.getElementById("syncBanner").classList.remove("hidden");
    loadLocalFallback();
    return;
  }

  document.getElementById("syncBanner").classList.add("hidden");
  setSyncStatus("connecting", "Connexion…");

  try {
    const app = initializeApp(window.FIREBASE_CONFIG);
    firestore = getFirestore(app);
    roomRef = doc(firestore, "checklists", roomId);
    firebaseReady = true;

    onSnapshot(
      roomRef,
      (snap) => {
        applyingRemote = true;
        if (snap.exists()) {
          const data = snap.data();
          remoteState = {
            checks: data.checks || {},
            projectName: data.projectName || "",
            reviewer: data.reviewer || "",
          };
        } else {
          remoteState = { checks: {}, projectName: "", reviewer: "" };
        }
        syncMetaFieldsFromRemote();
        applyingRemote = false;
        setSyncStatus("synced", "Synchronisé");
        render();
      },
      () => {
        setSyncStatus("error", "Erreur sync");
        loadLocalFallback();
      }
    );
  } catch {
    setSyncStatus("error", "Erreur Firebase");
    document.getElementById("syncBanner").classList.remove("hidden");
    loadLocalFallback();
  }
}

function loadLocalFallback() {
  try {
    const local = JSON.parse(localStorage.getItem(LOCAL_FALLBACK_KEY));
    if (local && local.roomId === roomId) {
      remoteState = {
        checks: local.checks || {},
        projectName: local.projectName || "",
        reviewer: local.reviewer || "",
      };
      syncMetaFieldsFromRemote();
      render();
    }
  } catch {
    /* ignore */
  }
}

function saveLocalFallback() {
  localStorage.setItem(
    LOCAL_FALLBACK_KEY,
    JSON.stringify({
      roomId,
      checks: remoteState.checks,
      projectName: remoteState.projectName,
      reviewer: remoteState.reviewer,
    })
  );
}

function syncMetaFieldsFromRemote() {
  document.getElementById("projectName").value = remoteState.projectName || "";
  document.getElementById("reviewer").value = remoteState.reviewer || "";
}

async function persistMeta() {
  if (applyingRemote) return;
  remoteState.projectName = document.getElementById("projectName").value;
  remoteState.reviewer = document.getElementById("reviewer").value;
  saveLocalFallback();

  if (!firebaseReady || !roomRef) return;

  try {
    await setDoc(
      roomRef,
      {
        projectName: remoteState.projectName,
        reviewer: remoteState.reviewer,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch {
    setSyncStatus("error", "Erreur enregistrement");
  }
}

function scheduleMetaSave() {
  clearTimeout(metaSaveTimer);
  metaSaveTimer = setTimeout(persistMeta, 600);
}

async function toggleCheck(id, val) {
  if (!firstName) {
    showNameModal();
    render();
    return;
  }

  const entry = {
    checked: val,
    by: firstName,
    at: Date.now(),
  };

  remoteState.checks[id] = entry;
  saveLocalFallback();
  render();

  if (!firebaseReady || !roomRef) return;

  setSyncStatus("connecting", "Enregistrement…");
  try {
    await setDoc(
      roomRef,
      {
        checks: { [id]: entry },
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    setSyncStatus("synced", "Synchronisé");
  } catch {
    setSyncStatus("error", "Erreur enregistrement");
  }
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
      const hay = (
        item.title +
        item.category +
        item.description +
        item.verify +
        item.setup
      ).toLowerCase();
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

  const bar = document.getElementById("progressBar");
  bar.innerHTML = PHASES.map((p) => {
    const { done: pd } = phaseProgress(p.id);
    const w = total > 0 ? (pd / total) * 100 : 0;
    return `<div class="progress-seg" style="width:${w}%;background:${PHASE_COLORS[p.id]}"></div>`;
  }).join("");

  const callout = document.getElementById("callout");
  if (criticalDone < critical.length) {
    const rem = critical.length - criticalDone;
    callout.innerHTML = `<div class="callout callout-warning"><div class="callout-title">Points critiques en attente</div>${rem} point${rem > 1 ? "s" : ""} critique${rem > 1 ? "s" : ""} restant${rem > 1 ? "s" : ""} sur ${critical.length}. Priorisez-les avant le go-live.</div>`;
  } else if (done === total) {
    callout.innerHTML = `<div class="callout callout-success"><div class="callout-title">Checklist complète</div>Tous les points de contrôle sont validés. Planifiez une revue trimestrielle pour maintenir la conformité.</div>`;
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

    const header = phaseEl.querySelector(".phase-header");
    header.addEventListener("click", () => {
      phaseEl.classList.toggle("open");
      header.setAttribute("aria-expanded", phaseEl.classList.contains("open"));
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
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById("shareBtn");
    const prev = btn.textContent;
    btn.textContent = "Lien copié !";
    setTimeout(() => {
      btn.textContent = prev;
    }, 2000);
  });
}

function setupUI() {
  document.getElementById("roomLabel").value = roomId;
  document.getElementById("firstName").value = firstName;
  document.getElementById("footer").textContent = `Checklist Looker — ${ITEMS.length} points de contrôle — salle « ${roomId} »`;

  populatePhaseFilter();

  if (!firstName) showNameModal();

  document.getElementById("modalSaveBtn").addEventListener("click", () => {
    const name = document.getElementById("modalFirstName").value;
    if (saveFirstName(name)) hideNameModal();
    else document.getElementById("modalFirstName").focus();
  });

  document.getElementById("modalFirstName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("modalSaveBtn").click();
  });

  document.getElementById("firstName").addEventListener("change", (e) => {
    saveFirstName(e.target.value);
  });

  document.getElementById("projectName").addEventListener("input", scheduleMetaSave);
  document.getElementById("reviewer").addEventListener("input", scheduleMetaSave);

  ["search", "priorityFilter", "phaseFilter", "hideCompleted"].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener(id === "hideCompleted" ? "change" : "input", render);
    if (id !== "search") el.addEventListener("change", render);
  });

  document.getElementById("shareBtn").addEventListener("click", copyShareLink);

  document.getElementById("resetBtn").addEventListener("click", async () => {
    if (!confirm("Réinitialiser toutes les coches de cet espace partagé ?")) return;
    if (!firstName && !saveFirstName(prompt("Votre prénom :") || "")) return;

    const cleared = {};
    ITEMS.forEach((item) => {
      cleared[item.id] = { checked: false, by: firstName, at: Date.now() };
    });
    remoteState.checks = cleared;
    saveLocalFallback();
    render();

    if (firebaseReady && roomRef) {
      await setDoc(roomRef, { checks: cleared, updatedAt: serverTimestamp() }, { merge: true });
    }
  });
}

setupUI();
initFirebase().then(() => render());
