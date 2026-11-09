/**
 * dsh-runtime-kit 远程集成探测
 * 通过 DSH Web 载体的真实调用路径执行斜杠命令（POST /api/commands/execute），
 * 验证 commands 服务注册与 handler 端到端行为。
 *
 * 认证：按 @deepseek-ai/dsh-client-connection 的浏览器 cookie 规范，
 * 用 $DSH_HOME/.credentials.yaml 的 browser-session 签名密钥本地铸造 v1 cookie
 * （等价于浏览器 ?token= 换发的会话 cookie）。密钥不回显。
 *
 * 运行：node test/remote-probe.mjs [command-line]
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as os from 'node:os';

const HOME = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
// DSH Web 端口每次启动随机变化；可用 RK_AUTHORITY 环境变量覆盖
const AUTHORITY = process.env.RK_AUTHORITY ?? '127.0.0.1:60135';
const COMMAND_LINE = process.argv[2] ?? process.env.RK_CMD ?? '/runtime_kit_health';

// ---- 1. 签名密钥（脚本内使用，不输出） --------------------------------------
const creds = await fs.readFile(path.join(HOME, '.credentials.yaml'), 'utf8');
const at = creds.indexOf('browser-session');
if (at < 0) throw new Error('browser-session credential record not found');
const block = creds.slice(at, at + 3000);
const secretMatch = /secret:\s*['"]?([A-Za-z0-9_-]{20,})['"]?/.exec(block);
if (!secretMatch) throw new Error('browser-session secret not found in record');
const b64uDecode = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4), 'base64');
const secret = b64uDecode(secretMatch[1]);
if (secret.byteLength !== 32) throw new Error(`unexpected secret length ${secret.byteLength}`);

// ---- 2. 铸造 v1 浏览器会话 cookie ------------------------------------------
const b64uEncode = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const payload = { version: 1, authority: AUTHORITY, issuedAt: Date.now(), expiresAt: Date.now() + 30 * 24 * 3600 * 1000 };
const body = b64uEncode(Buffer.from(JSON.stringify(payload), 'utf-8'));
const signature = b64uEncode(crypto.createHmac('sha256', secret).update(body).digest());
const cookieValue = `v1.${body}.${signature}`;
const cookieName = 'dsh-auth-' + b64uEncode(crypto.createHash('sha256').update(AUTHORITY).digest());

// ---- 3. 会话 id 候选（新会话优先） ------------------------------------------
const sessRoot = path.join(HOME, 'sessions', '--D-Dsh--');
const dirs = (await fs.readdir(sessRoot, { withFileTypes: true })).filter(d => d.isDirectory());
const ranked = [];
for (const d of dirs) {
  const files = await fs.readdir(path.join(sessRoot, d.name)).catch(() => []);
  let mtime = 0;
  for (const f of files) {
    const st = await fs.stat(path.join(sessRoot, d.name, f)).catch(() => null);
    if (st && st.mtimeMs > mtime) mtime = st.mtimeMs;
  }
  ranked.push({ name: d.name, mtime });
}
ranked.sort((a, b) => b.mtime - a.mtime);
const candidates = ranked.flatMap(d => [d.name.replace(/^session-/, ''), d.name]);

// ---- 4. POST /api/commands/execute -----------------------------------------
function callExecute(agentId) {
  return new Promise((resolve, reject) => {
    const envelope = {
      type: 'client-request',
      rpcId: `probe-${Date.now()}`,
      method: 'commands/execute',
      payload: { args: { agentId, line: COMMAND_LINE, submittedAttachments: [] } },
    };
    const req = http.request({
      host: AUTHORITY.split(':')[0],
      port: Number(AUTHORITY.split(':')[1] ?? '80'),
      path: '/api/commands/execute',
      method: 'POST',
      headers: {
        'host': AUTHORITY,
        'content-type': 'application/json',
        'cookie': `${cookieName}=${cookieValue}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(envelope));
  });
}

console.log(`命令行: ${COMMAND_LINE}`);
console.log(`会话候选: ${candidates.length} 个（新→旧）`);
let matched = false;
for (const id of candidates) {
  const { status, body } = await callExecute(id);
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = null; }
  const result = parsed?.result;
  const label = `${id.slice(0, 13)}…`;
  if (status === 200 && result?.ok === true) {
    console.log(`\n✅ 会话 ${label} 命中，端到端执行成功：`);
    console.log(JSON.stringify(result.value, null, 2));
    matched = true;
    break;
  }
  const errText = result?.ok === false ? `${result.error?.code}: ${result.error?.message}` : `HTTP ${status}: ${body.slice(0, 160)}`;
  const notFound = /lookup-not-found|context-not-found|invocation-unavailable|session\/not-found|agent.*not-found/.test(errText);
  console.log(`  ${label} → ${notFound ? '该会话无活跃 agent，跳过' : '失败: ' + errText}`);
  if (!notFound) {
    console.log(`\n❌ 非会话问题，终止：${errText}`);
    process.exit(1);
  }
}
if (!matched) {
  console.log('\n❌ 没有找到带活跃 agent 的会话（GUI 未打开任何会话？）');
  process.exit(1);
}
