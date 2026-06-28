import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  aggregateLanguages,
  buildRecentlySummary,
  renderRecentlyBlock,
  updateRecently,
} from "../scripts/update-recently.mjs";

test("aggregates language changes across authored commits", () => {
  const languages = aggregateLanguages([
    ["TypeScript", 12_000],
    ["Markdown", 3_000],
    ["TypeScript", 6_000],
    ["JSON", 1_500],
  ]);

  assert.deepEqual(languages.map((language) => language.name), [
    "TypeScript",
    "Markdown",
    "JSON",
  ]);
  assert.equal(languages[0].lines, 18_000);
  assert.equal(languages[0].percent.toFixed(2), "80.00");
});

test("renders a monthly built with and shipped block", () => {
  const block = renderRecentlyBlock({
    languages: [
      { name: "TypeScript", lines: 36_000, percent: 50 },
      { name: "Markdown", lines: 18_000, percent: 25 },
      { name: "JSON", lines: 7_200, percent: 10 },
      { name: "JavaScript", lines: 3_600, percent: 5 },
      { name: "YAML", lines: 1_800, percent: 2.5 },
      { name: "CSS", lines: 1_800, percent: 2.5 },
    ],
    stats: {
      activeRepos: 3,
      commits: 18,
      releases: 2,
    },
  });

  assert.match(block, /\*\*𝚝𝚑𝚒𝚜 𝚖𝚘𝚗𝚝𝚑 𝚒 𝚋𝚞𝚒𝚕𝚝 𝚠𝚒𝚝𝚑:\*\*/);
  assert.match(block, /```txt/);
  assert.match(block, /TypeScript\s+36\.0k lines\s+█████████████░░░░░░░░░░░░\s+50\.00 %/);
  assert.match(block, /CSS\s+1\.8k lines/);
  assert.match(block, /shipped\s+3 active repos · 18 commits · 2 releases/);
});

test("builds GitHub-derived recently summary from authored commit file changes", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });

    if (url.includes("/user/repos")) {
      return jsonResponse([
        {
          full_name: "AlucPro/app",
          fork: false,
          archived: false,
          updated_at: "2026-05-20T00:00:00Z",
        },
        {
          full_name: "AlucPro/private-app",
          private: true,
          fork: false,
          archived: false,
          updated_at: "2026-05-22T00:00:00Z",
        },
        {
          full_name: "AlucPro/old",
          fork: false,
          archived: false,
          updated_at: "2026-03-01T00:00:00Z",
        },
      ]);
    }

    if (url.includes("/repos/AlucPro/private-app/commits/c")) {
      return jsonResponse({
        files: [
          { filename: "src/private.js", additions: 4, deletions: 1 },
          { filename: "docs/private.md", additions: 2, deletions: 1 },
        ],
      });
    }

    if (url.includes("/repos/AlucPro/private-app/commits")) {
      return jsonResponse([{ sha: "c" }]);
    }

    if (url.includes("/repos/AlucPro/private-app/releases")) {
      return jsonResponse([]);
    }

    if (url.includes("/repos/AlucPro/app/commits/a")) {
      return jsonResponse({
        files: [
          { filename: "src/app.ts", additions: 10, deletions: 2 },
          { filename: "README.md", additions: 5, deletions: 5 },
          { filename: "public/index.html", additions: 500, deletions: 250 },
        ],
      });
    }

    if (url.includes("/repos/AlucPro/app/commits/b")) {
      return jsonResponse({
        files: [
          { filename: "src/style.css", additions: 3, deletions: 0 },
          { filename: "docs/guide.mdx", additions: 2, deletions: 0 },
        ],
      });
    }

    if (url.includes("/repos/AlucPro/app/commits")) {
      return jsonResponse([{ sha: "a" }, { sha: "b" }]);
    }

    if (url.includes("/repos/AlucPro/app/releases")) {
      return jsonResponse([{ published_at: "2026-05-10T00:00:00Z" }]);
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const summary = await buildRecentlySummary({
    username: "AlucPro",
    token: "profile-token",
    today: new Date("2026-05-28T00:00:00.000Z"),
    fetchImpl,
  });

  assert.equal(summary.stats.activeRepos, 2);
  assert.equal(summary.stats.commits, 3);
  assert.equal(summary.stats.releases, 1);
  assert.deepEqual(summary.languages.map((language) => language.name), ["Markdown", "TypeScript", "JavaScript", "CSS"]);
  assert.equal(summary.languages.find((language) => language.name === "Markdown")?.lines, 15);
  assert.equal(summary.languages.some((language) => language.name === "HTML"), false);
  assert.ok(calls.some((call) => call.url.includes("/user/repos?visibility=all&affiliation=owner")));
  assert.ok(calls.every((call) => call.options.headers.Authorization === "Bearer profile-token"));
  assert.ok(calls.some((call) => call.url.includes("since=2026-04-29T00%3A00%3A00.000Z")));
  assert.ok(calls.some((call) => call.url.includes("author=AlucPro")));
  assert.equal(calls.some((call) => call.url.includes("/languages")), false);
});

test("updates only the README recently marker block", async () => {
  const dir = await mkdtemp(join(tmpdir(), "recently-"));
  const readmePath = join(dir, "README.md");

  await writeFile(
    readmePath,
    [
      "# Profile",
      "",
      "before",
      "<!-- RECENTLY:START -->",
      "old recently",
      "<!-- RECENTLY:END -->",
      "after",
      "",
    ].join("\n"),
  );

  const fetchImpl = async (url) => {
    if (url.includes("/user/repos")) {
      return jsonResponse([
        {
          full_name: "AlucPro/app",
          fork: false,
          archived: false,
          updated_at: "2026-05-20T00:00:00Z",
        },
      ]);
    }

    if (url.includes("/repos/AlucPro/app/commits/a")) {
      return jsonResponse({
        files: [
          { filename: "src/app.ts", additions: 72, deletions: 0 },
          { filename: "README.md", additions: 18, deletions: 0 },
          { filename: "index.html", additions: 900, deletions: 0 },
        ],
      });
    }

    if (url.includes("/repos/AlucPro/app/commits")) {
      return jsonResponse([{ sha: "a" }]);
    }

    if (url.includes("/repos/AlucPro/app/releases")) {
      return jsonResponse([]);
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await updateRecently({
    username: "AlucPro",
    token: "profile-token",
    today: new Date("2026-05-28T00:00:00.000Z"),
    fetchImpl,
    readmePath,
  });
  const readme = await readFile(readmePath, "utf8");

  assert.equal(result.updated, true);
  assert.match(readme, /before/);
  assert.match(readme, /after/);
  assert.doesNotMatch(readme, /old recently/);
  assert.match(readme, /TypeScript\s+72 lines/);
  assert.match(readme, /Markdown\s+18 lines/);
  assert.doesNotMatch(readme, /HTML/);
  assert.match(readme, /shipped\s+1 active repo · 1 commit · 0 releases/);
});

function jsonResponse(body) {
  return {
    ok: true,
    headers: new Map(),
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}
