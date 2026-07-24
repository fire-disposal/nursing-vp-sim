#!/usr/bin/env node
// Auto-generate date-based tag: vYYYY.MM.DD-N
// Usage: node .husky/_/auto-tag.mjs [--push]

import { execSync } from "child_process";

const bj = new Date(new Date().getTime() + 8 * 3600 * 1000);
const today = bj.toISOString().slice(0, 10).replace(/-/g, ".");
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

// ── Sync with origin/master (CI only) ──────────────────────────────────
if (doPush && isCI) {
  execSync("git fetch origin master --quiet");
  execSync("git rebase origin/master", { stdio: "inherit" });
}

// ── Tag & push ─────────────────────────────────────────────────────────
const msg = doPush ? `Creating and pushing: ${tag}` : `Creating: ${tag}`;
console.log(msg);

// Dirty working tree gate — pre-commit hooks (ruff format etc.) may leave unstaged changes.
// Reject early so we never tag a dirty tree.
const porcelain = execSync("git status --porcelain", { encoding: "utf-8" }).trim();
if (porcelain) {
  console.error("ABORT: working tree is not clean. Stage or discard changes before tagging:");
  console.error(porcelain.split("\n").slice(0, 10).join("\n"));
  process.exit(1);
}

execSync(`git tag -a "${tag}" -m "${tag}"`, { stdio: "inherit" });

if (doPush) {
  execSync(`git push origin HEAD:master`, { stdio: "inherit", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  execSync(`git push origin "${tag}"`, { stdio: "inherit", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  console.log(`Pushed: ${tag}`);
} else {
  console.log(`Tag created: ${tag}`);
  console.log(`Push with: git push origin HEAD:master && git push origin ${tag}`);
}
