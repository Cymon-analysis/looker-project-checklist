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
let enrichPendingFiles = [];
let enrichResultData = { enrichments: [], newTasks: [] };

const UNDO_MS = 8000;

function getItemEnrichments() {
  return store.state.itemEnrichments || {};
}

function getItemEnrichment(itemId) {
  return getItemEnrichments()[itemId] || null;
}

function escAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function renderSubtasksHtml(subtasks, parentKey, onToggle) {
  const list = (subtasks || []).filter((s) => s && s.title);
  if (!list.length) return "";
  const items = list
    .map(
      (sub) => `
      <li>
        <input type="checkbox" data-subtask-parent="${escAttr(parentKey)}" data-subtask-id="${escAttr(sub.id)}" ${sub.done ? "checked" : ""} aria-label="Sous-action" />
        <span class="${sub.done ? "subtask-done" : ""}">${escHtml(sub.title)}</span>
      </li>`
    )
    .join("");
  return `<div class="guide-subtasks"><h4>Sous-actions</h4><ul class="subtasks-list">${items}</ul></div>`;
}

function bindSubtaskToggles(container, kind) {
  container.querySelectorAll("[data-subtask-id]").forEach((input) => {
    input.addEventListener("change", () => {
      const parentKey = input.dataset.subtaskParent;
      const subId = input.dataset.subtaskId;
      const done = input.checked;
      store.patch((state) => {
        if (kind === "todo") {
          const todo = (state.todos || []).find((t) => t.id === parentKey);
          if (!todo?.subtasks) return;
          const sub = todo.subtasks.find((s) => s.id === subId);
          if (sub) sub.done = done;
          todo.updatedAt = Date.now();
        } else {
          state.itemEnrichments = state.itemEnrichments || {};
          const entry = state.itemEnrichments[parentKey];
          if (!entry?.subtasks) return;
          const sub = entry.subtasks.find((s) => s.id === subId);
          if (sub) sub.done = done;
        }
      });
      const label = input.nextElementSibling;
      if (label) label.classList.toggle("subtask-done", done);
    });
  });
}

function normalizeSubtasks(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((s) => {
      if (typeof s === "string") {
        const title = s.trim();
        if (!title) return null;
        return { id: PageUtils.newTodoId(), title, done: false };
      }
      const title = String(s.title || s.text || "").trim();
      if (!title) return null;
      return {
        id: s.id || PageUtils.newTodoId(),
        title,
        done: !!s.done,
      };
    })
    .filter(Boolean);
}

function getCatalogs() {
  return {
    todos: getTodos(),
    checklistItems: getVisibleChecklistItems(),
  };
}

function buildEnrichableTasks() {
  const tasks = [];
  getVisibleChecklistItems().forEach((item) => {
    const enrichment = getItemEnrichment(item.id);
    tasks.push({
      refId: item.id,
      kind: "checklist",
      title: item.title,
      description: enrichment?.description || item.description,
      verify: enrichment?.verify || item.verify,
      setup: enrichment?.setup || item.setup,
      phaseId: item.phaseId,
      priority: item.priority,
      category: item.category,
    });
  });
  (getTodos() || []).forEach((todo) => {
    if (todo.done) return;
    tasks.push({
      refId: todo.id,
      kind: "todo",
      title: todo.title,
      description: todo.description || "",
      verify: todo.verify || "",
      setup: todo.setup || "",
      phaseId: todo.phaseId || "project-mgmt",
      priority: todo.priority || "medium",
    });
  });
  return tasks;
}

