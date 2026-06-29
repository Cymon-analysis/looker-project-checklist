import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const canvasPath = path.join(__dirname, "..", "canvases", "looker-project-checklist.canvas.tsx");
const content = fs.readFileSync(canvasPath, "utf8");

const itemsMatch = content.match(/const ITEMS: readonly ChecklistItem\[\] = (\[[\s\S]*?\n\]);/);
const phasesMatch = content.match(/const PHASES = (\[[\s\S]*?\]) as const;/);

if (!itemsMatch || !phasesMatch) {
  console.error("Could not parse canvas data");
  process.exit(1);
}

const itemsRaw = itemsMatch[1];
const phasesRaw = phasesMatch[1].replace(/ as const/g, "");
const ITEMS = eval(itemsRaw);
const PHASES = eval(phasesRaw);

const PRIORITY_LABEL = { critical: "Critique", high: "Haute", medium: "Moyenne" };
const PHASE_COLORS = {
  infra: "#e85d75",
  governance: "#e8913a",
  lookml: "#9b6dd7",
  cicd: "#4a8fd4",
  content: "#4caf7d",
  adoption: "#d4b43a",
  platform: "#8a8a96",
};

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Checklist Projet Looker et Couche Sémantique</title>
  <style>
    :root {
      --bg: #0f1117;
      --surface: #181b24;
      --surface2: #1e2230;
      --border: #2a2f3d;
      --text: #e8eaed;
      --text2: #9aa0ad;
      --text3: #6b7280;
      --accent: #4a8fd4;
      --accent-hover: #5a9fe4;
      --critical: #e85d75;
      --high: #e8913a;
      --medium: #8a8a96;
      --success: #4caf7d;
      --warning: #e8913a;
      --radius: 8px;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      min-height: 100vh;
    }
    .container { max-width: 960px; margin: 0 auto; padding: 24px 20px 48px; }
    h1 { font-size: 1.75rem; font-weight: 600; margin-bottom: 8px; }
    h2 { font-size: 1.125rem; font-weight: 600; margin: 24px 0 12px; }
    h3 { font-size: 0.8125rem; font-weight: 600; color: var(--text); margin-bottom: 4px; }
    .subtitle { color: var(--text2); font-size: 0.9375rem; margin-bottom: 24px; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
      margin-bottom: 16px;
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--text2);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 12px;
    }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    @media (max-width: 640px) {
      .grid-2, .grid-3 { grid-template-columns: 1fr; }
    }
    label.field-label { display: block; font-size: 0.75rem; color: var(--text3); margin-bottom: 4px; }
    input[type="text"], select {
      width: 100%;
      padding: 8px 10px;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 0.875rem;
      font-family: inherit;
    }
    input[type="text"]:focus, select:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
    .stat { text-align: center; padding: 12px; }
    .stat-value { font-size: 1.5rem; font-weight: 600; }
    .stat-value.success { color: var(--success); }
    .stat-value.warning { color: var(--warning); }
    .stat-label { font-size: 0.75rem; color: var(--text3); margin-top: 4px; }
    .progress-wrap { margin-top: 4px; }
    .progress-bar {
      height: 8px;
      background: var(--surface2);
      border-radius: 4px;
      overflow: hidden;
      display: flex;
    }
    .progress-seg { height: 100%; transition: width 0.3s; }
    .progress-labels {
      display: flex;
      justify-content: space-between;
      font-size: 0.75rem;
      color: var(--text3);
      margin-bottom: 6px;
    }
    .callout {
      padding: 12px 14px;
      border-radius: var(--radius);
      font-size: 0.875rem;
      margin-bottom: 16px;
      border: 1px solid;
    }
    .callout-warning { background: rgba(232,145,58,0.1); border-color: rgba(232,145,58,0.3); color: #f0b87a; }
    .callout-success { background: rgba(76,175,125,0.1); border-color: rgba(76,175,125,0.3); color: #7dcea0; }
    .callout-info { background: rgba(74,143,212,0.1); border-color: rgba(74,143,212,0.3); color: #8ab4e8; }
    .callout-title { font-weight: 600; margin-bottom: 4px; }
    .checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 0.875rem; cursor: pointer; }
    .checkbox-row input { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; }
    button {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 0.8125rem;
      cursor: pointer;
      font-family: inherit;
    }
    button:hover { background: var(--surface2); color: var(--text); }
    .phase {
      border-bottom: 1px solid var(--border);
      margin-bottom: 4px;
    }
    .phase-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 4px;
      cursor: pointer;
      user-select: none;
      width: 100%;
      background: none;
      border: none;
      color: var(--text);
      font-family: inherit;
      font-size: 0.9375rem;
      font-weight: 500;
      text-align: left;
    }
    .phase-header:hover { color: var(--accent); }
    .phase-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
    .phase-count { color: var(--text3); font-size: 0.8125rem; font-weight: 400; }
    .phase-progress { margin-left: auto; color: var(--text3); font-size: 0.8125rem; }
    .chevron { transition: transform 0.2s; color: var(--text3); font-size: 0.75rem; }
    .phase.open .chevron { transform: rotate(90deg); }
    .phase-body { display: none; padding-left: 12px; }
    .phase.open .phase-body { display: block; }
    .item {
      display: flex;
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid var(--border);
    }
    .item.done { opacity: 0.55; }
    .item-check { padding-top: 2px; }
    .item-check input { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; }
    .item-content { flex: 1; min-width: 0; }
    .item-title-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 4px; }
    .item-title { font-weight: 600; font-size: 0.9375rem; }
    .item.done .item-title { text-decoration: line-through; color: var(--text3); }
    .pill {
      font-size: 0.6875rem;
      padding: 2px 8px;
      border-radius: 4px;
      border: 1px solid var(--border);
      color: var(--text2);
      white-space: nowrap;
    }
    .pill-critical { border-color: rgba(232,93,117,0.4); color: #f08090; }
    .pill-high { border-color: rgba(232,145,58,0.4); color: #f0b87a; }
    .item-desc { font-size: 0.8125rem; color: var(--text2); margin-bottom: 8px; }
    .guide-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      background: none;
      border: none;
      color: var(--accent);
      font-size: 0.8125rem;
      cursor: pointer;
      padding: 4px 0;
      font-family: inherit;
    }
    .guide-toggle:hover { color: var(--accent-hover); }
    .guide-toggle .chevron { font-size: 0.625rem; }
    .guide-toggle.open .chevron { transform: rotate(90deg); }
    .guide-body {
      display: none;
      padding: 10px 0 4px;
      border-left: 2px solid var(--border);
      margin-left: 4px;
      padding-left: 12px;
    }
    .guide-body.open { display: block; }
    .guide-section { margin-bottom: 12px; }
    .guide-section:last-child { margin-bottom: 0; }
    .guide-text { font-size: 0.8125rem; color: var(--text2); }
    .legend { display: flex; flex-wrap: wrap; gap: 16px; }
    .legend-item { display: flex; align-items: center; gap: 6px; font-size: 0.8125rem; color: var(--text2); }
    .hidden { display: none !important; }
    footer { text-align: center; margin-top: 32px; font-size: 0.75rem; color: var(--text3); }
  </style>
</head>
<body>
  <div class="container">
    <h1>Checklist Projet Looker et Couche Sémantique</h1>
    <p class="subtitle">Audit post-setup — cochez chaque point validé. Votre progression est sauvegardée localement dans votre navigateur.</p>

    <div class="card">
      <div class="card-header">Informations du projet</div>
      <div class="grid-2">
        <div>
          <label class="field-label" for="projectName">Nom du projet Looker</label>
          <input type="text" id="projectName" placeholder="ex. analytics_semantic_layer" />
        </div>
        <div>
          <label class="field-label" for="reviewer">Auditeur / Responsable</label>
          <input type="text" id="reviewer" placeholder="ex. Équipe Data Platform" />
        </div>
      </div>
    </div>

    <div class="grid-3" id="stats"></div>

    <div class="card">
      <div class="progress-labels">
        <span id="progressLeft">0 validés</span>
        <span id="progressRight">0 restants</span>
      </div>
      <div class="progress-bar" id="progressBar"></div>
    </div>

    <div class="card">
      <div class="card-header">
        <span>Filtres</span>
        <button type="button" id="resetBtn">Réinitialiser</button>
      </div>
      <div class="grid-2">
        <div>
          <label class="field-label" for="search">Recherche</label>
          <input type="text" id="search" placeholder="Mot-clé, catégorie, instruction…" />
        </div>
        <div>
          <label class="field-label" for="priorityFilter">Priorité</label>
          <select id="priorityFilter">
            <option value="all">Toutes les priorités</option>
            <option value="critical">Critique</option>
            <option value="high">Haute</option>
            <option value="medium">Moyenne</option>
          </select>
        </div>
        <div>
          <label class="field-label" for="phaseFilter">Phase</label>
          <select id="phaseFilter">
            <option value="all">Toutes les phases</option>
            ${PHASES.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join("")}
          </select>
        </div>
        <div style="display:flex;align-items:flex-end;padding-bottom:4px">
          <label class="checkbox-row">
            <input type="checkbox" id="hideCompleted" />
            Masquer les points validés
          </label>
        </div>
      </div>
    </div>

    <div id="callout"></div>
    <h2 id="itemsHeading">Points de contrôle</h2>
    <div id="phases"></div>
    <div id="noResults" class="callout callout-info hidden">
      <div class="callout-title">Aucun résultat</div>
      Aucun point ne correspond aux filtres actifs.
    </div>

    <h2>Légende des priorités</h2>
    <div class="legend">
      <div class="legend-item"><span class="phase-dot" style="background:var(--critical)"></span> Critique — bloquant pour la production</div>
      <div class="legend-item"><span class="phase-dot" style="background:var(--high)"></span> Haute — fort impact sécurité, performance ou adoption</div>
      <div class="legend-item"><span class="phase-dot" style="background:var(--medium)"></span> Moyenne — bonnes pratiques et optimisation</div>
    </div>

    <footer>Checklist Looker — ${ITEMS.length} points de contrôle</footer>
  </div>

  <script>
    const PHASES = ${JSON.stringify(PHASES)};
    const ITEMS = ${JSON.stringify(ITEMS)};
    const PRIORITY_LABEL = ${JSON.stringify(PRIORITY_LABEL)};
    const PHASE_COLORS = ${JSON.stringify(PHASE_COLORS)};
    const STORAGE_KEY = "looker-checklist-state-v1";

    let state = loadState();

    function loadState() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { checked: {}, projectName: "", reviewer: "" };
      } catch { return { checked: {}, projectName: "", reviewer: "" }; }
    }

    function saveState() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    function isChecked(id) { return !!state.checked[id]; }

    function toggleCheck(id, val) {
      if (val) state.checked[id] = true;
      else delete state.checked[id];
      saveState();
      render();
    }

    function getFilteredItems() {
      const q = (document.getElementById("search").value || "").trim().toLowerCase();
      const priority = document.getElementById("priorityFilter").value;
      const phase = document.getElementById("phaseFilter").value;
      const hideCompleted = document.getElementById("hideCompleted").checked;
      return ITEMS.filter(item => {
        if (priority !== "all" && item.priority !== priority) return false;
        if (phase !== "all" && item.phaseId !== phase) return false;
        if (hideCompleted && isChecked(item.id)) return false;
        if (q) {
          const hay = (item.title + item.category + item.description + item.verify + item.setup).toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
    }

    function phaseProgress(phaseId) {
      const items = ITEMS.filter(i => i.phaseId === phaseId);
      const done = items.filter(i => isChecked(i.id)).length;
      return { done, total: items.length };
    }

    function escHtml(s) {
      const d = document.createElement("div");
      d.textContent = s;
      return d.innerHTML;
    }

    function renderStats() {
      const total = ITEMS.length;
      const done = ITEMS.filter(i => isChecked(i.id)).length;
      const critical = ITEMS.filter(i => i.priority === "critical");
      const criticalDone = critical.filter(i => isChecked(i.id)).length;
      const pct = Math.round((done / total) * 100);

      document.getElementById("stats").innerHTML = \`
        <div class="card stat">
          <div class="stat-value \${done === total ? "success" : ""}">\${done}/\${total}</div>
          <div class="stat-label">Points validés</div>
        </div>
        <div class="card stat">
          <div class="stat-value">\${pct}%</div>
          <div class="stat-label">Progression globale</div>
        </div>
        <div class="card stat">
          <div class="stat-value \${criticalDone === critical.length ? "success" : "warning"}">\${criticalDone}/\${critical.length}</div>
          <div class="stat-label">Critiques validés</div>
        </div>
      \`;

      document.getElementById("progressLeft").textContent = done + " validés";
      document.getElementById("progressRight").textContent = (total - done) + " restants";

      const bar = document.getElementById("progressBar");
      bar.innerHTML = PHASES.map(p => {
        const { done: pd } = phaseProgress(p.id);
        const w = total > 0 ? (pd / total) * 100 : 0;
        return \`<div class="progress-seg" style="width:\${w}%;background:\${PHASE_COLORS[p.id]}"></div>\`;
      }).join("");

      const callout = document.getElementById("callout");
      if (criticalDone < critical.length) {
        const rem = critical.length - criticalDone;
        callout.innerHTML = \`<div class="callout callout-warning"><div class="callout-title">Points critiques en attente</div>\${rem} point\${rem > 1 ? "s" : ""} critique\${rem > 1 ? "s" : ""} restant\${rem > 1 ? "s" : ""} sur \${critical.length}. Priorisez-les avant le go-live.</div>\`;
      } else if (done === total) {
        callout.innerHTML = \`<div class="callout callout-success"><div class="callout-title">Checklist complète</div>Tous les points de contrôle sont validés. Planifiez une revue trimestrielle pour maintenir la conformité.</div>\`;
      } else {
        callout.innerHTML = "";
      }
    }

    function renderPhases() {
      const filtered = getFilteredItems();
      document.getElementById("itemsHeading").textContent = "Points de contrôle (" + filtered.length + " affichés)";
      document.getElementById("noResults").classList.toggle("hidden", filtered.length > 0);

      const container = document.getElementById("phases");
      container.innerHTML = "";

      PHASES.forEach(phase => {
        const phaseItems = filtered.filter(i => i.phaseId === phase.id);
        if (phaseItems.length === 0) return;

        const { done, total } = phaseProgress(phase.id);
        const phaseEl = document.createElement("div");
        phaseEl.className = "phase" + (phase.id === "infra" || phase.id === "lookml" ? " open" : "");
        phaseEl.innerHTML = \`
          <button type="button" class="phase-header" aria-expanded="\${phaseEl.classList.contains("open")}">
            <span class="chevron">▶</span>
            <span class="phase-dot" style="background:\${PHASE_COLORS[phase.id]}"></span>
            <span>\${escHtml(phase.title)}</span>
            <span class="phase-count">(\${phaseItems.length})</span>
            <span class="phase-progress">\${done}/\${total}</span>
          </button>
          <div class="phase-body"></div>
        \`;

        const header = phaseEl.querySelector(".phase-header");
        header.addEventListener("click", () => {
          phaseEl.classList.toggle("open");
          header.setAttribute("aria-expanded", phaseEl.classList.contains("open"));
        });

        const body = phaseEl.querySelector(".phase-body");
        phaseItems.forEach(item => {
          const done = isChecked(item.id);
          const itemEl = document.createElement("div");
          itemEl.className = "item" + (done ? " done" : "");
          itemEl.innerHTML = \`
            <div class="item-check">
              <input type="checkbox" \${done ? "checked" : ""} aria-label="Marquer comme validé" />
            </div>
            <div class="item-content">
              <div class="item-title-row">
                <span class="item-title">\${escHtml(item.title)}</span>
                <span class="pill pill-\${item.priority}">\${PRIORITY_LABEL[item.priority]}</span>
                <span class="pill">\${escHtml(item.category)}</span>
              </div>
              <p class="item-desc">\${escHtml(item.description)}</p>
              <button type="button" class="guide-toggle" aria-expanded="false">
                <span class="chevron">▶</span> Vérification et mise en place
              </button>
              <div class="guide-body">
                <div class="guide-section">
                  <h3>Comment vérifier</h3>
                  <p class="guide-text">\${escHtml(item.verify)}</p>
                </div>
                <div class="guide-section">
                  <h3>Comment mettre en place</h3>
                  <p class="guide-text">\${escHtml(item.setup)}</p>
                </div>
              </div>
            </div>
          \`;

          itemEl.querySelector(".item-check input").addEventListener("change", e => {
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

    document.getElementById("projectName").value = state.projectName || "";
    document.getElementById("reviewer").value = state.reviewer || "";

    document.getElementById("projectName").addEventListener("input", e => {
      state.projectName = e.target.value;
      saveState();
    });
    document.getElementById("reviewer").addEventListener("input", e => {
      state.reviewer = e.target.value;
      saveState();
    });
    ["search", "priorityFilter", "phaseFilter", "hideCompleted"].forEach(id => {
      document.getElementById(id).addEventListener(id === "hideCompleted" ? "change" : "input", render);
      if (id !== "search") document.getElementById(id).addEventListener("change", render);
    });
    document.getElementById("resetBtn").addEventListener("click", () => {
      if (confirm("Réinitialiser toute la progression ?")) {
        state.checked = {};
        saveState();
        render();
      }
    });

    render();
  </script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, "index.html"), html, "utf8");
console.log("Generated index.html with", ITEMS.length, "items");
