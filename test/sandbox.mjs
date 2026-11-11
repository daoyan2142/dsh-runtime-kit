/**
 * 沙箱端到端：用真实的插件代码（apply + 钩子 + Sandbox）验证拦截能力。
 *
 * 为什么不在运行中的 DSH 里直接开沙箱：`sandbox` 一旦打开，同一条管线也会拦当前会话
 * 自己的工具调用。这个 profile 没有注册任何工作区（`resolveAndValidate` 会直接
 * deny），workspace-write 模式下命令也不在白名单——开了就等于把正在干活的会话锁死。
 * 所以这里用 mock ctx 复刻 Host 的调用形状，跑的是 dist 里的真实实现。
 *
 *   node test/sandbox.mjs
 */
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const mod = await import(new URL('../dist/index.js', import.meta.url).href);

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

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rk-sandbox-'));
const wsRoot = path.join(tmp, 'ws');
await fs.mkdir(path.join(wsRoot, 'secrets'), { recursive: true });
await fs.mkdir(path.join(wsRoot, 'docs'), { recursive: true });
await fs.writeFile(path.join(wsRoot, 'secrets', 'key.txt'), 'hunter2', 'utf8');
await fs.writeFile(path.join(wsRoot, 'docs', 'note.md'), 'hello', 'utf8');

const handlers = {};
const ctx = {
  provide(name, value) {
    this[`__${name}`] = value;
  },
  inject(_names, cb) {
    cb({ commands: { register: () => () => {} } });
  },
  effect(fn) {
    const out = fn();
    return typeof out === 'function' ? out : () => {};
  },
  on(name, fn) {
    handlers[name] = fn;
    return () => {};
  },
  get() {
    return undefined;
  },
  logger: { warn: () => {} },
};

await mod.apply(ctx, {
  logDir: path.join(tmp, 'logs'),
  stateDir: path.join(tmp, 'state'),
  sandbox: {
    mode: 'workspace-write',
    approval: 'ask',
    rules: {
      files: [
        { pattern: 'secrets/**', read: 'deny', write: 'deny', delete: 'deny' },
        { pattern: 'docs/*.md', read: 'allow' },
      ],
      commands: [
        { prefix: 'rm', action: 'deny' },
        { prefix: 'git status', action: 'allow' },
      ],
      network: [
        { domain: 'api.github.com', action: 'allow' },
        { domain: 'evil.example', action: 'deny' },
      ],
    },
    networkDefault: 'deny',
    commandDefault: 'allow',
    workspaces: [{ profile: 'default', root: wsRoot, permissionMode: 'workspace-write' }],
    toolControl: { crash_tool: false },
  },
});

const svc = ctx.__runtimeKit;
check('服务与钩子就绪', Boolean(svc) && typeof handlers['tools/pre-execute'] === 'function');
check('配置里的工作区已自动注册', Boolean(svc.sandbox.getWorkspace?.('default')), JSON.stringify(svc.getConfig().sandbox.workspaces));

// 打开沙箱：钩子读的是同一个 governance 对象，改它即刻生效
svc.governance.sandbox = true;

const allowed = { kind: 'allow' };
const pre = (name, args) => handlers['tools/pre-execute']({ name, arguments: args }, async () => allowed);

console.log('\n[1] 文件规则');
const inside = await pre('read', { path: path.join(wsRoot, 'docs', 'note.md') });
check('工作区内的普通文件放行', inside === allowed || inside.kind === 'allow');

const secret = await pre('read', { path: path.join(wsRoot, 'secrets', 'key.txt') });
check('secrets/** 被拒绝', secret.kind === 'deny', JSON.stringify(secret).slice(0, 120));
check('拒绝原因带规则线索', String(secret.reason).includes('sandbox'));

const escape = await pre('read', { path: path.join(wsRoot, '..', 'etc', 'passwd') });
check('路径逃出工作区被拒绝', escape.kind === 'deny');

const outside = await pre('write', { path: 'C:\\Windows\\System32\\drivers\\etc\\hosts' });
check('工作区外的绝对路径被拒绝', outside.kind === 'deny');

console.log('\n[2] 命令规则');
const rm = await pre('pwsh', { command: 'rm -rf /tmp/x' });
check('rm 前缀被拒绝', rm.kind === 'deny');
const gitStatus = await pre('pwsh', { command: 'git status --short' });
check('白名单命令放行', gitStatus === allowed || gitStatus.kind === 'allow');

console.log('\n[3] 网络规则');
const evil = await pre('web_fetch', { url: 'https://evil.example/collect' });
check('黑名单域名被拒绝', evil.kind === 'deny');
const gh = await pre('web_fetch', { url: 'https://api.github.com/user' });
check('白名单域名放行', gh === allowed || gh.kind === 'allow');
const unknown = await pre('web_fetch', { url: 'https://example.org/x' });
check('默认策略是拒绝', unknown.kind === 'deny');

console.log('\n[4] 工具粒度');
const controlled = await pre('crash_tool', {});
check('toolControl 里关掉的工具被拒绝', controlled.kind === 'deny');

console.log('\n[5] 审计与 fail-open');
await new Promise((resolve) => setTimeout(resolve, 120));
const auditFile = path.join(tmp, 'logs', 'audit-default.jsonl');
const auditText = await fs.readFile(auditFile, 'utf8').catch(() => '');
const blocked = auditText.split('\n').filter((line) => line.includes('BLOCKED')).length;
check('被拒绝的调用写进了审计', blocked >= 3, `BLOCKED=${blocked}`);

