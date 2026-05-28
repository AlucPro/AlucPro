import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const START_MARKER = "<!-- PROJECTS:START -->";
const END_MARKER = "<!-- PROJECTS:END -->";
const DEFAULT_README = new URL("../README.md", import.meta.url);
const DEFAULT_PROJECTS = new URL("../.ai-context/CONTENT/projects.v4.json", import.meta.url);
const OBSIDIAN_STATS_URL =
  "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json";
const LOGSEQ_STATS_URL = "https://raw.githubusercontent.com/logseq/marketplace/master/stats.json";

const token = process.env.GITHUB_TOKEN;
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "alucpro-projects-table",
  "X-GitHub-Api-Version": "2022-11-28",
};

if (token) {
  headers.Authorization = `Bearer ${token}`;
}

export async function updateProjectsTable({
  readmePath = DEFAULT_README,
  projectsPath = resolveProjectsPath(),
  fetchImpl = fetch,
} = {}) {
  const [readme, projectJson] = await Promise.all([
    readFile(readmePath, "utf8"),
    readFile(projectsPath, "utf8"),
  ]);
  const projects = JSON.parse(projectJson).filter((project) => project.featured);
  const rows = await Promise.all(projects.map((project) => buildProjectRow(project, fetchImpl)));
  const table = renderTable(rows);
  const nextReadme = replaceProjectsBlock(readme, table);

  if (nextReadme === readme) {
    return { updated: false, rows };
  }

  await writeFile(readmePath, nextReadme);
  return { updated: true, rows };
}

export function resolveProjectsPath() {
  return process.env.PROJECTS_FILE || DEFAULT_PROJECTS;
}

export async function buildProjectRow(project, fetchImpl = fetch) {
  const type = project.type || "npm";

  if (type === "project" || type === "ai-project") {
    return buildManualProjectRow(project);
  }

  if (type === "obsidian-plugin") {
    return buildPluginProjectRow(project, fetchImpl, fetchObsidianDownloads);
  }

  if (type === "logseq-plugin") {
    return buildPluginProjectRow(project, fetchImpl, fetchLogseqDownloads);
  }

  if (type !== "npm") {
    throw new Error(`Unsupported project type: ${type}`);
  }

  const repo = await fetchJson(fetchImpl, `https://api.github.com/repos/${project.repo}`);
  const npm = project.npm ? await fetchNpm(project.npm, fetchImpl) : null;
  const homepage = project.homepage || repo.homepage || "";

  return {
    type,
    name: project.name,
    repoUrl: repo.html_url || `https://github.com/${project.repo}`,
    homepage,
    stars: repo.stargazers_count ?? 0,
    forks: repo.forks_count ?? 0,
    downloads: npm?.downloads ?? null,
    downloadsLabel: npm?.downloads === null ? "-" : `${formatCompact(npm.downloads)} total`,
    version: npm?.version ?? "",
    versionLabel: formatVersion(npm?.version ?? ""),
    description: project.description || repo.description || "",
  };
}

async function buildPluginProjectRow(project, fetchImpl, fetchDownloads) {
  const repo = await fetchJson(fetchImpl, `https://api.github.com/repos/${project.repo}`);
  const downloads = await fetchDownloads(project.pluginId || project.name, fetchImpl);
  const homepage = project.homepage || repo.homepage || "";

  return {
    type: project.type,
    name: project.name,
    repoUrl: repo.html_url || `https://github.com/${project.repo}`,
    homepage,
    stars: repo.stargazers_count ?? 0,
    forks: repo.forks_count ?? 0,
    downloads,
    downloadsLabel: downloads === null ? "-" : `${formatCompact(downloads)} total`,
    version: project.version ?? "",
    versionLabel: project.version ? formatVersion(project.version) : "-",
    description: project.description || repo.description || "",
  };
}

function buildManualProjectRow(project) {
  return {
    type: project.type || "project",
    name: project.name,
    repoUrl: project.url || project.repoUrl || project.homepage || "",
    homepage: project.homepage || "",
    stars: project.stars ?? "-",
    forks: project.forks ?? "-",
    downloads: project.downloads ?? "-",
    downloadsLabel: project.downloads ?? "-",
    version: project.version ?? "-",
    versionLabel: project.version ?? "-",
    description: project.description || "",
  };
}

