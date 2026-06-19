#!/usr/bin/env node
// Generate combined testing checklist between production and staging versions
// Usage: pnpm run gen:checklist [--target=v2026.06.19-4] [-o=output.md]
//        pnpm run gen:checklist:target -- --target=v2026.06.19-4

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

function arg(short, long) {
  const a = process.argv.find(x => x.startsWith(`-${short}=`) || x.startsWith(`--${long}=`));
  return a ? a.split("=").slice(1).join("=") : "";
}
const outputFile = arg("o", "output");

function git(cmd) {
  try { return execSync(`git ${cmd}`, { encoding: "utf-8", stdio: "pipe" }).trim(); }
  catch { return ""; }
}

function ssh(cmd) {
  try { return execSync(`ssh yecaoyun "${cmd}"`, { encoding: "utf-8", stdio: "pipe", timeout: 5000 }).trim(); }
  catch { return ""; }
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

// Read and combine non-empty checklists — extract items and renumber
const items = [];

for (const tag of range) {
  const file = path.join(ROOT, "docs", "testing", `checklist-${tag}.md`);
  if (!fs.existsSync(file)) continue;

  const content = fs.readFileSync(file, "utf-8").trim();
  const stripped = content.replace(/\s/g, "");
  if (stripped === "无需测试" || stripped === "") continue;

  // Split by "###" sections, keep each item block
  const sections = content.split(/\n(?=###\s)/);
  for (const section of sections) {
    const s = section.trim();
    if (!s.startsWith("### ")) continue;
    // Strip original number, keep the rest
    const cleaned = s.replace(/^###\s+\d+\.\s*/, "### ");
    if (cleaned.trim()) items.push(cleaned);
  }
}

if (items.length === 0) {
  const msg = "无需测试\n";
  if (outputFile) fs.writeFileSync(path.resolve(outputFile), msg, "utf-8");
  else console.log(msg);
  console.error("No user-facing changes found");
  process.exit(0);
}

// Renumber items sequentially
const numbered = items.map((item, i) => item.replace(/^###\s+/, `### ${i + 1}. `));

const output = [
  `# ${targetTag} 合并测试清单`,
  "",
  `**版本**: ${prodTag} → ${targetTag}`,
  `**环境**: https://test.205716.xyz`,
  "",
  "---",
  "",
  numbered.join("\n\n"),
  "",
].join("\n");

if (outputFile) {
  const outPath = path.resolve(outputFile);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output, "utf-8");
  console.error(`Written: ${outPath}`);
} else {
  console.log(output);
}
console.error(`${items.length} items across ${range.length} versions`);

// ── Feishu Bitable integration ──
const useFeishu = process.argv.includes("--feishu");
if (useFeishu) {
  const ok = await publishToFeishu(items, targetTag);
  if (!ok) process.exit(1);
}

async function publishToFeishu(items, targetTag) {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  const appToken = process.env.FEISHU_BITABLE_TOKEN;
  const tableId = process.env.FEISHU_TABLE_ID;

  if (!appId || !appSecret || !appToken || !tableId) {
    console.error("⚠ Feishu env vars missing, skipping");
    return true;
  }

  console.error(">> Feishu auth...");
  const auth = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const token = (await auth.json())?.tenant_access_token;
  if (!token) { console.error("Auth failed"); return false; }

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const base = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}`;

  console.error(`>> Writing ${items.length} items...`);
  for (const item of items) {
    const p = parseItem(item);
    const record = {
      fields: {
        版本: targetTag,
        功能: p.title,
        操作步骤: p.op,
        预期结果: p.ex,
        来源: "自动生成",
      },
    };
    const res = await fetch(`${base}/records`, { method: "POST", headers, body: JSON.stringify(record) });
    if (!res.ok) { console.error(`Write failed: ${res.status}`); return false; }
  }
  console.error(`  ${items.length} items appended`);

  // Notify chat if configured
  const chatId = process.env.FEISHU_CHAT_ID;
  if (chatId && process.env.FEISHU_BITABLE_URL) {
    const url = process.env.FEISHU_BITABLE_URL;
    const msg = JSON.stringify({
      receive_id: chatId,
      msg_type: "interactive",
      content: JSON.stringify({
        header: { title: { tag: "plain_text", content: `📋 ${targetTag} 待测试` } },
        elements: [{ tag: "markdown", content: `共 ${items.length} 项核对。\n[打开表格](${url})` }],
      }),
    });
    await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
      method: "POST", headers, body: msg,
    });
    console.error("  Notification sent");
  }

  return true;
}

function parseItem(item) {
  let title = item.replace(/^###\s+\d+\.\s*/, "").split("\n")[0].trim();
  title = title.replace(/^###\s*/, "").trim();
  const body = item.replace(/^###\s+.*\n/, "");
  const opMatch = body.match(/\*\*操作\*\*:\s*(.+)/);
  const exMatch = body.match(/\*\*预期\*\*:\s*(.+)/);
  return {
    title,
    op: opMatch ? opMatch[1].trim() : "",
    ex: exMatch ? exMatch[1].trim() : "",
  };
}
