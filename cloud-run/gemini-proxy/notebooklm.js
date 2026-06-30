const NOTEBOOKLM_API_URL = String(process.env.NOTEBOOKLM_API_URL || "").replace(/\/$/, "");
const NOTEBOOKLM_NOTEBOOK_ID = process.env.NOTEBOOKLM_NOTEBOOK_ID || "";
const NOTEBOOKLM_NOTEBOOK_URL = process.env.NOTEBOOKLM_NOTEBOOK_URL || "";

function isConfigured() {
  return Boolean(NOTEBOOKLM_API_URL && (NOTEBOOKLM_NOTEBOOK_ID || NOTEBOOKLM_NOTEBOOK_URL));
}

function healthInfo() {
  return {
    configured: isConfigured(),
    notebookId: NOTEBOOKLM_NOTEBOOK_ID || null,
    hasNotebookUrl: Boolean(NOTEBOOKLM_NOTEBOOK_URL),
  };
}

async function notebooklmFetch(path, options = {}) {
  const url = `${NOTEBOOKLM_API_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data?.error || data?.message || `notebooklm_http_${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function notebookPayload(extra = {}) {
  const payload = { ...extra };
  if (NOTEBOOKLM_NOTEBOOK_URL) payload.notebook_url = NOTEBOOKLM_NOTEBOOK_URL;
  else if (NOTEBOOKLM_NOTEBOOK_ID) payload.notebook_id = NOTEBOOKLM_NOTEBOOK_ID;
  return payload;
}

async function uploadTextSources(sources) {
  const uploaded = [];
  for (const source of sources || []) {
    const title = String(source.title || "Document").trim().slice(0, 120);
    const text = String(source.text || "").trim();
    if (!text) continue;
    const result = await notebooklmFetch("/content/sources", {
      method: "POST",
      body: JSON.stringify(
        notebookPayload({
          source_type: "text",
          title,
          text: text.slice(0, 500_000),
        })
      ),
    });
    uploaded.push({ title, result });
  }
  return uploaded;
}

function extractAnswer(data) {
  const answer =
    data?.data?.answer ||
    data?.answer ||
    data?.data?.text ||
    data?.text ||
    "";
  const sources = data?.data?.sources || data?.sources || null;
  const sessionId = data?.data?.session_id || data?.session_id || "";
  return { answer: String(answer).trim(), sources, sessionId };
}

async function askNotebookLM(question, sessionId) {
  const body = notebookPayload({
    question: String(question).trim(),
    source_format: "json",
    ...(sessionId ? { session_id: sessionId } : {}),
  });
  const data = await notebooklmFetch("/ask", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return extractAnswer(data);
}

function buildNotebookQuestion(tasks, projectName) {
  const taskLines = (tasks || [])
    .map((task, index) => {
      const parts = [
        `${index + 1}. [${task.refId}] (${task.kind}) ${task.title}`,
        task.priority ? `   Priorité : ${task.priority}` : "",
        task.phaseId ? `   Phase : ${task.phaseId}` : "",
        task.description ? `   Description actuelle : ${task.description}` : "",
        task.verify ? `   Vérification actuelle : ${task.verify}` : "",
        task.setup ? `   Mise en place actuelle : ${task.setup}` : "",
      ];
      return parts.filter(Boolean).join("\n");
    })
    .join("\n\n");

  return `Tu es consultant sur un projet Looker / couche sémantique / Dataform${projectName ? ` (« ${projectName} »)` : ""}.

Des documents techniques viennent d'être ajoutés à ce notebook (code Dataform, specs, architecture, etc.).

TÂCHES EXISTANTES À ENRICHIR (conserve le refId entre crochets pour chaque tâche) :
${taskLines || "(aucune tâche sélectionnée)"}

Pour CHAQUE tâche listée ci-dessus :
1. Enrichis la description avec le contexte technique des documents (sans inventer)
2. Détaille comment vérifier que c'est fait (critères concrets)
3. Détaille comment mettre en place (étapes, outils, livrables)
4. Propose 3 à 8 sous-actions concrètes et ordonnées (découpage opérationnel)

Identifie aussi de NOUVELLES tâches pertinentes suggérées par les documents mais absentes de la liste (gouvernance, LookML, Dataform, CI/CD, adoption…).

Réponds en français, structuré par tâche (refId), avec citations des sources du notebook quand c'est pertinent.`;
}

async function structureEnrichment({ notebookAnswer, tasks, catalogs, generateJson }) {
  const todoList = (catalogs?.todos || []).map((t) => ({
    id: t.id,
    title: t.title,
    done: !!t.done,
  }));
  const checklistList = (catalogs?.checklistItems || []).map((i) => ({
    id: i.id,
    title: i.title,
    category: i.category,
  }));
  const taskRefs = (tasks || []).map((t) => ({
    refId: t.refId,
    kind: t.kind,
    title: t.title,
  }));

  const systemPrompt = `Tu structures une réponse NotebookLM en JSON pour un projet Looker / data en français.

Réponse NotebookLM (avec citations) :
---
${notebookAnswer}
---

Tâches ciblées (refId à respecter) :
${JSON.stringify(taskRefs, null, 2)}

Todos existantes :
${JSON.stringify(todoList, null, 2)}

Checklist existante :
${JSON.stringify(checklistList, null, 2)}

Produis un JSON avec :

1) "enrichments" — un objet par tâche ciblée (même refId, même kind) :
   - "refId", "kind" ("checklist" | "todo")
   - "description" : contexte enrichi (markdown léger autorisé)
   - "verify" : critères de vérification
   - "setup" : étapes de mise en place
   - "subtasks" : tableau de strings (sous-actions concrètes)

2) "newTasks" — nouvelles tâches suggérées par les documents :
   - "text" : titre court actionnable
   - "status" : "new" | "duplicate-todo" | "duplicate-checklist" | "similar-todo" | "similar-checklist"
   - "matchTitle", "matchId", "score" (0-1) si status != "new"
   - "phaseId" parmi : project-mgmt, infra, governance, lookml, cicd, content, adoption, platform
   - "priority" : critical | high | medium
   - "description", "verify", "setup"
   - "subtasks" : tableau de strings

Base-toi sur la réponse NotebookLM. N'invente pas de faits absents des sources.
Réponds UNIQUEMENT en JSON valide.`;

  const result = await generateJson(systemPrompt, notebookAnswer);
  const enrichments = Array.isArray(result.enrichments) ? result.enrichments : [];
  const newTasks = Array.isArray(result.newTasks) ? result.newTasks : [];
  return { enrichments, newTasks };
}

function registerNotebookLMRoutes(app, deps) {
  const { checkProxySecret, generateJson } = deps;

  app.post("/v1/notebooklm/enrich", async (req, res) => {
    if (!checkProxySecret(req)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (!isConfigured()) {
      res.status(503).json({ error: "notebooklm_not_configured" });
      return;
    }

    const { sources = [], tasks = [], catalogs = {}, projectName = "" } = req.body || {};
    if (!Array.isArray(tasks) || !tasks.length) {
      res.status(400).json({ error: "tasks_required" });
      return;
    }

    try {
      const uploaded = sources.length ? await uploadTextSources(sources) : [];
      const question = buildNotebookQuestion(tasks, projectName);
      const { answer, sources: citations, sessionId } = await askNotebookLM(question);
      if (!answer) {
        res.status(502).json({ error: "notebooklm_empty_answer" });
        return;
      }

      const structured = await structureEnrichment({
        notebookAnswer: answer,
        tasks,
        catalogs,
        generateJson,
      });

      res.json({
        ok: true,
        usedNotebookLM: true,
        uploadedSources: uploaded.length,
        sessionId,
        notebookAnswer: answer,
        citations,
        enrichments: structured.enrichments,
        newTasks: structured.newTasks,
      });
    } catch (err) {
      res.status(err.status || 500).json({
        error: err.message || "notebooklm_enrich_failed",
        details: err.body,
      });
    }
  });

  app.get("/v1/notebooklm/status", (_req, res) => {
    res.json({ ok: true, ...healthInfo() });
  });
}

module.exports = {
  registerNotebookLMRoutes,
  healthInfo,
  isConfigured,
};
