#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const inputPath = process.argv[2] ?? "response.json";
const outputPath = process.argv[3] ?? "assets/token-usage.svg";
const historyPath = process.argv[4] ?? "assets/token-history.json";
const DAY_MS = 86_400_000;
const DAYS_IN_YEAR = 365;

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

function parseDay(value, label) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!match) fail(`invalid ${label}: ${value}`);
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (dayKey(time) !== value) fail(`invalid ${label}: ${value}`);
  return time;
}

function dayKey(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function minDefined(...values) {
  const defined = values.filter(Number.isFinite);
  return defined.length ? Math.min(...defined) : undefined;
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
const endDay = Date.UTC(
  updatedAt.getUTCFullYear(),
  updatedAt.getUTCMonth(),
  updatedAt.getUTCDate(),
);
const startDay = endDay - (DAYS_IN_YEAR - 1) * DAY_MS;

let savedHistory = {};
if (fs.existsSync(historyPath)) {
  try {
    savedHistory = JSON.parse(fs.readFileSync(historyPath, "utf8"));
  } catch (error) {
    fail(`cannot read ${historyPath}: ${error.message}`);
  }
}

const tokensByDay = new Map();
for (const entry of savedHistory.daily ?? []) {
  const time = parseDay(entry.date, "saved history date");
  if (time >= startDay && time <= endDay) {
    tokensByDay.set(entry.date, number(entry.tokens, `tokens for ${entry.date}`));
  }
}

let firstCurrentDay;
for (const entry of daily) {
  const time = parseDay(entry.date, "daily date");
  firstCurrentDay = minDefined(firstCurrentDay, time);
  if (time >= startDay && time <= endDay) {
    tokensByDay.set(entry.date, number(entry.tokens, `tokens for ${entry.date}`));
  }
}

const savedObservedFrom = savedHistory.observedFrom
  ? parseDay(savedHistory.observedFrom, "observedFrom")
  : undefined;
const observedFrom = Math.max(
  startDay,
  minDefined(savedObservedFrom, firstCurrentDay) ?? startDay,
);

const history = {
  updatedAt: data.updatedAt,
  observedFrom: dayKey(observedFrom),
  observedThrough: dayKey(endDay),
  daily: [...tokensByDay]
    .map(([date, tokens]) => ({ date, tokens }))
    .sort((a, b) => a.date.localeCompare(b.date)),
};

fs.mkdirSync(path.dirname(historyPath), { recursive: true });
fs.writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`);

const observedSum = [...tokensByDay]
  .filter(([date]) => parseDay(date, "history date") >= observedFrom)
  .reduce((sum, [, tokens]) => sum + tokens, 0);
let cumulative = Math.max(0, totalTokens - observedSum);
const series = [];
for (let time = observedFrom; time <= endDay; time += DAY_MS) {
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
  <desc id="desc">A static cumulative token usage curve ending at ${escapeXml(totalTokens.toLocaleString("en-US"))} tokens as of ${escapeXml(updatedLabel)}.</desc>
  <style>
    text { font-family: "Ubuntu", "Helvetica", "Arial", sans-serif; }
    .total { fill: #00000f; font-size: 13px; font-weight: 500; }
  </style>
  <rect width="800" height="240" fill="#ffffff"/>
  <path d="${linePath}" fill="none" stroke="#47a042" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="400" y="46" text-anchor="middle" class="total">All-time token usage: ${escapeXml(totalTokens.toLocaleString("en-US"))} as of ${escapeXml(updatedLabel)}</text>
</svg>
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, svg);
console.log(`Generated ${outputPath} and updated ${historyPath}`);
