(function () {
  function cfg() {
    return window.GEMINI_CONFIG || {};
  }

  function proxyUrl() {
    return String(cfg().proxyUrl || "").trim().replace(/\/$/, "");
  }

  function isConfigured() {
    return Boolean(proxyUrl() && cfg().enabled);
  }

  async function checkStatus() {
    if (!proxyUrl()) return { ok: false, configured: false, reason: "no_proxy" };
    try {
      const res = await fetch(`${proxyUrl()}/v1/notebooklm/status`);
      if (!res.ok) return { ok: false, configured: false, reason: "status_error" };
      return await res.json();
    } catch {
      return { ok: false, configured: false, reason: "unreachable" };
    }
  }

  async function enrichTasks({ sources, tasks, catalogs, projectName }) {
    if (!isConfigured()) throw new Error("notebooklm_not_configured");

    const headers = { "Content-Type": "application/json" };
    if (cfg().proxySecret) headers["X-Gemini-Proxy-Secret"] = cfg().proxySecret;

    const res = await fetch(`${proxyUrl()}/v1/notebooklm/enrich`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sources: sources || [],
        tasks: tasks || [],
        catalogs: catalogs || {},
        projectName: projectName || "",
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `notebooklm_http_${res.status}`);
      err.status = res.status;
      err.details = data;
      throw err;
    }
    return data;
  }

  window.NotebookLMClient = {
    isConfigured,
    checkStatus,
    enrichTasks,
  };
})();
