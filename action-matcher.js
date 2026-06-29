(function () {
  const STOP_WORDS = new Set([
    "le", "la", "les", "un", "une", "des", "de", "du", "d", "l", "et", "ou", "a", "à",
    "en", "pour", "par", "sur", "avec", "dans", "ce", "cette", "ces", "son", "sa", "ses",
    "notre", "nos", "leur", "leurs", "il", "elle", "on", "nous", "vous", "ils", "elles",
    "est", "sont", "être", "faire", "fait", "faire", "mettre", "ajouter", "voir", "valider",
    "the", "to", "and", "or", "of", "in", "on", "for", "with",
  ]);

  function removeAccents(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function normalizeText(str) {
    return removeAccents(String(str || "").toLowerCase())
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenize(str) {
    return normalizeText(str)
      .split(" ")
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
  }

  function jaccard(a, b) {
    const setA = new Set(tokenize(a));
    const setB = new Set(tokenize(b));
    if (!setA.size || !setB.size) return 0;
    let inter = 0;
    setA.forEach((t) => {
      if (setB.has(t)) inter += 1;
    });
    return inter / (setA.size + setB.size - inter);
  }

  function similarityScore(a, b) {
    const na = normalizeText(a);
    const nb = normalizeText(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    if (na.includes(nb) || nb.includes(na)) return 0.92;

    const tokensA = tokenize(a);
    const tokensB = tokenize(b);
    const shared = tokensA.filter((t) => tokensB.includes(t));
    const j = jaccard(a, b);

    let score = j;
    if (shared.length >= 3) score = Math.max(score, 0.75 + shared.length * 0.04);
    if (shared.length >= 2 && j >= 0.35) score = Math.max(score, 0.68);

    const keyTerms = [
      "looker", "gcp", "bigquery", "bq", "dataform", "converteo", "lookml",
      "sso", "iam", "weekly", "documentation", "gouvernance", "explore", "dashboard",
    ];
    const keyShared = keyTerms.filter(
      (k) => na.includes(k) && nb.includes(k)
    ).length;
    if (keyShared >= 2) score = Math.max(score, 0.72);

    return Math.min(score, 1);
  }

  function parseActionsText(text) {
    if (!text || !text.trim()) return [];

    const lines = text
      .split(/\n+/)
      .flatMap((line) => {
        const trimmed = line.trim();
        if (!trimmed) return [];
        if (/^#{1,3}\s+/.test(trimmed)) return [];
        if (/^[-*•–—]\s+/.test(trimmed)) return [trimmed.replace(/^[-*•–—]\s+/, "")];
        if (/^\d+[.)]\s+/.test(trimmed)) return [trimmed.replace(/^\d+[.)]\s+/, "")];
        if (/^(action|todo|à faire|prochaine étape)\s*:\s*/i.test(trimmed)) {
          return [trimmed.replace(/^(action|todo|à faire|prochaine étape)\s*:\s*/i, "")];
        }
        if (trimmed.includes(";")) {
          return trimmed
            .split(";")
            .map((p) => p.trim())
            .filter(Boolean);
        }
        return [trimmed];
      })
      .map((s) => s.replace(/^[-*•–—]\s+/, "").replace(/\*\*/g, "").trim())
      .filter((s) => s.length >= 3);

    const seen = new Set();
    return lines.filter((line) => {
      const key = normalizeText(line);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function hashActions(text) {
    return normalizeText(text);
  }

  /**
   * @param {string} actionText
   * @param {{ todos: object[], checklistItems: object[] }} catalogs
   * @returns {{ text, status, matchTitle?, matchId?, score? }[]}
   */
  function analyzeActions(actionText, catalogs) {
    const todos = catalogs.todos || [];
    const checklistItems = catalogs.checklistItems || [];
    const parsed = parseActionsText(actionText);

    return parsed.map((text) => {
      let bestTodo = { score: 0, item: null };
      todos.forEach((todo) => {
        const score = similarityScore(text, todo.title);
        if (score > bestTodo.score) bestTodo = { score, item: todo };
      });

      let bestChecklist = { score: 0, item: null };
      checklistItems.forEach((item) => {
        const combined = `${item.title} ${item.description || ""}`;
        const score = Math.max(
          similarityScore(text, item.title),
          similarityScore(text, combined) * 0.95
        );
        if (score > bestChecklist.score) bestChecklist = { score, item };
      });

      const DUPLICATE_THRESHOLD = 0.82;
      const SIMILAR_THRESHOLD = 0.55;

      if (bestTodo.score >= DUPLICATE_THRESHOLD) {
        return {
          text,
          status: "duplicate-todo",
          matchTitle: bestTodo.item.title,
          matchId: bestTodo.item.id,
          score: bestTodo.score,
        };
      }

      if (bestChecklist.score >= DUPLICATE_THRESHOLD) {
        return {
          text,
          status: "duplicate-checklist",
          matchTitle: bestChecklist.item.title,
          matchId: bestChecklist.item.id,
          score: bestChecklist.score,
        };
      }

      if (bestTodo.score >= SIMILAR_THRESHOLD || bestChecklist.score >= SIMILAR_THRESHOLD) {
        const useTodo = bestTodo.score >= bestChecklist.score;
        const match = useTodo ? bestTodo : bestChecklist;
        return {
          text,
          status: useTodo ? "similar-todo" : "similar-checklist",
          matchTitle: match.item.title,
          matchId: match.item.id,
          score: match.score,
        };
      }

      return { text, status: "new", score: 0 };
    });
  }

  window.ActionMatcher = {
    parseActionsText,
    analyzeActions,
    hashActions,
    similarityScore,
    normalizeText,
  };
})();