function renderEnrichTaskList() {
  const list = document.getElementById("enrichTaskList");
  if (!list) return;
  const tasks = buildEnrichableTasks();
  if (!tasks.length) {
    list.innerHTML = '<p class="paste-hint">Aucune tâche disponible.</p>';
    return;
  }
  list.innerHTML = tasks
    .map(
      (task) => `
      <div class="enrich-task-row">
        <label>
          <input type="checkbox" data-enrich-ref="${escAttr(task.refId)}" data-enrich-kind="${escAttr(task.kind)}" data-enrich-priority="${escAttr(task.priority)}" ${
        task.priority === "critical" || task.priority === "high" ? "checked" : ""
      } />
          <span>
            <strong>${escHtml(task.title)}</strong>
            <span class="paste-hint"> — ${escHtml(task.kind === "checklist" ? "Checklist" : "Todo")} · ${escHtml(PRIORITY_LABEL[task.priority] || task.priority)}</span>
          </span>
        </label>
      </div>`
    )
    .join("");
}

function getSelectedEnrichTasks() {
  const all = buildEnrichableTasks();
  const selected = new Set();
  document.querySelectorAll("#enrichTaskList [data-enrich-ref]:checked").forEach((el) => {
    selected.add(el.dataset.enrichRef);
  });
  return all.filter((t) => selected.has(t.refId));
}

async function updateNotebookLMUI() {
  const statusEl = document.getElementById("notebooklmStatus");
  const hintEl = document.getElementById("notebooklmHint");
  const btn = document.getElementById("openEnrichBtn");
  if (!statusEl || !btn) return;

  if (!window.NotebookLMClient?.isConfigured?.()) {
    statusEl.textContent = "Proxy non configuré";
    statusEl.className = "calendar-status warn";
    btn.disabled = true;
    if (hintEl) {
      hintEl.textContent = "Configurez GEMINI_PROXY_URL et déployez NotebookLM MCP (voir docs/NOTEBOOKLM-MCP.md).";
      hintEl.classList.remove("hidden");
    }
    return;
  }

  const status = await NotebookLMClient.checkStatus();
  if (status.configured) {
    statusEl.textContent = "NotebookLM connecté";
    statusEl.className = "calendar-status ok";
    btn.disabled = false;
    if (hintEl) hintEl.classList.add("hidden");
  } else {
    statusEl.textContent = "NotebookLM non configuré";
    statusEl.className = "calendar-status warn";
    btn.disabled = true;
    if (hintEl) {
      hintEl.textContent =
        "Le proxy Cloud Run doit exposer NOTEBOOKLM_API_URL et NOTEBOOKLM_NOTEBOOK_ID. Voir docs/NOTEBOOKLM-MCP.md.";
      hintEl.classList.remove("hidden");
    }
  }
}

function openEnrichModal() {
  enrichPendingFiles = [];
  document.getElementById("enrichFileList").innerHTML = "";
  document.getElementById("enrichFileInput").value = "";
  renderEnrichTaskList();
  document.getElementById("enrichModal").classList.remove("hidden");
}

function hideEnrichModal() {
  document.getElementById("enrichModal")?.classList.add("hidden");
}

function hideEnrichResultModal() {
  document.getElementById("enrichResultModal")?.classList.add("hidden");
  enrichResultData = { enrichments: [], newTasks: [] };
}

async function readEnrichFiles(fileList) {
  const files = Array.from(fileList || []);
  const sources = [];
  for (const file of files.slice(0, 8)) {
    if (file.size > 800_000) continue;
    const text = await file.text();
    if (!text.trim()) continue;
    sources.push({ title: file.name, text });
  }
  return sources;
}

function phaseOptionsHtml(selectedId) {
  return PHASES.map(
    (p) =>
      `<option value="${escAttr(p.id)}"${p.id === selectedId ? " selected" : ""}>${escHtml(p.title)}</option>`
  ).join("");
}

function importTagForStatus(status) {
  if (status === "duplicate-todo" || status === "duplicate-checklist") {
    return { className: "tag-duplicate", text: "Doublon" };
  }
  if (status === "similar-todo" || status === "similar-checklist") {
    return { className: "tag-similar", text: "Similaire" };
  }
  return { className: "", text: "Nouvelle" };
}

