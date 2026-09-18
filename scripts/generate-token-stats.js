#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const statsPath = process.argv[2] ?? "stats.json";
const historyPath = process.argv[3] ?? "history.json";
const outputPath = process.argv[4] ?? "assets/token-usage.svg";
const windowDays = 30;
const rankingSize = 5;
const placeholderNames = new Set(["unknown", "<synthetic>"]);

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

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`cannot read ${label} from ${filePath}: ${error.message}`);
  }
}

function toDay(entry) {
  for (const field of ["perModel", "perClient"]) {
    if (!entry[field] || typeof entry[field] !== "object") {
      fail(`history.daily entry ${entry.date} carries no ${field} breakdown`);
    }
  }
  return {
    date: String(entry.date),
    tokens: numeric(entry.tokens, `tokens for ${entry.date}`),
    perModel: entry.perModel,
    perClient: entry.perClient,
  };
}

const stats = readJson(statsPath, "stats");
const history = readJson(historyPath, "history");

if (!Array.isArray(history.daily) || history.daily.length === 0) {
  fail("history.daily must contain at least one entry");
}

const days = history.daily
  .map(toDay)
  .sort((a, b) => a.date.localeCompare(b.date));
const daily = days.slice(-Math.min(windowDays, days.length));
const dailyTokens = daily.map((entry) => entry.tokens);
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

function rankByTokens(field, label) {
  const totals = new Map();
  for (const day of daily) {
    for (const [name, entry] of Object.entries(day[field])) {
      if (placeholderNames.has(name)) continue;
      const tokens = numeric(
        entry?.tokens,
        `tokens for ${label} ${name} on ${day.date}`,
      );
      if (tokens <= 0) continue;
      totals.set(name, (totals.get(name) ?? 0) + tokens);
    }
  }
  const ranked = [...totals]
    .map(([name, tokens]) => ({ name, tokens }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, rankingSize);
  if (ranked.length === 0) {
    fail(`the usage window carries no usable ${label} entries`);
  }
  return ranked;
}

const topModels = rankByTokens("perModel", "model");
const topAgents = rankByTokens("perClient", "agent");

const canvasWidth = 960;
const margin = 28;
const chartLeft = margin;
const chartWidth = 380;
const chartTop = 82;
const chartBottom = 204;
const chartHeight = chartBottom - chartTop;
const panelWidth = 222;
const panelGap = 40;
const panelRight = canvasWidth - margin;
const modelPanelLeft = panelRight - panelWidth * 2 - panelGap;
const agentPanelLeft = panelRight - panelWidth;
const maxDaily = Math.max(...dailyTokens, 1);
const daySlot = chartWidth / daily.length;
const barWidth = Math.min(10, daySlot * 0.64);
const peakDay = daily.reduce((peak, entry) =>
  entry.tokens > peak.tokens ? entry : peak,
);
const peakIndex = daily.indexOf(peakDay);
const peakX = chartLeft + peakIndex * daySlot + daySlot / 2;
const peakLabel = `  <text x="${peakX.toFixed(1)}" y="${chartTop - 7}" text-anchor="middle" class="peak-value">${escapeXml(peakDay.tokens.toLocaleString("en-US"))}</text>`;
const bars = daily
  .map((entry, index) => {
    const height = Math.max(2, (entry.tokens / maxDaily) * chartHeight);
    const x = chartLeft + index * daySlot + (daySlot - barWidth) / 2;
    const y = chartBottom - height;
    const className = entry.tokens === maxDaily ? "daily-bar peak" : "daily-bar";
    return `  <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${height.toFixed(1)}" rx="${(barWidth / 2).toFixed(1)}" class="${className}"><title>${escapeXml(entry.date)}: ${escapeXml(entry.tokens.toLocaleString("en-US"))} tokens</title></rect>`;
  })
  .join("\n");

function rankingRows(entries, panelLeft) {
  const panelMax = entries[0].tokens;
  return entries
    .map((entry, index) => {
      const labelY = 75 + index * 29;
      const trackY = labelY + 6;
      const width = Math.max(4, (entry.tokens / panelMax) * panelWidth);
      const tooltip = `${entry.name}: ${entry.tokens.toLocaleString("en-US")} tokens over the last ${daily.length} active days`;
      return `  <text x="${panelLeft}" y="${labelY}" class="ranking-name">${escapeXml(entry.name)}</text>
  <text x="${panelLeft + panelWidth}" y="${labelY}" text-anchor="end" class="ranking-value">${escapeXml(compactNumber(entry.tokens))}</text>
  <rect x="${panelLeft}" y="${trackY}" width="${panelWidth}" height="7" rx="3.5" class="ranking-track"/>
  <rect x="${panelLeft}" y="${trackY}" width="${width.toFixed(1)}" height="7" rx="3.5" class="ranking-bar"><title>${escapeXml(tooltip)}</title></rect>`;
    })
    .join("\n");
}

const modelRows = rankingRows(topModels, modelPanelLeft);
const agentRows = rankingRows(topAgents, agentPanelLeft);
const chartCaptionX = chartLeft + chartWidth / 2;
const modelCaptionX = modelPanelLeft + panelWidth / 2;
const agentCaptionX = agentPanelLeft + panelWidth / 2;
const windowLabel = `last ${daily.length} active days`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="210" viewBox="0 30 ${canvasWidth} 210" role="img" aria-labelledby="title desc">
  <title id="title">Token usage</title>
  <desc id="desc">Daily token usage, the five most-used models and the five most-used agents over the last ${daily.length} active days, with ${escapeXml(totalTokens.toLocaleString("en-US"))} tokens used in total as of ${escapeXml(updatedLabel)}.</desc>
  <style>
    text { font-family: "Ubuntu", "Helvetica", "Arial", sans-serif; }
    .total { fill: #00000f; font-size: 15px; font-weight: 500; }
    .section { fill: gray; font-size: 13px; font-weight: 400; }
    .daily-bar { fill: #47a042; fill-opacity: 0.62; }
    .daily-bar.peak { fill: #1d6a23; fill-opacity: 0.9; }
    .peak-value { fill: #1d6a23; font-size: 12px; font-weight: 500; font-variant-numeric: tabular-nums; }
    .ranking-name { fill: #00000f; font-size: 12.5px; font-weight: 500; }
    .ranking-value { fill: gray; font-size: 12px; font-variant-numeric: tabular-nums; }
    .ranking-track { fill: #efefef; }
    .ranking-bar { fill: #47a042; }
  </style>
  <rect width="${canvasWidth}" height="240" fill="#ffffff"/>
  <text x="${canvasWidth / 2}" y="46" text-anchor="middle" class="total">All-time token usage: ${escapeXml(totalTokens.toLocaleString("en-US"))} as of ${escapeXml(updatedLabel)}</text>
${bars}
${peakLabel}
${modelRows}
${agentRows}
  <text x="${chartCaptionX}" y="226" text-anchor="middle" class="section">Daily usage · ${windowLabel}</text>
  <text x="${modelCaptionX}" y="226" text-anchor="middle" class="section">Top models · ${windowLabel}</text>
  <text x="${agentCaptionX}" y="226" text-anchor="middle" class="section">Top agents · ${windowLabel}</text>
</svg>
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, svg);
console.log(`Generated ${outputPath}`);
