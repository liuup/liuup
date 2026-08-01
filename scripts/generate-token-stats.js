#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const inputPath = process.argv[2] ?? "response.json";
const outputPath = process.argv[3] ?? "assets/token-usage.svg";

function fail(message) {
  console.error(`token-stats: ${message}`);
  process.exit(1);
}

function numeric(value, label) {
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

function pointX(index, count) {
  return count === 1 ? 400 : 20 + (index / (count - 1)) * 760;
}

function scaleValues(values, top, height, padding) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = Math.max(maximum - minimum, 1);
  const domainMin = minimum - span * padding;
  const domainSpan = span * (1 + padding * 2);
  return values.map(
    (value) => top + height - ((value - domainMin) / domainSpan) * height,
  );
}

function quantile(sorted, fraction) {
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0;
}

let data;
try {
  data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
} catch (error) {
  fail(`cannot read ${inputPath}: ${error.message}`);
}

const rawDaily = data.historyPreview?.daily;
if (!Array.isArray(rawDaily) || rawDaily.length === 0) {
  fail("historyPreview.daily must contain at least one entry");
}

const daily = rawDaily
  .map((entry) => ({
    date: String(entry.date),
    tokens: numeric(entry.tokens, `tokens for ${entry.date}`),
  }))
  .sort((a, b) => a.date.localeCompare(b.date));
const dailyTokens = daily.map((entry) => entry.tokens);
const totalTokens = numeric(
  data.historyPreview?.summary?.totalTokens ?? data.periods?.allTime?.totalTokens,
  "all-time token total",
);
const updatedAt = new Date(data.updatedAt);
if (Number.isNaN(updatedAt.valueOf())) fail("missing or invalid updatedAt");
const updatedLabel = new Intl.DateTimeFormat("en", {
  year: "numeric",
  month: "long",
  day: "2-digit",
  timeZone: "UTC",
}).format(updatedAt);

const previewTotal = dailyTokens.reduce((sum, value) => sum + value, 0);
let runningTotal = Math.max(0, totalTokens - previewTotal);
const cumulative = dailyTokens.map((value) => (runningTotal += value));
const cumulativeY = scaleValues(cumulative, 74, 96, 0.12);
const cumulativePoints = cumulative.map((_, index) => ({
  x: pointX(index, cumulative.length),
  y: cumulativeY[index],
}));
const stepPath = cumulativePoints.slice(1).reduce(
  (result, point) =>
    `${result} H${point.x.toFixed(1)} V${point.y.toFixed(1)}`,
  `M${cumulativePoints[0].x.toFixed(1)} ${cumulativePoints[0].y.toFixed(1)}`,
);

const sortedDaily = [...dailyTokens].sort((a, b) => a - b);
const thresholds = [0.2, 0.4, 0.6, 0.8].map((fraction) =>
  quantile(sortedDaily, fraction),
);
function heatLevel(value) {
  if (value <= thresholds[0]) return 0;
  if (value <= thresholds[1]) return 1;
  if (value <= thresholds[2]) return 2;
  if (value <= thresholds[3]) return 3;
  return 4;
}

const cellSize = 20;
const heatCells = daily
  .map((entry, index) => {
    const x = pointX(index, daily.length) - cellSize / 2;
    return `  <rect x="${x.toFixed(1)}" y="178" width="${cellSize}" height="${cellSize}" rx="4" class="heat-${heatLevel(entry.tokens)}"><title>${escapeXml(entry.date)}: ${escapeXml(entry.tokens.toLocaleString("en-US"))} tokens</title></rect>`;
  })
  .join("\n");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="180" viewBox="0 30 800 180" role="img" aria-labelledby="title desc">
  <title id="title">Token usage</title>
  <desc id="desc">Cumulative token growth and daily usage intensity for the most recent ${daily.length} active days, ending at ${escapeXml(totalTokens.toLocaleString("en-US"))} tokens as of ${escapeXml(updatedLabel)}.</desc>
  <style>
    text { font-family: "Ubuntu", "Helvetica", "Arial", sans-serif; }
    .total { fill: #00000f; font-size: 13px; font-weight: 500; }
    .subtitle { fill: gray; font-size: 11px; font-weight: 400; }
    .step { fill: none; stroke: #47a042; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .heat-0 { fill: #efefef; }
    .heat-1 { fill: #d8e887; }
    .heat-2 { fill: #8cc569; }
    .heat-3 { fill: #47a042; }
    .heat-4 { fill: #1d6a23; }
  </style>
  <rect width="800" height="240" fill="#ffffff"/>
  <text x="400" y="46" text-anchor="middle" class="total">All-time token usage: ${escapeXml(totalTokens.toLocaleString("en-US"))} as of ${escapeXml(updatedLabel)}</text>
  <text x="400" y="64" text-anchor="middle" class="subtitle">Cumulative steps with daily intensity · last ${daily.length} active days</text>
  <path d="${stepPath}" class="step"/>
${heatCells}
</svg>
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, svg);
console.log(`Generated ${outputPath}`);
