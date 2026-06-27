#!/usr/bin/env node
// Auto-generate date-based tag: vYYYY.MM.DD-N
// Usage: node .husky/_/auto-tag.mjs [--push]

import { execSync } from "child_process";
import fs from "node:fs";
import path from "node:path";

const today = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
const prefix = `v${today}`;

execSync("git fetch --tags --quiet", { stdio: "ignore" });

const tags = execSync("git tag -l", { encoding: "utf-8" }).split("\n").filter(Boolean);
const todayTags = tags.filter((t) => t.startsWith(prefix));
const nums = todayTags
  .map((t) => parseInt(t.replace(`${prefix}-`, ""), 10))
  .filter((n) => !isNaN(n));
const next = nums.length ? Math.max(...nums) + 1 : 1;
const tag = `${prefix}-${next}`;

const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;
const doPush = process.argv.includes("--push");

// ── Redundancy gate ─────────────────────────────────────────────────────
const allSorted = execSync("git tag --sort=-creatordate -l 'v*'", { encoding: "utf-8" }).split("\n").filter(Boolean);
const latestTag = allSorted[0];
if (latestTag && doPush) {
  execSync("git fetch origin master --quiet", { stdio: "ignore" });
  try {
    execSync(`git diff --quiet "${latestTag}" origin/master`, { stdio: "ignore" });
    console.log(`origin/master unchanged since ${latestTag} — skipping redundant tag`);
    process.exit(0);
  } catch {
    // diff exits non-zero — proceed
  }
}

// ── Checklist (always created as a NEW commit, never amend) ─────────────
// Amending a published commit and force-pushing causes divergence and
// non-fast-forward rejections.  A dedicated commit keeps history linear.
const checklistDir = path.resolve(process.cwd(), "docs/testing");
const checklistFile = path.join(checklistDir, `checklist-${tag}.md`);

function ensureChecklist() {
  if (fs.existsSync(checklistFile)) return;
  if (!fs.existsSync(checklistDir)) {
    fs.mkdirSync(checklistDir, { recursive: true });
  }
  fs.writeFileSync(checklistFile, "无需测试\n", "utf-8");
  execSync(`git add "${checklistFile}"`, { stdio: "ignore" });
  execSync(`git commit -m "📝 docs: add testing checklist for ${tag}"`, { stdio: "inherit" });
  console.log(`Created: ${checklistFile}`);
}

if (doPush) {
  ensureChecklist();
}

// ── Sync with origin/master (CI only) ──────────────────────────────────
if (doPush && isCI) {
  execSync("git fetch origin master --quiet");
  execSync("git rebase origin/master", { stdio: "inherit" });
}

// ── Tag & push ─────────────────────────────────────────────────────────
const msg = doPush ? `Creating and pushing: ${tag}` : `Creating: ${tag}`;
console.log(msg);
execSync(`git tag -a "${tag}" -m "${tag}"`, { stdio: "inherit" });

if (doPush) {
  execSync(`git push origin HEAD:master`, { stdio: "inherit" });
  execSync(`git push origin "${tag}"`, { stdio: "inherit" });
  console.log(`Pushed: ${tag}`);
} else {
  console.log(`Tag created: ${tag}`);
  console.log(`Push with: git push origin HEAD:master && git push origin ${tag}`);
}
