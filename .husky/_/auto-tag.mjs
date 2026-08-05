#!/usr/bin/env node
// Auto-generate date-based tag: vYYYY.MM.DD-N
// Usage: node .husky/_/auto-tag.mjs [--push] [--force]
//   --push   create tag, push HEAD:master and the tag to origin
//   --force  skip the redundancy gate (used when a deploy must happen even
//            if origin/master matches the latest tag, e.g. PiOps merges)
//
// Cross-platform note: all git invocations go through execFileSync with
// argument arrays (never shell-quoted strings), so behavior is identical
// on Windows cmd, macOS sh, and Linux bash/Arch.

import { execFileSync } from "child_process";

const args = process.argv.slice(2);
const doPush = args.includes("--push");
const force = args.includes("--force");
const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;
const MAX_ATTEMPTS = 3;

const bj = new Date(new Date().getTime() + 8 * 3600 * 1000);
const today = bj.toISOString().slice(0, 10).replace(/-/g, ".");
const prefix = `v${today}`;

function git(...gitArgs) {
  return execFileSync("git", gitArgs, { encoding: "utf-8" });
}

function gitQuiet(...gitArgs) {
  execFileSync("git", gitArgs, { stdio: "ignore" });
}

function fetchTags() {
  gitQuiet("fetch", "--tags", "--quiet");
}

function computeNext() {
  const tags = git("tag", "-l").split("\n").filter(Boolean);
  const todayTags = tags.filter((t) => t.startsWith(prefix));
  const nums = todayTags
    .map((t) => parseInt(t.replace(`${prefix}-`, ""), 10))
    .filter((n) => !isNaN(n));
  return nums.length ? Math.max(...nums) + 1 : 1;
}

// Remote double-check: confirm the candidate tag does not already exist on
// origin, so a concurrent publisher picking the same sequence number is
// caught before we even try to push.
function remoteHasTag(tag) {
  try {
    const out = git("ls-remote", "--tags", "origin", tag);
    return out.trim().length > 0;
  } catch {
    return false; // ls-remote failure → treat as absent; push retry still guards
  }
}

function cleanTag(tag) {
  try {
    gitQuiet("tag", "-d", tag);
  } catch {
    // tag may not exist locally — fine
  }
}

// ── Redundancy gate (skipped with --force) ─────────────────────────────
// Only when pushing: if origin/master has not changed since the newest tag,
// a new tag would be redundant. PiOps merges force a deploy regardless.
if (doPush && !force) {
  const allSorted = git("tag", "--sort=-creatordate", "-l", "v*")
    .split("\n")
    .filter(Boolean);
  const latestTag = allSorted[0];
  if (latestTag) {
    gitQuiet("fetch", "origin", "master");
    try {
      gitQuiet("diff", "--quiet", latestTag, "origin/master");
      console.log(`origin/master unchanged since ${latestTag} — skipping redundant tag`);
      process.exit(0);
    } catch {
      // diff exits non-zero — proceed
    }
  }
}

// ── Dirty working tree gate ────────────────────────────────────────────
// Reject early so we never tag a dirty tree.
const porcelain = git("status", "--porcelain").trim();
if (porcelain) {
  console.error("ABORT: working tree is not clean. Stage or discard changes before tagging:");
  console.error(porcelain.split("\n").slice(0, 10).join("\n"));
  process.exit(1);
}

// ── Sync with origin/master (CI only) ──────────────────────────────────
if (doPush && isCI) {
  gitQuiet("fetch", "origin", "master");
  execFileSync("git", ["rebase", "origin/master"], { stdio: "inherit" });
}

// ── Tag & push with conflict retry ─────────────────────────────────────
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  fetchTags();
  const next = computeNext();
  const tag = `${prefix}-${next}`;

  if (remoteHasTag(tag)) {
    console.warn(`⚠ ${tag} already exists on origin (concurrent publish?) — refetching tags`);
    continue;
  }

  console.log(`Creating and pushing: ${tag}`);

  try {
    execFileSync("git", ["tag", "-a", tag, "-m", tag], { stdio: "inherit" });
    if (doPush) {
      execFileSync("git", ["push", "origin", "HEAD:master"], {
        stdio: "inherit",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      execFileSync("git", ["push", "origin", tag], {
        stdio: "inherit",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      console.log(`Pushed: ${tag}`);
      process.exit(0);
    }
    console.log(`Tag created: ${tag}`);
    console.log(`Push with: git push origin HEAD:master && git push origin ${tag}`);
    process.exit(0);
  } catch (err) {
    cleanTag(tag);
    if (attempt < MAX_ATTEMPTS) {
      const msg = String(err.stderr || err.message || err).split("\n").filter(Boolean).slice(-2).join(" | ");
      console.warn(`⚠ push failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${msg}`);
      console.warn("  refetching tags and retrying with a fresh sequence number...");
    } else {
      console.error(`ABORT: tag push failed after ${MAX_ATTEMPTS} attempts`);
      process.exit(1);
    }
  }
}
