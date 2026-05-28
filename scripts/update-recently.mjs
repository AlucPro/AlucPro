import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const START_MARKER = "<!-- RECENTLY:START -->";
const END_MARKER = "<!-- RECENTLY:END -->";
const DEFAULT_README = new URL("../README.md", import.meta.url);
const WAKATIME_SUMMARIES_URL = "https://api.wakatime.com/api/v1/users/current/summaries";
const BAR_WIDTH = 25;

export async function updateRecently({
  readmePath = DEFAULT_README,
  apiKey = process.env.WAKATIME_API_KEY,
  fetchImpl = fetch,
  today = new Date(),
  languageLimit = Number(process.env.RECENTLY_LANG_LIMIT || 10),
  timezone = process.env.WAKATIME_TIMEZONE || "Asia/Shanghai",
} = {}) {
  const readme = await readFile(readmePath, "utf8");
  const block = apiKey
    ? renderRecentlyBlock(
        aggregateLanguages(
          await fetchWakaTimeSummaries({ apiKey, fetchImpl, today, timezone }),
        ),
        { languageLimit },
      )
    : renderRecentlyBlock([], { languageLimit });
  const nextReadme = replaceRecentlyBlock(readme, block);

  if (nextReadme === readme) {
    return { updated: false };
  }

  await writeFile(readmePath, nextReadme);
  return { updated: true };
}

export async function fetchWakaTimeSummaries({
  apiKey,
  fetchImpl = fetch,
  today = new Date(),
  timezone = "Asia/Shanghai",
}) {
  if (!apiKey) {
    throw new Error("WAKATIME_API_KEY is required to update Recently.");
  }

  const end = formatDate(today);
  const start = formatDate(addDays(today, -29));
  const url = new URL(WAKATIME_SUMMARIES_URL);
  url.searchParams.set("start", start);
  url.searchParams.set("end", end);
  url.searchParams.set("timezone", timezone);

  const response = await fetchImpl(url.toString(), {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      "User-Agent": "alucpro-readme-recently",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WakaTime API ${response.status}: ${body}`);
  }

  const payload = await response.json();
  return payload.data || [];
}

export function aggregateLanguages(summaries) {
  const totals = new Map();

  for (const summary of summaries) {
    for (const language of summary.languages || []) {
      const name = language.name || "Other";
      const seconds = Number(language.total_seconds ?? language.seconds ?? 0);
      totals.set(name, (totals.get(name) || 0) + seconds);
    }
  }

  const totalSeconds = [...totals.values()].reduce((sum, seconds) => sum + seconds, 0);

  return [...totals.entries()]
    .map(([name, seconds]) => ({
      name,
      totalSeconds: seconds,
      percent: totalSeconds > 0 ? (seconds / totalSeconds) * 100 : 0,
    }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds);
}

export function renderRecentlyBlock(languages, { languageLimit = 10 } = {}) {
  const rows = languages.slice(0, languageLimit);
  const content = rows.length
    ? rows.map(formatLanguageRow).join("\n")
    : "No coding activity tracked this month.";

  return `**this month i spent my time on:**

\`\`\`txt
${content}
\`\`\``;
}

export function replaceRecentlyBlock(readme, block) {
  const startIndex = readme.indexOf(START_MARKER);
  const endIndex = readme.indexOf(END_MARKER);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`README must contain ${START_MARKER} and ${END_MARKER} markers.`);
  }

  const before = readme.slice(0, startIndex + START_MARKER.length);
  const after = readme.slice(endIndex);
  return `${before}\n${block}\n${after}`;
}

function formatLanguageRow(language) {
  return [
    language.name.padEnd(16),
    formatDuration(language.totalSeconds).padEnd(14),
    progressBar(language.percent),
    `${language.percent.toFixed(2).padStart(6)} %`,
  ].join(" ");
}

function formatDuration(totalSeconds) {
  const totalMinutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes} min${minutes === 1 ? "" : "s"}`;
  }

  if (minutes === 0) {
    return `${hours} hr${hours === 1 ? "" : "s"}`;
  }

  return `${hours} hr${hours === 1 ? "" : "s"} ${minutes} min${minutes === 1 ? "" : "s"}`;
}

function progressBar(percent) {
  const filled = Math.round((percent / 100) * BAR_WIDTH);
  return `${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await updateRecently();
}
