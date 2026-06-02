/**
 * 提交消息格式校验 (Husky commit-msg hook)
 *
 * 格式: <emoji> <type>: <描述>
 * 示例: ✨ feat: 添加患者评分模块
 *       🐛 fix: 修复 SSE 流式断连问题
 *       🎨 style: 优化登录页布局
 *       🔀 merge: feature/rbac-classes-management
 *
 * 快速复制前缀 (Quick Copy):
 *   ✨ feat:       🐛 fix:        📝 docs:
 *   ♻️ refactor:   🔧 chore:      ✅ test:
 *   🎨 style:      🚀 ci:         📦 build:
 *   ⚡ perf:       🔀 merge:      🔒 security:
 *   🗃️ db:         ⏪ revert:     🔥 remove:
 *
 * 版本号: vYYYY.MM.DD 或 vYYYY.MM.DD-N (e.g. v2026.06.02, v2026.06.02-3)
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
  '🎨': 'style',
  '🚀': 'ci',
  '📦': 'build',
  '⚡': 'perf',
  '🔀': 'merge',
  '🔒': 'security',
  '🗃️': 'db',
  '⏪': 'revert',
  '🔥': 'remove',
};

const msgFile = process.argv[2];
let msg = fs.readFileSync(msgFile, 'utf-8').replace(/\uFEFF/g, '');
const firstLine = msg.split(/\r?\n/, 1)[0];

const RE_SCOPED = new RegExp(
  `^(${Object.keys(EMOJI_TYPES).join('|')}) (${Object.values(EMOJI_TYPES).join('|')})(\\(.+\\))?: .+`,
  'u'
);

const m = firstLine.match(RE_SCOPED);
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
