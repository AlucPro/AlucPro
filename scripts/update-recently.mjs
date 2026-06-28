import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const START_MARKER = "<!-- RECENTLY:START -->";
const END_MARKER = "<!-- RECENTLY:END -->";
const DEFAULT_README = new URL("../README.md", import.meta.url);
const GITHUB_API_URL = "https://api.github.com";
const BAR_WIDTH = 25;
const EXCLUDED_LANGUAGES = new Set(["HTML"]);
const LANGUAGE_BY_EXTENSION = new Map([
  [".cjs", "JavaScript"],
  [".css", "CSS"],
  [".go", "Go"],
  [".js", "JavaScript"],
  [".jsx", "JavaScript"],
  [".json", "JSON"],
  [".mjs", "JavaScript"],
  [".md", "Markdown"],
  [".mdown", "Markdown"],
  [".markdown", "Markdown"],
  [".mdx", "Markdown"],
  [".py", "Python"],
  [".sh", "Shell"],
  [".ts", "TypeScript"],
  [".tsx", "TypeScript"],
  [".vue", "Vue"],
  [".yaml", "YAML"],
  [".yml", "YAML"],
]);

const username =
  process.env.GITHUB_USERNAME ||
  process.env.GITHUB_REPOSITORY?.split("/")[0] ||
  "AlucPro";

export async function updateRecently({
  readmePath = DEFAULT_README,
  fetchImpl = fetch,
  today = new Date(),
  languageLimit = Number(process.env.RECENTLY_LANG_LIMIT || 10),
  token = process.env.PROFILE_STATS_TOKEN || process.env.GITHUB_TOKEN,
  username: targetUsername = username,
} = {}) {
  const readme = await readFile(readmePath, "utf8");
  const summary = await buildRecentlySummary({
    fetchImpl,
    today,
    token,
    username: targetUsername,
  });
  const block = renderRecentlyBlock(summary, { languageLimit });
  const nextReadme = replaceRecentlyBlock(readme, block);

  if (nextReadme === readme) {
    return { updated: false, summary };
  }

  await writeFile(readmePath, nextReadme);
  return { updated: true, summary };
}

export async function buildRecentlySummary({
  fetchImpl = fetch,
  today = new Date(),
  token = process.env.PROFILE_STATS_TOKEN || process.env.GITHUB_TOKEN,
  username: targetUsername = username,
} = {}) {
  if (!token) {
    throw new Error("PROFILE_STATS_TOKEN or GITHUB_TOKEN is required to read repositories.");
  }

  const end = new Date(today);
  const start = addDays(end, -29);
  const activeRepos = (await listRepos({ fetchImpl, token }))
    .filter((repo) => !repo.fork && !repo.archived)
    .filter((repo) => new Date(repo.updated_at) >= start);

  const languageEntries = [];
  let commits = 0;
  let releases = 0;

  await Promise.all(
    activeRepos.map(async (repo) => {
      const [repoCommits, repoReleases] = await Promise.all([
        listCommits({
          fetchImpl,
          repo: repo.full_name,
          start,
          end,
          token,
          username: targetUsername,
        }),
        listReleases({ fetchImpl, repo: repo.full_name, start, token }),
      ]);

      const commitFiles = await Promise.all(
        repoCommits.map((commit) =>
          listCommitFiles({ fetchImpl, repo: repo.full_name, sha: commit.sha, token }),
        ),
      );

      for (const file of commitFiles.flat()) {
        const language = languageForFile(file.filename);
        if (!language || EXCLUDED_LANGUAGES.has(language)) {
          continue;
        }

        languageEntries.push([language, Number(file.additions || 0) + Number(file.deletions || 0)]);
      }

      commits += repoCommits.length;
      releases += repoReleases.length;
    }),
  );

  return {
    languages: aggregateLanguages(languageEntries),
    stats: {
      activeRepos: activeRepos.length,
      commits,
      releases,
    },
  };
}

