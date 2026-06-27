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
// When two PRs merge in quick succession, both merges land on master before
// either auto-tag runs.  The first tag already covers the combined HEAD —
// skip creating a redundant tag to avoid a wasteful duplicate staging deploy.
const allSorted = execSync("git tag --sort=-creatordate -l 'v*'", { encoding: "utf-8" }).split("\n").filter(Boolean);
const latestTag = allSorted[0];
if (latestTag && doPush) {
  execSync("git fetch origin master --quiet", { stdio: "ignore" });
  try {
    execSync(`git diff --quiet "${latestTag}" origin/master`, { stdio: "ignore" });
    console.log(`origin/master unchanged since ${latestTag} — skipping redundant tag`);
    process.exit(0);
  } catch {
    // diff exits non-zero when there are changes — proceed normally
  }
}

// ── CI checklist placeholder ────────────────────────────────────────────
if (isCI) {
  const checklistDir = path.resolve(process.cwd(), "docs/testing");
  const checklistFile = path.join(checklistDir, `checklist-${tag}.md`);
  if (!fs.existsSync(checklistDir)) {
    fs.mkdirSync(checklistDir, { recursive: true });
  }
  if (!fs.existsSync(checklistFile)) {
    fs.writeFileSync(checklistFile, "无需测试\n", "utf-8");
    execSync(`git add "${checklistFile}"`, { stdio: "ignore" });
    execSync(`git commit -m "📝 docs: add testing checklist placeholder for ${tag}"`, { stdio: "inherit" });
  }
  console.log(`Created: ${checklistFile}`);
}

// ── Local checklist (pre-tag) ───────────────────────────────────────────
// Creating the checklist BEFORE pushing the tag means the pre-push hook
// finds it already present and skips amend — avoiding the recursive
// push-in-hook pitfall that causes local/remote divergence.
if (!isCI && doPush) {
  const checklistDir = path.resolve(process.cwd(), "docs/testing");
  const checklistFile = path.join(checklistDir, `checklist-${tag}.md`);
  if (!fs.existsSync(checklistFile)) {
    if (!fs.existsSync(checklistDir)) {
      fs.mkdirSync(checklistDir, { recursive: true });
    }
    fs.writeFileSync(checklistFile, "无需测试\n", "utf-8");
    execSync(`git add "${checklistFile}"`, { stdio: "ignore" });
    execSync("git commit --amend --no-edit", { stdio: "ignore" });
    console.log(`Created: ${checklistFile}`);
  }
}

// ── Sync with origin/master (CI only) ───────────────────────────────────
// CI checkout may be a stale ref; rebase ensures tag points at real master.
if (doPush && isCI) {
  execSync("git fetch origin master --quiet");
  execSync("git rebase origin/master", { stdio: "inherit" });
}

// ── Tag & push ──────────────────────────────────────────────────────────
const msg = doPush ? `Creating and pushing: ${tag}` : `Creating: ${tag}`;
console.log(msg);
execSync(`git tag -a "${tag}" -m "${tag}"`, { stdio: "inherit" });

if (doPush) {
  if (isCI) {
    execSync(`git push origin HEAD:master`, { stdio: "inherit" });
  }
  execSync(`git push origin "${tag}"`, { stdio: "inherit" });
  console.log(`Pushed: ${tag}`);
} else {
  console.log(`Tag created locally. Push with: git push origin ${tag}`);
}