function showEnrichResults(data) {
  enrichResultData = data;
  const enrichments = data.enrichments || [];
  const newTasks = data.newTasks || [];

  document.getElementById("enrichResultSubtitle").textContent =
    `${enrichments.length} enrichissement${enrichments.length > 1 ? "s" : ""}, ${newTasks.length} nouvelle${newTasks.length > 1 ? "s" : ""} tâche${newTasks.length > 1 ? "s" : ""} proposée${newTasks.length > 1 ? "s" : ""}.`;

  const enrichEl = document.getElementById("enrichResultEnrichments");
  enrichEl.innerHTML = enrichments.length
    ? enrichments
        .map((item, index) => {
          const subtasks = normalizeSubtasks(item.subtasks);
          const subHtml = subtasks.length
            ? `<ul class="subtasks-list">${subtasks.map((s) => `<li>${escHtml(s.title)}</li>`).join("")}</ul>`
            : "";
          return `
          <div class="enrich-result-card" data-enrich-result="${index}">
            <label class="checkbox-row">
              <input type="checkbox" data-enrich-apply-index="${index}" checked />
              <strong>${escHtml(item.title || item.refId)}</strong>
              <span class="paste-hint"> (${escHtml(item.kind)})</span>
            </label>
            ${item.description ? `<p class="item-desc">${escHtml(item.description)}</p>` : ""}
            ${item.verify ? `<p class="paste-hint"><strong>Vérifier :</strong> ${escHtml(item.verify)}</p>` : ""}
            ${item.setup ? `<p class="paste-hint"><strong>Mettre en place :</strong> ${escHtml(item.setup)}</p>` : ""}
            ${subHtml}
          </div>`;
        })
        .join("")
    : '<p class="paste-hint">Aucun enrichissement proposé.</p>';

  const newEl = document.getElementById("enrichResultNewTasks");
  if (!newTasks.length) {
    newEl.innerHTML = '<p class="paste-hint">Aucune nouvelle tâche suggérée.</p>';
  } else {
    newEl.innerHTML = newTasks
      .map((item, index) => {
        const tag = importTagForStatus(item.status);
        const duplicate = item.status?.includes("duplicate");
        const checked = !duplicate ? "checked" : "";
        const phaseId = item.phaseId || "project-mgmt";
        const matchInfo = item.matchTitle
          ? `<span class="import-tag ${tag.className}">${escHtml(tag.text)} : ${escHtml(item.matchTitle)}</span>`
          : `<span class="import-tag ${tag.className}">${escHtml(tag.text)}</span>`;
        return `
        <div class="import-action-row${duplicate ? " is-duplicate" : ""}" data-new-task-row="${index}">
          <input type="checkbox" data-new-task-index="${index}" ${checked} aria-label="Importer cette tâche" />
          <div class="import-action-body import-action-editable">
            <label class="import-field-label">Titre</label>
            <input type="text" class="import-title-input" data-new-task-index="${index}" value="${escAttr(item.text)}" maxlength="200" />
            <label class="import-field-label">Phase</label>
            <select class="import-phase-select" data-new-task-index="${index}">${phaseOptionsHtml(phaseId)}</select>
            <label class="import-field-label">Description</label>
            <textarea class="import-desc-input" data-new-task-index="${index}" rows="2">${escHtml(item.description || "")}</textarea>
            <label class="import-field-label">Comment vérifier</label>
            <textarea class="import-verify-input" data-new-task-index="${index}" rows="2">${escHtml(item.verify || "")}</textarea>
            <label class="import-field-label">Comment mettre en place</label>
            <textarea class="import-setup-input" data-new-task-index="${index}" rows="2">${escHtml(item.setup || "")}</textarea>
            <div class="import-action-tags">${matchInfo}</div>
          </div>
        </div>`;
      })
      .join("");
  }

  hideEnrichModal();
  document.getElementById("enrichResultModal").classList.remove("hidden");
}

