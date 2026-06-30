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
      const healthRes = await fetch(`${proxyUrl()}/health`);
      if (healthRes.ok) {
        const health = await healthRes.json().catch(() => ({}));
        if (health.notebooklm === false || health.notebooklm === undefined) {
          const statusRes = await fetch(`${proxyUrl()}/v1/notebooklm/status`);
          if (statusRes.status === 404) {
            return { ok: false, configured: false, reason: "proxy_outdated" };
          }
        }
      }

      const res = await fetch(`${proxyUrl()}/v1/notebooklm/status`);
      if (res.status === 404) {
        return { ok: false, configured: false, reason: "proxy_outdated" };
      }
      if (!res.ok) return { ok: false, configured: false, reason: "status_error", status: res.status };
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
