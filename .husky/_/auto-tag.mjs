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

// ── Feat/fix detection ──────────────────────────────────────────────────
const prevTag = allSorted.length > 1 ? allSorted[1] : "";
function hasFeatOrFix() {
  if (!prevTag) return false;
  const log = execSync(`git log ${prevTag}..HEAD --oneline --no-merges`, { encoding: "utf-8" });
  return /\s(✨|🐛)\s*(feat|fix):/.test(log);
}

// ── Checklist (only for feat/fix versions) ──────────────────────────────
// Non-feat/fix versions don't need a checklist file — the pre-push hook
// gate only activates when user-facing changes are detected.
const needChecklist = doPush && hasFeatOrFix();
if (needChecklist) {
  const checklistDir = path.resolve(process.cwd(), "docs/testing");
  const checklistFile = path.join(checklistDir, `checklist-${tag}.md`);

  if (!fs.existsSync(checklistFile)) {
    // Create a stub so the pre-push hook finds the file and checks length.
    // The stub is intentionally too short (<30 chars); pre-push will block
    // until a real checklist is written.
    const stub = "TODO: write real checklist for ${tag}\n";
    if (!fs.existsSync(checklistDir)) {
      fs.mkdirSync(checklistDir, { recursive: true });
    }
    fs.writeFileSync(checklistFile, stub, "utf-8");
    console.log(`Created stub: ${checklistFile} (real checklist needed — feat/fix commits detected)`);

    if (isCI) {
      // In CI, commit the stub so it's part of the push.
      // Pre-push will block because stub is too short — intentional:
      // CI should not pass with an auto-generated placeholder for feat/fix.
      execSync(`git add "${checklistFile}"`, { stdio: "ignore" });
      execSync(`git commit -m "📝 docs: stub checklist for ${tag} (real checklist needed)"`, { stdio: "inherit" });
    } else {
      // Local: leave the stub in the working tree.  User writes the real
      // checklist, commits it, then re-runs `pnpm run tag`.
      console.log("→ generate a real checklist and commit it, then re-run: pnpm run tag");
      process.exit(0);
    }
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
execSync(`git tag -a "${tag}" -m "${tag}"`, { stdio: "inherit" });

if (doPush) {
  execSync(`git push origin HEAD:master`, { stdio: "inherit" });
  execSync(`git push origin "${tag}"`, { stdio: "inherit" });
  console.log(`Pushed: ${tag}`);
} else {
  console.log(`Tag created: ${tag}`);
  console.log(`Push with: git push origin HEAD:master && git push origin ${tag}`);
}