export function renderTable(rows) {
  const header = [
    ["#", "Project", "Homepage", "Stars", "Downloads", "Version", "Description"],
    ["---", "---", "---", "---:", "---:", "---", "---"],
  ];
  const body = rows.map((row) =>
    [
      projectTypeIcon(row.type),
      link(row.name, row.repoUrl),
      row.homepage ? link("Website", row.homepage) : "-",
      formatMetric(row.stars),
      escapeMarkdownCell(row.downloadsLabel ?? (row.downloads === null ? "-" : `${formatCompact(row.downloads)} total`)),
      escapeMarkdownCell(row.versionLabel ?? formatVersion(row.version)),
      escapeMarkdownCell(row.description),
    ],
  );

  return [...header, ...body].map((cells) => `| ${cells.join(" | ")} |`).join("\n");
}

function projectTypeIcon(type = "project") {
  const normalizedType = type === "ai-project" ? "project" : type;
  const icons = {
    "logseq-plugin": { label: "logseq", path: "./icon/badge-logseq.svg" },
    "obsidian-plugin": { label: "obsidian", path: "./icon/badge-obsidian.svg" },
    npm: { label: "npm", path: "./icon/badge-npm.svg" },
    project: { label: "project", path: "./icon/badge-project.svg" },
  };
  const icon = icons[normalizedType] || icons.project;

  return `<img src="${icon.path}" alt="${icon.label}" width="28">`;
}

export function replaceProjectsBlock(readme, table) {
  const startIndex = readme.indexOf(START_MARKER);
  const endIndex = readme.indexOf(END_MARKER);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`README must contain ${START_MARKER} and ${END_MARKER} markers.`);
  }

  const before = readme.slice(0, startIndex + START_MARKER.length);
  const after = readme.slice(endIndex);
  return `${before}\n${table}\n${after}`;
}

async function fetchNpm(packageName, fetchImpl) {
  const encoded = encodeURIComponent(packageName);
  const [downloads, metadata] = await Promise.all([
    fetchJson(fetchImpl, `https://api.npmjs.org/downloads/point/${npmTotalRange()}/${encoded}`, {
      optional: true,
    }),
    fetchJson(fetchImpl, `https://registry.npmjs.org/${encoded}`, { optional: true }),
  ]);

  return {
    downloads: downloads?.downloads ?? null,
    version: metadata?.["dist-tags"]?.latest ?? "",
  };
}

async function fetchObsidianDownloads(pluginId, fetchImpl) {
  const stats = await fetchJson(fetchImpl, OBSIDIAN_STATS_URL, { optional: true });
  return stats?.[pluginId]?.downloads ?? null;
}

async function fetchLogseqDownloads(pluginId, fetchImpl) {
  const stats = await fetchJson(fetchImpl, LOGSEQ_STATS_URL, { optional: true });
  const releases = stats?.[pluginId]?.releases;

  if (!Array.isArray(releases)) {
    return null;
  }

  return releases.reduce((sum, release) => sum + (Number(release?.[2]) || 0), 0);
}

export function npmTotalRange(today = new Date()) {
  return `2015-01-10:${today.toISOString().slice(0, 10)}`;
}

async function fetchJson(fetchImpl, url, { optional = false } = {}) {
  const response = await fetchImpl(url, { headers });

  if (!response.ok) {
    if (optional && response.status === 404) {
      return null;
    }

    const body = await response.text();
    throw new Error(`Request failed ${response.status} for ${url}: ${body}`);
  }

  return response.json();
}

function link(label, url) {
  return `[${escapeMarkdownCell(label)}](${url})`;
}

function escapeMarkdownCell(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .trim();
}

function formatInteger(value) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(value);
}

function formatMetric(value) {
  return typeof value === "number" ? formatInteger(value) : escapeMarkdownCell(value);
}

function formatVersion(value) {
  if (!value || value === "-") {
    return "-";
  }

  return String(value).startsWith("`") ? value : `\`${escapeMarkdownCell(value)}\``;
}

function formatCompact(value) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  })
    .format(value)
    .toLowerCase();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await updateProjectsTable();
}
