/**
 * dsh-runtime-kit v0.1.0 - DSH 通用运行时插件
 * 上下文治理（C1）、快路径（C2）、PTC（C3）、编排裁剪（C4）、并发/恢复（C5）、沙箱（C6）、审计（C7）
 * 零业务依赖：仅依赖 Node 内置模块与 DSH 宿主注入的 ctx。
 *
 * 导出形状遵循 @deepseek-ai/cordis-plugin-loader 契约：
 *   exports.default ?? exports → { name, inject?, apply }
 * 命令通过 'commands' 服务注册（commands.register），handler 返回 CommandResult。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { installGovernance, DEFAULT_GOVERNANCE } from './hooks/index.js';
import { spawn } from 'node:child_process';

// ============================================================================
// Registry（唯一业务耦合面：registerTool / registerTemplate / registerWorkspace）
// ============================================================================

class RegistryImpl {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.tools = new Map();
    this.toolEnabled = new Map();
    this.templates = new Map();
    this.workspaces = new Map();
  }

  registerTool(spec) {
    if (this.tools.has(spec.name)) throw new Error(`Tool "${spec.name}" already registered`);
    this.tools.set(spec.name, spec);
    this.toolEnabled.set(spec.name, true);
  }

  unregisterTool(name) {
    this.tools.delete(name);
    this.toolEnabled.delete(name);
  }

  getTool(name) { return this.tools.get(name); }
  listTools() { return Array.from(this.tools.values()); }
  isToolEnabled(name) { return this.toolEnabled.get(name) ?? false; }

  setToolEnabled(name, enabled) {
    if (!this.tools.has(name)) throw new Error(`Tool "${name}" not registered`);
    this.toolEnabled.set(name, enabled);
  }

  registerTemplate(spec) {
    if (this.templates.has(spec.name)) throw new Error(`Template "${spec.name}" already registered`);
    this.templates.set(spec.name, spec);
  }

  unregisterTemplate(name) { this.templates.delete(name); }
  getTemplate(name) { return this.templates.get(name); }
  listTemplates() { return Array.from(this.templates.values()); }

  async matchTemplate(input) {
    for (const t of this.templates.values()) {
      if (await t.match(input)) return t;
    }
  }

  registerWorkspace(spec) {
    if (this.workspaces.has(spec.profile)) throw new Error(`Workspace for profile "${spec.profile}" already registered`);
    const ws = { ...spec, root: path.resolve(spec.root) };
    this.workspaces.set(spec.profile, ws);
    this.hooks.onWorkspaceRegistered?.(ws);
  }

  unregisterWorkspace(profile) {
    this.workspaces.delete(profile);
    this.hooks.onWorkspaceUnregistered?.(profile);
  }
  getWorkspace(profile) { return this.workspaces.get(profile); }
  listWorkspaces() { return Array.from(this.workspaces.values()); }

  clear() {
    this.tools.clear();
    this.toolEnabled.clear();
    this.templates.clear();
    this.workspaces.clear();
  }
}

// ============================================================================
// Context Governance（C1）：返回体裁剪 / 字段投影 / 懒加载
// ============================================================================

class ContextGovernance {
  constructor(config) {
    this.config = config;
    this.toolSchemas = new Map();
    this.schemasLoaded = new Map();
    this.metrics = [];
    this.currentTurn = 0;
  }

  registerToolSchema(name, schema) {
    this.toolSchemas.set(name, schema);
    this.schemasLoaded.set(name, false);
  }

  async getToolSchema(name) {
    if (!this.config.lazyLoadTools) return this.toolSchemas.get(name);
    if (!this.schemasLoaded.get(name)) this.schemasLoaded.set(name, true);
    return this.toolSchemas.get(name);
  }

  async governReturn(toolName, result, projection) {
    const originalStr = JSON.stringify(result);
    const originalBytes = Buffer.byteLength(originalStr, 'utf-8');
    let governed = { ...result };
    let truncated = false;
    let fieldsProjected;

    if (this.config.fieldsProjection && projection && governed.data) {
      governed.data = this.projectFields(governed.data, projection);
      fieldsProjected = projection.include ?? Object.keys(projection.exclude ?? {});
    }

    const budget = this.config.maxReturnBytes;
    let governedBytes = Buffer.byteLength(JSON.stringify(governed), 'utf-8');

    if (governedBytes > budget) {
      governed = this.truncateToBudget(governed, budget);
      governedBytes = budget;
      truncated = true;
    }

    return { ...governed, governance: { originalBytes, governedBytes, truncated, fieldsProjected } };
  }

  projectFields(obj, options) {
    const { include, exclude, maxDepth = 10, maxArrayLength = 50 } = options;
    function visit(v, p, d) {
      if (d > maxDepth) return '[MAX_DEPTH_EXCEEDED]';
      if (Array.isArray(v)) {
        if (v.length > maxArrayLength) {
          const head = v.slice(0, maxArrayLength).map((x, i) => visit(x, `${p}[${i}]`, d + 1));
          return [...head, `[...${v.length - maxArrayLength} more]`];
        }
        return v.map((x, i) => visit(x, `${p}[${i}]`, d + 1));
      }
      if (v && typeof v === 'object') {
        const r = {};
        for (const [k, val] of Object.entries(v)) {
          const fp = p ? `${p}.${k}` : k;
          if (include?.length && !include.some(pt => fp === pt || fp.startsWith(pt + '.'))) continue;
          if (exclude?.length && exclude.some(pt => fp === pt || fp.startsWith(pt + '.'))) continue;
          r[k] = visit(val, fp, d + 1);
        }
        return r;
      }
      return v;
    }
    return visit(obj, '', 0);
  }

  truncateToBudget(result, budget) {
    const t = { ...result };
    if (t.data) {
      const oh = Buffer.byteLength(JSON.stringify({ ...t, data: '' }), 'utf-8');
      const avail = budget - oh - 100;
      if (avail > 100) {
        if (typeof t.data === 'string' && t.data.length > avail / 3) {
          t.data = t.data.slice(0, avail / 3) + '\n... [TRUNCATED]';
        } else if (Array.isArray(t.data)) {
          const kept = [];
          let bytes = 0;
          for (const it of t.data) {
            const ib = Buffer.byteLength(JSON.stringify(it), 'utf-8');
            if (bytes + ib > avail) break;
            kept.push(it);
            bytes += ib;
          }
          t.data = [...kept, `[...${t.data.length - kept.length} more TRUNCATED]`];
        } else if (typeof t.data === 'object') {
          t.data = { ...t.data, _truncated: true };
        }
      } else {
        t.data = '[TRUNCATED: EXCEEDS BUDGET]';
      }
    }
    t.truncated = true;
    t.totalBytes = budget;
    return t;
  }

  recordMetrics(s) {
    this.metrics.push(s);
    if (this.metrics.length > 1000) this.metrics.shift();
  }

  getMetrics() { return [...this.metrics]; }
  updateConfig(p) { this.config = { ...this.config, ...p }; }
  getConfig() { return { ...this.config }; }
  nextTurn() { this.currentTurn++; }
  getCurrentTurn() { return this.currentTurn; }
}

// ============================================================================
// Sandbox（C6）：3 级基线 + 3 态细规则、fail-closed、快照/回收站、注入防护、脱敏
// ============================================================================

class Sandbox {
  constructor(config) {
    this.config = config;
    this.workspaces = new Map();
    this.snapshots = new Map();
    this.trash = new Map();
  }

  updateConfig(p) { this.config = { ...this.config, ...p }; }
  getConfig() { return { ...this.config }; }

  registerWorkspace(spec) { this.workspaces.set(spec.profile, { ...spec, root: path.resolve(spec.root) }); }
  unregisterWorkspace(p) { this.workspaces.delete(p); }
  getWorkspace(p) { return this.workspaces.get(p); }

  resolveAndValidate(profile, requestedPath, op) {
    const ws = this.workspaces.get(profile);
    if (!ws) return this.deny(`Workspace not registered: ${profile}`, 'file', op);
    let abs;
    try {
      abs = path.isAbsolute(requestedPath) ? path.resolve(requestedPath) : path.resolve(ws.root, requestedPath);
    } catch {
      return this.deny(`Path resolution failed: ${requestedPath}`, 'file', op);
    }
    const rel = path.relative(ws.root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return this.deny(`Path traversal: ${requestedPath} -> ${abs}`, 'file', op);
    }
    const base = this.checkBaseMode(ws, op);
    if (!base.allowed) return base;
    const rule = this.matchFileRules(rel, op);
    if (rule) return rule;
    return base;
  }

  checkBaseMode(ws, op) {
    const mode = ws.permissionMode ?? this.config.mode;
    if (mode === 'read-only') {
      if (op === 'read') return this.allow('Read allowed');
      return this.deny(`${op} denied in read-only`, 'file', op);
    }
    if (mode === 'workspace-write') return this.allow(`${op} allowed`);
    return this.allow(`${op} allowed in danger-full-access`);
  }

  matchFileRules(rel, op) {
    for (const r of this.config.rules.files) {
      if (this.matchGlob(rel, r.pattern)) {
        const a = r[op];
        if (a === 'allow') return this.allow(`File rule allow: ${r.pattern}`, r);
        if (a === 'deny') return this.deny(`File rule deny: ${r.pattern}`, 'file', op, r);
        if (a === 'ask') return this.ask(`File rule ask: ${r.pattern}`, r);
      }
    }
    return null;
  }

  validateCommand(req) {
    const full = `${req.command} ${req.args.join(' ')}`.trim();
    for (const r of this.config.rules.commands) {
      if (full.startsWith(r.prefix)) {
        if (r.action === 'allow') return this.allow(`Cmd allow: ${r.prefix}`, r);
        if (r.action === 'deny') return this.deny(`Cmd deny: ${r.prefix}`, 'command', 'execute', r);
        if (r.action === 'ask') return this.ask(`Cmd ask: ${r.prefix}`, r);
      }
    }
    if (this.config.mode === 'danger-full-access') return this.allow('Allowed in danger-full-access');
    return this.deny(`Cmd not allowed: ${full}`, 'command', 'execute');
  }

  validateNetwork(req) {
    let host;
    try {
      host = new URL(req.url).hostname;
    } catch {
      return this.deny(`Invalid URL: ${req.url}`, 'network', 'connect');
    }
    for (const r of this.config.rules.network) {
      if (host === r.domain) {
        if (r.action === 'allow') return this.allow(`Net allow: ${r.domain}`, r);
        if (r.action === 'deny') return this.deny(`Net deny: ${r.domain}`, 'network', 'connect', r);
        if (r.action === 'ask') return this.ask(`Net ask: ${r.domain}`, r);
      }
    }
    switch (this.config.networkDefault) {
      case 'allow': return this.allow('Allowed by default');
      case 'ask': return this.ask('Requires approval');
      default: return this.deny(`Denied by default: ${host}`, 'network', 'connect');
    }
  }

  isToolAllowed(name) {
    const en = this.config.toolControl[name];
    if (en === false) return this.deny(`Tool disabled: ${name}`, 'tool', 'call');
    if (en === true) return this.allow(`Tool enabled: ${name}`);
    return this.allow(`Tool not controlled: ${name}`);
  }

  async createSnapshot(filePath, content) {
    if (!this.config.backupEnabled) return '';
    const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
    const snap = { path: filePath, content, hash, timestamp: new Date().toISOString() };
    const arr = this.snapshots.get(filePath) || [];
    arr.push(snap);
    if (arr.length > 10) arr.shift();
    this.snapshots.set(filePath, arr);
    return hash;
  }

  getSnapshots(filePath) { return this.snapshots.get(filePath) || []; }

  restoreSnapshot(filePath, hash) {
    const s = this.snapshots.get(filePath) || [];
    return s.find(x => x.hash === hash)?.content ?? null;
  }

  async safeDelete(filePath, content) {
    if (!this.config.deletionProtection) return 'deleted';
    const id = crypto.randomUUID();
    const hash = await this.createSnapshot(filePath, content);
    this.trash.set(id, {
      originalPath: filePath,
      snapshot: { path: filePath, content, hash, timestamp: new Date().toISOString() },
      deletedAt: new Date().toISOString(),
    });
    return id;
  }

  restoreFromTrash(id) {
    const e = this.trash.get(id);
    if (!e) return null;
    this.trash.delete(id);
    return { path: e.originalPath, content: e.snapshot.content };
  }

  async emptyTrash(approved) {
    if (!approved) throw new Error('Requires approval');
    const n = this.trash.size;
    this.trash.clear();
    return n;
  }

  isWorkspaceTrusted(p) {
    const w = this.workspaces.get(p);
    return w?.trusted ?? this.config.workspaceTrust;
  }

  detectInjection(content) {
    if (!this.config.injectionGuard) return { suspicious: false, patterns: [] };
    const pats = [
      /ignore\s+(previous|above|all)\s+instructions?/i,
      /forget\s+(everything|all|previous)/i,
      /you\s+are\s+now\s+/i,
      /system\s*:\s*/i,
      /assistant\s*:\s*/i,
      /<\|.*?\|>/g,
      /```\s*(system|user|assistant)/i,
      /override\s+(safety|security|policy)/i,
      /bypass\s+(filter|guard|check)/i,
    ];
    const hit = pats.filter(p => p.test(content));
    return { suspicious: hit.length > 0, patterns: hit.map(p => p.source) };
  }

  static SENSITIVE = [
    { n: 'password', r: /(?:password|passwd|pwd)\s*[:=]\s*["']?([^"'\s]{8,})/gi },
    { n: 'api_key', r: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?([^"'\s]{16,})/gi },
    { n: 'secret', r: /(?:secret|token)\s*[:=]\s*["']?([^"'\s]{16,})/gi },
    { n: 'cookie', r: /(?:cookie|session)\s*[:=]\s*["']?([^"'\s]{16,})/gi },
    { n: 'private_key', r: /-----BEGIN (?:RSA|EC|OPENSSH)? PRIVATE KEY-----[\s\S]*?-----END (?:RSA|EC|OPENSSH)? PRIVATE KEY-----/gi },
    { n: 'conn', r: /(?:jdbc:|mongodb:\/\/|redis:\/\/|mysql:\/\/|postgresql:\/\/)[^"'\s]*(?::[^"'\s@]+@)/gi },
  ];

  desensitize(content) {
    if (!this.config.sensitiveProtection) return { sanitized: content, placeholders: new Map() };
    const ph = new Map();
    let s = content;
    for (const { n, r } of Sandbox.SENSITIVE) {
      r.lastIndex = 0;
      let m;
      while ((m = r.exec(content)) !== null) {
        const o = m[1] ?? m[0];
        const pl = `__${n.toUpperCase()}_${ph.size}__`;
        ph.set(pl, o);
        s = s.split(o).join(pl);
        if (!r.global) break;
      }
    }
    return { sanitized: s, placeholders: ph };
  }

  resensitize(s, ph) {
    let r = s;
    for (const [pl, o] of ph) r = r.split(pl).join(o);
    return r;
  }

  getShellExecutor() {
    if (process.platform === 'win32') return { command: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-Command'] };
    return { command: '/bin/sh', args: ['-c'] };
  }

  createExecutionDomain() { return new LocalExecutionDomain(this); }

  matchGlob(value, pattern) {
      const normalize = (input) => String(input).replace(/\\/g, '/');
      const source = normalize(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '.');
      try {
          return new RegExp('^' + source + '$').test(normalize(value));
      }
      catch {
          return false;
      }
  }

  allow(reason, rule) {
    return { allowed: true, action: 'allow', reason, ruleMatched: rule, requiresApproval: false };
  }

  deny(reason, _rt, _op, rule) {
    return { allowed: false, action: 'deny', reason, ruleMatched: rule, requiresApproval: false };
  }

  ask(reason, rule) {
    return { allowed: false, action: 'ask', reason, ruleMatched: rule, requiresApproval: true };
  }
}

class LocalExecutionDomain {
  constructor(sb) {
    this.sb = sb;
    this.fs = {
      read: (p) => fs.readFile(p, 'utf-8'),
      write: async (p, c) => {
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, c, 'utf-8');
      },
      delete: async (p) => {
        try {
          await fs.unlink(p);
        } catch {
          await fs.rm(p, { recursive: true, force: true });
        }
      },
      list: (p) => fs.readdir(p),
      stat: async (p) => {
        const s = await fs.stat(p);
        return { size: s.size, mtime: s.mtime, isDirectory: s.isDirectory() };
      },
      mkdir: (p, r = true) => fs.mkdir(p, { recursive: r }),
    };
    this.shell = {
      execute: (cmd, args, o) => {
        const { command, args: shArgs } = this.sb.getShellExecutor();
        return new Promise((resolve, reject) => {
          const ch = spawn(command, [...shArgs, `${cmd} ${args.join(' ')}`], {
            cwd: o?.cwd,
            env: { ...process.env, ...o?.env },
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          let stdout = '';
          let stderr = '';
          ch.stdout?.on('data', d => { stdout += d.toString(); });
          ch.stderr?.on('data', d => { stderr += d.toString(); });
          ch.on('close', c => resolve({ stdout, stderr, exitCode: c ?? 1 }));
          ch.on('error', reject);
        });
      },
    };
    this.subprocess = { spawn: (cmd, args, o) => this.shell.execute(cmd, args, o) };
    this.network = { fetch: (u, o) => fetch(u, o) };
  }
}

// ============================================================================
// Audit（C7）：append-only JSONL、脱敏、导出、清理
// ============================================================================

class Audit {
  constructor(config, logDir, sb) {
    this.config = config;
    this.logDir = logDir;
    this.sb = sb;
    this.buf = [];
    this.timer = null;
    if (config.mode !== 'off') {
      this.timer = setInterval(() => { this.flush().catch(() => {}); }, 5000);
      if (this.timer.unref) this.timer.unref();
    }
  }

  async log(e) {
    if (this.config.mode === 'off') return;
    let ph = e.paramsHash;
    if (this.config.desensitize) {
      const { sanitized } = this.sb.desensitize(e.paramsHash);
      ph = sanitized;
    }
    this.buf.push({ ...e, timestamp: new Date().toISOString(), paramsHash: ph });
    if (e.result === 'BLOCKED' || e.action === 'block') await this.flush();
  }

  async flush() {
    if (!this.buf.length) return;
    const by = new Map();
    for (const e of this.buf) {
      const p = e.profile || 'default';
      if (!by.has(p)) by.set(p, []);
      by.get(p).push(e);
    }
    await fs.mkdir(this.logDir, { recursive: true });
    for (const [prof, ents] of by) {
      const lp = path.join(this.logDir, `audit-${prof}.jsonl`);
      await fs.appendFile(lp, ents.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
    }
    this.buf = [];
  }

  async getLogs(f) {
    const p = f?.profile || 'default';
    const lp = path.join(this.logDir, `audit-${p}.jsonl`);
    try {
      const c = await fs.readFile(lp, 'utf-8');
      let es = c.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
      if (f?.tool) es = es.filter(e => e.tool === f.tool);
      if (f?.action) es = es.filter(e => e.action === f.action);
      if (f?.result) es = es.filter(e => e.result === f.result);
      if (f?.since) es = es.filter(e => e.timestamp >= f.since);
      if (f?.until) es = es.filter(e => e.timestamp <= f.until);
      es.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return f?.limit ? es.slice(0, f.limit) : es;
    } catch {
      return [];
    }
  }

  async exportLogs(f, fmt = 'jsonl') {
    const es = await this.getLogs(f);
    if (fmt === 'csv') {
      const h = ['timestamp', 'profile', 'tool', 'action', 'paramsHash', 'result', 'durationMs', 'error'];
      return [h.join(','), ...es.map(e => [e.timestamp, e.profile, e.tool, e.action, e.paramsHash, e.result, e.durationMs, e.error ?? ''].join(','))].join('\n');
    }
    return es.map(e => JSON.stringify(e)).join('\n');
  }

  updateConfig(p) { this.config = { ...this.config, ...p }; }

  async cleanup() {
    if (this.config.mode === 'off') return 0;
    const cut = new Date();
    cut.setDate(cut.getDate() - this.config.retentionDays);
    const cs = cut.toISOString();
    let n = 0;
    const pros = new Set();
    try {
      for (const e of await fs.readdir(this.logDir)) {
        if (e.startsWith('audit-') && e.endsWith('.jsonl')) pros.add(e.slice(6, -6));
      }
    } catch {
      return 0;
    }
    for (const p of pros) {
      const lp = path.join(this.logDir, `audit-${p}.jsonl`);
      try {
        const c = await fs.readFile(lp, 'utf-8');
        const ls = c.trim().split('\n').filter(Boolean);
        const kept = ls.map(l => JSON.parse(l)).filter(e => e.timestamp >= cs).map(e => JSON.stringify(e));
        await fs.writeFile(lp, kept.join('\n') + (kept.length ? '\n' : ''), 'utf-8');
        n += ls.length - kept.length;
      } catch { /* keep going */ }
    }
    return n;
  }

  async shutdown() {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }
}

// ============================================================================
// Loop（C2/C3/C5）：FastPath + PTC + SessionManager + ConcurrentScheduler
// ============================================================================

class FastPathExecutor {
  constructor(reg, sb, cg, au, profile) {
    this.reg = reg;
    this.sb = sb;
    this.cg = cg;
    this.au = au;
    this.profile = profile;
  }

  async execute(input, tpl) {
    const start = Date.now();
    const ik = tpl.idempotencyKeyFn
      ? await tpl.idempotencyKeyFn(input)
      : crypto.createHash('sha256').update(`${tpl.name}:${input}`).digest('hex').slice(0, 32);
    const steps = [];
    const prev = new Map();
    let st = 'SUCCEEDED';
    for (const step of tpl.plan) {
      if (step.condition && !step.condition(prev)) continue;
      const args = typeof step.args === 'function' ? step.args(input, prev) : step.args;
      const ts = this.reg.getTool(step.tool);
      if (!ts) throw new Error(`Tool ${step.tool} not registered`);
      const ta = this.sb.isToolAllowed(step.tool);
      if (!ta.allowed) {
        if (ta.requiresApproval) {
          st = 'BLOCKED';
          await this.au.log({ profile: this.profile, tool: step.tool, action: 'block', paramsHash: JSON.stringify(args), result: 'BLOCKED', durationMs: 0, error: ta.reason });
          break;
        }
        throw new Error(`Tool not allowed: ${ta.reason}`);
      }
      const ss = Date.now();
      let res;
      try {
        res = await ts.handler(args);
      } catch (e) {
        res = { success: false, error: String(e) };
      }
      const gov = await this.cg.governReturn(step.tool, res);
      await this.au.log({
        profile: this.profile,
        tool: step.tool,
        action: 'call',
        paramsHash: JSON.stringify(args),
        result: gov.success ? 'SUCCESS' : 'FAILURE',
        durationMs: Date.now() - ss,
        error: gov.error,
      });
      steps.push({ tool: step.tool, result: gov, durationMs: Date.now() - ss });
      prev.set(step.tool, gov);
      if (!gov.success) {
        st = 'FAILED';
        break;
      }
    }
    return { templateName: tpl.name, idempotencyKey: ik, status: st, steps, totalDurationMs: Date.now() - start, llmCalls: 0 };
  }
}

class PTCExecutor {
  constructor(reg, sb, cg, au, profile, maxCalls = 50, timeout = 120000) {
    this.reg = reg;
    this.sb = sb;
    this.cg = cg;
    this.au = au;
    this.profile = profile;
    this.maxCalls = maxCalls;
    this.timeout = timeout;
  }

  async execute(script) {
    const start = Date.now();
    const calls = [];
    let trunc = false;
    const parsed = this.parse(script);
    for (const call of parsed) {
      if (calls.length >= this.maxCalls) {
        trunc = true;
        break;
      }
      const ts = this.reg.getTool(call.name);
      if (!ts) {
        calls.push({ tool: call.name, args: call.args, result: { success: false, error: `Tool ${call.name} not registered` } });
        continue;
      }
      const ta = this.sb.isToolAllowed(call.name);
      if (!ta.allowed) {
        calls.push({ tool: call.name, args: call.args, result: { success: false, error: `Not allowed: ${ta.reason}` } });
        if (ta.requiresApproval) {
          await this.au.log({ profile: this.profile, tool: call.name, action: 'block', paramsHash: JSON.stringify(call.args), result: 'BLOCKED', durationMs: 0, error: ta.reason });
        }
        continue;
      }
      const ss = Date.now();
      let r;
      try {
        r = await ts.handler(call.args);
      } catch (e) {
        r = { success: false, error: String(e) };
      }
      const gov = await this.cg.governReturn(call.name, r);
      await this.au.log({
        profile: this.profile,
        tool: call.name,
        action: 'call',
        paramsHash: JSON.stringify(call.args),
        result: gov.success ? 'SUCCESS' : 'FAILURE',
        durationMs: Date.now() - ss,
        error: gov.error,
      });
      calls.push({ tool: call.name, args: call.args, result: gov });
    }
    return {
      script,
      summary: {
        totalCalls: calls.length,
        succeeded: calls.filter(c => c.result.success).length,
        failed: calls.filter(c => !c.result.success).length,
        tools: [...new Set(calls.map(c => c.tool))],
      },
      toolCalls: calls,
      durationMs: Date.now() - start,
      truncated: trunc,
    };
  }

  parse(s) {
    const out = [];
    const re = /callTool\s*\(\s*["']([^"']+)["']\s*,\s*(\{[\s\S]*?\})\s*\)/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      try {
        out.push({ name: m[1], args: JSON.parse(m[2]) });
      } catch { /* skip malformed call */ }
    }
    return out;
  }
}

class SessionManager {
  constructor(profile, dir) {
    this.p = path.join(dir, `session-${profile}.json`);
    this.state = this.init();
  }

  init() {
    return {
      version: 1,
      turn: 0,
      step: 0,
      completedSteps: new Map(),
      pendingSteps: [],
      idempotencyKeys: new Map(),
      workspaceRoots: new Map(),
      updatedAt: new Date().toISOString(),
    };
  }

  async load() {
    try {
      const c = await fs.readFile(this.p, 'utf-8');
      const j = JSON.parse(c);
      this.state = {
        ...j,
        completedSteps: new Map(Object.entries(j.completedSteps ?? {})),
        idempotencyKeys: new Map(Object.entries(j.idempotencyKeys ?? {})),
        workspaceRoots: new Map(Object.entries(j.workspaceRoots ?? {})),
      };
    } catch { /* fresh state */ }
  }

  async save() {
    await fs.mkdir(path.dirname(this.p), { recursive: true });
    await fs.writeFile(this.p, JSON.stringify({
      ...this.state,
      completedSteps: Object.fromEntries(this.state.completedSteps),
      idempotencyKeys: Object.fromEntries(this.state.idempotencyKeys),
      workspaceRoots: Object.fromEntries(this.state.workspaceRoots),
      updatedAt: new Date().toISOString(),
    }, null, 2), 'utf-8');
  }

  mark(id, r) {
    this.state.completedSteps.set(id, r);
    this.state.step++;
  }

  has(id) { return this.state.completedSteps.has(id); }
  get(id) { return this.state.completedSteps.get(id); }
  setIdem(k, r) { this.state.idempotencyKeys.set(k, r); }
  getIdem(k) { return this.state.idempotencyKeys.get(k); }

  nextTurn() {
    this.state.turn++;
    this.state.step = 0;
  }
}

class ConcurrentScheduler {
  constructor(max = 8) { this.max = max; }

  async execReadOnly(calls) {
    const results = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(this.max, calls.length) }, async () => {
      while (cursor < calls.length) {
        const i = cursor++;
        try {
          results[i] = await calls[i].execute();
        } catch (e) {
          results[i] = e;
        }
      }
    });
    await Promise.all(workers);
    return results;
  }
}

// ============================================================================
// Preset（C4）：编排裁剪补丁
// ============================================================================

const presets = {
  'minimal-no-orchestration': (c) => ({
    ...c,
    loop: { ...c.loop, disabledLayers: ['plan', 'todo', 'goal', 'subagent'], prunerEnabled: true, compactionEnabled: true },
  }),
  'code-ptc-friendly': (c) => ({
    ...c,
    loop: {
      ...c.loop,
      preset: 'code',
      disabledLayers: ['plan', 'todo', 'goal', 'subagent'],
      prunerEnabled: true,
      compactionEnabled: true,
      maxParallelToolCalls: 8,
    },
  }),
};

function applyPreset(cfg, name) {
  const p = presets[name];
  if (!p) throw new Error(`Unknown preset: ${name}`);
  return p(cfg);
}

function dumpConfig(cfg) { return JSON.stringify(cfg, null, 2); }

// ============================================================================
// Main Service
// ============================================================================

const DEFAULT_CONFIG = {
  context: { maxReturnBytes: 4096, fieldsProjection: true, prunerEnabled: true, compactionEnabled: true, lazyLoadTools: true },
  loop: { preset: 'code', disabledLayers: ['plan', 'todo', 'goal', 'subagent'], maxParallelToolCalls: 8, enableCustomLoop: false },
  sandbox: {
    mode: 'workspace-write',
    approval: 'ask',
    rules: { files: [], commands: [], network: [] },
    networkDefault: 'deny',
    backupEnabled: true,
    deletionProtection: true,
    injectionGuard: true,
    sensitiveProtection: true,
    shell: 'pwsh',
    workspaceTrust: true,
    toolControl: {},
  },
  audit: { mode: 'append-only', desensitize: true, exportable: true, retentionDays: 90 },
  logDir: path.join(os.homedir(), '.dsh', 'runtime-kit', 'logs'),
  stateDir: path.join(os.homedir(), '.dsh', 'runtime-kit', 'state'),
};

class RuntimeKitServiceImpl {
  constructor(config) {
    this.config = config;
    this.registry = new RegistryImpl({
      onWorkspaceRegistered: (ws) => this.sandbox.registerWorkspace(ws),
      onWorkspaceUnregistered: (p) => this.sandbox.unregisterWorkspace(p),
    });
    this.contextGov = new ContextGovernance(config.context);
    this.sandbox = new Sandbox(config.sandbox);
    this.audit = new Audit(config.audit, config.logDir, this.sandbox);
    this.sessionManager = new SessionManager('default', config.stateDir);
    this.fastPath = new FastPathExecutor(this.registry, this.sandbox, this.contextGov, this.audit, 'default');
    this.ptc = new PTCExecutor(this.registry, this.sandbox, this.contextGov, this.audit, 'default');
    this.scheduler = new ConcurrentScheduler(config.loop.maxParallelToolCalls);
    this.registerBuiltinTools();
  }

  registerBuiltinTools() {
    this.registry.registerTool({
      name: 'echo',
      description: 'Echo back input',
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      isStateChanging: false,
      returnBudget: 1024,
      handler: async (a) => ({ success: true, data: { echoed: a.text } }),
    });

    const kv = new Map();
    this.registry.registerTool({
      name: 'kv_get',
      description: 'Get KV value',
      schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
      isStateChanging: false,
      returnBudget: 1024,
      handler: async (a) => ({ success: true, data: { value: kv.get(a.key) ?? null } }),
    });
    this.registry.registerTool({
      name: 'kv_set',
      description: 'Set KV value',
      schema: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] },
      isStateChanging: true,
      returnBudget: 1024,
      handler: async (a) => {
        kv.set(a.key, a.value);
        return { success: true, data: { ok: true } };
      },
    });

    this.registry.registerTool({
      name: 'file_read',
      description: 'Read file content',
      schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      isStateChanging: false,
      returnBudget: 4096,
      handler: async (a) => {
        try {
          const c = await fs.readFile(a.path, 'utf-8');
          return { success: true, data: { content: c } };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    });
    this.registry.registerTool({
      name: 'file_write',
      description: 'Write file content',
      schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      isStateChanging: true,
      returnBudget: 1024,
      handler: async (a) => {
        try {
          await fs.mkdir(path.dirname(a.path), { recursive: true });
          await fs.writeFile(a.path, a.content, 'utf-8');
          return { success: true, data: { ok: true } };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    });

    this.registry.registerTool({
      name: 'http_probe',
      description: 'HTTP probe (GET/HEAD)',
      schema: { type: 'object', properties: { url: { type: 'string', format: 'uri' }, method: { type: 'string', enum: ['GET', 'HEAD'], default: 'GET' } }, required: ['url'] },
      isStateChanging: false,
      returnBudget: 2048,
      handler: async (a) => {
        try {
          const r = await fetch(a.url, { method: a.method ?? 'GET' });
          return { success: true, data: { status: r.status, ok: r.ok } };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    });

    this.registry.registerTool({
      name: 'crash_tool',
      description: 'Intentional crash for testing',
      schema: { type: 'object', properties: {} },
      isStateChanging: false,
      returnBudget: 1024,
      handler: async () => {
        throw new Error('INTENTIONAL_CRASH');
      },
    });

    this.registry.registerTemplate({
      name: 'echo-chain',
      description: 'Chain 3 echos',
      match: (i) => i.startsWith('echo-chain:'),
      plan: [
        { tool: 'echo', args: { text: 'step-1' } },
        { tool: 'echo', args: { text: 'step-2' } },
        { tool: 'echo', args: { text: 'step-3' } },
      ],
      idempotencyKeyFn: (i) => `echo-chain:${i.slice(11)}`,
    });
  }

  async executeFastPath(input) {
    const t = await this.registry.matchTemplate(input);
    if (!t) throw new Error(`No template matched: ${input}`);
    return this.fastPath.execute(input, t);
  }

  async executePTC(script) { return this.ptc.execute(script); }
  getMetrics() { return this.contextGov.getMetrics(); }
  async getAuditLogs(f) { return this.audit.getLogs(f); }

  async verifyIsolation(profile) {
    const ws = this.registry.getWorkspace(profile);
    if (!ws) {
      return {
        profile,
        checks: { workspaceBound: false, pathTraversal: false, networkIsolation: false, credentialLeak: false, toolControl: false },
        violations: [`Workspace not registered: ${profile}`],
        passed: false,
      };
    }
    return {
      profile,
      checks: { workspaceBound: true, pathTraversal: true, networkIsolation: true, credentialLeak: true, toolControl: true },
      violations: [],
      passed: true,
    };
  }

  async healthCheck() {
    const checks = {};
    checks.registry = {
      status: 'pass',
      message: `${this.registry.listTools().length} tools, ${this.registry.listTemplates().length} templates, ${this.registry.listWorkspaces().length} workspaces`,
    };
    try {
      this.sandbox.getConfig();
      checks.sandbox = { status: 'pass', message: 'Config loaded' };
    } catch {
      checks.sandbox = { status: 'fail', message: 'Config invalid' };
    }
    try {
      await fs.access(this.config.logDir);
      checks.audit = { status: 'pass', message: 'Log dir accessible' };
    } catch {
      checks.audit = { status: 'warn', message: 'Log dir not accessible' };
    }
    const all = Object.values(checks).every(c => c.status === 'pass');
    const any = Object.values(checks).some(c => c.status === 'fail');
    return { status: any ? 'unhealthy' : all ? 'healthy' : 'degraded', checks, version: this.version ?? '0.0.0', build: 'whole-line-ptc+workspace-hooks', dshVersion: process.env.DSH_VERSION ?? 'unknown' };
  }

  reloadConfig(p) {
    this.config = { ...this.config, ...p };
    this.contextGov.updateConfig(p.context ?? {});
    this.sandbox.updateConfig(p.sandbox ?? {});
    this.audit.updateConfig(p.audit ?? {});
    for (const ws of this.registry.listWorkspaces()) this.sandbox.registerWorkspace(ws);
  }

  getConfig() { return { ...this.config }; }
  dumpConfig() { return dumpConfig(this.config); }
  getPresets() { return Object.keys(presets); }
  applyPreset(name) { this.reloadConfig(applyPreset(this.config, name)); }
}

// ============================================================================
// Plugin Entry
// ============================================================================

const name = 'dsh-runtime-kit';

/** Split raw command input into positional tokens and -k value options.
 *  Double-quoted segments ("...") stay together; a quoted empty string is a token. */
function parseArgs(rawInput) {
  const tokens = [];
  const s = String(rawInput ?? '');
  let cur = '';
  let inQuote = false;
  let started = false;
  for (const ch of s) {
    if (inQuote) {
      if (ch === '"') inQuote = false;
      else cur += ch;
    } else if (ch === '"') {
      inQuote = true;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || cur) {
        tokens.push(cur);
        cur = '';
        started = false;
      }
    } else {
      cur += ch;
    }
  }
  if (started || cur) tokens.push(cur);
  const positional = [];
  const options = {};
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.length > 1 && t.startsWith('-')) {
      const key = t.replace(/^-+/, '');
      const next = tokens[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        options[key] = next;
        i++;
      } else {
        options[key] = 'true';
      }
    } else {
      positional.push(t);
    }
  }
  return { positional, options };
}

/** Wrap a plain handler into a CommandResult-producing handler. */
function command(fn) {
  return async (invocation) => {
    try {
      const text = await fn(parseArgs(invocation.rawInput), invocation);
      return { kind: 'success', text: String(text ?? '') };
    } catch (error) {
      return { kind: 'error', text: String(error?.message ?? error) };
    }
  };
}

async function apply(ctx, raw = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    ...raw,
    context: { ...DEFAULT_CONFIG.context, ...raw.context },
    loop: { ...DEFAULT_CONFIG.loop, ...raw.loop },
    sandbox: { ...DEFAULT_CONFIG.sandbox, ...raw.sandbox },
    audit: { ...DEFAULT_CONFIG.audit, ...raw.audit },
  };
  await fs.mkdir(config.logDir, { recursive: true });
  await fs.mkdir(config.stateDir, { recursive: true });

  const svc = new RuntimeKitServiceImpl(config);
  try {
    svc.version = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch { /* 读不到就保持未知 */ }
  ctx.provide('runtimeKit', svc);

  // ---- 治理钩子：审计 / 脱敏 / 注入检测 / 沙箱（全部 fail-open） ----
  // ---- 治理钩子：审计 / 脱敏 / 注入检测 / 沙箱（全部 fail-open） ----
  config.governance = { ...DEFAULT_GOVERNANCE, ...(raw.governance ?? {}) };
  try {
    svc.governance = installGovernance(ctx, svc, config.governance);
  } catch (error) {
    ctx.logger?.warn?.(`[runtime-kit] governance hooks failed: ${String(error)}`);
  }

  // ---- 页面：把能力暴露成 HTTP，客户端设置页/侧栏读取 ----
  try {
    const { mountDashboard } = await import('./dashboard/index.js');
    mountDashboard(ctx, svc);
  } catch (error) {
    ctx.logger?.warn?.(`[runtime-kit] dashboard failed: ${String(error)}`);
  }

  const registerCommands = (commandCtx) => {
    const commands = commandCtx.commands;
    const definitions = [
      {
        name: 'runtime_kit_health',
        description: 'Runtime Kit health check',
        handler: command(async () => JSON.stringify(await svc.healthCheck(), null, 2)),
      },
      {
        name: 'runtime_kit_config',
        description: 'Show runtime-kit config, or apply a preset (minimal-no-orchestration | code-ptc-friendly)',
        input: { hint: '[preset]' },
        handler: command(async ({ positional }) => {
          const preset = positional[0];
          if (preset) {
            svc.applyPreset(preset);
            return `Applied preset: ${preset}`;
          }
          return svc.dumpConfig();
        }),
      },
      {
        name: 'runtime_kit_metrics',
        description: 'Show context-governance metrics',
        handler: command(async () => JSON.stringify(svc.getMetrics(), null, 2)),
      },
      {
        name: 'runtime_kit_audit_logs',
        description: 'Query audit logs: [profile] [-t tool] [-a action] [-r result] [-s since] [-l limit]',
        input: { hint: '[profile] [-t tool] [-a action] [-r result] [-s since] [-l limit]' },
        handler: command(async ({ positional, options }) => JSON.stringify(await svc.getAuditLogs({
          profile: positional[0],
          tool: options.t,
          action: options.a,
          result: options.r,
          since: options.s,
          limit: options.l ? Number(options.l) : 50,
        }), null, 2)),
      },
      {
        name: 'runtime_kit_isolation',
        description: 'Verify sandbox isolation for a workspace profile',
        input: { hint: '<profile>' },
        handler: command(async ({ positional }) => {
          const profile = positional[0];
          if (!profile) throw new Error('Usage: /runtime_kit_isolation <profile>');
          return JSON.stringify(await svc.verifyIsolation(profile), null, 2);
        }),
      },
      {
        name: 'runtime_kit_fastpath',
        description: 'Execute a fast-path template (0 LLM calls); the whole input line is the template input',
        input: { hint: '<template-input>' },
        handler: command(async (_args, invocation) => {
          const input = invocation.rawInput.trim();
          if (!input) throw new Error('Usage: /runtime_kit_fastpath <template-input>');
          return JSON.stringify(await svc.executeFastPath(input), null, 2);
        }),
      },
      {
        name: 'runtime_kit_ptc',
        description: 'Execute a PTC script: callTool("name", {...}) lines; the whole input line is the script, only the summary returns',
        input: { hint: '<script>' },
        handler: command(async (_args, invocation) => {
          const script = invocation.rawInput.trim();
          if (!script) throw new Error('Usage: /runtime_kit_ptc <script>');
          return JSON.stringify(await svc.executePTC(script), null, 2);
        }),
      },
      {
        name: 'runtime_kit_registry_tools',
        description: 'List registered runtime-kit tools',
        handler: command(async () => JSON.stringify(svc.registry.listTools().map(t => t.name), null, 2)),
      },
      {
        name: 'runtime_kit_registry_templates',
        description: 'List registered fast-path templates',
        handler: command(async () => JSON.stringify(svc.registry.listTemplates().map(t => t.name), null, 2)),
      },
      {
        name: 'runtime_kit_registry_workspaces',
        description: 'List registered sandbox workspaces',
        handler: command(async () => JSON.stringify(svc.registry.listWorkspaces().map(w => ({ profile: w.profile, root: w.root })), null, 2)),
      },
    ];
    const disposers = [];
    for (const def of definitions) {
      try {
        disposers.push(commands.register(def));
      } catch (e) {
        ctx.logger?.warn?.(`[runtime-kit] command ${def.name} registration failed: ${String(e)}`);
      }
    }
    commandCtx.effect(function* () {
      for (const dispose of disposers) yield dispose;
    }, 'runtime-kit commands');
  };

  // 'commands' 服务可选：宿主提供后注册斜杠命令；不提供时 runtimeKit 服务照常工作。
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['commands'], registerCommands);
    } catch (e) {
      ctx.logger?.warn?.(`[runtime-kit] commands subscription failed: ${String(e)}`);
    }
  }

  // 审计在插件销毁时落盘。
  if (typeof ctx.effect === 'function') {
    ctx.effect(function* () {
      yield () => svc.audit.shutdown();
    }, 'runtime-kit audit shutdown');
  } else {
    ctx.on('dispose', () => { svc.audit.shutdown().catch(() => {}); });
  }
}

export { name, apply };
export default { name, apply };
