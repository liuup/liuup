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

let data;
try {
  data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
} catch (error) {
  fail(`cannot read ${inputPath}: ${error.message}`);
}

const summary = data.historyPreview?.summary ?? {};
const allTime = data.periods?.allTime ?? {};
const daily = data.historyPreview?.daily;

if (!Array.isArray(daily) || daily.length === 0) {
  fail("historyPreview.daily must contain at least one entry");
}

const totalTokens = number(
  summary.totalTokens ?? allTime.totalTokens,
  "all-time token total",
);
const updatedAt = new Date(data.updatedAt);
if (Number.isNaN(updatedAt.valueOf())) fail("missing or invalid updatedAt");

const series = daily
  .map((entry) => {
    const date = String(entry.date);
    const time = new Date(`${date}T00:00:00Z`).valueOf();
    if (!Number.isFinite(time)) fail(`invalid daily date: ${date}`);
    return {
      time,
      tokens: number(entry.tokens, `tokens for ${date}`),
    };
  })
  .sort((a, b) => a.time - b.time);

const chart = { left: 12, top: 4, width: 776, height: 198 };
const maxDaily = Math.max(...series.map((point) => point.tokens), 1) * 1.03;
const firstTime = series[0].time;
const lastTime = series.at(-1).time;
const timeSpan = Math.max(lastTime - firstTime, 1);
const points = series.map((point) => ({
  ...point,
  x:
    series.length === 1
      ? chart.left + chart.width / 2
      : chart.left + ((point.time - firstTime) / timeSpan) * chart.width,
  y: chart.top + chart.height - (point.tokens / maxDaily) * chart.height,
}));

const linePath = points.slice(1).reduce((pathData, point, index) => {
  const previous = points[index];
  const middleX = (previous.x + point.x) / 2;
  return `${pathData} C${middleX.toFixed(1)} ${previous.y.toFixed(1)}, ${middleX.toFixed(1)} ${point.y.toFixed(1)}, ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
}, `M${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`);
const areaPath = `${linePath} L${points.at(-1).x.toFixed(1)} ${(chart.top + chart.height).toFixed(1)} L${points[0].x.toFixed(1)} ${(chart.top + chart.height).toFixed(1)} Z`;

const updatedLabel = new Intl.DateTimeFormat("en", {
  year: "numeric",
  month: "long",
  day: "2-digit",
  timeZone: "UTC",
}).format(updatedAt);
const exactTotal = totalTokens.toLocaleString("en-US");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="240" viewBox="0 0 800 240" role="img" aria-labelledby="title desc">
  <title id="title">All-time token usage</title>
  <desc id="desc">${escapeXml(exactTotal)} tokens used all time as of ${escapeXml(updatedLabel)}, with daily token usage shown above.</desc>
  <style>
    :root {
      --bg: #ffffff;
      --text: #000000;
      --grid: #d8dee4;
      --accent: #0969da;
      --area: #0969da18;
    }
    text { font-family: "Ubuntu", "Helvetica", "Arial", sans-serif; }
    .card { fill: var(--bg); }
    .caption { fill: var(--text); font-size: 13px; font-weight: 500; }
    .grid { stroke: var(--grid); stroke-width: 1; }
    .area { fill: var(--area); }
    .line { fill: none; stroke: var(--accent); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
  </style>

  <rect width="800" height="240" class="card"/>
  <line x1="${chart.left}" y1="${chart.top + chart.height}" x2="${chart.left + chart.width}" y2="${chart.top + chart.height}" class="grid"/>
  <path d="${areaPath}" class="area"/>
  <path d="${linePath}" class="line"/>
  <text x="400" y="229" text-anchor="middle" class="caption">All-time token usage: ${escapeXml(exactTotal)} as of ${escapeXml(updatedLabel)}</text>
</svg>
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, svg);
console.log(`Generated ${outputPath}`);
