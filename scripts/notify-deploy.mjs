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
 *   BACKUP_REPORT     部署前备份摘要（可选，服务器 .last-pre-deploy.report）
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
const backupReport = process.env.BACKUP_REPORT || "";

const envLabel = env === "production" ? "🚀 正式服" : "🧪 测试服";
const title = `${envLabel} v${version} 部署成功`;

const pad = (n) => String(n).padStart(2, "0");
const bj = new Date(new Date().getTime() + 8 * 3600 * 1000);
const ts = `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())} ${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}:${pad(bj.getUTCSeconds())} CST`;

let commitsBlock = "";
if (commitsRaw) {
  const lines = commitsRaw.trim().split("\n").filter(Boolean);
  const total = lines.length;
  const shown = lines.slice(0, 5);
  if (total > 0) {
    commitsBlock = `\n\n---\n\n**最近变更 (${total} commits)**\n\n` + shown
      .map((l) => l.replace(/^[0-9a-f]+\s+/, ""))
      .map((l) => `- ${l}`)
      .join("\n");
    if (total > 5) {
      commitsBlock += `\n\n... 还有 ${total - 5} 条`;
    }
  }
}

const backupBlock = backupReport ? `\n> 🗄️ 部署前备份：${backupReport}` : "";
const markdown = `## ${title}
> ${ts}
> [${url}](${url})${backupBlock}${commitsBlock}`;

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
  // 钉钉用 HTTP 200 + errcode 表达业务结果（例如关键字不匹配 → errcode 310000）。
  // 只看 resp.ok 会把“消息被拒”记成成功，所以这里必须解 errcode。
  let errcode;
  try {
    errcode = JSON.parse(body).errcode;
  } catch {
    /* 非 JSON：交给下面的判定 */
  }
  if (resp.ok && (errcode === undefined || errcode === 0)) {
    console.log(`✓ DingTalk notified (${env})`);
  } else {
    console.error(`✗ DingTalk failed (${resp.status}, errcode=${errcode}): ${body.slice(0, 200)}`);
    process.exit(1);
  }
} catch (err) {
  console.error(`✗ DingTalk request error: ${err.message}`);
  process.exit(1);
}
