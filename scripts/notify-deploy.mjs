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
 *
 * 使用示例：
 *   DINGTALK_WEBHOOK="https://oapi.dingtalk.com/robot/send?access_token=xxx" \
 *   DEPLOY_VERSION="2026.07.14-1" DEPLOY_ENV="staging" \
 *   DEPLOY_URL="https://test.205716.xyz" node scripts/notify-deploy.mjs
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
const prevInfo = prev ? `\n> 上一版本：${prev}` : "";

const envLabel = env === "production" ? "🚀 正式服" : "🧪 测试服";
const title = `${envLabel} 部署成功`;

const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

const markdown = `## ${title}
> 版本：**v${version}**
> 时间：${now}
> 地址：[${url}](${url})${prevInfo}
---
> Nursing VP Sim 护理虚拟患者系统`;

const payload = {
  msgtype: "markdown",
  markdown: {
    title: title,
    text: markdown,
  },
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
