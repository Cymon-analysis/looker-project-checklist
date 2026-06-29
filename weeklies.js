const SYNC = window.SYNC_CONFIG || { enabled: false };
const POLL_MS = 3000;
const { ITEMS } = window.CHECKLIST_DATA || { ITEMS: [] };

const roomId = PageUtils.getRoomIdFromUrl();
const store = RoomStore.create(roomId, SYNC);
const syncEnabled = store.syncEnabled;

let editingId = null;
let pendingImportWeekly = null;
let importAnalysis = [];
let importUsedGemini = false;
let pasteAnalyzeTimer = null;
let isAnalyzingPaste = false;

function setGeminiStatus(kind, message) {
  const el = document.getElementById("geminiStatus");
  if (!el) return;
  el.classList.remove("hidden", "loading", "error", "ok");
  if (kind) el.classList.add(kind);
  el.textContent = message || "";
  if (!message) el.classList.add("hidden");
}

async function analyzeActionsForImport(actionsText) {
  return GeminiClient.analyzeActions(actionsText, getCatalogs());
}

async function analyzeWeeklyPaste({ silent = false } = {}) {
  const raw = document.getElementById("weeklyRawPaste").value.trim();
  if (!raw) {
    if (!silent) setGeminiStatus("error", "Collez d'abord le texte du CR.");
    return false;
  }

  if (isAnalyzingPaste) return false;
  isAnalyzingPaste = true;
  document.getElementById("analyzePasteBtn").disabled = true;
  setGeminiStatus(
    "loading",
    GeminiClient.isEnabled() ? "Analyse Gemini en cours…" : "Analyse locale en cours…"
  );

  try {
    const split = await GeminiClient.splitWeeklyText(raw);
    document.getElementById("weeklyNotes").value = split.notes || "";
    document.getElementById("weeklyActions").value = split.actions || "";
    document.getElementById("splitPreview").classList.remove("hidden");
    setGeminiStatus(
      "ok",
      GeminiClient.isEnabled()
        ? "Séparation effectuée par Gemini — vérifiez avant enregistrement."
        : "Séparation locale — activez Gemini pour une analyse plus précise."
    );
    return true;
  } catch {
    setGeminiStatus("error", "Échec de l'analyse. Réessayez ou saisissez manuellement.");
    return false;
  } finally {
    isAnalyzingPaste = false;
    document.getElementById("analyzePasteBtn").disabled = false;
  }
}

function schedulePasteAnalyze() {
  clearTimeout(pasteAnalyzeTimer);
  const raw = document.getElementById("weeklyRawPaste").value.trim();
  if (raw.length < 80) return;
  pasteAnalyzeTimer = setTimeout(() => analyzeWeeklyPaste({ silent: true }), 1200);
}

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

