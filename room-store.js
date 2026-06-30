(function () {
  const DEFAULT_ROADMAP_LAYOUT = {
    "project-mgmt": { startDay: 0, span: 2 },
    infra: { startDay: 1, span: 3 },
    governance: { startDay: 3, span: 3 },
    lookml: { startDay: 5, span: 5 },
    cicd: { startDay: 8, span: 3 },
    content: { startDay: 10, span: 2 },
    adoption: { startDay: 11, span: 2 },
    platform: { startDay: 11, span: 2 },
  };

  function defaultStartDate() {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? 1 : day === 6 ? 2 : day === 1 ? 0 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  function defaultState() {
    return {
      version: 1,
      projectName: "",
      reviewer: "",
      checks: {},
      roadmap: {
        layout: structuredClone(DEFAULT_ROADMAP_LAYOUT),
        startDate: defaultStartDate(),
        updatedAt: 0,
      },
      weeklies: [],
      todos: [],
      deletedWeeklyIds: {},
      deletedTodoIds: {},
      deletedItemIds: {},
      itemEnrichments: {},
      openPhases: ["infra", "lookml"],
      updatedAt: 0,
    };
  }

  function mergeChecks(a, b) {
    const merged = { ...(a || {}) };
    Object.entries(b || {}).forEach(([id, check]) => {
      const local = merged[id];
      if (!local || (check.at || 0) >= (local.at || 0)) merged[id] = check;
    });
    return merged;
  }

  function mergeDeletedMaps(a, b) {
    const merged = { ...(a || {}), ...(b || {}) };
    Object.keys(merged).forEach((id) => {
      merged[id] = Math.max(a?.[id] || 0, b?.[id] || 0);
    });
    return merged;
  }

  function applyDeletedFilter(items, deletedMap) {
    const deleted = deletedMap || {};
    return (items || []).filter((item) => {
      const deletedAt = deleted[item.id];
      if (!deletedAt) return true;
      return (item.updatedAt || 0) > deletedAt;
    });
  }

  function mergeTodos(a, b, localRoomUpdatedAt = 0, remoteRoomUpdatedAt = 0, localDeleted = {}, remoteDeleted = {}) {
    const deleted = mergeDeletedMaps(localDeleted, remoteDeleted);
    const localList = applyDeletedFilter(a, deleted);
    const remoteList = applyDeletedFilter(b, deleted);
    const localMap = new Map(localList.map((entry) => [entry.id, entry]));
    const remoteMap = new Map(remoteList.map((entry) => [entry.id, entry]));
    const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);
    const localWins = (localRoomUpdatedAt || 0) >= (remoteRoomUpdatedAt || 0);
    const result = [];

    for (const id of allIds) {
      const local = localMap.get(id);
      const remote = remoteMap.get(id);
      if (local && remote) {
        result.push((local.updatedAt || 0) >= (remote.updatedAt || 0) ? local : remote);
      } else if (local && !remote) {
        if (localWins) result.push(local);
      } else if (!local && remote) {
        if (!localWins) result.push(remote);
      }
    }

    return result.sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
  }

  function mergeWeeklies(a, b, localRoomUpdatedAt = 0, remoteRoomUpdatedAt = 0, localDeleted = {}, remoteDeleted = {}) {
    const deleted = mergeDeletedMaps(localDeleted, remoteDeleted);
    const localList = applyDeletedFilter(a, deleted);
    const remoteList = applyDeletedFilter(b, deleted);
    const localMap = new Map(localList.map((entry) => [entry.id, entry]));
    const remoteMap = new Map(remoteList.map((entry) => [entry.id, entry]));
    const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);
    const localWins = (localRoomUpdatedAt || 0) >= (remoteRoomUpdatedAt || 0);
    const result = [];

    for (const id of allIds) {
      const local = localMap.get(id);
      const remote = remoteMap.get(id);
      if (local && remote) {
        result.push((local.updatedAt || 0) >= (remote.updatedAt || 0) ? local : remote);
      } else if (local && !remote) {
        if (localWins) result.push(local);
      } else if (!local && remote) {
        if (!localWins) result.push(remote);
      }
    }

    return result.sort((x, y) => String(y.date).localeCompare(String(x.date)));
  }

  function normalizeState(raw) {
    const state = defaultState();
    if (!raw || typeof raw !== "object") return state;

    state.projectName = raw.projectName || "";
    state.reviewer = raw.reviewer || "";
    state.checks = raw.checks || {};
    state.openPhases = Array.isArray(raw.openPhases) ? raw.openPhases : state.openPhases;

    if (raw.roadmap) {
      state.roadmap = {
        layout: { ...DEFAULT_ROADMAP_LAYOUT, ...(raw.roadmap.layout || {}) },
        startDate: raw.roadmap.startDate || state.roadmap.startDate,
        updatedAt: raw.roadmap.updatedAt || 0,
      };
    }

    state.weeklies = Array.isArray(raw.weeklies) ? raw.weeklies : [];
    state.todos = Array.isArray(raw.todos) ? raw.todos : [];
    state.deletedWeeklyIds =
      raw.deletedWeeklyIds && typeof raw.deletedWeeklyIds === "object" ? raw.deletedWeeklyIds : {};
    state.deletedTodoIds =
      raw.deletedTodoIds && typeof raw.deletedTodoIds === "object" ? raw.deletedTodoIds : {};
    state.deletedItemIds =
      raw.deletedItemIds && typeof raw.deletedItemIds === "object" ? raw.deletedItemIds : {};
    state.itemEnrichments =
      raw.itemEnrichments && typeof raw.itemEnrichments === "object" ? raw.itemEnrichments : {};
    state.updatedAt = raw.updatedAt || 0;
    return state;
  }

  function mergeStates(local, remote) {
    const l = normalizeState(local);
    const r = normalizeState(remote);
    const merged = normalizeState(remote);

    merged.checks = mergeChecks(l.checks, r.checks);
    merged.deletedWeeklyIds = mergeDeletedMaps(l.deletedWeeklyIds, r.deletedWeeklyIds);
    merged.deletedTodoIds = mergeDeletedMaps(l.deletedTodoIds, r.deletedTodoIds);
    merged.deletedItemIds = mergeDeletedMaps(l.deletedItemIds, r.deletedItemIds);
    merged.itemEnrichments = { ...(l.itemEnrichments || {}), ...(r.itemEnrichments || {}) };

    if ((l.updatedAt || 0) > (r.updatedAt || 0)) {
      merged.weeklies = applyDeletedFilter(l.weeklies, merged.deletedWeeklyIds);
      merged.todos = applyDeletedFilter(l.todos, merged.deletedTodoIds);
    } else if ((r.updatedAt || 0) > (l.updatedAt || 0)) {
      merged.weeklies = applyDeletedFilter(r.weeklies, merged.deletedWeeklyIds);
      merged.todos = applyDeletedFilter(r.todos, merged.deletedTodoIds);
    } else {
      merged.weeklies = mergeWeeklies(
        l.weeklies,
        r.weeklies,
        l.updatedAt,
        r.updatedAt,
        l.deletedWeeklyIds,
        r.deletedWeeklyIds
      );
      merged.todos = mergeTodos(
        l.todos,
        r.todos,
        l.updatedAt,
        r.updatedAt,
        l.deletedTodoIds,
        r.deletedTodoIds
      );
    }

    if ((l.roadmap.updatedAt || 0) >= (r.roadmap.updatedAt || 0)) {
      merged.roadmap = { ...l.roadmap };
    }

    if ((l.updatedAt || 0) > (r.updatedAt || 0)) {
      if (!l.projectName && r.projectName) merged.projectName = r.projectName;
      else if (l.projectName) merged.projectName = l.projectName;

      if (!l.reviewer && r.reviewer) merged.reviewer = r.reviewer;
      else if (l.reviewer) merged.reviewer = l.reviewer;

      if (l.openPhases?.length) merged.openPhases = l.openPhases;
    } else {
      merged.projectName = r.projectName || l.projectName;
      merged.reviewer = r.reviewer || l.reviewer;
      merged.openPhases = r.openPhases?.length ? r.openPhases : l.openPhases;
    }

    merged.updatedAt = Math.max(l.updatedAt || 0, r.updatedAt || 0, Date.now());
    return merged;
  }

  function migrateLegacyLocal(roomId) {
    const state = defaultState();
    try {
      const meta = localStorage.getItem(`looker-checklist-meta-${roomId}`);
      if (meta) {
        const parsed = JSON.parse(meta);
        state.projectName = parsed.projectName || "";
        state.reviewer = parsed.reviewer || "";
      }
    } catch {
      // ignore
    }

    try {
      const checks = localStorage.getItem(`looker-checklist-checks-${roomId}`);
      if (checks) state.checks = JSON.parse(checks);
    } catch {
      // ignore
    }

    try {
      const layout = localStorage.getItem(`looker-roadmap-layout-${roomId}`);
      if (layout) {
        state.roadmap.layout = { ...DEFAULT_ROADMAP_LAYOUT, ...JSON.parse(layout) };
        state.roadmap.updatedAt = Date.now();
      }
      const start = localStorage.getItem(`looker-roadmap-start-${roomId}`);
      if (start) state.roadmap.startDate = start;
    } catch {
      // ignore
    }

    try {
      const phases = localStorage.getItem(`looker-checklist-open-phases-${roomId}`);
      if (phases) state.openPhases = JSON.parse(phases);
    } catch {
      // ignore
    }

    try {
      const weeklies = localStorage.getItem(`looker-weeklies-${roomId}`);
      if (weeklies) state.weeklies = JSON.parse(weeklies);
    } catch {
      // ignore
    }

    try {
      const todos = localStorage.getItem(`looker-todos-${roomId}`);
      if (todos) state.todos = JSON.parse(todos);
    } catch {
      // ignore
    }

    return state;
  }

  class RoomStore {
    constructor(roomId, syncConfig) {
      this.roomId = roomId;
      this.sync = syncConfig || { enabled: false };
      this.syncEnabled = !!(this.sync.enabled && this.sync.token);
      this.localKey = `looker-room-${roomId}`;
      this.syncPath = `sync/${roomId}.json`;
      this.legacyRoadmapPath = `sync/roadmap-${roomId}.json`;
      this.state = defaultState();
      this.fileSha = null;
      this.legacyRoadmapSha = null;
      this.listeners = new Set();
      this.saveQueue = Promise.resolve();
      this.pollTimer = null;
      this.saving = false;
      this.savePending = false;
    }

    subscribe(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }

    notify() {
      this.listeners.forEach((fn) => fn(this.state));
    }

    loadLocal() {
      try {
        const raw = localStorage.getItem(this.localKey);
        if (raw) {
          this.state = normalizeState(JSON.parse(raw));
          return;
        }
      } catch {
        // ignore
      }
      this.state = migrateLegacyLocal(this.roomId);
    }

    saveLocal() {
      localStorage.setItem(this.localKey, JSON.stringify(this.state));
      localStorage.setItem(
        `looker-checklist-meta-${this.roomId}`,
        JSON.stringify({
          projectName: this.state.projectName,
          reviewer: this.state.reviewer,
        })
      );
      localStorage.setItem(
        `looker-checklist-checks-${this.roomId}`,
        JSON.stringify(this.state.checks)
      );
      localStorage.setItem(
        `looker-roadmap-layout-${this.roomId}`,
        JSON.stringify(this.state.roadmap.layout)
      );
      localStorage.setItem(
        `looker-roadmap-start-${this.roomId}`,
        this.state.roadmap.startDate
      );
      localStorage.setItem(
        `looker-checklist-open-phases-${this.roomId}`,
        JSON.stringify(this.state.openPhases)
      );
      localStorage.setItem(
        `looker-weeklies-${this.roomId}`,
        JSON.stringify(this.state.weeklies)
      );
      localStorage.setItem(
        `looker-todos-${this.roomId}`,
        JSON.stringify(this.state.todos)
      );
    }

    async githubGet(path) {
      const url = `https://api.github.com/repos/${this.sync.owner}/${this.sync.repo}/contents/${path}?ref=${this.sync.branch}`;
      return fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.sync.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
    }

    async githubPut(path, payload, sha, message) {
      const body = {
        message,
        content: btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2)))),
        branch: this.sync.branch,
      };
      if (sha) body.sha = sha;

      const url = `https://api.github.com/repos/${this.sync.owner}/${this.sync.repo}/contents/${path}`;
      const res = await fetch(url, {
        method: "PUT",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.sync.token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("save failed");
      const data = await res.json();
      return data.content?.sha || sha;
    }

    async fetchRemote() {
      if (!this.syncEnabled) return false;

      let remoteState = null;

      try {
        const res = await this.githubGet(this.syncPath);
        if (res.ok) {
          const meta = await res.json();
          this.fileSha = meta.sha;
          remoteState = JSON.parse(atob(meta.content.replace(/\n/g, "")));
        } else if (res.status !== 404) {
          throw new Error("fetch failed");
        }
      } catch {
        return false;
      }

      if (!remoteState?.roadmap?.layout) {
        try {
          const legacy = await this.githubGet(this.legacyRoadmapPath);
          if (legacy.ok) {
            const meta = await legacy.json();
            this.legacyRoadmapSha = meta.sha;
            const json = JSON.parse(atob(meta.content.replace(/\n/g, "")));
            remoteState = remoteState || {};
            remoteState.roadmap = {
              layout: json.layout,
              startDate: json.startDate,
              updatedAt: json.updatedAt || 0,
            };
          }
        } catch {
          // ignore legacy fetch
        }
      }

      const before = JSON.stringify(this.state);
      if (remoteState) {
        if (this.savePending || this.saving) return true;
        this.state = mergeStates(this.state, remoteState);
      }
      this.saveLocal();
      if (JSON.stringify(this.state) !== before) this.notify();
      return true;
    }

    patch(mutator, options = {}) {
      const { roadmapTouch = false, save = true } = options;
      mutator(this.state);
      this.state.updatedAt = Date.now();
      if (roadmapTouch) this.state.roadmap.updatedAt = Date.now();
      this.saveLocal();
      this.notify();
      if (save) this.queueSave();
    }

    queueSave() {
      this.savePending = true;
      this.saveQueue = this.saveQueue
        .then(() => this.persistRemote())
        .catch(() => {
          this.saving = false;
          this.savePending = false;
          throw new Error("save failed");
        });
      return this.saveQueue;
    }

    async persistRemote() {
      if (!this.syncEnabled) {
        this.savePending = false;
        return;
      }
      this.saving = true;
      const payload = { ...this.state, updatedAt: Date.now() };
      try {
        this.fileSha = await this.githubPut(
          this.syncPath,
          payload,
          this.fileSha,
          `Sync room ${this.roomId}`
        );
        this.state.updatedAt = payload.updatedAt;
        this.saveLocal();
      } finally {
        this.saving = false;
        this.savePending = false;
      }
    }

    async init() {
      this.loadLocal();
      this.notify();
      if (!this.syncEnabled) return "local";

      const ok = await this.fetchRemote();
      return ok ? "synced" : "error";
    }

    startPolling(ms) {
      if (!this.syncEnabled || this.pollTimer) return;
      this.pollTimer = setInterval(() => {
        if (this.saving || this.savePending) return;
        this.fetchRemote();
      }, ms);
    }

    stopPolling() {
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  window.RoomStore = {
    DEFAULT_ROADMAP_LAYOUT,
    defaultStartDate,
    create(roomId, syncConfig) {
      return new RoomStore(roomId, syncConfig);
    },
  };
})();
