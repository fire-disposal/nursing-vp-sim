#!/usr/bin/env node
/**
 * 部署成功通知 — 钉钉 Webhook 播报
 *
 * 环境变量：
 *   DINGTALK_WEBHOOK  钉钉机器人 Webhook 完整 URL（含 access_token）
 *   DEPLOY_VERSION    部署版本号（如 2026.07.14-1）
 *   DEPLOY_ENV        环境标识（staging | production）
 *   DEPLOY_URL        访问 URL
 *   PREV_VERSION      上一个版本号（可选）
 *   COMMITS           最近提交列表（可选，每行一个 --oneline 格式）
 */

const webhook = process.env.DINGTALK_WEBHOOK;
if (!webhook) {
  console.log("⚠ DINGTALK_WEBHOOK not set — skipping notification");
  process.exit(0);
}

const version = process.env.DEPLOY_VERSION || "unknown";
const env = process.env.DEPLOY_ENV || "unknown";
const url = process.env.DEPLOY_URL || "";
const prev = process.env.PREV_VERSION || "";
const commitsRaw = process.env.COMMITS || "";

const envLabel = env === "production" ? "🚀 正式服" : "🧪 测试服";
const title = `${envLabel} 部署成功`;

const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const bj = new Date(now.getTime() + 8 * 3600 * 1000);
const ts = `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())} ${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}:${pad(bj.getUTCSeconds())} CST`;

const prevLine = prev ? `\n> 上一版本：**${prev}**` : "";

let commitsBlock = "";
if (commitsRaw) {
  const lines = commitsRaw.trim().split("\n").filter(Boolean).slice(0, 5);
  if (lines.length > 0) {
    commitsBlock = "\n\n**最近提交**\n" + lines.map((l) => `> ${l}`).join("\n");
  }
}

const markdown = `## ${title} v${version}
> 时间：${ts}
> 地址：[${url}](${url})${prevLine}${commitsBlock}
---
> Nursing VP Sim 护理虚拟患者系统`;

const payload = {
  msgtype: "markdown",
  markdown: { title, text: markdown },
};

try {
  const resp = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await resp.text();
  if (resp.ok) {
    console.log(`✓ DingTalk notified (${env})`);
  } else {
    console.error(`✗ DingTalk failed (${resp.status}): ${body.slice(0, 200)}`);
    process.exit(1);
  }
} catch (err) {
  console.error(`✗ DingTalk request error: ${err.message}`);
  process.exit(1);
}
