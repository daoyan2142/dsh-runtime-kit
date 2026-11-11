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
    toolControl: { crash_tool: false },
  },
});

const svc = ctx.__runtimeKit;
svc.registry.registerWorkspace({ profile: 'default', root: wsRoot, permissionMode: 'workspace-write' });
svc.sandbox.registerWorkspace({ profile: 'default', root: wsRoot, permissionMode: 'workspace-write' });
check('服务与钩子就绪', Boolean(svc) && typeof handlers['tools/pre-execute'] === 'function');

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

console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========`);
await fs.rm(tmp, { recursive: true, force: true });
if (fail > 0) process.exit(1);
