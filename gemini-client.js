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

  function heuristicSplit(rawText) {
    const text = String(rawText || "").trim();
    if (!text) return { notes: "", actions: "" };

    const patterns = [
      /\n(?:#{1,3}\s*)?(?:actions?|action items?|prochaines étapes|next steps|à faire|todo)\s*:?\s*\n/i,
      /\n(?:[-*]\s*)?(?:actions?|prochaines étapes)\s*:?\s*\n/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match.index != null) {
        return {
          notes: text.slice(0, match.index).trim(),
          actions: text.slice(match.index + match[0].length).trim(),
        };
      }
    }

    return { notes: text, actions: "" };
  }

  async function splitWeeklyText(rawText) {
    const text = String(rawText || "").trim();
    if (!text) return { notes: "", actions: "" };

    if (!isEnabled()) return heuristicSplit(text);

    const systemPrompt = `Tu es un assistant expert en comptes-rendus de réunion en français.
À partir du texte brut d'une weekly, sépare le contenu en deux champs JSON:

- "notes": tout ce qui s'est dit (contexte, discussion, décisions, points abordés, risques, arbitrages). N'inclus PAS les actions à mener.
- "actions": uniquement les actions concrètes et prochaines étapes. Une action par ligne dans le texte (puces ou numérotation acceptées). Formulation claire et actionnable.

Si le texte ne contient aucune action explicite, renvoie "actions" vide.
Réponds UNIQUEMENT en JSON: {"notes":"...","actions":"..."}`;

    try {
      const result = await generateJson(systemPrompt, text);
      return {
        notes: String(result.notes || "").trim(),
        actions: String(result.actions || "").trim(),
      };
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
      const items = Array.isArray(result.items) ? result.items : [];
      if (!items.length) return window.ActionMatcher.analyzeActions(text, catalogs);
      return items.map(normalizeGeminiItem).filter((i) => i.text.length >= 3);
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
