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

app.get("/health", (_req, res) => {
  res.json({ ok: true, project: PROJECT_ID, location: LOCATION });
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

const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  console.log(`Gemini proxy listening on ${port} (${PROJECT_ID}/${LOCATION})`);
});
