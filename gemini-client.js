(function () {
  const CFG = () => window.GEMINI_CONFIG || { enabled: false, apiKey: "", model: "gemini-2.0-flash" };

  function isEnabled() {
    const c = CFG();
    return Boolean(c.enabled && c.apiKey);
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${c.model}:generateContent?key=${encodeURIComponent(c.apiKey)}`;
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
          temperature: 0.15,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`gemini_http_${res.status}: ${err.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("gemini_empty_response");
    return extractJson(text);
  }

  function normalizeActionsField(value) {
    if (Array.isArray(value)) {
      return value
        .map((v) => String(v).trim())
        .filter(Boolean)
        .map((a) => (a.match(/^[-*•–—]\s+/) ? a : `- ${a}`))
        .join("\n");
    }
    return String(value || "").trim();
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

    if (actionLines.length >= 2) {
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
    if (!source) return "";

    const systemPrompt = `Tu extrais les actions et prochaines étapes d'un compte-rendu de réunion en français.
Inclus les engagements explicites ET implicites :
- formulations du type "X va…", "il faut…", "à valider", "prochaine étape", "d'ici la semaine prochaine"
- puces ou numéros listant des tâches
- décisions qui impliquent une action concrète

Une action par ligne, format liste markdown avec tiret (- ).
Formulation courte, actionnable, à l'infinitif ou à l'impératif.
Si vraiment aucune action, renvoie {"actions":""}.
Réponds UNIQUEMENT en JSON: {"actions":"..."}`;

    try {
      const result = await generateJson(systemPrompt, source);
      return normalizeActionsField(result.actions);
    } catch {
      return "";
    }
  }

  async function splitWeeklyText(rawText) {
    const text = String(rawText || "").trim();
    if (!text) return { notes: "", actions: "" };

    if (!isEnabled()) return heuristicSplit(text);

    const systemPrompt = `Tu es un assistant expert en comptes-rendus de réunion en français (projet data / Looker).
À partir du texte brut d'une weekly, sépare le contenu en deux champs JSON:

- "notes": tout ce qui s'est dit (contexte, discussion, décisions, points abordés, risques, arbitrages).
  Formate en Markdown lisible : titres ## ou ###, listes à puces, **gras** pour les décisions importantes.
  N'inclus PAS les actions à mener dans ce champ.
- "actions": toutes les actions concrètes et prochaines étapes, y compris implicites
  ("Simon va…", "il faut…", "à faire", engagements, tâches en fin de CR).
  Une action par ligne, format liste markdown avec tiret (- ).
  Formulation courte, actionnable.

Si le texte ne contient vraiment aucune action, renvoie "actions" vide.
Réponds UNIQUEMENT en JSON: {"notes":"...","actions":"..."}`;

    try {
      const result = await generateJson(systemPrompt, text);
      let notes = String(result.notes || "").trim();
      let actions = normalizeActionsField(result.actions);

      if (!actions) {
        actions = await extractActionsFromText(`${notes}\n\n${text}`);
      }
      if (!actions) {
        const fallback = heuristicSplit(text);
        if (!notes) notes = fallback.notes;
        actions = fallback.actions || "";
      }

      return { notes, actions };
    } catch {
      return heuristicSplit(text);
    }
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
      text: String(item.text || "").trim(),
      status: allowed.includes(status) ? status : "new",
      matchTitle: item.matchTitle ? String(item.matchTitle) : undefined,
      matchId: item.matchId ? String(item.matchId) : undefined,
      score: typeof item.score === "number" ? item.score : 0,
    };
  }

  async function analyzeActions(actionsText, catalogs) {
    const text = String(actionsText || "").trim();
    if (!text) return [];

    const todos = catalogs?.todos || [];
    const checklistItems = catalogs?.checklistItems || [];

    if (!isEnabled()) {
      return window.ActionMatcher.analyzeActions(text, catalogs);
    }

    const todoList = todos.map((t) => ({ id: t.id, title: t.title, done: !!t.done }));
    const checklistList = checklistItems.map((i) => ({
      id: i.id,
      title: i.title,
      category: i.category,
    }));

    const systemPrompt = `Tu analyses des actions issues d'un compte-rendu weekly (projet Looker / data).
Le texte peut être une liste markdown (lignes commençant par - ou numérotées). Extrais CHAQUE ligne/action distincte.
Compare chaque action avec les todos existantes et la checklist, même si la formulation diffère (synonymes, abréviations, ordre des mots).

Todos existantes:
${JSON.stringify(todoList, null, 0)}

Checklist existante:
${JSON.stringify(checklistList, null, 0)}

Texte des actions du CR:
"""
${text}
"""

Pour CHAQUE action distincte détectée, retourne un objet dans "items":
- "text": formulation claire et concise de l'action (impératif ou infinitif)
- "status": un parmi "new", "duplicate-todo", "duplicate-checklist", "similar-todo", "similar-checklist"
  - duplicate-todo: même intention qu'une todo existante (même tâche, formulation différente)
  - duplicate-checklist: même intention qu'un point checklist existant
  - similar-todo / similar-checklist: proche mais pas exactement la même chose
  - new: vraiment nouvelle
- "matchTitle": titre de l'élément correspondant si status != "new"
- "matchId": id de l'élément correspondant si connu
- "score": confiance entre 0 et 1

Réponds UNIQUEMENT en JSON: {"items":[...]}`;

    try {
      const result = await generateJson(systemPrompt, text);
      let items = Array.isArray(result.items) ? result.items : [];
      if (!items.length && Array.isArray(result.actions)) {
        items = result.actions.map((action) => ({ text: action, status: "new" }));
      }
      const normalized = items.map(normalizeGeminiItem).filter((i) => i.text.length >= 3);
      if (!normalized.length) return window.ActionMatcher.analyzeActions(text, catalogs);
      return normalized;
    } catch {
      return window.ActionMatcher.analyzeActions(text, catalogs);
    }
  }

  window.GeminiClient = {
    isEnabled,
    splitWeeklyText,
    analyzeActions,
    heuristicSplit,
  };
})();
