/**
 * 提交消息格式校验 (Husky commit-msg hook)
 *
 * 格式: <emoji> <type>: <描述>
 * 示例: ✨ feat: 添加患者评分模块
 *       🐛 fix: 修复 SSE 流式断连问题
 *       🔧 chore: 版本号统一为日期风格
 *
 * 快速复制前缀 (Quick Copy):
 *   ✨ feat:       🐛 fix:        📝 docs:
 *   ♻️ refactor:   🔧 chore:      ✅ test:
 *   💄 style:      🚀 ci:         📦 build:
 *   ⚡ perf:
 *
 * 版本号: vYYYY.MM.DD 或 vYYYY.MM.DD-N (e.g. v2026.05.29, v2026.05.29-3)
 * Tag 格式由 .husky/pre-push 校验
 */

const fs = require('fs');
const { execSync } = require('child_process');

const EMOJI_TYPES = {
  '✨': 'feat',
  '🐛': 'fix',
  '📝': 'docs',
  '♻️': 'refactor',
  '🔧': 'chore',
  '✅': 'test',
  '💄': 'style',
  '🚀': 'ci',
  '📦': 'build',
  '⚡': 'perf',
};

const msgFile = process.argv[2];
let msg = fs.readFileSync(msgFile, 'utf-8').replace(/\uFEFF/g, '');
const firstLine = msg.split(/\r?\n/, 1)[0];

const emojiAlt = Object.keys(EMOJI_TYPES).join('|');
const typesAlt = Object.values(EMOJI_TYPES).join('|');
const re = new RegExp(`^(${emojiAlt}) (${typesAlt})(\\(.+\\))?: .+`, 'u');

const m = firstLine.match(re);
if (!m) {
  console.log('');
  console.log('  Format: <emoji> <type>: <description>');
  console.log('');
  console.log('  Types:');
  for (const [emoji, type] of Object.entries(EMOJI_TYPES)) {
    console.log(`    ${emoji} ${type}`);
  }
  console.log('');
  console.log(`  Got: ${JSON.stringify(firstLine)}`);
  console.log('');
  process.exit(1);
}

const matchedEmoji = m[1];
const stripped = firstLine.slice(matchedEmoji.length + 1);
const lintFile = msgFile + '.lint';
fs.writeFileSync(lintFile, stripped + msg.slice(firstLine.length), 'utf-8');

let ok = true;
try {
  execSync(`npx --no -- commitlint --edit "${lintFile}"`, { stdio: 'inherit' });
} catch (e) {
  ok = false;
} finally {
  try { fs.unlinkSync(lintFile); } catch {}
}

if (!ok) process.exit(1);
