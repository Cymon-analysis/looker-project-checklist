import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const canvasPath = path.join(__dirname, "..", "canvases", "looker-project-checklist.canvas.tsx");
const content = fs.readFileSync(canvasPath, "utf8");

const itemsMatch = content.match(/const ITEMS: readonly ChecklistItem\[\] = (\[[\s\S]*?\n\]);/);
const phasesMatch = content.match(/const PHASES = (\[[\s\S]*?\]) as const;/);

if (!itemsMatch || !phasesMatch) {
  console.error("Could not parse canvas data");
  process.exit(1);
}

const itemsRaw = itemsMatch[1];
const phasesRaw = phasesMatch[1].replace(/ as const/g, "");
const ITEMS = eval(itemsRaw);
const PHASES = eval(phasesRaw);

const PRIORITY_LABEL = { critical: "Critique", high: "Haute", medium: "Moyenne" };
const PHASE_COLORS = {
  "project-mgmt": "#2a9d8f",
  infra: "#e85d75",
  governance: "#e8913a",
  lookml: "#9b6dd7",
  cicd: "#4a8fd4",
  content: "#4caf7d",
  adoption: "#d4b43a",
  platform: "#8a8a96",
};

const dataJs = `// Généré automatiquement — ne pas modifier à la main
window.CHECKLIST_DATA = ${JSON.stringify({ PHASES, ITEMS, PRIORITY_LABEL, PHASE_COLORS }, null, 0)};
`;

fs.writeFileSync(path.join(__dirname, "data.js"), dataJs, "utf8");
console.log("Generated data.js with", ITEMS.length, "items");
