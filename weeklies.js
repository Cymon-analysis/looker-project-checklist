const SYNC = window.SYNC_CONFIG || { enabled: false };
const POLL_MS = 3000;

const roomId = PageUtils.getRoomIdFromUrl();
const store = RoomStore.create(roomId, SYNC);
const syncEnabled = store.syncEnabled;

let editingId = null;
let saveTimer = null;

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

function setSyncStatus(kind, label) {
  const el = document.getElementById("syncStatus");
  el.className = `sync-badge sync-${kind}`;
  el.textContent = label;
}

function getWeeklies() {
  return store.state.weeklies || [];
}

function showForm(weekly) {
  document.getElementById("weeklyFormCard").classList.remove("hidden");
  document.getElementById("formTitle").textContent = weekly ? "Modifier le compte-rendu" : "Nouveau compte-rendu";
  editingId = weekly?.id || null;
  document.getElementById("weeklyId").value = weekly?.id || "";
  document.getElementById("weeklyDate").value = weekly?.date || new Date().toISOString().slice(0, 10);
  document.getElementById("weeklyTitle").value = weekly?.title || "";
  document.getElementById("weeklyParticipants").value = weekly?.participants || "";
  document.getElementById("weeklyNotes").value = weekly?.notes || "";
  document.getElementById("weeklyActions").value = weekly?.actions || "";
  document.getElementById("weeklyTitle").focus();
}

function hideForm() {
  editingId = null;
  document.getElementById("weeklyFormCard").classList.add("hidden");
  document.getElementById("weeklyForm").reset();
}

function saveWeeklyFromForm(e) {
  e.preventDefault();
  const payload = {
    id: editingId || newWeeklyId(),
    date: document.getElementById("weeklyDate").value,
    title: document.getElementById("weeklyTitle").value.trim(),
    participants: document.getElementById("weeklyParticipants").value.trim(),
    notes: document.getElementById("weeklyNotes").value.trim(),
    actions: document.getElementById("weeklyActions").value.trim(),
    updatedAt: Date.now(),
  };

  if (!payload.title || !payload.notes) return;

  if (syncEnabled) setSyncStatus("connecting", "Enregistrement…");
  store.patch((state) => {
    const list = [...(state.weeklies || [])];
    const index = list.findIndex((w) => w.id === payload.id);
    if (index >= 0) list[index] = { ...list[index], ...payload };
    else list.push({ ...payload, createdAt: Date.now() });
    state.weeklies = list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  });

  hideForm();
  if (syncEnabled) {
    store.queueSave()
      .then(() => setSyncStatus("synced", "Synchronisé"))
      .catch(() => setSyncStatus("error", "Erreur enregistrement"));
  }
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
    .map(
      (w) => `
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
            ? `<div class="weekly-section"><h3>Actions / prochaines étapes</h3><p>${escHtml(w.actions)}</p></div>`
            : ""
        }
      </article>
    `
    )
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
document.getElementById("weeklyForm").addEventListener("submit", saveWeeklyFromForm);
document.getElementById("shareBtn").addEventListener("click", copyShareLink);

store.subscribe(() => renderWeeklies());

(async function init() {
  const status = await store.init();
  if (!syncEnabled) setSyncStatus("offline", "Sauvegardé localement");
  else if (status === "synced") {
    setSyncStatus("synced", "Synchronisé");
    store.startPolling(POLL_MS);
  } else setSyncStatus("error", "Erreur sync");
  renderWeeklies();
})();
