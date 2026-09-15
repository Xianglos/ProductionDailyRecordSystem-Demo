'use strict';

/**
 * 静态语法检查：对工程内全部 JavaScript 源码做 node --check 级别的语法校验。
 * 仅做语法校验，不执行任何业务逻辑，不产生副作用。
 *
 * 用法：node scripts/check.js
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = ['main.js', 'src', 'ui', 'scripts'];

const files = [];

function walk(target) {
  const full = path.join(ROOT, target);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch (_) {
    return;
  }
  if (stat.isFile()) {
    if (full.endsWith('.js')) files.push(full);
    return;
  }
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    walk(path.join(target, entry.name));
  }
}

TARGETS.forEach(walk);

let failed = 0;
for (const file of files.sort()) {
  const relative = path.relative(ROOT, file).replace(/\\/g, '/');
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status === 0) {
    console.log(`  OK   ${relative}`);
  } else {
    failed += 1;
    console.error(`FAIL   ${relative}`);
    console.error(String(result.stderr || '').split('\n').slice(0, 6).join('\n'));
  }
}

console.log(`\n[语法] 共检查 ${files.length} 个文件，失败 ${failed} 个。`);

/* ------------------ 相对模块引用可解析性检查（静态） ------------------ */

const REQUIRE_RE = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
const unresolved = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  let match = REQUIRE_RE.exec(source);
  while (match) {
    const target = path.resolve(path.dirname(file), match[1]);
    const candidates = [target, `${target}.js`, path.join(target, 'index.js')];
    if (!candidates.some((candidate) => fs.existsSync(candidate))) {
      unresolved.push(`${path.relative(ROOT, file).replace(/\\/g, '/')} → ${match[1]}`);
    }
    match = REQUIRE_RE.exec(source);
  }
}

if (unresolved.length === 0) {
  console.log('[引用] 全部相对模块引用均可解析。');
} else {
  failed += unresolved.length;
  console.error(`[引用] 存在 ${unresolved.length} 处无法解析的模块引用：`);
  unresolved.forEach((item) => console.error(`  - ${item}`));
}

process.exitCode = failed > 0 ? 1 : 0;