async function runEnrichment() {
  const tasks = getSelectedEnrichTasks();
  if (!tasks.length) {
    alert("Sélectionnez au moins une tâche à enrichir.");
    return;
  }

  const btn = document.getElementById("enrichRunBtn");
  btn.disabled = true;
  btn.textContent = "Analyse en cours…";

  try {
    const fileInput = document.getElementById("enrichFileInput");
    const uploaded = enrichPendingFiles.length
      ? enrichPendingFiles
      : await readEnrichFiles(fileInput.files);

    const result = await NotebookLMClient.enrichTasks({
      sources: uploaded,
      tasks,
      catalogs: getCatalogs(),
      projectName: store.state.projectName || "",
    });

    const enrichments = (result.enrichments || []).map((item) => {
      const source = tasks.find((t) => t.refId === item.refId) || {};
      return {
        ...item,
        title: source.title || item.refId,
        subtasks: normalizeSubtasks(item.subtasks),
      };
    });

    let newTasks = (result.newTasks || []).map((item) => ({
      text: String(item.text || "").trim(),
      status: item.status || "new",
      matchTitle: item.matchTitle,
      matchId: item.matchId,
      score: item.score,
      phaseId: item.phaseId || "project-mgmt",
      priority: item.priority || "medium",
      description: item.description || "",
      verify: item.verify || "",
      setup: item.setup || "",
      subtasks: normalizeSubtasks(item.subtasks),
    }));

    if (newTasks.length && window.GeminiClient?.analyzeActions) {
      const actionsText = newTasks.map((t) => `- ${t.text}`).join("\n");
      const analyzed = await GeminiClient.analyzeActions(actionsText, getCatalogs());
      if (analyzed.length) {
        newTasks = analyzed.map((item, i) => ({
          ...newTasks[i],
          ...item,
          subtasks: newTasks[i]?.subtasks || normalizeSubtasks(item.subtasks),
        }));
      }
    }

    showEnrichResults({ enrichments, newTasks });
  } catch (err) {
    const msg =
      err.message === "notebooklm_not_configured"
        ? "NotebookLM n'est pas configuré sur le proxy."
        : `Erreur NotebookLM : ${err.message || "analyse impossible"}`;
    alert(msg);
  } finally {
    btn.disabled = false;
    btn.textContent = "Lancer l'analyse";
  }
}

