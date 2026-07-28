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

function buildCounterFrames(total) {
  const frameCount = 30;
  const durationSeconds = 3;
  const frameDuration = durationSeconds / frameCount;

  return Array.from({ length: frameCount + 1 }, (_, index) => {
    const progress = index / frameCount;
    const easedProgress = progress * progress * (3 - 2 * progress);
    const value = Math.round(total * easedProgress).toLocaleString("en-US");
    const begin = (index * frameDuration).toFixed(1);
    const timing =
      index === frameCount
        ? `begin="${begin}s" dur="indefinite"`
        : `begin="${begin}s" dur="${frameDuration.toFixed(1)}s"`;

    return `    <text x="405" y="229" text-anchor="middle" visibility="hidden" class="caption counter">${escapeXml(value)}<set attributeName="visibility" to="visible" ${timing}/></text>`;
  }).join("\n");
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
const counterFrames = buildCounterFrames(totalTokens);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="240" viewBox="0 0 800 240" role="img" aria-labelledby="title desc">
  <title id="title">All-time token usage</title>
  <desc id="desc">${escapeXml(exactTotal)} tokens used all time as of ${escapeXml(updatedLabel)}, with daily token usage shown above.</desc>
  <style>
    :root {
      --bg: #ffffff;
      --text: #00000f;
      --strong: #111133;
      --muted: gray;
      --accent: #47a042;
    }
    text { font-family: "Ubuntu", "Helvetica", "Arial", sans-serif; }
    .card { fill: var(--bg); }
    .caption { fill: var(--text); font-size: 13px; font-weight: 500; }
    .counter {
      fill: var(--strong);
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }
    .date { fill: var(--muted); }
    .area { fill: url(#area-gradient); }
    .line { fill: none; stroke: var(--accent); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
  </style>

  <defs>
    <linearGradient id="area-gradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#47a042" stop-opacity="0.16"/>
      <stop offset="72%" stop-color="#47a042" stop-opacity="0.07"/>
      <stop offset="100%" stop-color="#47a042" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="800" height="240" class="card"/>
  <path d="${areaPath}" class="area">
    <animate attributeName="fill-opacity" values="0;0;1" keyTimes="0;0.75;1" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" dur="3s" repeatCount="1"/>
  </path>
  <path d="${linePath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="0" class="line">
    <animate attributeName="stroke-dashoffset" values="1;0" keyTimes="0;1" calcMode="spline" keySplines="0.42 0 0.58 1" dur="3s" repeatCount="1"/>
  </path>
  <text x="330" y="229" text-anchor="end" class="caption">All-time token usage:</text>
  <g aria-hidden="true">
${counterFrames}
  </g>
  <text x="480" y="229" text-anchor="start" class="caption date">as of ${escapeXml(updatedLabel)}</text>
</svg>
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, svg);
console.log(`Generated ${outputPath}`);
