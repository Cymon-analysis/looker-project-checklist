(function () {
  const TOKEN_KEY = "looker-calendar-access-token";
  const EXPIRY_KEY = "looker-calendar-token-expiry";
  const EMAIL_KEY = "looker-calendar-user-email";

  const SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
  ].join(" ");

  function cfg() {
    return window.GEMINI_CONFIG || {};
  }

  function resolveConfig() {
    const c = cfg();
    let proxyUrl = String(c.proxyUrl || "").trim().replace(/\/$/, "");
    let apiKey = String(c.apiKey || "").trim();
    if (!proxyUrl && /^https?:\/\//i.test(apiKey)) {
      proxyUrl = apiKey.replace(/\/$/, "");
      apiKey = "";
    }
    return {
      ...c,
      proxyUrl,
      apiKey,
      googleOAuthClientId: String(c.googleOAuthClientId || "").trim(),
    };
  }

  function getSetupStatus() {
    const c = resolveConfig();
    return {
      hasClientId: Boolean(c.googleOAuthClientId),
      hasProxyUrl: Boolean(c.proxyUrl),
      proxyUrl: c.proxyUrl,
    };
  }

  async function checkProxyHealth() {
    const c = resolveConfig();
    if (!c.proxyUrl) return { ok: false, reason: "no_proxy_url" };
    try {
      const res = await fetch(`${c.proxyUrl}/health`);
      if (!res.ok) return { ok: false, reason: "proxy_error", status: res.status };
      const data = await res.json();
      return { ok: true, calendar: Boolean(data.calendar), data };
    } catch {
      return { ok: false, reason: "proxy_unreachable" };
    }
  }

  function proxyUrl() {
    return resolveConfig().proxyUrl;
  }

  function clientId() {
    return resolveConfig().googleOAuthClientId;
  }

  function isConfigured() {
    const c = resolveConfig();
    return Boolean(c.proxyUrl && c.googleOAuthClientId);
  }

  function getStoredToken() {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const expiry = Number(sessionStorage.getItem(EXPIRY_KEY) || 0);
    if (!token || Date.now() > expiry - 60_000) return null;
    return token;
  }

  function storeToken(accessToken, expiresInSeconds) {
    sessionStorage.setItem(TOKEN_KEY, accessToken);
    sessionStorage.setItem(
      EXPIRY_KEY,
      String(Date.now() + (expiresInSeconds || 3600) * 1000)
    );
  }

  function getConnectedEmail() {
    return sessionStorage.getItem(EMAIL_KEY) || "";
  }

  function isConnected() {
    return Boolean(getStoredToken());
  }

  function disconnect() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(EXPIRY_KEY);
    sessionStorage.removeItem(EMAIL_KEY);
  }

  function waitForGoogleIdentity() {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) {
        resolve();
        return;
      }
      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        if (window.google?.accounts?.oauth2) {
          clearInterval(timer);
          resolve();
        } else if (attempts > 50) {
          clearInterval(timer);
          reject(new Error("google_identity_not_loaded"));
        }
      }, 100);
    });
  }

  async function verifyConnection() {
    try {
      const me = await apiFetch("/v1/calendar/me", { disconnectOn401: false });
      sessionStorage.setItem(EMAIL_KEY, me.email || "");
      return me;
    } catch {
      await apiFetch("/v1/calendar/meetings?daysBack=1", { disconnectOn401: false });
      sessionStorage.setItem(EMAIL_KEY, "");
      return { email: "" };
    }
  }

  async function connect() {
    if (!isConfigured()) throw new Error("calendar_not_configured");
    await waitForGoogleIdentity();

    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId(),
        scope: SCOPES,
        callback: async (response) => {
          if (response.error) {
            reject(new Error(response.error));
            return;
          }
          if (!response.access_token) {
            reject(new Error("no_access_token"));
            return;
          }
          storeToken(response.access_token, response.expires_in);
          try {
            resolve(await verifyConnection());
          } catch (err) {
            disconnect();
            reject(err);
          }
        },
      });
      client.requestAccessToken({ prompt: "consent" });
    });
  }

  async function ensureConnected() {
    if (getStoredToken()) {
      try {
        return await verifyConnection();
      } catch (err) {
        if (["token_expired", "invalid_token", "missing_token", "google_api_401"].includes(err.message)) {
          disconnect();
        } else {
          throw err;
        }
      }
    }
    return connect();
  }

  async function apiFetch(path, options = {}) {
    const { disconnectOn401 = true, ...fetchOptions } = options;
    const token = getStoredToken();
    if (!token) throw new Error("not_connected");

    const headers = {
      ...(fetchOptions.headers || {}),
      Authorization: `Bearer ${token}`,
    };
    const resolved = resolveConfig();
    if (resolved.proxySecret) {
      headers["X-Gemini-Proxy-Secret"] = resolved.proxySecret;
    }

    const res = await fetch(`${proxyUrl()}${path}`, {
      ...fetchOptions,
      headers,
    });

    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      const err = new Error(data.error || "token_expired");
      err.status = 401;
      err.details = data;
      if (disconnectOn401) disconnect();
      throw err;
    }

    if (!res.ok) {
      const err = new Error(data.error || `calendar_http_${res.status}`);
      err.status = res.status;
      err.details = data;
      throw err;
    }
    return data;
  }

  async function listMeetings(daysBack = 90) {
    await ensureConnected();
    return apiFetch(`/v1/calendar/meetings?daysBack=${daysBack}`);
  }

  async function fetchMeeting(eventId) {
    await ensureConnected();
    return apiFetch(`/v1/calendar/events/${encodeURIComponent(eventId)}`);
  }

  window.CalendarClient = {
    isConfigured,
    getSetupStatus,
    checkProxyHealth,
    isConnected,
    getConnectedEmail,
    connect,
    ensureConnected,
    disconnect,
    listMeetings,
    fetchMeeting,
  };
})();