async function listRepos({ fetchImpl, token }) {
  const repos = [];
  let page = 1;

  while (true) {
    const batch = await github(
      fetchImpl,
      `/user/repos?visibility=all&affiliation=owner&sort=updated&per_page=100&page=${page}`,
      { token },
    );
    repos.push(...batch);

    if (batch.length < 100) {
      return repos;
    }

    page += 1;
  }
}

async function listCommits({ fetchImpl, repo, start, end, token, username: targetUsername }) {
  return github(
    fetchImpl,
    `/repos/${repo}/commits?author=${encodeURIComponent(targetUsername)}&since=${encodeURIComponent(start.toISOString())}&until=${encodeURIComponent(end.toISOString())}&per_page=100`,
    { token, optional404: true },
  );
}

async function listCommitFiles({ fetchImpl, repo, sha, token }) {
  const commit = await github(fetchImpl, `/repos/${repo}/commits/${sha}`, {
    token,
    optional404: true,
  });

  return commit.files || [];
}

async function listReleases({ fetchImpl, repo, start, token }) {
  const releases = await github(fetchImpl, `/repos/${repo}/releases?per_page=100`, {
    token,
    optional404: true,
  });

  return releases.filter((release) => new Date(release.published_at || release.created_at) >= start);
}

async function github(fetchImpl, path, { token, optional404 = false } = {}) {
  const response = await fetchImpl(`${GITHUB_API_URL}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "alucpro-readme-recently",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    if (optional404 && response.status === 404) {
      return [];
    }

    const body = await response.text();
    throw new Error(`GitHub API ${response.status} for ${path}: ${body}`);
  }

  return response.json();
}

export function aggregateLanguages(entries) {
  const totals = new Map();

  for (const [name, lines] of entries) {
    totals.set(name, (totals.get(name) || 0) + Number(lines || 0));
  }

  const totalLines = [...totals.values()].reduce((sum, lines) => sum + lines, 0);

  return [...totals.entries()]
    .map(([name, lines]) => ({
      name,
      lines,
      percent: totalLines > 0 ? (lines / totalLines) * 100 : 0,
    }))
    .sort((a, b) => b.lines - a.lines);
}

export function renderRecentlyBlock(summary, { languageLimit = 10 } = {}) {
  const languages = summary.languages.slice(0, languageLimit);
  const languageRows = languages.length
    ? languages.map(formatLanguageRow).join("\n")
    : "No GitHub language activity tracked this month.";

  return `**𝚝𝚑𝚒𝚜 𝚖𝚘𝚗𝚝𝚑 𝚒 𝚋𝚞𝚒𝚕𝚝 𝚠𝚒𝚝𝚑:**

\`\`\`txt
${languageRows}

shipped          ${formatCount(summary.stats.activeRepos, "active repo")} · ${formatCount(summary.stats.commits, "commit")} · ${formatCount(summary.stats.releases, "release")}
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
    formatChangedLines(language.lines).padEnd(10),
    progressBar(language.percent),
    `${language.percent.toFixed(2).padStart(6)} %`,
  ].join(" ");
}

function formatChangedLines(lines) {
  if (lines < 1000) {
    return `${lines} ${lines === 1 ? "line" : "lines"}`;
  }

  return `${(lines / 1000).toFixed(1)}k lines`;
}

function formatCount(value, label) {
  return `${value} ${label}${value === 1 ? "" : "s"}`;
}

function progressBar(percent) {
  const filled = Math.round((percent / 100) * BAR_WIDTH);
  return `${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)}`;
}

function languageForFile(filename = "") {
  const normalized = filename.toLowerCase();
  const extension = normalized.includes(".")
    ? normalized.slice(normalized.lastIndexOf("."))
    : "";

  if (extension === ".html" || extension === ".htm") {
    return "HTML";
  }

  return LANGUAGE_BY_EXTENSION.get(extension);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await updateRecently();
}
