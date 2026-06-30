const express = require("express");
const cors = require("cors");
const { GoogleAuth } = require("google-auth-library");

const app = express();
app.use(express.json({ limit: "2mb" }));

const PROJECT_ID = process.env.GCP_PROJECT_ID || "lab-fileparser";
const LOCATION = process.env.GCP_LOCATION || "europe-west1";
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://cymon-analysis.github.io";
const PROXY_SECRET = process.env.GEMINI_PROXY_SECRET || "";
const ALLOWED_EMAIL_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || "converteo.com").toLowerCase();

const MODEL_FALLBACKS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash-lite",
];

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

const corsOptions = {
  origin(origin, callback) {
    if (!origin || origin === ALLOWED_ORIGIN || origin.startsWith(ALLOWED_ORIGIN)) {
      callback(null, true);
      return;
    }
    callback(new Error("CORS not allowed"));
  },
  allowedHeaders: ["Content-Type", "Authorization", "X-Gemini-Proxy-Secret"],
};

app.use(cors(corsOptions));

function vertexUrl(model) {
  return `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${model}:generateContent`;
}

async function callVertex(model, body) {
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("auth_failed");

  const res = await fetch(vertexUrl(model), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

function authBearer(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

async function googleFetch(url, userToken, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${userToken}`,
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(`google_api_${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

async function validateUserToken(userToken) {
  const info = await googleFetch("https://www.googleapis.com/oauth2/v3/userinfo", userToken);
  const email = String(info.email || "").toLowerCase();
  const domain = email.split("@")[1] || "";
  if (domain !== ALLOWED_EMAIL_DOMAIN) {
    const err = new Error("domain_not_allowed");
    err.email = email;
    throw err;
  }
  return info;
}

function extractDriveFileId(url) {
  const raw = String(url || "");
  const dMatch = raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (dMatch) return dMatch[1];
  const idMatch = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return idMatch?.[1] || null;
}

function isGeminiNotesAttachment(attachment) {
  const title = String(attachment?.title || attachment?.fileTitle || "").toLowerCase();
  return (
    title.includes("notes by gemini") ||
    title.includes("notes gemini") ||
    title.includes("gemini notes")
  );
}

function formatAttendees(attendees) {
  return (attendees || [])
    .filter((a) => !a.self && !a.resource)
    .map((a) => {
      const name = (a.displayName || "").trim();
      const email = (a.email || "").trim();
      if (name && email) return `${name} (${email})`;
      return name || email;
    })
    .filter(Boolean);
}

function eventDateIso(event) {
  const start = event?.start?.dateTime || event?.start?.date;
  if (!start) return "";
  return start.slice(0, 10);
}

async function exportDriveDocPlainText(userToken, fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent("text/plain")}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  if (!res.ok) {
    const err = new Error(`drive_export_${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

async function fetchGeminiNotesText(userToken, event) {
  const attachments = event.attachments || [];
  const geminiAttachment = attachments.find(isGeminiNotesAttachment);
  if (!geminiAttachment) return { text: "", source: null };

  const fileId =
    geminiAttachment.fileId ||
    extractDriveFileId(geminiAttachment.fileUrl) ||
    extractDriveFileId(geminiAttachment.url);

  if (!fileId) return { text: "", source: geminiAttachment.title || "Notes Gemini" };

  try {
    const text = await exportDriveDocPlainText(userToken, fileId);
    return { text: text.trim(), source: geminiAttachment.title || "Notes by Gemini", fileId };
  } catch {
    return { text: "", source: geminiAttachment.title || "Notes by Gemini", fileId };
  }
}

function meetingSummary(event) {
  const attachments = event.attachments || [];
  return {
    id: event.id,
    title: event.summary || "(Sans titre)",
    start: event.start?.dateTime || event.start?.date || "",
    end: event.end?.dateTime || event.end?.date || "",
    date: eventDateIso(event),
    participants: formatAttendees(event.attendees),
    hasGeminiNotes: attachments.some(isGeminiNotesAttachment),
    htmlLink: event.htmlLink || "",
    attachments: attachments.map((a) => ({
      title: a.title || a.fileTitle || "",
      url: a.fileUrl || a.url || "",
    })),
  };
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    project: PROJECT_ID,
    location: LOCATION,
    calendar: true,
    allowedDomain: ALLOWED_EMAIL_DOMAIN,
  });
});

app.post("/v1/generate", async (req, res) => {
  if (PROXY_SECRET && req.headers["x-gemini-proxy-secret"] !== PROXY_SECRET) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { systemPrompt, userContent, model, responseMimeType, temperature } = req.body || {};
  if (!systemPrompt || !userContent) {
    res.status(400).json({ error: "systemPrompt and userContent are required" });
    return;
  }

  const preferred = model || DEFAULT_MODEL;
  const candidates = [preferred, ...MODEL_FALLBACKS].filter((m, i, arr) => arr.indexOf(m) === i);

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: `${systemPrompt}\n\n---\n\n${userContent}` }],
      },
    ],
    generationConfig: {
      temperature: typeof temperature === "number" ? temperature : 0.1,
      ...(responseMimeType ? { responseMimeType } : {}),
    },
  };

  let lastStatus = 500;
  let lastBody = "";

  for (const modelId of candidates) {
    try {
      const result = await callVertex(modelId, payload);
      lastStatus = result.status;
      lastBody = result.text;

      if (!result.ok) {
        if ([404, 429, 503].includes(result.status)) continue;
        res.status(result.status).type("application/json").send(result.text);
        return;
      }

      const data = JSON.parse(result.text);
      const responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!responseText) continue;

      res.json({ model: modelId, candidates: data.candidates });
      return;
    } catch (err) {
      lastBody = String(err.message || err);
    }
  }

  res.status(lastStatus).json({
    error: "vertex_all_models_failed",
    message: lastBody.slice(0, 300),
  });
});

app.get("/v1/calendar/me", async (req, res) => {
  const userToken = authBearer(req);
  if (!userToken) {
    res.status(401).json({ error: "missing_token" });
    return;
  }

  try {
    const user = await validateUserToken(userToken);
    res.json({ email: user.email, name: user.name, domain: ALLOWED_EMAIL_DOMAIN });
  } catch (err) {
    if (err.message === "domain_not_allowed") {
      res.status(403).json({ error: "domain_not_allowed", email: err.email });
      return;
    }
    res.status(err.status || 500).json({ error: err.message, details: err.body });
  }
});

app.get("/v1/calendar/meetings", async (req, res) => {
  const userToken = authBearer(req);
  if (!userToken) {
    res.status(401).json({ error: "missing_token" });
    return;
  }

  try {
    await validateUserToken(userToken);

    const daysBack = Math.min(Number(req.query.daysBack) || 90, 180);
    const timeMin = new Date(Date.now() - daysBack * 86400000).toISOString();
    const timeMax = new Date(Date.now() + 14 * 86400000).toISOString();

    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      q: "Weavenn",
      maxResults: "40",
    });
    params.set(
      "fields",
      "items(id,summary,start,end,attendees,attachments,description,htmlLink)"
    );

    const data = await googleFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      userToken
    );

    const meetings = (data.items || [])
      .filter((event) => String(event.summary || "").toLowerCase().includes("weavenn"))
      .map(meetingSummary)
      .sort((a, b) => String(b.start).localeCompare(String(a.start)));

    res.json({ meetings, count: meetings.length });
  } catch (err) {
    if (err.message === "domain_not_allowed") {
      res.status(403).json({ error: "domain_not_allowed", email: err.email });
      return;
    }
    res.status(err.status || 500).json({ error: err.message, details: err.body });
  }
});

app.get("/v1/calendar/events/:eventId", async (req, res) => {
  const userToken = authBearer(req);
  if (!userToken) {
    res.status(401).json({ error: "missing_token" });
    return;
  }

  try {
    await validateUserToken(userToken);
    const eventId = encodeURIComponent(req.params.eventId);

    const event = await googleFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}?fields=id,summary,start,end,attendees,attachments,description,htmlLink`,
      userToken
    );

    if (!String(event.summary || "").toLowerCase().includes("weavenn")) {
      res.status(400).json({ error: "not_weavenn_meeting" });
      return;
    }

    const notes = await fetchGeminiNotesText(userToken, event);
    const description = String(event.description || "").trim();
    const participants = formatAttendees(event.attendees);

    let rawText = notes.text;
    if (!rawText && description) rawText = description;
    if (!rawText) {
      rawText = [
        `Réunion : ${event.summary || ""}`,
        participants.length ? `Participants : ${participants.join(", ")}` : "",
        description,
      ]
        .filter(Boolean)
        .join("\n\n");
    }

    res.json({
      id: event.id,
      title: event.summary || "",
      date: eventDateIso(event),
      start: event.start?.dateTime || event.start?.date || "",
      participants,
      rawText,
      notesSource: notes.source,
      hasGeminiNotes: Boolean(notes.text),
      htmlLink: event.htmlLink || "",
    });
  } catch (err) {
    if (err.message === "domain_not_allowed") {
      res.status(403).json({ error: "domain_not_allowed", email: err.email });
      return;
    }
    res.status(err.status || 500).json({ error: err.message, details: err.body });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  console.log(`Gemini proxy listening on ${port} (${PROJECT_ID}/${LOCATION})`);
});
