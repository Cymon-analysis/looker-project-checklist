const res = await fetch(
  "https://cymon-analysis.github.io/looker-project-checklist/gemini-config.js"
);
const cfgText = await res.text();
const apiKey = cfgText.match(/"apiKey":\s*"([^"]*)"/)?.[1] || "";

const models = [
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
];

for (const m of models) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: "OK" }] }],
    }),
  });
  console.log(m, "->", r.status);
}