function applyEnrichmentResults() {
  const enrichments = enrichResultData.enrichments || [];
  const newTasks = enrichResultData.newTasks || [];
  const selectedEnrichIndexes = [
    ...document.querySelectorAll("[data-enrich-apply-index]:checked"),
  ].map((el) => Number(el.dataset.enrichApplyIndex));
  const selectedNewIndexes = [
    ...document.querySelectorAll("[data-new-task-index]:checked"),
  ].map((el) => Number(el.dataset.newTaskIndex));

  store.patch((state) => {
    state.itemEnrichments = state.itemEnrichments || {};
    selectedEnrichIndexes.forEach((index) => {
      const item = enrichments[index];
      if (!item?.refId) return;
      if (item.kind === "checklist") {
        state.itemEnrichments[item.refId] = {
          description: item.description || "",
          verify: item.verify || "",
          setup: item.setup || "",
          subtasks: normalizeSubtasks(item.subtasks),
          enrichedAt: Date.now(),
          source: "notebooklm",
        };
      } else if (item.kind === "todo") {
        const todo = (state.todos || []).find((t) => t.id === item.refId);
        if (!todo) return;
        if (item.description) todo.description = item.description;
        if (item.verify) todo.verify = item.verify;
        if (item.setup) todo.setup = item.setup;
        if (item.subtasks?.length) todo.subtasks = normalizeSubtasks(item.subtasks);
        todo.enrichmentSource = "notebooklm";
        todo.updatedAt = Date.now();
      }
    });

    selectedNewIndexes.forEach((index) => {
      const row = document.querySelector(`[data-new-task-row="${index}"]`);
      const item = newTasks[index];
      if (!item || !row) return;
      const title = row.querySelector(".import-title-input")?.value.trim() || item.text;
      if (!title || title.length < 3) return;
      const todos = [...(state.todos || [])];
      todos.unshift({
        id: PageUtils.newTodoId(),
        title,
        description: row.querySelector(".import-desc-input")?.value.trim() || item.description || "",
        verify: row.querySelector(".import-verify-input")?.value.trim() || item.verify || "",
        setup: row.querySelector(".import-setup-input")?.value.trim() || item.setup || "",
        subtasks: item.subtasks || [],
        phaseId: row.querySelector(".import-phase-select")?.value || item.phaseId || "project-mgmt",
        priority: item.priority || "medium",
        done: false,
        enrichmentSource: "notebooklm",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      state.todos = todos;
    });
  });

  hideEnrichResultModal();
  flashStatus("Enrichissements appliqués");
  render();
}


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
  const enrichment = getItemEnrichment(item.id);
  const description = enrichment?.description || item.description;
  const verify = enrichment?.verify || item.verify;
  const setup = enrichment?.setup || item.setup;
  const subtasks = enrichment?.subtasks || [];
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
        ${enrichment ? '<span class="pill">NotebookLM</span>' : ""}
        <button type="button" class="item-delete-btn" data-item-delete="${escHtml(item.id)}" title="Masquer ce point" aria-label="Masquer ce point">×</button>
      </div>
      <p class="item-desc">${escHtml(description)}</p>
      ${attributionHtml(check)}
      <button type="button" class="guide-toggle" aria-expanded="false">
        <span class="chevron">▶</span> Vérification et mise en place
      </button>
      <div class="guide-body">
        <div class="guide-section">
          <h3>Comment vérifier</h3>
          <p class="guide-text">${escHtml(verify)}</p>
        </div>
        <div class="guide-section">
          <h3>Comment mettre en place</h3>
          <p class="guide-text">${escHtml(setup)}</p>
        </div>
        ${renderSubtasksHtml(subtasks, item.id)}
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
  bindSubtaskToggles(itemEl, "checklist");
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
  const pillLabel = todo.weeklyId ? "Action CR" : todo.enrichmentSource === "notebooklm" ? "NotebookLM" : "Tâche libre";
  const subtasks = todo.subtasks || [];

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
        ${renderSubtasksHtml(subtasks, todo.id)}
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
  bindSubtaskToggles(itemEl, "todo");
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

  document.getElementById("openEnrichBtn")?.addEventListener("click", openEnrichModal);
  document.getElementById("enrichCancelBtn")?.addEventListener("click", hideEnrichModal);
  document.getElementById("enrichRunBtn")?.addEventListener("click", runEnrichment);
  document.getElementById("enrichResultSkipBtn")?.addEventListener("click", hideEnrichResultModal);
  document.getElementById("enrichResultApplyBtn")?.addEventListener("click", applyEnrichmentResults);
  document.getElementById("enrichSelectCritical")?.addEventListener("click", () => {
    document.querySelectorAll("#enrichTaskList [data-enrich-ref]").forEach((el) => {
      const p = el.dataset.enrichPriority;
      el.checked = p === "critical" || p === "high";
    });
  });
  document.getElementById("enrichSelectAll")?.addEventListener("click", () => {
    document.querySelectorAll("#enrichTaskList [data-enrich-ref]").forEach((el) => {
      el.checked = true;
    });
  });
  document.getElementById("enrichSelectNone")?.addEventListener("click", () => {
    document.querySelectorAll("#enrichTaskList [data-enrich-ref]").forEach((el) => {
      el.checked = false;
    });
  });
  document.getElementById("enrichFileInput")?.addEventListener("change", async (e) => {
    enrichPendingFiles = await readEnrichFiles(e.target.files);
    const list = document.getElementById("enrichFileList");
    if (list) {
      list.innerHTML = enrichPendingFiles.map((f) => `<li>${escHtml(f.title)}</li>`).join("");
    }
  });
}

async function initApp() {
  store.subscribe(onStoreChange);
  const status = await store.init();
  updateNotebookLMUI();

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
