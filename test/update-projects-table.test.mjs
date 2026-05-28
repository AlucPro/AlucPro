import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  npmTotalRange,
  resolveProjectsPath,
  updateProjectsTable,
} from "../scripts/update-projects-table.mjs";

test("updates only the README projects marker block with GitHub and npm data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "projects-table-"));
  const readmePath = join(dir, "README.md");
  const projectsPath = join(dir, "projects.json");

  await writeFile(
    readmePath,
    [
      "# Profile",
      "",
      "before",
      "",
      "<!-- PROJECTS:START -->",
      "old content",
      "<!-- PROJECTS:END -->",
      "",
      "after",
      "",
    ].join("\n"),
  );

  await writeFile(
    projectsPath,
    JSON.stringify([
      {
        type: "npm",
        name: "tool-manage",
        repo: "AlucPro/tool-manage",
        npm: "@alucpro/tool-manage",
        homepage: "",
        description: "Manage local AI tool plugins and skills from the terminal.",
        featured: true,
      },
      {
        type: "project",
        name: "Rolling Sagas",
        url: "https://rollingsagas.com",
        homepage: "https://rollingsagas.com",
        stars: "manual",
        forks: "-",
        downloads: "-",
        version: "live",
        description: "Demo non-npm project configured by hand.",
        featured: true,
      },
      {
        type: "obsidian-plugin",
        name: "LexiNote",
        repo: "AlucPro/obsidian-lexinote",
        pluginId: "lexinote",
        homepage: "",
        description: "Demo Obsidian plugin.",
        featured: true,
      },
      {
        type: "logseq-plugin",
        name: "Logseq LeetCode",
        repo: "AlucPro/logseq-plugin-leetcode",
        pluginId: "logseq-plugin-leetcode",
        homepage: "",
        description: "Demo Logseq plugin.",
        featured: true,
      },
      {
        name: "Hidden",
        repo: "AlucPro/hidden",
        npm: "",
        homepage: "",
        description: "Should not render.",
        featured: false,
      },
    ]),
  );

  const fetchImpl = async (url) => {
    if (url === "https://api.github.com/repos/AlucPro/tool-manage") {
      return jsonResponse({
        html_url: "https://github.com/AlucPro/tool-manage",
        homepage: "https://tool.aluc.pro",
        stargazers_count: 12,
        forks_count: 3,
      });
    }

    if (
      url ===
      `https://api.npmjs.org/downloads/point/${npmTotalRange()}/%40alucpro%2Ftool-manage`
    ) {
      return jsonResponse({ downloads: 12345 });
    }

    if (url === "https://registry.npmjs.org/%40alucpro%2Ftool-manage") {
      return jsonResponse({ "dist-tags": { latest: "1.2.3" } });
    }

    if (url === "https://api.github.com/repos/AlucPro/obsidian-lexinote") {
      return jsonResponse({
        html_url: "https://github.com/AlucPro/obsidian-lexinote",
        homepage: "",
        stargazers_count: 7,
        forks_count: 1,
      });
    }

    if (
      url ===
      "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json"
    ) {
      return jsonResponse({ lexinote: { downloads: 4567, updated: 1778695852000 } });
    }

    if (url === "https://api.github.com/repos/AlucPro/logseq-plugin-leetcode") {
      return jsonResponse({
        html_url: "https://github.com/AlucPro/logseq-plugin-leetcode",
        homepage: "",
        stargazers_count: 9,
        forks_count: 2,
      });
    }

    if (url === "https://raw.githubusercontent.com/logseq/marketplace/master/stats.json") {
      return jsonResponse({
        "logseq-plugin-leetcode": {
          releases: [
            ["v0.0.1", false, 690],
            ["0.0.1", false, 9],
          ],
        },
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await updateProjectsTable({ readmePath, projectsPath, fetchImpl });
  const readme = await readFile(readmePath, "utf8");

  assert.equal(result.updated, true);
  assert.match(readme, /before/);
  assert.match(readme, /after/);
  assert.match(
    readme,
    /\| # \| Project \| Homepage \| Stars \| Downloads \| Version \| Description \|/,
  );
  assert.doesNotMatch(readme, /\| # \| Project \| Homepage \| Stars \| Forks \| Downloads \| Version \| Description \|/);
  assert.match(
    readme,
    /\| <img src="\.\/icon\/badge-npm\.svg" alt="npm" width="28"> \| \[tool-manage\]\(https:\/\/github\.com\/AlucPro\/tool-manage\) \| \[Website\]\(https:\/\/tool\.aluc\.pro\) \| 12 \| 12\.3k total \| `1\.2\.3` \| Manage local AI tool plugins and skills from the terminal\. \|/,
  );
  assert.match(
    readme,
    /\| <img src="\.\/icon\/badge-project\.svg" alt="project" width="28"> \| \[Rolling Sagas\]\(https:\/\/rollingsagas\.com\) \| \[Website\]\(https:\/\/rollingsagas\.com\) \| manual \| - \| live \| Demo non-npm project configured by hand\. \|/,
  );
  assert.match(
    readme,
    /\| <img src="\.\/icon\/badge-obsidian\.svg" alt="obsidian" width="28"> \| \[LexiNote\]\(https:\/\/github\.com\/AlucPro\/obsidian-lexinote\) \| - \| 7 \| 4\.6k total \| - \| Demo Obsidian plugin\. \|/,
  );
  assert.match(
    readme,
    /\| <img src="\.\/icon\/badge-logseq\.svg" alt="logseq" width="28"> \| \[Logseq LeetCode\]\(https:\/\/github\.com\/AlucPro\/logseq-plugin-leetcode\) \| - \| 9 \| 699 total \| - \| Demo Logseq plugin\. \|/,
  );
  assert.doesNotMatch(readme, /old content/);
  assert.doesNotMatch(readme, /Hidden/);
});

test("uses PROJECTS_FILE as the default project config path", () => {
  const previous = process.env.PROJECTS_FILE;
  process.env.PROJECTS_FILE = "projects.v4.json";

  try {
    assert.equal(resolveProjectsPath().toString(), "projects.v4.json");
  } finally {
    if (previous === undefined) {
      delete process.env.PROJECTS_FILE;
    } else {
      process.env.PROJECTS_FILE = previous;
    }
  }
});

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}
