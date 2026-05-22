import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const START_MARKER = "<!-- PROJECTS:START -->";
const END_MARKER = "<!-- PROJECTS:END -->";
const DEFAULT_README = new URL("../README.md", import.meta.url);
const DEFAULT_PROJECTS = new URL("../.ai-context/CONTENT/projects.v4.json", import.meta.url);

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
  const repo = await fetchJson(fetchImpl, `https://api.github.com/repos/${project.repo}`);
  const npm = project.npm ? await fetchNpm(project.npm, fetchImpl) : null;
  const homepage = project.homepage || repo.homepage || "";

  return {
    name: project.name,
    repoUrl: repo.html_url || `https://github.com/${project.repo}`,
    homepage,
    stars: repo.stargazers_count ?? 0,
    forks: repo.forks_count ?? 0,
    downloads: npm?.downloads ?? null,
    version: npm?.version ?? "",
    description: project.description || repo.description || "",
  };
}

export function renderTable(rows) {
  const header = [
    ["Project", "Homepage", "Stars", "Forks", "npm downloads", "Version", "Description"],
    ["---", "---", "---:", "---:", "---:", "---", "---"],
  ];
  const body = rows.map((row) =>
    [
      link(row.name, row.repoUrl),
      row.homepage ? link("Website", row.homepage) : "-",
      formatInteger(row.stars),
      formatInteger(row.forks),
      row.downloads === null ? "-" : `${formatCompact(row.downloads)}/mo`,
      row.version ? `\`${escapeMarkdownCell(row.version)}\`` : "-",
      escapeMarkdownCell(row.description),
    ],
  );

  return [...header, ...body].map((cells) => `| ${cells.join(" | ")} |`).join("\n");
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
    fetchJson(fetchImpl, `https://api.npmjs.org/downloads/point/last-month/${encoded}`, {
      optional: true,
    }),
    fetchJson(fetchImpl, `https://registry.npmjs.org/${encoded}`, { optional: true }),
  ]);

  return {
    downloads: downloads?.downloads ?? null,
    version: metadata?.["dist-tags"]?.latest ?? "",
  };
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
