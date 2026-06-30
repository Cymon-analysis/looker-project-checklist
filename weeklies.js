const SYNC = window.SYNC_CONFIG || { enabled: false };
const POLL_MS = 3000;
const { ITEMS, PHASES } = window.CHECKLIST_DATA || { ITEMS: [], PHASES: [] };

const roomId = PageUtils.getRoomIdFromUrl();
const store = RoomStore.create(roomId, SYNC);
const syncEnabled = store.syncEnabled;

let editingId = null;
let pendingImportWeekly = null;
let importAnalysis = [];
let importUsedGemini = false;
let pasteAnalyzeTimer = null;
let isAnalyzingPaste = false;

const APP_BUILD = "20250629-12";
let notesPreviewTimer = null;

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
    updateFormPreviews();
    setGeminiStatus(split.error && !split.usedGemini ? "error" : "ok", formatSplitStatus(split));
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

function formatMeetingDate(iso) {
  if (!iso) return "";
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  return d.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(iso.includes("T") ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function calendarErrorMessage(err) {
  const code = err?.message || "";
  const details = err?.details || {};
  if (code === "domain_not_allowed") return "Seuls les comptes @converteo.com sont autorisés.";
  if (code === "calendar_not_configured") return "Configuration incomplète (proxy ou Client OAuth).";
  if (code === "google_identity_not_loaded") {
    return "Script Google bloqué. Désactivez le bloqueur de pub / autorisez accounts.google.com.";
  }
  if (code === "access_denied") {
    return "Accès refusé. Réessayez et acceptez toutes les permissions (agenda, Drive, email).";
  }
  if (code === "invalid_token" || code === "google_api_401") {
    return "Token Google refusé. Déconnectez-vous, reconnectez et acceptez les nouvelles permissions demandées.";
  }
  if (code === "missing_token") {
    return "Erreur technique : le token n'a pas été transmis au proxy. Réessayez.";
  }
  if (code === "token_expired") {
    return "Session expirée. Cliquez à nouveau sur « Connecter mon agenda ».";
  }
  if (code === "proxy_calendar_missing") {
    return "Le proxy Cloud Run doit être redéployé (routes Calendar absentes).";
  }
  if (details.error === "domain_not_allowed") {
    return `Compte non autorisé : ${details.email || "hors @converteo.com"}.`;
  }
  return `Connexion impossible : ${code || "erreur inconnue"}`;
}

async function updateCalendarUI() {
  const card = document.getElementById("calendarCard");
  const statusEl = document.getElementById("calendarStatus");
  const hintEl = document.getElementById("calendarHint");
  const connectBtn = document.getElementById("connectCalendarBtn");
  const importBtn = document.getElementById("importCalendarBtn");
  const disconnectBtn = document.getElementById("disconnectCalendarBtn");

  if (!card || !window.CalendarClient) return;

  const setup = CalendarClient.getSetupStatus();

  if (!CalendarClient.isConfigured()) {
    card.classList.add("disabled");
    statusEl.textContent = "Non configuré";
    connectBtn.disabled = true;
    importBtn.disabled = true;
    disconnectBtn.classList.add("hidden");
    hintEl.classList.remove("hidden");
    if (!setup.hasProxyUrl) {
      hintEl.textContent =
        "Secret GEMINI_PROXY_URL manquant dans GitHub. L'URL du proxy Cloud Run doit être dans GEMINI_PROXY_URL (pas dans GEMINI_API_KEY).";
    } else if (!setup.hasClientId) {
      hintEl.textContent = "Secret GOOGLE_OAUTH_CLIENT_ID manquant dans GitHub. Relancez le déploiement Pages.";
    } else {
      hintEl.textContent = "Configuration agenda incomplète.";
    }
    return;
  }

  const health = await CalendarClient.checkProxyHealth();
  if (!health.ok || !health.calendar) {
    card.classList.add("disabled");
    statusEl.textContent = "Proxy à mettre à jour";
    connectBtn.disabled = true;
    importBtn.disabled = true;
    disconnectBtn.classList.add("hidden");
    hintEl.classList.remove("hidden");
    hintEl.textContent =
      "Le proxy Cloud Run n'inclut pas encore les routes Calendar. Redéployez looker-gemini-proxy (voir docs/GOOGLE-CALENDAR-OAUTH.md, étape 5).";
    return;
  }

  card.classList.remove("disabled");
  connectBtn.disabled = false;
  hintEl.classList.add("hidden");

  if (CalendarClient.isConnected()) {
    const email = CalendarClient.getConnectedEmail();
    statusEl.textContent = email ? `Connecté — ${email}` : "Connecté";
    statusEl.classList.add("connected");
    importBtn.disabled = false;
    connectBtn.classList.add("hidden");
    disconnectBtn.classList.remove("hidden");
  } else {
    statusEl.textContent = "Non connecté";
    statusEl.classList.remove("connected");
    importBtn.disabled = true;
    connectBtn.classList.remove("hidden");
    disconnectBtn.classList.add("hidden");
  }
}

async function connectCalendar() {
  const connectBtn = document.getElementById("connectCalendarBtn");
  connectBtn.disabled = true;
  try {
    const health = await CalendarClient.checkProxyHealth();
    if (!health.calendar) throw new Error("proxy_calendar_missing");
    await CalendarClient.connect();
    await updateCalendarUI();
  } catch (err) {
    alert(calendarErrorMessage(err));
    await updateCalendarUI();
  } finally {
    connectBtn.disabled = false;
  }
}

function disconnectCalendar() {
  CalendarClient.disconnect();
  updateCalendarUI();
}

function hideCalendarModal() {
  document.getElementById("calendarModal")?.classList.add("hidden");
}

async function openCalendarModal() {
  const modal = document.getElementById("calendarModal");
  const list = document.getElementById("calendarMeetingsList");
  const subtitle = document.getElementById("calendarModalSubtitle");

  modal.classList.remove("hidden");
  list.innerHTML = '<p class="calendar-empty">Chargement des réunions Weavenn…</p>';
  subtitle.textContent = "Recherche dans votre agenda…";

  try {
    await CalendarClient.ensureConnected();
    updateCalendarUI();
    const { meetings } = await CalendarClient.listMeetings(90);

    if (!meetings?.length) {
      list.innerHTML =
        '<p class="calendar-empty">Aucune réunion avec « Weavenn » dans le titre sur les 90 derniers jours.</p>';
      subtitle.textContent = "0 réunion trouvée";
      return;
    }

    subtitle.textContent = `${meetings.length} réunion${meetings.length > 1 ? "s" : ""} Weavenn`;
    list.innerHTML = meetings
      .map(
        (m) => `
        <div class="calendar-meeting-row">
          <div class="calendar-meeting-info">
            <div class="calendar-meeting-title">${escHtml(m.title)}</div>
            <div class="calendar-meeting-meta">${escHtml(formatMeetingDate(m.start))}</div>
          </div>
          <span class="calendar-meeting-badge${m.hasGeminiNotes ? "" : " missing"}">${
            m.hasGeminiNotes ? "Notes Gemini" : "Sans notes Gemini"
          }</span>
          <button type="button" class="btn-primary" data-calendar-import="${escHtml(m.id)}">Importer</button>
        </div>
      `
      )
      .join("");

    list.querySelectorAll("[data-calendar-import]").forEach((btn) => {
      btn.addEventListener("click", () => importCalendarMeeting(btn.dataset.calendarImport));
    });
  } catch (err) {
    list.innerHTML = `<p class="calendar-empty">Erreur : ${escHtml(err.message || "chargement impossible")}</p>`;
    if (err.message === "token_expired") updateCalendarUI();
  }
}

async function importCalendarMeeting(eventId) {
  hideCalendarModal();
  showForm(null);
  setGeminiStatus("loading", "Récupération des notes de réunion…");

  try {
    const meeting = await CalendarClient.fetchMeeting(eventId);
    const geminiNotes = String(meeting.geminiNotes || meeting.rawText || "").trim();

    document.getElementById("weeklyDate").value = meeting.date || new Date().toISOString().slice(0, 10);
    document.getElementById("weeklyTitle").value = meeting.title || "";
    document.getElementById("weeklyParticipants").value = (meeting.participants || []).join(", ");
    document.getElementById("weeklyRawPaste").value = geminiNotes;

    document.getElementById("splitPreview").classList.remove("hidden");

    if (!geminiNotes) {
      document.getElementById("weeklyNotes").value = "";
      document.getElementById("weeklyActions").value = "";
      updateFormPreviews();
      setGeminiStatus(
        "error",
        meeting.hasGeminiNotes
          ? "Notes Gemini détectées mais illisibles (accès Drive). Ouvrez la réunion dans Google Calendar."
          : "Aucune note Gemini sur cette réunion. Activez « Prendre des notes » dans Google Meet, puis réessayez."
      );
      return;
    }

    setGeminiStatus(
      "loading",
      "Analyse Gemini : titre, participants, compte-rendu et actions…"
    );

    const analysis = await GeminiClient.analyzeMeetingImport({
      title: meeting.title,
      date: meeting.date,
      participants: meeting.participants,
      geminiNotes,
    });

    if (analysis.title) document.getElementById("weeklyTitle").value = analysis.title;
    if (analysis.participants) {
      document.getElementById("weeklyParticipants").value = analysis.participants;
    }
    document.getElementById("weeklyNotes").value = analysis.notes || "";
    document.getElementById("weeklyActions").value = analysis.actions || "";
    updateFormPreviews();

    const sourceLabel = `Import agenda — ${meeting.notesSource || "Notes Gemini"}`;
    if (analysis.error === "no_gemini_notes") {
      setGeminiStatus("error", "Notes Gemini introuvables pour cette réunion.");
      return;
    }
    setGeminiStatus(
      analysis.error && !analysis.usedGemini ? "error" : "ok",
      `${sourceLabel}. ${formatSplitStatus(analysis)}`
    );
  } catch (err) {
    setGeminiStatus("error", "Import agenda impossible. Vérifiez votre connexion Google.");
    if (err.message === "token_expired") updateCalendarUI();
  }
}

function escHtml(s) {
  return Markdown.escapeHtml(s);
}

function escAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function renderMd(text) {
  return Markdown.render(text);
}

function updateFormPreviews() {
  const notes = document.getElementById("weeklyNotes")?.value || "";
  const actions = document.getElementById("weeklyActions")?.value || "";
  const notesEl = document.getElementById("notesPreview");
  const actionsEl = document.getElementById("actionsPreview");
  if (notesEl) {
    notesEl.innerHTML = notes.trim()
      ? renderMd(notes)
      : '<p class="preview-empty">L\'aperçu apparaîtra après l\'analyse Gemini.</p>';
  }
  if (actionsEl) {
    const count = ActionMatcher.parseActionsText(actions).length;
    actionsEl.innerHTML = actions.trim()
      ? `${renderMd(actions)}<p class="preview-count">${count} action${count > 1 ? "s" : ""} détectée${count > 1 ? "s" : ""}</p>`
      : '<p class="preview-empty">Aucune action pour l\'instant.</p>';
  }
}

function scheduleNotesPreview() {
  clearTimeout(notesPreviewTimer);
  notesPreviewTimer = setTimeout(updateFormPreviews, 300);
}

async function ensureWeeklyActions(weekly) {
  if (weekly?.actions?.trim()) return weekly.actions;
  if (!GeminiClient.isEnabled()) return "";
  const source = [weekly?.notes, weekly?.rawPaste].filter(Boolean).join("\n\n");
  if (!source.trim()) return "";
  return GeminiClient.extractActionsFromText(source);
}
function formatSplitStatus(split) {
  const count = ActionMatcher.parseActionsText(split.actions).length;
  if (split.error && !split.usedGemini) {
    return `${split.error} — séparation locale utilisée.`;
  }
  const modelInfo = GeminiClient.getLastModelUsed()
    ? ` (${GeminiClient.getLastModelUsed()})`
    : "";
  if (count > 0) {
    return split.usedGemini
      ? `Gemini OK${modelInfo} — CR structuré, ${count} action${count > 1 ? "s" : ""} extraite${count > 1 ? "s" : ""}.`
      : `Séparation locale — ${count} action${count > 1 ? "s" : ""} détectée${count > 1 ? "s" : ""}.`;
  }
  return split.usedGemini
    ? `CR structuré${modelInfo} — aucune action trouvée. Complétez le champ actions ou recollez le CR.`
    : "Séparation locale — aucune action détectée.";
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

function phaseOptionsHtml(selectedId) {
  return PHASES.map(
    (p) =>
      `<option value="${escHtml(p.id)}"${p.id === selectedId ? " selected" : ""}>${escHtml(p.title)}</option>`
  ).join("");
}

function newWeeklyId() {
  return `w-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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

  let actionsText = weekly.actions || "";
  if (!actionsText.trim()) {
    actionsText = await ensureWeeklyActions(weekly);
    if (actionsText) weekly = { ...weekly, actions: actionsText };
  }

  let parsed = [];
  try {
    parsed = await analyzeActionsForImport(actionsText);
    importUsedGemini = GeminiClient.isEnabled();
  } catch {
    parsed = ActionMatcher.analyzeActions(actionsText, getCatalogs());
    importUsedGemini = false;
  }

  if (!parsed.length) {
    hideImportModal();
    alert(
      "Aucune action détectée dans ce CR.\n\nVérifiez le champ « Actions / prochaines étapes » ou relancez l'analyse après avoir collé le CR complet."
    );
    return false;
  }

  pendingImportWeekly = weekly;
  importAnalysis = parsed;

  const aiBadge = importUsedGemini
    ? '<span class="import-ai-badge">Analyse Gemini</span>'
    : '<span class="import-ai-badge">Analyse locale</span>';

  document.getElementById("importModalTitle").innerHTML = `Ajouter les actions à la todo ?${aiBadge}`;
  document.getElementById("importModalSubtitle").textContent =
    `${parsed.length} action${parsed.length > 1 ? "s" : ""} détectée${parsed.length > 1 ? "s" : ""} dans « ${weekly.title} ». Modifiez le titre, la phase et la description avant d'importer.`;

  const list = document.getElementById("importActionsList");
  list.innerHTML = parsed
    .map((item, index) => {
      const tag = statusLabel(item.status);
      const duplicate = isDuplicateStatus(item.status);
      const matchInfo = item.matchTitle
        ? `<span class="import-tag ${tag.className}">${escHtml(tag.text)} : ${escHtml(item.matchTitle)}</span>`
        : `<span class="import-tag ${tag.className}">${escHtml(tag.text)}</span>`;
      const checked = duplicate ? "" : "checked";

      const phaseId = item.phaseId || ActionMatcher.guessPhaseId(item.text, item.description);

      return `
        <div class="import-action-row${duplicate ? " is-duplicate" : ""}" data-import-row="${index}">
          <input type="checkbox" data-import-index="${index}" ${checked} aria-label="Importer cette action" />
          <div class="import-action-body import-action-editable">
            <label class="import-field-label" for="import-title-${index}">Titre de la tâche</label>
            <input type="text" id="import-title-${index}" class="import-title-input" data-import-index="${index}" value="${escAttr(item.text)}" maxlength="200" />
            <label class="import-field-label" for="import-phase-${index}">Phase du projet</label>
            <select id="import-phase-${index}" class="import-phase-select" data-import-index="${index}">${phaseOptionsHtml(phaseId)}</select>
            <label class="import-field-label" for="import-desc-${index}">Contexte / description</label>
            <textarea id="import-desc-${index}" class="import-desc-input" data-import-index="${index}" rows="2" placeholder="Précisez le pourquoi ou le périmètre de l'action…">${escHtml(item.description || "")}</textarea>
            <label class="import-field-label" for="import-verify-${index}">Comment vérifier</label>
            <textarea id="import-verify-${index}" class="import-verify-input" data-import-index="${index}" rows="3" placeholder="Critères concrets pour valider que l'action est faite…">${escHtml(item.verify || "")}</textarea>
            <label class="import-field-label" for="import-setup-${index}">Comment mettre en place</label>
            <textarea id="import-setup-${index}" class="import-setup-input" data-import-index="${index}" rows="3" placeholder="Étapes concrètes, responsables, outils…">${escHtml(item.setup || "")}</textarea>
            <div class="import-action-tags">${matchInfo}</div>
          </div>
        </div>
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
  document.querySelectorAll("#importActionsList input[type=checkbox]").forEach((el) => {
    el.checked = checked;
  });
}

function collectSelectedImports() {
  const selected = [];
  document.querySelectorAll("#importActionsList .import-action-row").forEach((row) => {
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (!checkbox?.checked) return;

    const index = Number(checkbox.dataset.importIndex);
    const item = importAnalysis[index];
    if (!item) return;

    const title = row.querySelector(".import-title-input")?.value.trim() || item.text;
    if (!title) return;

    selected.push({
      text: title,
      title,
      description: row.querySelector(".import-desc-input")?.value.trim() || "",
      verify: row.querySelector(".import-verify-input")?.value.trim() || "",
      setup: row.querySelector(".import-setup-input")?.value.trim() || "",
      phaseId: row.querySelector(".import-phase-select")?.value || item.phaseId || "project-mgmt",
      priority: item.priority || "medium",
    });
  });
  return selected;
}

function confirmImport() {
  if (!pendingImportWeekly) return hideImportModal();

  const selected = collectSelectedImports();

  if (selected.length) {
    if (syncEnabled) setSyncStatus("connecting", "Enregistrement…");
    store.patch((state) => {
      const todos = [...(state.todos || [])];
      const openedPhases = new Set(state.openPhases || []);
      selected.forEach((item) => {
        const phaseId = item.phaseId || "project-mgmt";
        openedPhases.add(phaseId);
        todos.unshift({
          id: PageUtils.newTodoId(),
          title: item.title || item.text,
          description: item.description || "",
          verify: item.verify || "",
          setup: item.setup || "",
          phaseId,
          priority: item.priority || "medium",
          weeklyId: pendingImportWeekly.id,
          weeklyTitle: pendingImportWeekly.title,
          weeklyDate: pendingImportWeekly.date,
          done: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });
      state.todos = todos;
      state.openPhases = [...openedPhases];
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
  if (!weekly) return;
  const actions = weekly.actions?.trim() || (await ensureWeeklyActions(weekly));
  if (!actions) {
    alert("Aucune action détectée dans ce CR. Modifiez-le et relancez l'analyse Gemini.");
    return;
  }
  await showImportModal({ ...weekly, actions });
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
  updateFormPreviews();
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

  if (!actions && notes && GeminiClient.isEnabled()) {
    actions = await GeminiClient.extractActionsFromText(`${notes}\n\n${rawPaste}`.trim());
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
  store.patch((state) => {
    state.deletedWeeklyIds = state.deletedWeeklyIds || {};
    state.deletedWeeklyIds[id] = Date.now();
    state.weeklies = (state.weeklies || []).filter((w) => w.id !== id);
  });
  if (editingId === id) hideForm();
  if (syncEnabled) setSyncStatus("synced", "CR supprimé");
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
          <div class="markdown-body">${renderMd(w.notes)}</div>
        </div>
        ${
          w.actions
            ? `<div class="weekly-section"><h3>Actions / prochaines étapes</h3><div class="markdown-body markdown-actions">${renderMd(w.actions)}</div>${importBtn}</div>`
            : ""
        }
      </article>
    `;
    })
    .join("");
}

function handleWeeklyListClick(e) {
  const editBtn = e.target.closest("[data-edit]");
  if (editBtn) {
    const weekly = getWeeklies().find((w) => w.id === editBtn.dataset.edit);
    if (weekly) showForm(weekly);
    return;
  }

  const deleteBtn = e.target.closest("[data-delete]");
  if (deleteBtn) {
    deleteWeekly(deleteBtn.dataset.delete);
    return;
  }

  const importBtn = e.target.closest("[data-import]");
  if (importBtn) {
    promptImportForWeekly(importBtn.dataset.import);
  }
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
document.getElementById("footer").textContent =
  `CR Weekly — salle « ${roomId} » — build ${APP_BUILD}`;

document.getElementById("weeklyList").addEventListener("click", handleWeeklyListClick);

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
document.getElementById("weeklyNotes").addEventListener("input", scheduleNotesPreview);
document.getElementById("weeklyActions").addEventListener("input", scheduleNotesPreview);
document.getElementById("shareBtn").addEventListener("click", copyShareLink);
document.getElementById("importSelectAll").addEventListener("click", () => setAllImportChecks(true));
document.getElementById("importSelectNone").addEventListener("click", () => setAllImportChecks(false));
document.getElementById("importConfirmBtn").addEventListener("click", confirmImport);
document.getElementById("importSkipBtn").addEventListener("click", skipImport);
document.getElementById("connectCalendarBtn")?.addEventListener("click", connectCalendar);
document.getElementById("disconnectCalendarBtn")?.addEventListener("click", disconnectCalendar);
document.getElementById("importCalendarBtn")?.addEventListener("click", openCalendarModal);
document.getElementById("calendarModalCloseBtn")?.addEventListener("click", hideCalendarModal);

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

  await updateCalendarUI();
  renderWeeklies();
})();
