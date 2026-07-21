#!/usr/bin/env node
/**
 * 部署成功通知 — 钉钉 Webhook 播报
 *
 * 环境变量：
 *   DINGTALK_WEBHOOK  钉钉机器人 Webhook 完整 URL（含 access_token）
 *   DEPLOY_VERSION    部署版本号（如 2026.07.14-1）
 *   DEPLOY_ENV        环境标识（staging | production）
 *   DEPLOY_URL        访问 URL
 *   COMMITS           最近提交列表（可选，每行一个 --oneline 格式）
 */

const webhook = process.env.DINGTALK_WEBHOOK;
if (!webhook) {
  console.log("⚠ DINGTALK_WEBHOOK not set — skipping notification");
  process.exit(0);
}

const env = process.env.DEPLOY_ENV || "unknown";
if (env === "staging" && process.env.SKIP_STAGING_NOTIFY === "true") {
  console.log("⏭ SKIP_STAGING_NOTIFY=true — skipping staging notification");
  process.exit(0);
}

const version = process.env.DEPLOY_VERSION || "unknown";
const url = process.env.DEPLOY_URL || "";
const commitsRaw = process.env.COMMITS || "";

const envLabel = env === "production" ? "🚀 正式服" : "🧪 测试服";
const title = `${envLabel} v${version} 部署成功`;

const pad = (n) => String(n).padStart(2, "0");
const bj = new Date(new Date().getTime() + 8 * 3600 * 1000);
const ts = `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())} ${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}:${pad(bj.getUTCSeconds())} CST`;

let commitsBlock = "";
if (commitsRaw) {
  const lines = commitsRaw.trim().split("\n").filter(Boolean);
  const total = lines.length;
  const shown = lines.slice(0, 20);
  if (total > 0) {
    commitsBlock = `\n\n**最近变更 (${total} commits)**\n` + shown
      .map((l) => l.replace(/^[0-9a-f]+\s+/, ""))
      .map((l) => `> ${l}`)
      .join("\n");
    if (total > 20) {
      commitsBlock += `\n> ... 还有 ${total - 20} 条`;
    }
  }
}

const markdown = `## ${title}
> ${ts}
> [${url}](${url})${commitsBlock}`;

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