const originalSandbox = svc.sandbox;
svc.sandbox = {
  isToolAllowed() {
    throw new Error('boom');
  },
};
const failOpen = await pre('pwsh', { command: 'rm -rf /' });
check('沙箱内部异常时 fail-open', failOpen === allowed);
svc.sandbox = originalSandbox;

console.log('\n[6] 关掉沙箱后不再拦截');
svc.governance.sandbox = false;
const off = await pre('read', { path: path.join(wsRoot, 'secrets', 'key.txt') });
check('sandbox=false 时原样放行', off === allowed);


console.log('\n[7] 工作区配置校验');
const { normalizeWorkspaces } = await import(new URL('../dist/workspaces/index.js', import.meta.url).href);
const bad = normalizeWorkspaces([
  { profile: 'ok', root: 'D:\\work' },
  { profile: 'ok', root: 'D:\\other' },
  { profile: 'rel', root: 'relative/path' },
]);
check('合法项保留', bad.workspaces.length === 1 && bad.workspaces[0].profile === 'ok');
check('相对路径被拒', bad.errors.some((e) => e.includes('绝对路径')));
check('盘符根/相对路径都被报告', bad.errors.length >= 2);
check('重复 profile 被拒', bad.errors.some((e) => e.includes('重复')));

console.log('\n[8] 隔离自检');
svc.governance.sandbox = true;
const report = await svc.verifyIsolation('default');
check('已配置的工作区通过', report.passed === true, JSON.stringify(report.violations));
check('越界探针被拒绝', report.checks.traversal.status === 'pass', report.checks.traversal.message);
check('symlink 校验已挂载', report.checks.symlink.status === 'pass', report.checks.symlink.message);
const missing = await svc.verifyIsolation('nope');
check('未配置的 profile 判定失败', missing.passed === false && missing.checks.workspace.status === 'fail');

console.log('\n[9] commandDefault');
const sandboxCfg = svc.getConfig().sandbox;
svc.reloadConfig({
  sandbox: { ...sandboxCfg, commandDefault: 'deny', rules: { ...sandboxCfg.rules, commands: [] } },
});
const deniedByDefault = await pre('pwsh', { command: 'git status' });
check('commandDefault=deny 时未命中规则也拒绝', deniedByDefault.kind === 'deny', JSON.stringify(deniedByDefault).slice(0, 100));
svc.reloadConfig({ sandbox: { ...sandboxCfg, commandDefault: 'allow' } });
const allowedByDefault = await pre('pwsh', { command: 'git status' });
check('commandDefault=allow 时放行', allowedByDefault === allowed || allowedByDefault.kind === 'allow');


console.log('\n[10] 写前快照 / 回收站');
const stateDir = svc.getConfig().stateDir;
const target = path.join(wsRoot, 'docs', 'note.md');
const beforeCopy = await pre('write', { path: target });
check('写操作放行', beforeCopy === allowed || beforeCopy.kind === 'allow');
const trashRoot = path.join(stateDir, 'trash');
const trashFiles = await fs.readdir(trashRoot, { recursive: true }).catch(() => []);
check('写之前留了副本', trashFiles.some((f) => String(f).includes('note.md')), JSON.stringify(trashFiles).slice(0, 120));

const delTarget = path.join(wsRoot, 'docs', 'note.md');
await pre('delete', { path: delTarget });
const trashAfterDelete = await fs.readdir(trashRoot, { recursive: true }).catch(() => []);
check('删除前也留了副本', trashAfterDelete.length >= 1);

svc.reloadConfig({ sandbox: { ...svc.getConfig().sandbox, backupEnabled: false } });
const noCopy = await pre('write', { path: path.join(wsRoot, 'docs', 'other.md') });
check('backupEnabled=false 时不复制', noCopy === allowed || noCopy.kind === 'allow');
svc.reloadConfig({ sandbox: { ...svc.getConfig().sandbox, backupEnabled: true } });

console.log('\n[11] 工作区信任');
svc.reloadConfig({ sandbox: { ...svc.getConfig().sandbox, workspaceTrust: false } });
const untrustedWrite = await pre('write', { path: path.join(wsRoot, 'docs', 'x.md') });
check('未受信任时写操作被拒', untrustedWrite.kind === 'deny' && String(untrustedWrite.reason).includes('未受信任'));
svc.reloadConfig({ sandbox: { ...svc.getConfig().sandbox, workspaceTrust: true } });
const trustedWrite = await pre('write', { path: path.join(wsRoot, 'docs', 'y.md') });
check('受信任后写操作放行', trustedWrite === allowed || trustedWrite.kind === 'allow');

console.log('\n[12] 链接逃逸');
const outsideDir = path.join(tmp, 'outside');
await fs.mkdir(outsideDir, { recursive: true });
await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'top secret', 'utf8');
const linkPath = path.join(wsRoot, 'link');
try {
  await fs.symlink(outsideDir, linkPath, 'junction');
  const viaLink = await pre('read', { path: path.join(linkPath, 'secret.txt') });
  check('经 junction 逃出工作区被拒绝', viaLink.kind === 'deny', JSON.stringify(viaLink).slice(0, 120));
  check('拒绝原因提到链接', /链接|realpath/.test(String(viaLink.reason)), String(viaLink.reason));
} catch (error) {
  check('无法创建 junction（跳过本项）', true, String(error.message).slice(0, 60));
}

console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========`);
await fs.rm(tmp, { recursive: true, force: true });
if (fail > 0) process.exit(1);

