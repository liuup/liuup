#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const statsPath = process.argv[2] ?? "stats.json";
const historyPath = process.argv[3] ?? "history.json";
const outputPath = process.argv[4] ?? "assets/token-usage.svg";
const dayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const dayAbbreviations = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekMs = 7 * 24 * 60 * 60 * 1000;
// matplotlib "Oranges" colormap, sampled at nine evenly spaced stops.
const heatColors = [
  "#fff5eb",
  "#fee6ce",
  "#fdd0a2",
  "#fdae6a",
  "#fd8c3b",
  "#f16813",
  "#d84801",
  "#a53603",
  "#7f2704",
];

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

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`cannot read ${label} from ${filePath}: ${error.message}`);
  }
}

function toDay(entry) {
  const date = new Date(`${entry.date}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) fail(`invalid history date ${entry.date}`);
  return {
    date: String(entry.date),
    tokens: numeric(entry.tokens, `tokens for ${entry.date}`),
    dayIndex: date.getUTCDay(),
    weekStart: date.getTime() - date.getUTCDay() * 24 * 60 * 60 * 1000,
  };
}

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function heatColor(ratio) {
  const clamped = Math.min(1, Math.max(0, ratio));
  const position = clamped * (heatColors.length - 1);
  const index = Math.min(Math.floor(position), heatColors.length - 2);
  const fraction = position - index;
  const from = hexToRgb(heatColors[index]);
  const to = hexToRgb(heatColors[index + 1]);
  const channel = (a, b) =>
    Math.round(a + (b - a) * fraction)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(from.r, to.r)}${channel(from.g, to.g)}${channel(from.b, to.b)}`;
}

const stats = readJson(statsPath, "stats");
const history = readJson(historyPath, "history");

if (!Array.isArray(history.daily) || history.daily.length === 0) {
  fail("history.daily must contain at least one entry");
}

const days = history.daily.map(toDay).sort((a, b) => a.date.localeCompare(b.date));
const totalTokens = numeric(history.summary?.totalTokens, "all-time token total");
if (typeof stats.updatedAt !== "string") fail("missing or invalid updatedAt");
const updatedAt = new Date(stats.updatedAt);
if (Number.isNaN(updatedAt.valueOf())) fail("invalid updatedAt");
const updatedLabel = new Intl.DateTimeFormat("en", {
  year: "numeric",
  month: "long",
  day: "2-digit",
  timeZone: "UTC",
}).format(updatedAt);

// Fixed 52-week window ending on the most recent day; days without usage are
// still drawn, with a value of zero.
const windowWeeks = 52;
const dayMs = 24 * 60 * 60 * 1000;
const lastDay = days[days.length - 1];
const lastDate = new Date(`${lastDay.date}T00:00:00Z`).getTime();
const firstWeekStart = lastDay.weekStart - (windowWeeks - 1) * weekMs;
const byDate = new Map(days.map((day) => [day.date, day]));
const points = [];
for (let weekIndex = 0; weekIndex < windowWeeks; weekIndex++) {
  for (let dayIndex = 0; dayIndex < dayNames.length; dayIndex++) {
    const time = firstWeekStart + weekIndex * weekMs + dayIndex * dayMs;
    if (time > lastDate) break;
    const date = new Date(time).toISOString().slice(0, 10);
    points.push({
      date,
      tokens: byDate.get(date)?.tokens ?? 0,
      dayIndex,
      weekIndex,
    });
  }
}
const weekCount = windowWeeks;

// Clip the colour scale at a high percentile so a single outlier day cannot
// wash out the rest of the heatmap; values above the cap saturate at 1.
const heatCapPercentile = 0.95;
const sortedTokens = points
  .map((point) => point.tokens)
  .filter((tokens) => tokens > 0)
  .sort((a, b) => a - b);
const capIndex = Math.min(
  sortedTokens.length - 1,
  Math.round(heatCapPercentile * Math.max(sortedTokens.length - 1, 0)),
);
const capTokens = Math.max(sortedTokens[capIndex] ?? 1, 1);

const canvasWidth = 960;
const plotLeft = 56;
const plotRight = 936;
const plotWidth = plotRight - plotLeft;
const colWidth = plotWidth / weekCount;
const rowGap = colWidth;
const cellGap = 1.5;
const cellSize = colWidth - cellGap;
const gridTop = 48;
const gridBottom = gridTop + dayNames.length * rowGap;
const canvasHeight = Math.ceil(gridBottom + 18);

const cells = points
  .map((point) => {
    const ratio = Math.min(1, Math.sqrt(Math.max(0, point.tokens) / capTokens));
    const x = plotLeft + point.weekIndex * colWidth + cellGap / 2;
    const y = gridTop + point.dayIndex * rowGap + cellGap / 2;
    const tooltip = `${point.date} · ${dayNames[point.dayIndex]} · ${point.tokens.toLocaleString("en-US")} tokens`;
    const fill = point.tokens === 0 ? "#f7f7f7" : heatColor(ratio);
    return `  <rect rx="1.5" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cellSize.toFixed(2)}" height="${cellSize.toFixed(2)}" fill="${fill}"><title>${escapeXml(tooltip)}</title></rect>`;
  })
  .join("\n");

const dayLabels = dayAbbreviations
  .map((name, index) => ({ name, index }))
  .filter(({ index }) => index % 2 === 1)
  .map(({ name, index }) => {
    const y = gridTop + index * rowGap + rowGap / 2 + 4;
    return `  <text x="${plotLeft - 14}" y="${y.toFixed(1)}" text-anchor="end" class="axis-label">${name}</text>`;
  })
  .join("\n");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" role="img" aria-labelledby="title desc">
  <title id="title">Token usage</title>
  <desc id="desc">Daily token usage for the last 52 weeks as a heatmap (days without usage shown as zero): week index on the x-axis, day of week on the y-axis, values normalized to 0–1 and coloured with the matplotlib Oranges colormap, with ${escapeXml(totalTokens.toLocaleString("en-US"))} tokens used in total as of ${escapeXml(updatedLabel)}.</desc>
  <style>
    text { font-family: "Ubuntu", "Helvetica", "Arial", sans-serif; }
    .total { fill: #00000f; font-size: 15px; font-weight: 500; }
    .axis-label { fill: gray; font-size: 11px; }
  </style>
  <rect width="${canvasWidth}" height="${canvasHeight}" fill="#ffffff"/>
  <text x="${canvasWidth / 2}" y="30" text-anchor="middle" class="total">All-time token usage: ${escapeXml(totalTokens.toLocaleString("en-US"))} as of ${escapeXml(updatedLabel)}</text>
${cells}
${dayLabels}
</svg>
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, svg);
console.log(`Generated ${outputPath}`);
