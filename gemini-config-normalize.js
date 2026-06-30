(function () {
  const cfg = window.GEMINI_CONFIG;
  if (!cfg || typeof cfg !== "object") return;

  const apiKey = String(cfg.apiKey || "").trim();
  const proxyUrl = String(cfg.proxyUrl || "").trim();

  // Corrige la config si l'URL du proxy a été mise dans GEMINI_API_KEY par erreur.
  if (!proxyUrl && /^https?:\/\//i.test(apiKey)) {
    cfg.proxyUrl = apiKey.replace(/\/$/, "");
    cfg.apiKey = "";
    cfg.mode = "vertex-proxy";
  }

  if (cfg.proxyUrl) {
    cfg.proxyUrl = String(cfg.proxyUrl).replace(/\/$/, "");
    if (!cfg.mode || cfg.mode === "api-key") cfg.mode = "vertex-proxy";
  }

  cfg.googleOAuthClientId = String(cfg.googleOAuthClientId || "").trim();
})();
