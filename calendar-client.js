(function () {
  const TOKEN_KEY = "looker-calendar-access-token";
  const EXPIRY_KEY = "looker-calendar-token-expiry";
  const EMAIL_KEY = "looker-calendar-user-email";

  const SCOPES = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
  ].join(" ");

  function cfg() {
    return window.GEMINI_CONFIG || {};
  }

  function proxyUrl() {
    return String(cfg().proxyUrl || "").replace(/\/$/, "");
  }

  function clientId() {
    return String(cfg().googleOAuthClientId || "").trim();
  }

  function isConfigured() {
    return Boolean(proxyUrl() && clientId());
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

  async function connect() {
    if (!isConfigured()) throw new Error("calendar_not_configured");
    await waitForGoogleIdentity();

    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId(),
        scope: SCOPES,
        hd: "converteo.com",
        callback: async (response) => {
          if (response.error) {
            reject(new Error(response.error));
            return;
          }
          storeToken(response.access_token, response.expires_in);
          try {
            const me = await apiFetch("/v1/calendar/me");
            sessionStorage.setItem(EMAIL_KEY, me.email || "");
            resolve(me);
          } catch (err) {
            disconnect();
            reject(err);
          }
        },
      });
      client.requestAccessToken({ prompt: "select_account" });
    });
  }

  async function ensureConnected() {
    if (getStoredToken()) {
      try {
        const me = await apiFetch("/v1/calendar/me");
        sessionStorage.setItem(EMAIL_KEY, me.email || "");
        return me;
      } catch (err) {
        if (err.message === "token_expired" || err.message === "calendar_http_401") {
          disconnect();
        } else {
          throw err;
        }
      }
    }
    return connect();
  }

  async function apiFetch(path, options = {}) {
    const token = getStoredToken();
    if (!token) throw new Error("not_connected");

    const headers = {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    };
    if (cfg().proxySecret) {
      headers["X-Gemini-Proxy-Secret"] = cfg().proxySecret;
    }

    const res = await fetch(`${proxyUrl()}${path}`, {
      ...options,
      headers,
    });

    if (res.status === 401) {
      disconnect();
      throw new Error("token_expired");
    }

    const data = await res.json().catch(() => ({}));
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
    isConnected,
    getConnectedEmail,
    connect,
    ensureConnected,
    disconnect,
    listMeetings,
    fetchMeeting,
  };
})();
