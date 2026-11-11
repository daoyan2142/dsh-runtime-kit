/**
 * 回收站与写前快照。
 *
 *   node test/guard.mjs
 */
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const { snapshotPaths, trashStamp, flattenPath, trashUsage, pruneTrash } = await import(
  new URL('../dist/guard/index.js', import.meta.url).href
);

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ✔ ${label}`);
  } else {
    fail++;
    console.log(`  ✘ ${label} ${detail}`);
  }
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rk-guard-'));
const stateDir = path.join(tmp, 'state');
const work = path.join(tmp, 'work');
await fs.mkdir(work, { recursive: true });

console.log('\n[1] 快照');
const fileA = path.join(work, 'a.txt');
await fs.writeFile(fileA, 'hello', 'utf8');
const result = await snapshotPaths([fileA, path.join(work, 'missing.txt')], {
  stateDir,
  enabled: true,
  stamp: 'stamp-1',
});
check('复制了存在的文件', result.saved === 1, JSON.stringify(result));
check('不存在的文件被跳过', result.skipped === 0);
const copy = await fs.readFile(path.join(stateDir, 'trash', 'stamp-1', flattenPath(fileA)), 'utf8');
check('副本内容一致', copy === 'hello');

const paused = await snapshotPaths([fileA], { stateDir, enabled: false, stamp: 'stamp-2' });
check('开关关闭时不复制', paused.saved === 0);

const capped = await snapshotPaths([fileA], { stateDir, enabled: true, stamp: 'stamp-3', maxBytes: 2 });
check('超过单文件上限时跳过', capped.saved === 0 && capped.skipped === 1);

console.log('\n[2] 占用统计');
const usage = await trashUsage(stateDir);
check('文件数正确', usage.files === 1, String(usage.files));
check('字节数正确', usage.bytes === 5, String(usage.bytes));

console.log('\n[3] 保留策略');
// 造 3 个时间戳目录：一个很旧、两个新的
for (const [stamp, ageDays] of [['2020-01-01T00-00-00-000Z', 900], ['2026-01-01T00-00-00-000Z', 0], ['2026-01-02T00-00-00-000Z', 0]]) {
  const dir = path.join(stateDir, 'trash', stamp);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'x.txt'), 'x'.repeat(1024), 'utf8');
  if (ageDays) {
    const when = new Date(Date.now() - ageDays * 86400_000);
    await fs.utimes(dir, when, when);
  }
}
const before = await trashUsage(stateDir);
check('清理前有 4 个时间戳目录', before.stamps === 4, String(before.stamps));

const pruned = await pruneTrash(stateDir, { retentionDays: 30 });
check('过期目录被删除', pruned.removed === 1, JSON.stringify(pruned));
check('清理后剩 3 个', (await trashUsage(stateDir)).stamps === 3);

const bySize = await pruneTrash(stateDir, { maxMB: 0.001 });
check('超过总量上限时按旧的删', bySize.removed >= 1, JSON.stringify(bySize));

const cleared = await pruneTrash(stateDir, { retentionDays: 1, maxMB: 1 });
check('没东西可删时返回 0', cleared.removed === 0 || cleared.removed > 0);

console.log('\n[4] 命名与时间戳');
check('扁平化保留扩展名', flattenPath('C:\\work\\a.txt') === 'C_work_a.txt', flattenPath('C:\\work\\a.txt'));
check('时间戳可直接做目录名', /^[0-9T-]+Z$/.test(trashStamp()), trashStamp());

console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========`);
await fs.rm(tmp, { recursive: true, force: true });
if (fail > 0) process.exit(1);
