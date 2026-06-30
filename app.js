const { PHASES, ITEMS, PRIORITY_LABEL, PHASE_COLORS } = window.CHECKLIST_DATA;
const SYNC = window.SYNC_CONFIG || { enabled: false };
const PRENOM_KEY = "looker-checklist-prenom";
const POLL_MS = 3000;

const roomId = PageUtils.getRoomIdFromUrl();
const store = RoomStore.create(roomId, SYNC);
const syncEnabled = store.syncEnabled;

let firstName = localStorage.getItem(PRENOM_KEY) || "";
let applyingRemote = false;
let metaSaveTimer = null;
const openGuides = new Set();
const openTodoGuides = new Set();
let openPhases = new Set();

function getChecks() {
  return store.state.checks;
}

function getOpenPhasesSet() {
  return new Set(store.state.openPhases || []);
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

function applyProjectFieldsToUI() {
  document.getElementById("projectName").value = store.state.projectName;
  document.getElementById("reviewer").value = store.state.reviewer;
}

function togglePhaseOpen(phaseId, isOpen) {
  store.patch((state) => {
    const phases = new Set(state.openPhases || []);
    if (isOpen) phases.add(phaseId);
    else phases.delete(phaseId);
    state.openPhases = [...phases];
  });
  openPhases = getOpenPhasesSet();
}

function getCheck(id) {
  return getChecks()[id] || null;
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

function onStoreChange() {
  openPhases = getOpenPhasesSet();
  if (!applyingRemote) applyProjectFieldsToUI();
  render();
}

async function toggleCheck(id, val) {
  if (!firstName) {
    showNameModal();
    render();
    return;
  }

  if (syncEnabled) setSyncStatus("connecting", "Enregistrement…");
  store.patch((state) => {
    state.checks[id] = { checked: val, by: firstName, at: Date.now() };
  });
  if (syncEnabled) {
    store.queueSave().then(() => setSyncStatus("synced", "Synchronisé")).catch(() => setSyncStatus("error", "Erreur enregistrement"));
  }
}

function scheduleMetaSave() {
  if (applyingRemote) return;
  clearTimeout(metaSaveTimer);
  metaSaveTimer = setTimeout(() => {
    if (syncEnabled) setSyncStatus("connecting", "Enregistrement…");
    store.patch((state) => {
      state.projectName = document.getElementById("projectName").value;
      state.reviewer = document.getElementById("reviewer").value;
    });
    if (syncEnabled) {
      store.queueSave().then(() => setSyncStatus("synced", "Synchronisé")).catch(() => setSyncStatus("error", "Erreur enregistrement"));
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
    const isOpen = openPhases.has(phase.id);
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
      const expanded = phaseEl.classList.contains("open");
      btn.setAttribute("aria-expanded", expanded);
      togglePhaseOpen(phase.id, expanded);
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
      const guideOpen = openGuides.has(item.id);
      if (guideOpen) {
        guideBtn.classList.add("open");
        guideBody.classList.add("open");
        guideBtn.setAttribute("aria-expanded", "true");
      }
      guideBtn.addEventListener("click", () => {
        const willOpen = !guideBody.classList.contains("open");
        guideBtn.classList.toggle("open", willOpen);
        guideBody.classList.toggle("open", willOpen);
        guideBtn.setAttribute("aria-expanded", willOpen);
        if (willOpen) openGuides.add(item.id);
        else openGuides.delete(item.id);
      });

      body.appendChild(itemEl);
    });

    container.appendChild(phaseEl);
  });
}

function renderCustomTodos() {
  const todos = store.state.todos || [];
  const section = document.getElementById("customTodosSection");
  const list = document.getElementById("customTodosList");
  const hideCompleted = document.getElementById("hideCompleted").checked;
  const q = (document.getElementById("search").value || "").trim().toLowerCase();

  const visible = todos.filter((t) => {
    if (hideCompleted && t.done) return false;
    if (q) {
      const hay = `${t.title}${t.description || ""}${t.verify || ""}${t.setup || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (!todos.length) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  const done = todos.filter((t) => t.done).length;
  document.getElementById("customTodosCount").textContent = `${done}/${todos.length} terminées`;

  list.innerHTML = "";
  visible.forEach((todo) => {
    const source = todo.weeklyTitle
      ? `<p class="item-attribution">Issu de : ${escHtml(todo.weeklyTitle)}${todo.weeklyDate ? ` — ${formatDate(new Date(`${todo.weeklyDate}T12:00:00`).getTime())}` : ""}</p>`
      : "";
    const doneAttr =
      todo.done && todo.by
        ? `<p class="item-attribution">Validé par <strong>${escHtml(todo.by)}</strong>${todo.at ? ` — ${formatDate(todo.at)}` : ""}</p>`
        : "";
    const desc = todo.description
      ? `<p class="item-desc">${escHtml(todo.description)}</p>`
      : "";

    const itemEl = document.createElement("div");
    itemEl.className = `item custom-todo${todo.done ? " done" : ""}`;
    itemEl.innerHTML = `
      <div class="item-check">
        <input type="checkbox" ${todo.done ? "checked" : ""} aria-label="Marquer l'action comme faite" data-todo-id="${escHtml(todo.id)}" />
      </div>
      <div class="item-content">
        <div class="item-title-row">
          <span class="item-title">${escHtml(todo.title)}</span>
          <span class="pill pill-high">Action weekly</span>
          <button type="button" class="btn-secondary todo-delete-btn" data-todo-delete="${escHtml(todo.id)}" title="Supprimer cette action">Supprimer</button>
        </div>
        ${desc}
        ${source}
        ${doneAttr}
        <button type="button" class="guide-toggle" aria-expanded="false" data-todo-guide="${escHtml(todo.id)}">
          <span class="chevron">▶</span> Vérification et mise en place
        </button>
        <div class="guide-body" data-todo-guide-body="${escHtml(todo.id)}">
          <div class="guide-section">
            <h3>Comment vérifier</h3>
            <p class="guide-text">${todo.verify ? escHtml(todo.verify) : '<em class="guide-empty">À compléter</em>'}</p>
          </div>
          <div class="guide-section">
            <h3>Comment mettre en place</h3>
            <p class="guide-text">${todo.setup ? escHtml(todo.setup) : '<em class="guide-empty">À compléter</em>'}</p>
          </div>
        </div>
      </div>
    `;

    const guideBtn = itemEl.querySelector(".guide-toggle");
    const guideBody = itemEl.querySelector(".guide-body");
    const guideOpen = openTodoGuides.has(todo.id);
    if (guideOpen) {
      guideBtn.classList.add("open");
      guideBody.classList.add("open");
      guideBtn.setAttribute("aria-expanded", "true");
    }
    guideBtn.addEventListener("click", () => {
      const willOpen = !guideBody.classList.contains("open");
      guideBtn.classList.toggle("open", willOpen);
      guideBody.classList.toggle("open", willOpen);
      guideBtn.setAttribute("aria-expanded", willOpen);
      if (willOpen) openTodoGuides.add(todo.id);
      else openTodoGuides.delete(todo.id);
    });

    itemEl.querySelector("[data-todo-id]").addEventListener("change", (e) => {
      toggleCustomTodo(e.target.dataset.todoId, e.target.checked);
    });

    itemEl.querySelector("[data-todo-delete]")?.addEventListener("click", () => {
      deleteCustomTodo(todo.id, todo.title);
    });

    list.appendChild(itemEl);
  });
}

function deleteCustomTodo(id, title) {
  const label = title ? `« ${title} »` : "cette action";
  if (!confirm(`Supprimer ${label} de la checklist ?`)) return;

  if (syncEnabled) setSyncStatus("connecting", "Suppression…");
  store.patch((state) => {
    state.deletedTodoIds = state.deletedTodoIds || {};
    state.deletedTodoIds[id] = Date.now();
    state.todos = (state.todos || []).filter((t) => t.id !== id);
  });
  openTodoGuides.delete(id);

  if (syncEnabled) {
    store.queueSave()
      .then(() => setSyncStatus("synced", "Synchronisé"))
      .catch(() => setSyncStatus("error", "Erreur suppression"));
  }
}

function toggleCustomTodo(id, val) {
  if (!firstName) {
    showNameModal();
    render();
    return;
  }
  if (syncEnabled) setSyncStatus("connecting", "Enregistrement…");
  store.patch((state) => {
    const todo = (state.todos || []).find((t) => t.id === id);
    if (!todo) return;
    todo.done = val;
    todo.by = firstName;
    todo.at = Date.now();
    todo.updatedAt = Date.now();
  });
  if (syncEnabled) {
    store.queueSave()
      .then(() => setSyncStatus("synced", "Synchronisé"))
      .catch(() => setSyncStatus("error", "Erreur enregistrement"));
  }
}

function render() {
  renderStats();
  renderCustomTodos();
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
  openPhases = getOpenPhasesSet();
  applyProjectFieldsToUI();
  document.getElementById("footer").textContent = `Checklist Looker — ${ITEMS.length} points — salle « ${roomId} »`;

  PageUtils.setupPageNav(roomId, "index.html");
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
    store.patch((state) => {
      const cleared = {};
      ITEMS.forEach((item) => {
        cleared[item.id] = { checked: false, by: firstName, at: Date.now() };
      });
      state.checks = cleared;
    });
    if (syncEnabled) store.queueSave();
  });
}

async function initApp() {
  store.subscribe(onStoreChange);
  const status = await store.init();
  if (!syncEnabled) {
    setSyncStatus("offline", "Sauvegardé localement");
    document.getElementById("syncBanner").classList.remove("hidden");
  } else if (status === "synced") {
    document.getElementById("syncBanner").classList.add("hidden");
    setSyncStatus("synced", "Synchronisé");
    store.startPolling(POLL_MS);
  } else if (status === "error") {
    setSyncStatus("error", "Erreur sync");
  } else {
    setSyncStatus("offline", "Sauvegardé localement");
  }
  setupUI();
  render();
}

initApp();
