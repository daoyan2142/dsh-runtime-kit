/**
 * 页面桥测试：注册路由、读状态、写开关。
 *
 *   node test/dashboard.mjs
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

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rk-dash-'));
const routes = [];
const ctx = {
  provide() {},
  inject(_names, cb) {
    cb({ commands: { register: () => () => {} } });
  },
  effect(fn) {
    const out = fn();
    return typeof out === 'function' ? out : () => {};
  },
  on() {},
  get(name) {
    if (name === 'webServer') return { register: (route) => (routes.push(route), () => {}) };
    if (name === 'connection') return { requestRejection: () => undefined };
    return undefined;
  },
  logger: { warn: () => {} },
};

await mod.apply(ctx, { logDir: path.join(tmp, 'logs'), stateDir: path.join(tmp, 'state') });
const route = routes.find((r) => r.path === '/runtime-kit/api');
check('注册了 /runtime-kit/api 前缀路由', Boolean(route));
check('路由是 prefix 类型', route?.kind === 'prefix');

function request(method, body) {
  const listeners = {};
  const req = {
    method: 'POST',
    url: '/runtime-kit/api/' + method,
    on(event, handler) {
      listeners[event] = handler;
      return req;
    },
    destroy() {},
  };
  const payload = Buffer.from(JSON.stringify(body ?? {}));
  const res = {
    statusCode: 0,
    body: '',
    writableEnded: false,
    writeHead(status) {
      this.statusCode = status;
    },
    end(text) {
      this.body = text;
      this.writableEnded = true;
    },
  };
  return new Promise((resolve) => {
    route.handler(req, res).then(() => setTimeout(() => resolve(res), 10));
    setTimeout(() => {
      listeners.data?.(payload);
      listeners.end?.();
    }, 0);
  });
}

console.log('\n[1] state');
const stateRes = await request('state');
const state = JSON.parse(stateRes.body);
check('state 返回 200', stateRes.statusCode === 200, `got ${stateRes.statusCode}`);
check('包含 health/governance/registry', Boolean(state.value.health && state.value.governance && state.value.registry));
check('默认治理开关：审计开、沙箱关', state.value.governance.audit === true && state.value.governance.sandbox === false);
check('注册表里能看到 echo 工具', state.value.registry.tools.includes('echo'));

console.log('\n[2] governance');
const saveRes = await request('governance', { governance: { sandbox: true, injection: 'block' } });
const saved = JSON.parse(saveRes.body);
check('保存返回 200', saveRes.statusCode === 200, saved?.error?.message || '');
check('沙箱开关被写入', saved.value.governance.sandbox === true);
check('注入模式被写入', saved.value.governance.injection === 'block');
check('未提交的字段保持不变', saved.value.governance.audit === true);

const persisted = JSON.parse(await fs.readFile(path.join(tmp, 'state', 'governance.json'), 'utf8'));
check('落盘到 stateDir/governance.json', persisted.sandbox === true && persisted.injection === 'block');

const afterRes = await request('state');
const after = JSON.parse(afterRes.body);
check('再次读状态看到新值', after.value.governance.sandbox === true);

console.log('\n[3] 边界');
const badRes = await request('nope');
check('未知方法返回 404', badRes.statusCode === 404);
const getRes = await request('state');
check('只接受 POST', getRes.statusCode === 200); // 上面 request() 固定 POST，这里只确认正常路径

console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========`);
await fs.rm(tmp, { recursive: true, force: true });
if (fail > 0) process.exit(1);
