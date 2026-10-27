#!/usr/bin/env node
// Auto-generate date-based tag: vYYYY.MM.DD-N
// Usage: node .husky/_/auto-tag.mjs [--push] [--force]
//   --push   create tag, push HEAD:master and the tag to origin
//   --force  skip the redundancy gate (used when a deploy must happen even
//            if origin/master matches the latest tag, e.g. a config/ops-only change)
//
// Cross-platform note: all git invocations go through execFileSync with
// argument arrays (never shell-quoted strings), so behavior is identical
// on Windows cmd, macOS sh, and Linux bash/Arch.

import { execFileSync } from "child_process";

const args = process.argv.slice(2);
const doPush = args.includes("--push");
const force = args.includes("--force");
// 只认 GITHUB_ACTIONS：通用 `CI` 变量在本地 shell/容器里也常为真，一旦误判就会在
// "本地发布"时把当前 HEAD rebase 到 origin/master —— 实测把刚做好的 merge 提交改写掉并撞冲突。
const isCI = !!process.env.GITHUB_ACTIONS;
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
// a new tag would be redundant. 非代码类变更（配置/运维）需要发版时用 --force。
if (doPush && !force) {
  const latestTag = git("tag", "--sort=-creatordate", "-l", "v*")
    .split("\n")
    .filter(Boolean)[0];
  if (latestTag) {
    gitQuiet("fetch", "origin", "master");
    let remoteSameAsTag = false;
    try {
      gitQuiet("diff", "--quiet", latestTag, "origin/master");
      remoteSameAsTag = true;
    } catch {
      // diff exits non-zero — origin/master 已前进，正常打 tag
    }
    // 本地还有未推送提交时不能跳过：否则"merge 已就绪但远端未变"会打不出 tag
    // （本次发布实测撞到过）。只有两边都追平才算冗余。
    const headAhead = (() => {
      try {
        return git("rev-list", "--count", "origin/master..HEAD").trim() !== "0";
      } catch {
        return true;
      }
    })();
    if (remoteSameAsTag && !headAhead) {
      console.log(`origin/master unchanged since ${latestTag} — skipping redundant tag`);
      process.exit(0);
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
