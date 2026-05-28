import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  aggregateLanguages,
  renderRecentlyBlock,
  updateRecently,
} from "../scripts/update-recently.mjs";

test("aggregates languages across WakaTime daily summaries", () => {
  const languages = aggregateLanguages([
    {
      languages: [
        { name: "TypeScript", total_seconds: 3600 },
        { name: "Markdown", total_seconds: 900 },
      ],
    },
    {
      languages: [
        { name: "TypeScript", total_seconds: 1800 },
        { name: "JSON", total_seconds: 600 },
      ],
    },
  ]);

  assert.deepEqual(languages.map((language) => language.name), [
    "TypeScript",
    "Markdown",
    "JSON",
  ]);
  assert.equal(languages[0].totalSeconds, 5400);
  assert.equal(languages[0].percent.toFixed(2), "78.26");
});

test("renders a monthly recently block with more language rows", () => {
  const block = renderRecentlyBlock([
    { name: "TypeScript", totalSeconds: 36000, percent: 50 },
    { name: "Markdown", totalSeconds: 18000, percent: 25 },
    { name: "JSON", totalSeconds: 7200, percent: 10 },
    { name: "JavaScript", totalSeconds: 3600, percent: 5 },
    { name: "YAML", totalSeconds: 1800, percent: 2.5 },
    { name: "CSS", totalSeconds: 1800, percent: 2.5 },
  ]);

  assert.match(block, /\*\*this month i spent my time on:\*\*/);
  assert.match(block, /```txt/);
  assert.match(block, /TypeScript\s+10 hrs\s+█████████████░░░░░░░░░░░░\s+50\.00 %/);
  assert.match(block, /CSS\s+30 mins/);
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
    assert.match(url, /start=2026-04-29/);
    assert.match(url, /end=2026-05-28/);

    return {
      ok: true,
      async json() {
        return {
          data: [
            {
              languages: [
                { name: "TypeScript", total_seconds: 7200 },
                { name: "Markdown", total_seconds: 1800 },
              ],
            },
          ],
        };
      },
      async text() {
        return "";
      },
    };
  };

  const result = await updateRecently({
    apiKey: "waka-key",
    today: new Date("2026-05-28T00:00:00.000Z"),
    fetchImpl,
    readmePath,
  });
  const readme = await readFile(readmePath, "utf8");

  assert.equal(result.updated, true);
  assert.match(readme, /before/);
  assert.match(readme, /after/);
  assert.doesNotMatch(readme, /old recently/);
  assert.match(readme, /TypeScript\s+2 hrs/);
  assert.match(readme, /Markdown\s+30 mins/);
});
