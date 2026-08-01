#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const inputPath = process.argv[2] ?? "response.json";
const outputPath = process.argv[3] ?? "assets/token-usage.svg";
const DAY_MS = 86_400_000;

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

function dayKey(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function parseDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!match) fail(`invalid daily date: ${value}`);
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (dayKey(time) !== value) fail(`invalid daily date: ${value}`);
  return time;
}

let data;
try {
  data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
} catch (error) {
  fail(`cannot read ${inputPath}: ${error.message}`);
}

const daily = data.historyPreview?.daily;
if (!Array.isArray(daily) || daily.length === 0) {
  fail("historyPreview.daily must contain at least one entry");
}

const totalTokens = number(
  data.historyPreview?.summary?.totalTokens ?? data.periods?.allTime?.totalTokens,
  "all-time token total",
);
const updatedAt = new Date(data.updatedAt);
if (Number.isNaN(updatedAt.valueOf())) fail("missing or invalid updatedAt");
const updatedDay = Date.UTC(
  updatedAt.getUTCFullYear(),
  updatedAt.getUTCMonth(),
  updatedAt.getUTCDate(),
);

const tokensByDay = new Map(
  daily.map((entry) => {
    const time = parseDay(entry.date);
    return [dayKey(time), number(entry.tokens, `tokens for ${entry.date}`)];
  }),
);
const activeDays = [...tokensByDay.keys()].map(parseDay).sort((a, b) => a - b);
const firstDay = activeDays[0];
const lastDay = Math.max(activeDays.at(-1), updatedDay);
const previewTotal = [...tokensByDay.values()].reduce((sum, tokens) => sum + tokens, 0);
let cumulative = Math.max(0, totalTokens - previewTotal);
const series = [];
for (let time = firstDay; time <= lastDay; time += DAY_MS) {
  cumulative += tokensByDay.get(dayKey(time)) ?? 0;
  series.push({ time, tokens: cumulative });
}

const chart = { left: 10, top: 34, width: 780, height: 196 };
const firstTime = series[0].time;
const lastTime = series.at(-1).time;
const timeSpan = Math.max(lastTime - firstTime, 1);
const minTokens = Math.min(...series.map((point) => point.tokens));
const maxTokens = Math.max(...series.map((point) => point.tokens));
const tokenSpan = Math.max(maxTokens - minTokens, 1);
const points = series.map((point) => ({
  x:
    series.length === 1
      ? chart.left + chart.width / 2
      : chart.left + ((point.time - firstTime) / timeSpan) * chart.width,
  y:
    maxTokens === minTokens
      ? chart.top + chart.height / 2
      : chart.top + chart.height - ((point.tokens - minTokens) / tokenSpan) * chart.height,
}));

const linePath =
  points.length === 1
    ? `M${chart.left} ${points[0].y.toFixed(1)} L${chart.left + chart.width} ${points[0].y.toFixed(1)}`
    : points.slice(1).reduce((pathData, point, index) => {
        const previous = points[index];
        const middleX = (previous.x + point.x) / 2;
        return `${pathData} C${middleX.toFixed(1)} ${previous.y.toFixed(1)}, ${middleX.toFixed(1)} ${point.y.toFixed(1)}, ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
      }, `M${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`);

const updatedLabel = new Intl.DateTimeFormat("en", {
  year: "numeric",
  month: "long",
  day: "2-digit",
  timeZone: "UTC",
}).format(updatedAt);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="210" viewBox="0 30 800 210" role="img" aria-labelledby="title desc">
  <title id="title">Cumulative token usage</title>
  <desc id="desc">A static cumulative token usage curve for the most recent ${daily.length} active days, ending at ${escapeXml(totalTokens.toLocaleString("en-US"))} tokens as of ${escapeXml(updatedLabel)}.</desc>
  <style>
    text { font-family: "Ubuntu", "Helvetica", "Arial", sans-serif; }
    .total { fill: #00000f; font-size: 13px; font-weight: 500; }
    .period { fill: gray; font-size: 11px; font-weight: 400; }
  </style>
  <rect width="800" height="240" fill="#ffffff"/>
  <path d="${linePath}" fill="none" stroke="#47a042" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="400" y="46" text-anchor="middle" class="total">All-time token usage: ${escapeXml(totalTokens.toLocaleString("en-US"))} as of ${escapeXml(updatedLabel)}</text>
  <text x="400" y="64" text-anchor="middle" class="period">Cumulative growth over the last ${daily.length} active days</text>
</svg>
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, svg);
console.log(`Generated ${outputPath}`);