function formatDisplayDate(iso) {
  if (!iso) return "";
  return new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function newWeeklyId() {
  return `w-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function newTodoId() {
  return `todo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function setSyncStatus(kind, label) {
  const el = document.getElementById("syncStatus");
  el.className = `sync-badge sync-${kind}`;
  el.textContent = label;
}

function getWeeklies() {
  return store.state.weeklies || [];
}

function getCatalogs() {
  return {
    todos: store.state.todos || [],
    checklistItems: ITEMS,
  };
}

function statusLabel(status) {
  switch (status) {
    case "duplicate-todo":
      return { text: "Déjà dans la todo", className: "tag-duplicate" };
    case "duplicate-checklist":
      return { text: "Déjà dans la checklist", className: "tag-duplicate" };
    case "similar-todo":
      return { text: "Similaire (todo)", className: "tag-similar" };
    case "similar-checklist":
      return { text: "Similaire (checklist)", className: "tag-checklist" };
    default:
      return { text: "Nouvelle action", className: "tag-new" };
  }
}

function isDuplicateStatus(status) {
  return status === "duplicate-todo" || status === "duplicate-checklist";
}

function shouldPromptImport(weekly) {
  if (!weekly?.actions?.trim()) return false;
  const hash = ActionMatcher.hashActions(weekly.actions);
  return weekly.actionsImportedHash !== hash;
}

function markWeeklyActionsHandled(weeklyId, actionsText) {
  const hash = ActionMatcher.hashActions(actionsText);
  store.patch((state) => {
    const weekly = (state.weeklies || []).find((w) => w.id === weeklyId);
    if (weekly) weekly.actionsImportedHash = hash;
  });
}

async function showImportModal(weekly) {
  document.getElementById("importModal").classList.remove("hidden");
  document.getElementById("importModalSubtitle").textContent = "Analyse des actions en cours…";
  document.getElementById("importActionsList").innerHTML =
    '<p class="paste-hint">Gemini compare les actions avec la todo et la checklist…</p>';

  let parsed = [];
  try {
    parsed = await analyzeActionsForImport(weekly.actions);
    importUsedGemini = GeminiClient.isEnabled();
  } catch {
    parsed = ActionMatcher.analyzeActions(weekly.actions, getCatalogs());
    importUsedGemini = false;
  }

  if (!parsed.length) {
    hideImportModal();
    return false;
  }

  pendingImportWeekly = weekly;
  importAnalysis = parsed;

  const aiBadge = importUsedGemini
    ? '<span class="import-ai-badge">Analyse Gemini</span>'
    : '<span class="import-ai-badge">Analyse locale</span>';

  document.getElementById("importModalTitle").innerHTML = `Ajouter les actions à la todo ?${aiBadge}`;
  document.getElementById("importModalSubtitle").textContent =
    `${parsed.length} action${parsed.length > 1 ? "s" : ""} détectée${parsed.length > 1 ? "s" : ""} dans « ${weekly.title} ». Sélectionnez celles à ajouter à la todo.`;

  const list = document.getElementById("importActionsList");
  list.innerHTML = parsed
    .map((item, index) => {
      const tag = statusLabel(item.status);
      const duplicate = isDuplicateStatus(item.status);
      const matchInfo = item.matchTitle
        ? `<span class="import-tag ${tag.className}">${escHtml(tag.text)} : ${escHtml(item.matchTitle)}</span>`
        : `<span class="import-tag ${tag.className}">${escHtml(tag.text)}</span>`;
      const checked = duplicate ? "" : "checked";
      const disabled = duplicate ? "disabled" : "";
      return `
        <label class="import-action-row${duplicate ? " is-duplicate" : ""}">
          <input type="checkbox" data-import-index="${index}" ${checked} ${disabled} />
          <div class="import-action-body">
            <div class="import-action-text">${escHtml(item.text)}</div>
            <div class="import-action-tags">${matchInfo}</div>
          </div>
        </label>
      `;
    })
    .join("");

  return true;
}

function hideImportModal() {
  document.getElementById("importModal").classList.add("hidden");
  document.getElementById("importModalTitle").textContent = "Ajouter les actions à la todo ?";
  pendingImportWeekly = null;
  importAnalysis = [];
  importUsedGemini = false;
}

function setAllImportChecks(checked) {
  document.querySelectorAll("#importActionsList input[type=checkbox]:not(:disabled)").forEach((el) => {
    el.checked = checked;
  });
}

function confirmImport() {
  if (!pendingImportWeekly) return hideImportModal();

  const selected = [];
  document.querySelectorAll("#importActionsList input[type=checkbox]").forEach((el) => {
    if (!el.checked || el.disabled) return;
    const item = importAnalysis[Number(el.dataset.importIndex)];
    if (item && !isDuplicateStatus(item.status)) selected.push(item);
  });

  if (selected.length) {
    if (syncEnabled) setSyncStatus("connecting", "Enregistrement…");
    store.patch((state) => {
      const todos = [...(state.todos || [])];
      selected.forEach((item) => {
        todos.unshift({
          id: newTodoId(),
          title: item.text,
          weeklyId: pendingImportWeekly.id,
          weeklyTitle: pendingImportWeekly.title,
          weeklyDate: pendingImportWeekly.date,
          done: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });
      state.todos = todos;
      const weekly = (state.weeklies || []).find((w) => w.id === pendingImportWeekly.id);
      if (weekly) weekly.actionsImportedHash = ActionMatcher.hashActions(weekly.actions);
    });
    if (syncEnabled) {
      store.queueSave()
        .then(() => setSyncStatus("synced", "Synchronisé"))
        .catch(() => setSyncStatus("error", "Erreur enregistrement"));
    }
  } else {
    markWeeklyActionsHandled(pendingImportWeekly.id, pendingImportWeekly.actions);
  }

  hideImportModal();
}

function skipImport() {
  if (pendingImportWeekly) {
    markWeeklyActionsHandled(pendingImportWeekly.id, pendingImportWeekly.actions);
  }
  hideImportModal();
}

async function promptImportForWeekly(weeklyId) {
  const weekly = getWeeklies().find((w) => w.id === weeklyId);
  if (!weekly?.actions?.trim()) return;
  await showImportModal(weekly);
}

function showForm(weekly) {
  document.getElementById("weeklyFormCard").classList.remove("hidden");
  document.getElementById("formTitle").textContent = weekly ? "Modifier le compte-rendu" : "Nouveau compte-rendu";
  editingId = weekly?.id || null;
  document.getElementById("weeklyId").value = weekly?.id || "";
  document.getElementById("weeklyDate").value = weekly?.date || new Date().toISOString().slice(0, 10);
  document.getElementById("weeklyTitle").value = weekly?.title || "";
  document.getElementById("weeklyParticipants").value = weekly?.participants || "";
  document.getElementById("weeklyRawPaste").value = "";
  document.getElementById("weeklyNotes").value = weekly?.notes || "";
  document.getElementById("weeklyActions").value = weekly?.actions || "";
  document.getElementById("splitPreview").classList.toggle("hidden", !weekly?.notes);
  setGeminiStatus(null, "");
  if (weekly) document.getElementById("weeklyTitle").focus();
  else document.getElementById("weeklyRawPaste").focus();
}

function hideForm() {
  editingId = null;
  clearTimeout(pasteAnalyzeTimer);
  setGeminiStatus(null, "");
  document.getElementById("weeklyFormCard").classList.add("hidden");
  document.getElementById("weeklyForm").reset();
  document.getElementById("splitPreview").classList.add("hidden");
}

async function saveWeeklyFromForm(e) {
  e.preventDefault();

  const rawPaste = document.getElementById("weeklyRawPaste").value.trim();
  let notes = document.getElementById("weeklyNotes").value.trim();
  let actions = document.getElementById("weeklyActions").value.trim();

  if (rawPaste && (!notes || !actions)) {
    const split = await GeminiClient.splitWeeklyText(rawPaste);
    if (!notes) notes = split.notes || "";
    if (!actions) actions = split.actions || "";
    document.getElementById("weeklyNotes").value = notes;
    document.getElementById("weeklyActions").value = actions;
  }

  const payload = {
    id: editingId || newWeeklyId(),
    date: document.getElementById("weeklyDate").value,
    title: document.getElementById("weeklyTitle").value.trim(),
    participants: document.getElementById("weeklyParticipants").value.trim(),
    notes,
    actions,
    updatedAt: Date.now(),
  };

  if (!payload.title || !payload.notes) return;

  const existing = getWeeklies().find((w) => w.id === payload.id);
  const actionsChanged =
    ActionMatcher.hashActions(existing?.actions || "") !== ActionMatcher.hashActions(payload.actions);

  if (syncEnabled) setSyncStatus("connecting", "Enregistrement…");
  store.patch((state) => {
    const list = [...(state.weeklies || [])];
    const index = list.findIndex((w) => w.id === payload.id);
    const prev = index >= 0 ? list[index] : {};
    const entry = {
      ...prev,
      ...payload,
      createdAt: prev.createdAt || Date.now(),
    };
    if (actionsChanged) delete entry.actionsImportedHash;
    if (index >= 0) list[index] = entry;
    else list.push(entry);
    state.weeklies = list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  });

  hideForm();

  const savePromise = syncEnabled
    ? store.queueSave()
        .then(() => setSyncStatus("synced", "Synchronisé"))
        .catch(() => setSyncStatus("error", "Erreur enregistrement"))
    : Promise.resolve();

  savePromise.then(async () => {
    const weekly = getWeeklies().find((w) => w.id === payload.id);
    if (weekly && shouldPromptImport(weekly)) {
      await showImportModal(weekly);
    }
  });
}

function deleteWeekly(id) {
  if (!confirm("Supprimer ce compte-rendu ?")) return;
  if (syncEnabled) setSyncStatus("connecting", "Enregistrement…");
  store.patch((state) => {
    state.weeklies = (state.weeklies || []).filter((w) => w.id !== id);
  });
  if (editingId === id) hideForm();
  if (syncEnabled) store.queueSave().then(() => setSyncStatus("synced", "Synchronisé"));
}

function renderWeeklies() {
  const list = getWeeklies();
  const container = document.getElementById("weeklyList");
  const empty = document.getElementById("weeklyEmpty");

  document.getElementById("weeklyCount").textContent =
    list.length ? `${list.length} compte-rendu${list.length > 1 ? "s" : ""}` : "";

  if (!list.length) {
    container.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");
  container.innerHTML = list
    .map((w) => {
      const actionCount = ActionMatcher.parseActionsText(w.actions).length;
      const importBtn =
        w.actions && actionCount
          ? `<button type="button" class="btn-secondary weekly-import-btn" data-import="${escHtml(w.id)}">Importer les actions (${actionCount})</button>`
          : "";
      return `
      <article class="weekly-card" data-id="${escHtml(w.id)}">
        <div class="weekly-card-header">
          <div>
            <div class="weekly-card-title">${escHtml(w.title)}</div>
            <div class="weekly-card-date">${escHtml(formatDisplayDate(w.date))}</div>
          </div>
          <div class="weekly-card-actions">
            <button type="button" class="btn-secondary" data-edit="${escHtml(w.id)}">Modifier</button>
            <button type="button" class="btn-secondary" data-delete="${escHtml(w.id)}">Supprimer</button>
          </div>
        </div>
        ${
          w.participants
            ? `<div class="weekly-section"><h3>Participants</h3><p>${escHtml(w.participants)}</p></div>`
            : ""
        }
        <div class="weekly-section">
          <h3>Ce qu'il s'est dit</h3>
          <p>${escHtml(w.notes)}</p>
        </div>
        ${
          w.actions
            ? `<div class="weekly-section"><h3>Actions / prochaines étapes</h3><p>${escHtml(w.actions)}</p>${importBtn}</div>`
            : ""
        }
      </article>
    `;
    })
    .join("");

  container.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const weekly = list.find((w) => w.id === btn.dataset.edit);
      if (weekly) showForm(weekly);
    });
  });

  container.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => deleteWeekly(btn.dataset.delete));
  });

  container.querySelectorAll("[data-import]").forEach((btn) => {
    btn.addEventListener("click", () => promptImportForWeekly(btn.dataset.import));
  });
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
PageUtils.setupPageNav(roomId, "weeklies.html");
document.getElementById("footer").textContent = `CR Weekly — salle « ${roomId} »`;

