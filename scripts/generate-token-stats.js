#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const inputPath = process.argv[2] ?? "response.json";
const outputPath = process.argv[3] ?? "assets/token-usage.svg";

function fail(message) {
  console.error(`token-stats: ${message}`);
  process.exit(1);
}

function number(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) fail(`missing or invalid ${label}`);
  return parsed;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function compact(value) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000_000 ? 2 : 1,
  }).format(value);
}

function monthLabel(value) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    timeZone: "UTC",
  }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

let data;
try {
  data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
} catch (error) {
  fail(`cannot read ${inputPath}: ${error.message}`);
}

const summary = data.historyPreview?.summary ?? {};
const allTime = data.periods?.allTime ?? {};
const months = data.historyPreview?.monthly;

if (!Array.isArray(months) || months.length === 0) {
  fail("historyPreview.monthly must contain at least one entry");
}

const totalTokens = number(
  summary.totalTokens ?? allTime.totalTokens,
  "all-time token total",
);
const updatedAt = new Date(data.updatedAt);
if (Number.isNaN(updatedAt.valueOf())) fail("missing or invalid updatedAt");

const series = months.map((entry) => ({
  month: escapeXml(monthLabel(String(entry.month))),
  tokens: number(entry.tokens, `tokens for ${entry.month}`),
}));

let runningTotal = 0;
for (const point of series) {
  runningTotal += point.tokens;
  point.cumulative = runningTotal;
}

const chart = { left: 28, top: 91, width: 744, height: 111 };
const max = Math.max(totalTokens, ...series.map((point) => point.cumulative), 1);
const xStep = series.length > 1 ? chart.width / (series.length - 1) : 0;
const points = series.map((point, index) => ({
  ...point,
  x: chart.left + index * xStep,
  y: chart.top + chart.height - (point.cumulative / max) * chart.height,
}));

const linePath = points.slice(1).reduce((pathData, point, index) => {
  const previous = points[index];
  const middleX = (previous.x + point.x) / 2;
  return `${pathData} C${middleX.toFixed(1)} ${previous.y.toFixed(1)}, ${middleX.toFixed(1)} ${point.y.toFixed(1)}, ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
}, `M${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`);
const areaPath = `${linePath} L${points.at(-1).x.toFixed(1)} ${(chart.top + chart.height).toFixed(1)} L${points[0].x.toFixed(1)} ${(chart.top + chart.height).toFixed(1)} Z`;
const labels = points
  .map(
    (point, index) =>
      `<text x="${point.x.toFixed(1)}" y="224" text-anchor="${index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}" class="axis">${point.month}</text>`,
  )
  .join("\n      ");

const updatedLabel = new Intl.DateTimeFormat("en", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  timeZone: "UTC",
}).format(updatedAt);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="240" viewBox="0 0 800 240" role="img" aria-labelledby="title desc">
  <title id="title">All-time token usage</title>
  <desc id="desc">${escapeXml(compact(totalTokens))} tokens used all time. Updated ${escapeXml(updatedLabel)}.</desc>
  <style>
    :root {
      --bg: #ffffff;
      --border: #d0d7de;
      --text: #1f2328;
      --muted: #656d76;
      --grid: #d8dee4;
      --accent: #0969da;
      --area: #0969da18;
    }
    text { font-family: "Ubuntu", "Helvetica", "Arial", sans-serif; }
    .card { fill: var(--bg); stroke: var(--border); }
    .eyebrow { fill: var(--muted); font-size: 12px; font-weight: 600; letter-spacing: 1.2px; }
    .total { fill: var(--text); font-size: 34px; font-weight: 700; letter-spacing: -1px; }
    .unit { fill: var(--muted); font-size: 15px; font-weight: 500; }
    .meta-label, .axis { fill: var(--muted); font-size: 11px; }
    .grid { stroke: var(--grid); stroke-width: 1; }
    .area { fill: var(--area); }
    .line { fill: none; stroke: var(--accent); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
  </style>

  <rect x="0.5" y="0.5" width="799" height="239" rx="12" class="card"/>
  <text x="28" y="28" class="eyebrow">ALL-TIME TOKEN USAGE</text>
  <text x="772" y="28" text-anchor="end" class="meta-label">UPDATED ${escapeXml(updatedLabel.toUpperCase())} · UTC</text>
  <text x="28" y="69" class="total">${escapeXml(compact(totalTokens))}</text>
  <text x="${28 + Math.max(84, compact(totalTokens).length * 21)}" y="68" class="unit">tokens</text>

  <line x1="${chart.left}" y1="${chart.top + chart.height}" x2="${chart.left + chart.width}" y2="${chart.top + chart.height}" class="grid"/>
  <path d="${areaPath}" class="area"/>
  <path d="${linePath}" class="line"/>
  ${labels}
</svg>
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, svg);
console.log(`Generated ${outputPath}`);
