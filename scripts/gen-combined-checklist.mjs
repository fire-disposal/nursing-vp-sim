#!/usr/bin/env node
// Generate combined testing checklist between production and staging versions
// Usage: pnpm run gen:checklist [--target=v2026.06.19-4] [-o=output.md]
//        pnpm run gen:checklist:target -- --target=v2026.06.19-4

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

function git(cmd) {
  try { return execSync(`git ${cmd}`, { encoding: "utf-8", stdio: "pipe" }).trim(); }
  catch { return ""; }
}

function ssh(cmd) {
  try { return execSync(`ssh yecaoyun "${cmd}"`, { encoding: "utf-8", stdio: "pipe", timeout: 5000 }).trim(); }
  catch { return ""; }
}

// Parse args: support both --key=value and -k=value
function arg(short, long) {
  const a = process.argv.find(x => x.startsWith(`-${short}=`) || x.startsWith(`--${long}=`));
  return a ? a.split("=").slice(1).join("=") : "";
}

// Get all version tags sorted
const allTags = git("tag --sort=version:refname")
  .split("\n")
  .filter(t => /^v\d+\.\d+\.\d+-\d+$/.test(t));

if (allTags.length === 0) {
  console.error("No version tags found");
  process.exit(1);
}

// Target version: from arg or latest tag
let targetVer = arg("t", "target").replace(/^v/, "");
if (!targetVer) {
  targetVer = allTags[allTags.length - 1].replace(/^v/, "");
}
const targetTag = "v" + targetVer;

if (!allTags.includes(targetTag)) {
  console.error(`Target tag ${targetTag} not found`);
  process.exit(1);
}

// Production version: from arg, server, or tag before target
let prodVer = arg("f", "from").replace(/^v/, "");
if (!prodVer) {
  prodVer = ssh("tail -1 /opt/nursing-vp-sim/.version-history 2>/dev/null | cut -d'|' -f1");
}
if (!prodVer) {
  const idx = allTags.indexOf(targetTag);
  prodVer = idx > 0 ? allTags[idx - 1].replace(/^v/, "") : targetVer;
  console.error("⚠ Using tag before target as production version (SSH unavailable)");
}
const prodTag = "v" + prodVer;

console.error(`Production: ${prodTag}`);
console.error(`Target:     ${targetTag}`);

// Find tags between prod and target (inclusive)
const prodIdx = allTags.indexOf(prodTag);
const targetIdx = allTags.indexOf(targetTag);
const range = allTags.slice(Math.max(0, prodIdx), targetIdx + 1);

// Read and combine non-empty checklists
let combined = "";
let count = 0;

for (const tag of range) {
  const file = path.join(ROOT, "docs", "testing", `checklist-${tag}.md`);
  if (!fs.existsSync(file)) continue;

  const content = fs.readFileSync(file, "utf-8").trim();
  const stripped = content.replace(/\s/g, "");
  if (stripped === "无需测试" || stripped === "") continue;

  // Extract body: skip title and version/env headers
  const body = content.split("\n")
    .filter(l => {
      const t = l.trim();
      if (t.startsWith("# ")) return false;
      if (t.startsWith("**版本**") || t.startsWith("**环境**")) return false;
      return true;
    })
    .join("\n")
    .trim();

  if (!body) continue;

  combined += body + "\n\n";
  count++;
}

// Output
const outFile = arg("o", "output");

if (!combined.trim()) {
  const msg = "无需测试\n";
  if (outFile) fs.writeFileSync(path.resolve(outFile), msg, "utf-8");
  else console.log(msg);
  console.error("No user-facing changes found");
  process.exit(0);
}

const output = [
  `# ${targetTag} 合并测试清单`,
  "",
  `**版本**: ${prodTag} → ${targetTag}`,
  `**环境**: https://test.205716.xyz`,
  "",
  "---",
  "",
  combined.trim(),
  "",
].join("\n");

if (outFile) {
  const outPath = path.resolve(outFile);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output, "utf-8");
  console.error(`Written: ${outPath}`);
} else {
  console.log(output);
}
console.error(`${count} versions with user-facing changes`);
