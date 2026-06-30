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
let undoTimer = null;

const UNDO_MS = 8000;

function getChecks() {
  return store.state.checks;
}

function getTodos() {
  return store.state.todos || [];
}

function getDeletedItemIds() {
  return store.state.deletedItemIds || {};
}

function getVisibleChecklistItems() {
  const deleted = getDeletedItemIds();
  return ITEMS.filter((item) => !deleted[item.id]);
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

function phaseTitle(phaseId) {
  return PHASES.find((p) => p.id === phaseId)?.title || phaseId;
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

function flashStatus(label) {
  if (!syncEnabled) return;
  setSyncStatus("synced", label);
}

function ensureUndoToast() {
  let toast = document.getElementById("undoToast");
  if (toast) return toast;
  toast = document.createElement("div");
  toast.id = "undoToast";
  toast.className = "undo-toast hidden";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  document.body.appendChild(toast);
  return toast;
}

function hideUndoToast() {
  clearTimeout(undoTimer);
  undoTimer = null;
  const toast = document.getElementById("undoToast");
  if (toast) toast.classList.add("hidden");
}

function showUndoToast(message, onUndo) {
  hideUndoToast();

  const toast = ensureUndoToast();
  toast.innerHTML = `
    <span class="undo-toast-text">${escHtml(message)}</span>
    <button type="button" class="undo-toast-btn" id="undoActionBtn">Annuler</button>
  `;
  toast.classList.remove("hidden");

  document.getElementById("undoActionBtn").addEventListener("click", () => {
    onUndo();
    hideUndoToast();
    flashStatus("Suppression annulée");
  });

  undoTimer = setTimeout(hideUndoToast, UNDO_MS);
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

function getFilteredChecklistItems() {
  const q = (document.getElementById("search").value || "").trim().toLowerCase();
  const priority = document.getElementById("priorityFilter").value;
  const phase = document.getElementById("phaseFilter").value;
  const hideCompleted = document.getElementById("hideCompleted").checked;

  return getVisibleChecklistItems().filter((item) => {
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

function getFilteredTodos() {
  const q = (document.getElementById("search").value || "").trim().toLowerCase();
  const phase = document.getElementById("phaseFilter").value;
  const hideCompleted = document.getElementById("hideCompleted").checked;

  return getTodos().filter((todo) => {
    const todoPhase = todo.phaseId || "project-mgmt";
    if (phase !== "all" && todoPhase !== phase) return false;
    if (hideCompleted && todo.done) return false;
    if (q) {
      const hay = `${todo.title}${todo.description || ""}${todo.verify || ""}${todo.setup || ""}${phaseTitle(todoPhase)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function phaseProgress(phaseId) {
  const items = getVisibleChecklistItems().filter((i) => i.phaseId === phaseId);
  const todos = getTodos().filter((t) => (t.phaseId || "project-mgmt") === phaseId);
  const itemsDone = items.filter((i) => isChecked(i.id)).length;
  const todosDone = todos.filter((t) => t.done).length;
  return {
    done: itemsDone + todosDone,
    total: items.length + todos.length,
    itemsDone,
    todosDone,
    itemCount: items.length,
    todoCount: todos.length,
  };
}

function renderStats() {
  const visibleItems = getVisibleChecklistItems();
  const todos = getTodos();
  const total = visibleItems.length + todos.length;
  const done =
    visibleItems.filter((i) => isChecked(i.id)).length + todos.filter((t) => t.done).length;
  const critical = visibleItems.filter((i) => i.priority === "critical");
  const criticalDone = critical.filter((i) => isChecked(i.id)).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  document.getElementById("stats").innerHTML = `
    <div class="card stat">
      <div class="stat-value ${done === total && total > 0 ? "success" : ""}">${done}/${total}</div>
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
  if (critical.length && criticalDone < critical.length) {
    const rem = critical.length - criticalDone;
    callout.innerHTML = `<div class="callout callout-warning"><div class="callout-title">Points critiques en attente</div>${rem} point${rem > 1 ? "s" : ""} critique${rem > 1 ? "s" : ""} restant${rem > 1 ? "s" : ""} sur ${critical.length}.</div>`;
  } else if (total > 0 && done === total) {
    callout.innerHTML = `<div class="callout callout-success"><div class="callout-title">Checklist complète</div>Tous les points de contrôle et tâches sont validés.</div>`;
  } else {
    callout.innerHTML = "";
  }
}

function bindGuideToggle(itemEl, id, isTodo) {
  const guideBtn = itemEl.querySelector(".guide-toggle");
  const guideBody = itemEl.querySelector(".guide-body");
  const guideSet = isTodo ? openTodoGuides : openGuides;
  const guideOpen = guideSet.has(id);
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
    if (willOpen) guideSet.add(id);
    else guideSet.delete(id);
  });
}

function renderChecklistItem(item, body) {
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
        <button type="button" class="item-delete-btn" data-item-delete="${escHtml(item.id)}" title="Masquer ce point" aria-label="Masquer ce point">×</button>
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
  itemEl.querySelector("[data-item-delete]").addEventListener("click", () => {
    deleteChecklistItem(item.id);
  });
  bindGuideToggle(itemEl, item.id, false);
  body.appendChild(itemEl);
}

function renderTodoItem(todo, body) {
  const source = todo.weeklyTitle
    ? `<p class="item-attribution">Issu du CR : ${escHtml(todo.weeklyTitle)}${todo.weeklyDate ? ` — ${formatDate(new Date(`${todo.weeklyDate}T12:00:00`).getTime())}` : ""}</p>`
    : `<p class="item-attribution">Tâche ajoutée manuellement</p>`;
  const doneAttr =
    todo.done && todo.by
      ? `<p class="item-attribution">Validé par <strong>${escHtml(todo.by)}</strong>${todo.at ? ` — ${formatDate(todo.at)}` : ""}</p>`
      : "";
  const desc = todo.description ? `<p class="item-desc">${escHtml(todo.description)}</p>` : "";
  const priority = todo.priority || "medium";
  const pillLabel = todo.weeklyId ? "Action CR" : "Tâche libre";

  const itemEl = document.createElement("div");
  itemEl.className = `item custom-todo${todo.done ? " done" : ""}`;
  itemEl.innerHTML = `
    <div class="item-check">
      <input type="checkbox" ${todo.done ? "checked" : ""} aria-label="Marquer l'action comme faite" data-todo-id="${escHtml(todo.id)}" />
    </div>
    <div class="item-content">
      <div class="item-title-row">
        <span class="item-title">${escHtml(todo.title)}</span>
        <span class="pill pill-${priority}">${PRIORITY_LABEL[priority] || "Moyenne"}</span>
        <span class="pill">${escHtml(pillLabel)}</span>
        <button type="button" class="item-delete-btn" data-todo-delete="${escHtml(todo.id)}" title="Supprimer cette tâche" aria-label="Supprimer cette tâche">×</button>
      </div>
      ${desc}
      ${source}
      ${doneAttr}
      <button type="button" class="guide-toggle" aria-expanded="false">
        <span class="chevron">▶</span> Vérification et mise en place
      </button>
      <div class="guide-body">
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

  itemEl.querySelector("[data-todo-id]").addEventListener("change", (e) => {
    toggleCustomTodo(e.target.dataset.todoId, e.target.checked);
  });
  itemEl.querySelector("[data-todo-delete]").addEventListener("click", () => {
    deleteCustomTodo(todo.id);
  });
  bindGuideToggle(itemEl, todo.id, true);
  body.appendChild(itemEl);
}

function renderPhases() {
  const filteredItems = getFilteredChecklistItems();
  const filteredTodos = getFilteredTodos();
  const visibleCount = filteredItems.length + filteredTodos.length;

  document.getElementById("itemsHeading").textContent = `Points de contrôle et tâches (${visibleCount} affichés)`;
  document.getElementById("noResults").classList.toggle("hidden", visibleCount > 0);

  const container = document.getElementById("phases");
  container.innerHTML = "";

  PHASES.forEach((phase) => {
    const phaseItems = filteredItems.filter((i) => i.phaseId === phase.id);
    const phaseTodos = filteredTodos.filter((t) => (t.phaseId || "project-mgmt") === phase.id);
    if (!phaseItems.length && !phaseTodos.length) return;

    const { done, total } = phaseProgress(phase.id);
    const isOpen = openPhases.has(phase.id);
    const phaseEl = document.createElement("div");
    phaseEl.className = `phase${isOpen ? " open" : ""}`;
    phaseEl.innerHTML = `
      <button type="button" class="phase-header" aria-expanded="${isOpen}">
        <span class="chevron">▶</span>
        <span class="phase-dot" style="background:${PHASE_COLORS[phase.id]}"></span>
        <span>${escHtml(phase.title)}</span>
        <span class="phase-count">(${phaseItems.length + phaseTodos.length})</span>
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
    phaseItems.forEach((item) => renderChecklistItem(item, body));
    phaseTodos.forEach((todo) => renderTodoItem(todo, body));
    container.appendChild(phaseEl);
  });
}

function deleteChecklistItem(id) {
  const item = ITEMS.find((i) => i.id === id);
  const label = item?.title || "Ce point";

  store.patch((state) => {
    state.deletedItemIds = state.deletedItemIds || {};
    state.deletedItemIds[id] = Date.now();
  });
  openGuides.delete(id);

  showUndoToast(`${label} masqué`, () => {
    store.patch((state) => {
      if (state.deletedItemIds?.[id]) delete state.deletedItemIds[id];
    });
  });
}

function deleteCustomTodo(id) {
  const todo = getTodos().find((t) => t.id === id);
  if (!todo) return;
  const snapshot = structuredClone(todo);
  const label = todo.title || "Cette tâche";

  store.patch((state) => {
    state.deletedTodoIds = state.deletedTodoIds || {};
    state.deletedTodoIds[id] = Date.now();
    state.todos = (state.todos || []).filter((t) => t.id !== id);
  });
  openTodoGuides.delete(id);

  showUndoToast(`${label} supprimée`, () => {
    store.patch((state) => {
      if (state.deletedTodoIds?.[id]) delete state.deletedTodoIds[id];
      const todos = [...(state.todos || [])];
      if (!todos.some((t) => t.id === snapshot.id)) {
        todos.unshift({ ...snapshot, updatedAt: Date.now() });
        state.todos = todos;
      }
    });
  });
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

async function addManualTask(e) {
  e.preventDefault();
  const title = document.getElementById("newTaskTitle").value.trim();
  const description = document.getElementById("newTaskDesc").value.trim();
  let phaseId = document.getElementById("newTaskPhase").value;
  const submitBtn = document.getElementById("addTaskSubmitBtn");

  if (!title) {
    document.getElementById("newTaskTitle").focus();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = window.GeminiClient?.isEnabled?.() ? "Classification…" : "Ajout…";

  try {
    if (window.GeminiClient?.isEnabled?.()) {
      const [classified] = await GeminiClient.categorizeTasks([{ title, description }]);
      if (classified?.phaseId) {
        phaseId = classified.phaseId;
        document.getElementById("newTaskPhase").value = phaseId;
      }
    } else if (window.ActionMatcher?.guessPhaseId) {
      phaseId = ActionMatcher.guessPhaseId(title, description);
    }

    store.patch((state) => {
      const todos = [...(state.todos || [])];
      todos.unshift({
        id: PageUtils.newTodoId(),
        title,
        description,
        verify: "",
        setup: "",
        phaseId,
        priority: "medium",
        done: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      state.todos = todos;
      const phases = new Set(state.openPhases || []);
      phases.add(phaseId);
      state.openPhases = [...phases];
    });

    document.getElementById("addTaskForm").reset();
    document.getElementById("addTaskForm").classList.add("hidden");
    document.getElementById("toggleAddTaskBtn").textContent = "+ Nouvelle tâche";
    openPhases = getOpenPhasesSet();
    flashStatus("Tâche ajoutée");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Ajouter la tâche";
  }
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

  const newTaskPhase = document.getElementById("newTaskPhase");
  if (newTaskPhase) {
    PHASES.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.title;
      newTaskPhase.appendChild(opt);
    });
  }
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
    if (!firstName) {
      showNameModal();
      return;
    }
    store.patch((state) => {
      const cleared = { ...(state.checks || {}) };
      getVisibleChecklistItems().forEach((item) => {
        cleared[item.id] = { checked: false, by: firstName, at: Date.now() };
      });
      state.checks = cleared;
      (state.todos || []).forEach((todo) => {
        todo.done = false;
        todo.by = firstName;
        todo.at = Date.now();
        todo.updatedAt = Date.now();
      });
    });
    flashStatus("Coches réinitialisées");
  });

  document.getElementById("toggleAddTaskBtn").addEventListener("click", () => {
    const form = document.getElementById("addTaskForm");
    const isHidden = form.classList.contains("hidden");
    form.classList.toggle("hidden", !isHidden);
    document.getElementById("toggleAddTaskBtn").textContent = isHidden ? "Annuler" : "+ Nouvelle tâche";
    if (isHidden) document.getElementById("newTaskTitle").focus();
  });
  document.getElementById("addTaskForm").addEventListener("submit", addManualTask);
}

async function initApp() {
  store.subscribe(onStoreChange);
  const status = await store.init();

  const todosNeedPhase = (store.state.todos || []).some((t) => !t.phaseId);
  if (todosNeedPhase && window.ActionMatcher?.guessPhaseId) {
    store.patch((state) => {
      (state.todos || []).forEach((todo) => {
        if (!todo.phaseId) {
          todo.phaseId = ActionMatcher.guessPhaseId(todo.title, todo.description || "");
          todo.updatedAt = Date.now();
        }
      });
    });
  }

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