document.getElementById("addWeeklyBtn").addEventListener("click", () => showForm(null));
document.getElementById("cancelWeeklyBtn").addEventListener("click", hideForm);
document.getElementById("weeklyForm").addEventListener("submit", (e) => {
  saveWeeklyFromForm(e);
});
document.getElementById("analyzePasteBtn").addEventListener("click", () => analyzeWeeklyPaste());
document.getElementById("weeklyRawPaste").addEventListener("input", schedulePasteAnalyze);
document.getElementById("weeklyRawPaste").addEventListener("paste", () => {
  setTimeout(schedulePasteAnalyze, 50);
});
document.getElementById("shareBtn").addEventListener("click", copyShareLink);
document.getElementById("importSelectAll").addEventListener("click", () => setAllImportChecks(true));
document.getElementById("importSelectNone").addEventListener("click", () => setAllImportChecks(false));
document.getElementById("importConfirmBtn").addEventListener("click", confirmImport);
document.getElementById("importSkipBtn").addEventListener("click", skipImport);

store.subscribe(() => renderWeeklies());

(async function init() {
  const status = await store.init();
  if (!syncEnabled) setSyncStatus("offline", "Sauvegardé localement");
  else if (status === "synced") {
    setSyncStatus("synced", "Synchronisé");
    store.startPolling(POLL_MS);
  } else setSyncStatus("error", "Erreur sync");

  if (!GeminiClient.isEnabled()) {
    document.getElementById("geminiCallout")?.classList.remove("hidden");
  }

  renderWeeklies();
})();
