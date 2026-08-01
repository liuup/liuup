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

function compactNumber(value) {
  const units = [
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "K"],
  ];
  for (const [divisor, suffix] of units) {
    if (value >= divisor) {
      return `${(value / divisor).toFixed(1).replace(/\.0$/, "")}${suffix}`;
    }
  }
  return value.toLocaleString("en-US");
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

const allTimeModels = data.periods?.allTime?.models;
if (!allTimeModels || typeof allTimeModels !== "object") {
  fail("periods.allTime.models must be an object");
}
const topModels = Object.entries(allTimeModels)
  .filter(([model, tokens]) => model !== "unknown" && Number(tokens) > 0)
  .map(([model, tokens]) => ({
    model,
    tokens: numeric(tokens, `tokens for model ${model}`),
  }))
  .sort((a, b) => b.tokens - a.tokens)
  .slice(0, 5);
if (topModels.length === 0) fail("periods.allTime.models has no usable entries");

const chartLeft = 28;
const chartWidth = 460;
const chartTop = 88;
const chartBottom = 216;
const chartHeight = chartBottom - chartTop;
const maxDaily = Math.max(...dailyTokens, 1);
const daySlot = chartWidth / daily.length;
const barWidth = Math.min(10, daySlot * 0.64);
const bars = daily
  .map((entry, index) => {
    const height = Math.max(2, (entry.tokens / maxDaily) * chartHeight);
    const x = chartLeft + index * daySlot + (daySlot - barWidth) / 2;
    const y = chartBottom - height;
    const className = entry.tokens === maxDaily ? "daily-bar peak" : "daily-bar";
    return `  <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${height.toFixed(1)}" rx="${(barWidth / 2).toFixed(1)}" class="${className}"><title>${escapeXml(entry.date)}: ${escapeXml(entry.tokens.toLocaleString("en-US"))} tokens</title></rect>`;
  })
  .join("\n");

const modelTrackLeft = 530;
const modelTrackWidth = 242;
const modelMax = topModels[0].tokens;
const modelRows = topModels
  .map((entry, index) => {
    const labelY = 94 + index * 27;
    const trackY = labelY + 6;
    const width = Math.max(4, (entry.tokens / modelMax) * modelTrackWidth);
    return `  <text x="${modelTrackLeft}" y="${labelY}" class="model-name">${escapeXml(entry.model)}</text>
  <text x="${modelTrackLeft + modelTrackWidth}" y="${labelY}" text-anchor="end" class="model-value">${escapeXml(compactNumber(entry.tokens))}</text>
  <rect x="${modelTrackLeft}" y="${trackY}" width="${modelTrackWidth}" height="7" rx="3.5" class="model-track"/>
  <rect x="${modelTrackLeft}" y="${trackY}" width="${width.toFixed(1)}" height="7" rx="3.5" class="model-bar"><title>${escapeXml(entry.model)}: ${escapeXml(entry.tokens.toLocaleString("en-US"))} tokens</title></rect>`;
  })
  .join("\n");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200" viewBox="0 30 800 200" role="img" aria-labelledby="title desc">
  <title id="title">Token usage</title>
  <desc id="desc">Daily token usage for the most recent ${daily.length} active days and the five most-used models of all time, with ${escapeXml(totalTokens.toLocaleString("en-US"))} tokens used as of ${escapeXml(updatedLabel)}.</desc>
  <style>
    text { font-family: "Ubuntu", "Helvetica", "Arial", sans-serif; }
    .total { fill: #00000f; font-size: 13px; font-weight: 500; }
    .section { fill: gray; font-size: 11px; font-weight: 400; }
    .daily-bar { fill: #47a042; fill-opacity: 0.62; }
    .daily-bar.peak { fill: #1d6a23; fill-opacity: 0.9; }
    .model-name { fill: #00000f; font-size: 10.5px; font-weight: 500; }
    .model-value { fill: gray; font-size: 10px; font-variant-numeric: tabular-nums; }
    .model-track { fill: #efefef; }
    .model-bar { fill: #47a042; }
  </style>
  <rect width="800" height="240" fill="#ffffff"/>
  <text x="400" y="46" text-anchor="middle" class="total">All-time token usage: ${escapeXml(totalTokens.toLocaleString("en-US"))} as of ${escapeXml(updatedLabel)}</text>
  <text x="258" y="72" text-anchor="middle" class="section">Daily usage · last ${daily.length} active days</text>
  <text x="651" y="72" text-anchor="middle" class="section">Top models · all time</text>
${bars}
${modelRows}
</svg>
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, svg);
console.log(`Generated ${outputPath}`);
