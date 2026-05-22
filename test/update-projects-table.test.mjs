import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveProjectsPath, updateProjectsTable } from "../scripts/update-projects-table.mjs";

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
        name: "tool-manage",
        repo: "AlucPro/tool-manage",
        npm: "@alucpro/tool-manage",
        homepage: "",
        description: "Manage local AI tool plugins and skills from the terminal.",
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
      "https://api.npmjs.org/downloads/point/last-month/%40alucpro%2Ftool-manage"
    ) {
      return jsonResponse({ downloads: 12345 });
    }

    if (url === "https://registry.npmjs.org/%40alucpro%2Ftool-manage") {
      return jsonResponse({ "dist-tags": { latest: "1.2.3" } });
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
    /\| \[tool-manage\]\(https:\/\/github\.com\/AlucPro\/tool-manage\) \| \[Website\]\(https:\/\/tool\.aluc\.pro\) \| 12 \| 3 \| 12\.3k\/mo \| `1\.2\.3` \| Manage local AI tool plugins and skills from the terminal\. \|/,
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
