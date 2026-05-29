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

const emojis = Object.keys(EMOJI_TYPES).join('');
const types = Object.values(EMOJI_TYPES).join('|');
const re = new RegExp(`^([${emojis}]) (${types})(\\(.+\\))?: .+`, 'u');

const m = firstLine.match(re);
if (!m) {
  console.log('');
  console.log('  Format: <emoji> <type>: <description>');
  console.log('');
  for (const [emoji, type] of Object.entries(EMOJI_TYPES)) {
    console.log(`    ${emoji} ${type}`);
  }
  console.log('');
  console.log(`  Got: ${JSON.stringify(firstLine)}`);
  console.log('');
  process.exit(1);
}

const emoji = m[1];
const stripped = firstLine.slice(emoji.length + 1);
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
