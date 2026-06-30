(function () {
  const CFG = () =>
    window.GEMINI_CONFIG || {
      enabled: false,
      mode: "api-key",
      apiKey: "",
      proxyUrl: "",
      proxySecret: "",
      model: "gemini-2.5-flash-lite",
    };

  const MODEL_FALLBACKS = [
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash",
  ];

  let lastError = null;
  let lastModelUsed = null;

  function isEnabled() {
    const c = CFG();
    if (!c.enabled) return false;
    if (c.mode === "vertex-proxy" || c.proxyUrl) return Boolean(c.proxyUrl);
    return Boolean(c.apiKey);
  }

  function usesProxy() {
    const c = CFG();
    return Boolean(c.proxyUrl) || c.mode === "vertex-proxy";
  }

  function getLastError() {
    return lastError;
  }

  function getLastModelUsed() {
    return lastModelUsed;
  }

  function modelCandidates() {
    const preferred = CFG().model || MODEL_FALLBACKS[0];
    return [preferred, ...MODEL_FALLBACKS].filter((m, i, arr) => m && arr.indexOf(m) === i);
  }

  function formatApiError(status, body) {
    if (status === 429) return "Quota API dépassé — réessayez dans quelques minutes";
    if (status === 403) return "Clé API refusée — vérifiez GEMINI_API_KEY";
    if (status === 503) return "Modèle saturé — nouvel essai automatique";
    if (status === 404) return "Modèle indisponible";
    try {
      const parsed = JSON.parse(body);
      return parsed?.error?.message?.slice(0, 120) || `HTTP ${status}`;
    } catch {
      return `HTTP ${status}`;
    }
  }

  function extractJson(text) {
    const raw = String(text || "").trim();
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1].trim() : raw;
    return JSON.parse(candidate);
  }

  async function generateJson(systemPrompt, userContent) {
    const c = CFG();
    if (!isEnabled()) throw new Error("gemini_disabled");

    if (usesProxy()) {
      return generateJsonViaProxy(systemPrompt, userContent);
    }

    return generateJsonViaApiKey(systemPrompt, userContent);
  }

  async function generateJsonViaProxy(systemPrompt, userContent) {
    const c = CFG();
    const baseUrl = String(c.proxyUrl || "").replace(/\/$/, "");
    let lastBody = "";
    let lastStatus = 0;

    for (const model of modelCandidates()) {
      const headers = { "Content-Type": "application/json" };
      if (c.proxySecret) headers["X-Gemini-Proxy-Secret"] = c.proxySecret;

      const res = await fetch(`${baseUrl}/v1/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          systemPrompt,
          userContent,
          model,
          responseMimeType: "application/json",
          temperature: 0.1,
        }),
      });

      if (!res.ok) {
        lastStatus = res.status;
        lastBody = await res.text();
        if ([429, 503, 404].includes(res.status)) continue;
        lastError = formatApiError(res.status, lastBody);
        throw new Error(`gemini_http_${res.status}`);
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        lastError = "Réponse vide";
        continue;
      }
      lastError = null;
      lastModelUsed = data.model || model;
      return extractJson(text);
    }

    lastError = formatApiError(lastStatus, lastBody);
    throw new Error(`gemini_http_${lastStatus || "all_failed"}`);
  }

  async function generateJsonViaApiKey(systemPrompt, userContent) {
    const c = CFG();
    let lastBody = "";
    let lastStatus = 0;

    for (const model of modelCandidates()) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(c.apiKey)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: `${systemPrompt}\n\n---\n\n${userContent}` }],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
          },
        }),
      });

      if (!res.ok) {
        lastStatus = res.status;
        lastBody = await res.text();
        if (res.status === 429 || res.status === 503 || res.status === 404) {
          continue;
        }
        lastError = formatApiError(res.status, lastBody);
        throw new Error(`gemini_http_${res.status}`);
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        lastError = "Réponse vide";
        continue;
      }
      lastError = null;
      lastModelUsed = model;
      return extractJson(text);
    }

    lastError = formatApiError(lastStatus, lastBody);
    throw new Error(`gemini_http_${lastStatus || "all_failed"}`);
  }

  function normalizeActionsField(value) {
    if (Array.isArray(value)) {
      return value
        .map((v) => {
          if (v && typeof v === "object") {
            const text = String(v.text || v.title || v.action || "").trim();
            const owner = String(v.owner || v.assignee || v.responsable || "").trim();
            if (!text) return "";
            return owner ? `${text} (${owner})` : text;
          }
          return String(v || "").trim();
        })
        .filter(Boolean)
        .map((a) => (a.match(/^[-*•–—]\s+/) ? a : `- ${a.replace(/^[-*•–—]\s+/, "")}`))
        .join("\n");
    }
    return String(value || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((a) => (a.match(/^[-*•–—]\s+/) ? a : `- ${a.replace(/^[-*•–—]\s+/, "")}`))
      .join("\n");
  }

  function heuristicSplit(rawText) {
    const text = String(rawText || "").trim();
    if (!text) return { notes: "", actions: "" };

    const patterns = [
      /\n(?:#{1,3}\s*)?(?:actions?|action items?|prochaines étapes|next steps|à faire|todos?|tâches?)\s*:?\s*\n/i,
      /\n(?:[-*]\s*)?(?:actions?|prochaines étapes|à faire)\s*:?\s*\n/i,
      /\n(?:#{1,3}\s*)?(?:actions?|prochaines étapes)\s*$/im,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match.index != null) {
        return {
          notes: text.slice(0, match.index).trim(),
          actions: normalizeActionsField(text.slice(match.index + match[0].length).trim()),
        };
      }
    }

    const actionLines = text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return false;
        if (/^[-*•–—]\s+/.test(line)) return true;
        if (/^\d+[.)]\s+/.test(line)) return true;
        return /^(action|todo|à faire|prochaine étape)\s*:/i.test(line);
      });

    if (actionLines.length >= 1) {
      const actionSet = new Set(actionLines);
      const notes = text
        .split(/\n+/)
        .filter((line) => !actionSet.has(line.trim()))
        .join("\n")
        .trim();
      return {
        notes,
        actions: normalizeActionsField(actionLines),
      };
    }

    return { notes: text, actions: "" };
  }

  async function extractActionsFromText(sourceText) {
    const source = String(sourceText || "").trim();
    if (!source || !isEnabled()) return "";

    const systemPrompt = `Tu extrais TOUTES les tâches et prochaines étapes d'un compte-rendu de réunion en français.

Inclus obligatoirement :
- puces, numéros, listes "à faire"
- engagements nommés ("Simon va…", "Marie doit…")
- formulations "il faut", "à valider", "prochaine étape", "d'ici la prochaine weekly"
- décisions qui impliquent une action concrète à réaliser

Chaque entrée du tableau "actions" :
- formulation courte et actionnable (infinitif ou impératif)
- responsable entre parenthèses si mentionné dans le texte

Ne renvoie un tableau vide QUE si le texte ne contient vraiment aucun engagement ni tâche.
Réponds UNIQUEMENT en JSON: {"actions":["action 1","action 2"]}`;

    try {
      const result = await generateJson(systemPrompt, source);
      return normalizeActionsField(result.actions || result.items || result.todos);
    } catch {
      return "";
    }
  }

  async function splitWeeklyText(rawText) {
    const text = String(rawText || "").trim();
    if (!text) return { notes: "", actions: "", usedGemini: false, error: null };

    if (!isEnabled()) {
      const split = heuristicSplit(text);
      return { ...split, usedGemini: false, error: null };
    }

    const systemPrompt = `Tu es un rédacteur expert de comptes-rendus de réunion (projet data / Looker) en français.

À partir du texte brut collé, produis un JSON avec deux champs :

1) "notesMarkdown" — le compte-rendu restructuré, SANS aucune tâche/action/todo.
   Règles de mise en forme (applique-les intelligemment selon le contenu) :
   - Découpe en 2 à 5 sections thématiques avec titres ## (ex. Contexte, Points discutés, Décisions, Risques, Arbitrages)
   - Utilise des listes à puces (- ) quand plusieurs éléments courts appartiennent au même sujet
   - Utilise des paragraphes (texte simple) pour le récit continu ou les explications longues
   - Mets en **gras** les décisions importantes et les chiffres/dates clés
   - Ne sur-structure pas : une liste à puces vaut mieux qu'un paragraphe dense
   - Reste fidèle au contenu source, n'invente rien

2) "actions" — tableau de strings (PAS un seul bloc de texte).
   Chaque string = une tâche concrète distincte.
   Inclus les actions explicites ET implicites du texte entier.
   Format : verbe d'action + objet ; responsable entre parenthèses si connu.
   Exemple : ["Valider le modèle LookML (Simon)", "Planifier la revue IAM"]

IMPORTANT : si le texte source mentionne des tâches, engagements ou prochaines étapes, "actions" ne doit PAS être vide.

Réponds UNIQUEMENT en JSON: {"notesMarkdown":"...","actions":["..."]}`;

    try {
      const result = await generateJson(systemPrompt, text);
      let notes = String(result.notesMarkdown || result.notes || "").trim();
      let actions = normalizeActionsField(result.actions || result.actionItems || result.todos);

      if (!actions) {
        actions = await extractActionsFromText(text);
      }
      if (!actions) {
        actions = await extractActionsFromText(`${notes}\n\n${text}`);
      }
      if (!actions) {
        const fallback = heuristicSplit(text);
        if (!notes) notes = fallback.notes;
        actions = fallback.actions || "";
      }

      return { notes, actions, usedGemini: true, error: null };
    } catch {
      const fallback = heuristicSplit(text);
      return {
        ...fallback,
        usedGemini: false,
        error: lastError || "Erreur API Gemini",
      };
    }
  }

  const VALID_PHASE_IDS = new Set([
    "project-mgmt",
    "infra",
    "governance",
    "lookml",
    "cicd",
    "content",
    "adoption",
    "platform",
  ]);

  function phaseCatalogText() {
    const phases = window.CHECKLIST_DATA?.PHASES || [];
    return phases.map((p) => `- "${p.id}": ${p.title}`).join("\n");
  }

  function normalizePhaseId(value) {
    return VALID_PHASE_IDS.has(value) ? value : "project-mgmt";
  }

  function normalizeGeminiItem(item) {
    const status = item.status || "new";
    const allowed = [
      "new",
      "duplicate-todo",
      "duplicate-checklist",
      "similar-todo",
      "similar-checklist",
    ];
    return {
      text: String(item.text || item.action || item.title || "").trim(),
      status: allowed.includes(status) ? status : "new",
      matchTitle: item.matchTitle ? String(item.matchTitle) : undefined,
      matchId: item.matchId ? String(item.matchId) : undefined,
      score: typeof item.score === "number" ? item.score : 0,
      phaseId: item.phaseId
        ? normalizePhaseId(item.phaseId)
        : window.ActionMatcher?.guessPhaseId?.(item.text, item.description) || "project-mgmt",
      description: String(item.description || "").trim(),
      verify: String(item.verify || "").trim(),
      setup: String(item.setup || "").trim(),
    };
  }

  function baselineActions(text) {
    const parsed = window.ActionMatcher.parseActionsText(text);
    if (parsed.length) return parsed;
    return text
      .split(/\n+/)
      .map((line) => line.replace(/^[-*•–—]\s+/, "").trim())
      .filter((line) => line.length >= 3);
  }

  async function analyzeActions(actionsText, catalogs) {
    let text = String(actionsText || "").trim();
    if (!text) return [];

    const todos = catalogs?.todos || [];
    const checklistItems = catalogs?.checklistItems || [];

    let lines = baselineActions(text);
    if (!lines.length && isEnabled()) {
      const extracted = await extractActionsFromText(text);
      text = extracted || text;
      lines = baselineActions(text);
    }

    if (!lines.length) return [];

    const actionsBlock = lines.map((l) => `- ${l}`).join("\n");

    if (!isEnabled()) {
      return window.ActionMatcher.analyzeActions(actionsBlock, catalogs);
    }

    const todoList = todos.map((t) => ({ id: t.id, title: t.title, done: !!t.done }));
    const checklistList = checklistItems.map((i) => ({
      id: i.id,
      title: i.title,
      category: i.category,
    }));

    const systemPrompt = `Tu analyses des actions issues d'un compte-rendu weekly (projet Looker / data).
Voici ${lines.length} action(s) déjà extraites — compare chacune avec les todos et la checklist existantes.

Todos existantes:
${JSON.stringify(todoList)}

Checklist existante:
${JSON.stringify(checklistList)}

Actions à analyser (une par ligne) :
${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}

Pour CHAQUE action (même nombre d'entrées que la liste), retourne un objet dans "items":
- "text": reformulation claire si besoin, sinon identique
- "status": "new" | "duplicate-todo" | "duplicate-checklist" | "similar-todo" | "similar-checklist"
- "matchTitle": si status != "new"
- "matchId": si connu
- "score": 0 à 1
- "phaseId": phase du projet Looker la plus pertinente parmi:
${phaseCatalogText()}
- "description": contexte court (optionnel)
- "verify": comment vérifier (optionnel)
- "setup": comment mettre en place (optionnel)

Réponds UNIQUEMENT en JSON: {"items":[...]}`;

    try {
      const result = await generateJson(systemPrompt, actionsBlock);
      let items = Array.isArray(result.items) ? result.items : [];
      if (!items.length && Array.isArray(result.actions)) {
        items = result.actions.map((action) => ({
          text: typeof action === "string" ? action : action.text,
          status: "new",
        }));
      }
      const normalized = items.map(normalizeGeminiItem).filter((i) => i.text.length >= 3);
      if (normalized.length) return normalized;
    } catch {
      // fallback below
    }

    return window.ActionMatcher.analyzeActions(actionsBlock, catalogs);
  }

  async function categorizeTasks(items) {
    const list = (items || [])
      .map((item) => ({
        title: String(item.title || item.text || "").trim(),
        description: String(item.description || "").trim(),
      }))
      .filter((item) => item.title);

    if (!list.length) return [];

    if (!isEnabled()) {
      return list.map((item) => ({
        phaseId: window.ActionMatcher.guessPhaseId(item.title, item.description),
        priority: "medium",
      }));
    }

    const systemPrompt = `Tu classes des tâches d'un projet Looker / data en français.
Pour chaque tâche, choisis la phase la plus pertinente parmi:
${phaseCatalogText()}

Réponds UNIQUEMENT en JSON:
{"items":[{"phaseId":"...", "priority":"critical|high|medium", "reason":"..."}]}
Même nombre d'entrées que la liste fournie.`;

    const userContent = list
      .map((item, index) => `${index + 1}. ${item.title}${item.description ? ` — ${item.description}` : ""}`)
      .join("\n");

    try {
      const result = await generateJson(systemPrompt, userContent);
      const rows = Array.isArray(result.items) ? result.items : [];
      return list.map((item, index) => {
        const row = rows[index] || {};
        return {
          phaseId: normalizePhaseId(row.phaseId) || window.ActionMatcher.guessPhaseId(item.title, item.description),
          priority: ["critical", "high", "medium"].includes(row.priority) ? row.priority : "medium",
          reason: row.reason ? String(row.reason) : "",
        };
      });
    } catch {
      return list.map((item) => ({
        phaseId: window.ActionMatcher.guessPhaseId(item.title, item.description),
        priority: "medium",
      }));
    }
  }

  window.GeminiClient = {
    isEnabled,
    getLastError,
    getLastModelUsed,
    splitWeeklyText,
    analyzeActions,
    categorizeTasks,
    extractActionsFromText,
    heuristicSplit,
  };
})();
