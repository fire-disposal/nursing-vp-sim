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

// ── Feishu integration ──
const useFeishu = process.argv.includes("--feishu");
if (useFeishu) {
  const ok = await publishToFeishu(items, targetTag, prodTag);
  if (!ok) process.exit(1);
}

async function publishToFeishu(items, targetTag, prodTag) {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  const chatId = process.env.FEISHU_CHAT_ID;

  if (!appId || !appSecret) {
    console.error("⚠ FEISHU_APP_ID / FEISHU_APP_SECRET not set, skipping feishu");
    return true;
  }

  // 1. Get tenant_access_token
  console.error(">> Feishu auth...");
  const tokenRes = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  if (!tokenRes.ok) {
    console.error("Feishu auth failed:", tokenRes.status);
    return false;
  }
  const tokenData = await tokenRes.json();
  const token = tokenData.tenant_access_token;
  if (!token) {
    console.error("Feishu auth: no token returned");
    return false;
  }

  // 2. Create spreadsheet
  console.error(">> Creating spreadsheet...");
  const title = `${targetTag} 测试核对单 (${prodTag} → ${targetTag})`;
  const sheetRes = await fetch("https://open.feishu.cn/open-apis/sheets/v3/spreadsheets", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title, folder_token: process.env.FEISHU_FOLDER_TOKEN || "" }),
  });
  if (!sheetRes.ok) {
    const err = await sheetRes.text();
    console.error("Feishu create sheet failed:", sheetRes.status, err);
    return false;
  }
  const sheetData = await sheetRes.json();
  const sheetToken = sheetData?.data?.spreadsheet?.spreadsheet_token;
  const sheetUrl = sheetData?.data?.spreadsheet?.url;
  if (!sheetToken) {
    console.error("Feishu: no spreadsheet_token in response");
    return false;
  }
  console.error(`  Sheet: ${sheetUrl}`);

  // 3. Write header + rows
  console.error(">> Writing rows...");
  const rows = [
    ["序号", "功能", "操作步骤", "预期结果", "通过", "失败", "备注"],
    ...items.map((item, i) => parseItem(item, i + 1)),
  ];
  const writeRes = await fetch(
    `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${sheetToken}/values`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ valueRange: { range: "A1", values: rows } }),
    }
  );
  if (!writeRes.ok) {
    const err = await writeRes.text();
    console.error("Feishu write failed:", writeRes.status, err);
    return false;
  }
  console.error(`  ${items.length} items written`);

  // 4. Send message to chat
  if (chatId) {
    console.error(">> Sending notification...");
    const msg = JSON.stringify({
      receive_id: chatId,
      msg_type: "interactive",
      content: JSON.stringify({
        header: { title: { tag: "plain_text", content: `📋 ${targetTag} 待测试` } },
        elements: [{
          tag: "markdown",
          content: `**${prodTag} → ${targetTag}** 共 ${items.length} 项核对，请在表格中勾选通过/失败。\n[打开表格](${sheetUrl})`,
        }],
      }),
    });
    const msgRes = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: msg,
    });
    if (!msgRes.ok) {
      console.error("Feishu message failed:", msgRes.status, await msgRes.text());
    } else {
      console.error("  Notification sent");
    }
  }

  console.error(">> Done");
  return true;
}

function parseItem(item, num) {
  const title = item.replace(/^###\s+\d+\.\s*/, "").split("\n")[0].trim();
  const body = item.replace(/^###\s+.*\n/, "");
  const opMatch = body.match(/\*\*操作\*\*:\s*(.+)/);
  const exMatch = body.match(/\*\*预期\*\*:\s*(.+)/);
  return [
    String(num),
    title,
    opMatch ? opMatch[1].trim() : "",
    exMatch ? exMatch[1].trim() : "",
    "",  // 通过
    "",  // 失败
    "",  // 备注
  ];
}
