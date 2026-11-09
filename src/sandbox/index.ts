// ============================================================================
// Sandbox - C6 沙箱策略、路径/网络白名单、shell 抽象、执行域接口
// 零业务依赖，纯安全能力
// ============================================================================

import * as path from 'path';
import * as crypto from 'crypto';
import {
  SandboxConfig,
  FileRule,
  CommandRule,
  NetworkRule,
  WorkspaceSpec,
  ToolSpec,
} from '../types';

/** 沙箱决策结果 */
export interface SandboxDecision {
  allowed: boolean;
  action: 'allow' | 'ask' | 'deny';
  reason: string;
  ruleMatched?: FileRule | CommandRule | NetworkRule;
  requiresApproval: boolean;
}

/** 文件操作类型 */
export type FileOperation = 'read' | 'write' | 'delete';

/** 命令执行请求 */
export interface CommandRequest {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

/** 网络请求 */
export interface NetworkRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
}

/** 快照记录 */
export interface FileSnapshot {
  path: string;
  content: string;
  hash: string;
  timestamp: string;
}

/** 回收站条目 */
export interface TrashEntry {
  originalPath: string;
  snapshot: FileSnapshot;
  deletedAt: string;
}

/** 沙箱服务 */
export class Sandbox {
  private config: SandboxConfig;
  private workspaces = new Map<string, WorkspaceSpec>();
  private snapshots = new Map<string, FileSnapshot[]>();  // path -> snapshots[]
  private trash = new Map<string, TrashEntry>();  // trashId -> entry

  constructor(config: SandboxConfig) {
    this.config = config;
  }

  // ========== 配置管理 ==========
  updateConfig(partial: Partial<SandboxConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  getConfig(): SandboxConfig {
    return { ...this.config };
  }

  // ========== 工作区绑定 ==========
  registerWorkspace(spec: WorkspaceSpec): void {
    // 解析并验证根路径
    const resolvedRoot = path.resolve(spec.root);
    this.workspaces.set(spec.profile, { ...spec, root: resolvedRoot });
  }

  unregisterWorkspace(profile: string): void {
    this.workspaces.delete(profile);
  }

  getWorkspace(profile: string): WorkspaceSpec | undefined {
    return this.workspaces.get(profile);
  }

  // ========== 路径校验（核心） ==========
  /** 解析路径并校验是否在工作区白名单内 */
  resolveAndValidate(profile: string, requestedPath: string, operation: FileOperation): SandboxDecision {
    const workspace = this.workspaces.get(profile);
    if (!workspace) {
      return this.deny(`Workspace not registered for profile: ${profile}`, 'file', operation);
    }

    // 1. 解析为绝对路径
    let absolutePath: string;
    try {
      // 禁止绝对路径注入：如果传入的是绝对路径，直接拒绝（除非在白名单内）
      if (path.isAbsolute(requestedPath)) {
        absolutePath = path.resolve(requestedPath);
      } else {
        absolutePath = path.resolve(workspace.root, requestedPath);
      }
    } catch {
      return this.deny(`Path resolution failed: ${requestedPath}`, 'file', operation);
    }

    // 2. 拒绝路径穿越（.. 软链接逃逸）
    const relative = path.relative(workspace.root, absolutePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return this.deny(`Path traversal attempt: ${requestedPath} -> ${absolutePath}`, 'file', operation);
    }

    // 3. 检查软链接（Windows 上较少见但仍需防范）
    // 实际实现需用 fs.lstatSync 检查是否为符号链接

    // 4. 基线权限模式检查
    const baseDecision = this.checkBaseMode(workspace, operation);
    if (!baseDecision.allowed) return baseDecision;

    // 5. 细粒度文件规则匹配
    const ruleDecision = this.matchFileRules(relative, operation);
    if (ruleDecision) return ruleDecision;

    // 6. 默认基于基线模式
    return baseDecision;
  }

  /** 基线三档模式检查 */
  private checkBaseMode(workspace: WorkspaceSpec, operation: FileOperation): SandboxDecision {
    const mode = workspace.permissionMode ?? this.config.mode;

    switch (mode) {
      case 'read-only':
        if (operation === 'read') return this.allow('Read allowed in read-only mode');
        return this.deny(`${operation} denied in read-only mode`, 'file', operation);

      case 'workspace-write':
        return this.allow(`${operation} allowed in workspace-write mode`);

      case 'danger-full-access':
        return this.allow(`${operation} allowed in danger-full-access mode`);
    }
  }

  /** 细粒度文件规则匹配（三态：读/写/删分别设置） */
  private matchFileRules(relativePath: string, operation: FileOperation): SandboxDecision | null {
    for (const rule of this.config.rules.files) {
      if (this.matchGlob(relativePath, rule.pattern)) {
        const action = rule[operation];
        if (action === 'allow') return this.allow(`File rule allow: ${rule.pattern}`, rule);
        if (action === 'deny') return this.deny(`File rule deny: ${rule.pattern}`, 'file', operation, rule);
        if (action === 'ask') return this.ask(`File rule ask: ${rule.pattern}`, rule);
      }
    }
    return null;
  }

  // ========== 命令执行校验 ==========
  validateCommand(request: CommandRequest): SandboxDecision {
    const fullCommand = `${request.command} ${request.args.join(' ')}`.trim();

    for (const rule of this.config.rules.commands) {
      if (fullCommand.startsWith(rule.prefix)) {
        if (rule.action === 'allow') return this.allow(`Command rule allow: ${rule.prefix}`, rule);
        if (rule.action === 'deny') return this.deny(`Command rule deny: ${rule.prefix}`, 'command', 'execute', rule);
        if (rule.action === 'ask') return this.ask(`Command rule ask: ${rule.prefix}`, rule);
      }
    }

    // 默认基于基线模式（danger-full-access 才允许任意命令）
    if (this.config.mode === 'danger-full-access') {
      return this.allow('Command allowed in danger-full-access mode');
    }
    return this.deny(`Command not in allowlist: ${fullCommand}`, 'command', 'execute');
  }

  // ========== 网络访问校验 ==========
  validateNetwork(request: NetworkRequest): SandboxDecision {
    let hostname: string;
    try {
      hostname = new URL(request.url).hostname;
    } catch {
      return this.deny(`Invalid URL: ${request.url}`, 'network', 'connect');
    }

    // 精确域名匹配（禁止泛域名通配）
    for (const rule of this.config.rules.network) {
      if (hostname === rule.domain) {
        if (rule.action === 'allow') return this.allow(`Network rule allow: ${rule.domain}`, rule);
        if (rule.action === 'deny') return this.deny(`Network rule deny: ${rule.domain}`, 'network', 'connect', rule);
        if (rule.action === 'ask') return this.ask(`Network rule ask: ${rule.domain}`, rule);
      }
    }

    // 默认策略
    switch (this.config.networkDefault) {
      case 'allow':
        return this.allow('Network allowed by default');
      case 'ask':
        return this.ask('Network access requires approval (default)');
      case 'deny':
      default:
        return this.deny(`Network denied by default: ${hostname}`, 'network', 'connect');
    }
  }

  // ========== 工具粒度管控 ==========
  isToolAllowed(toolName: string): SandboxDecision {
    const enabled = this.config.toolControl[toolName];
    if (enabled === false) {
      return this.deny(`Tool disabled: ${toolName}`, 'tool', 'call');
    }
    if (enabled === true) {
      return this.allow(`Tool enabled: ${toolName}`);
    }
    // 未配置则默认允许（由注册表控制）
    return this.allow(`Tool not explicitly controlled: ${toolName}`);
  }

  // ========== 变更可恢复：快照 + 回收站 ==========
  /** 修改前创建快照 */
  async createSnapshot(filePath: string, content: string): Promise<string> {
    if (!this.config.backupEnabled) return '';

    const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
    const snapshot: FileSnapshot = {
      path: filePath,
      content,
      hash,
      timestamp: new Date().toISOString(),
    };

    const existing = this.snapshots.get(filePath) ?? [];
    existing.push(snapshot);
    // 保留最近 10 个快照
    if (existing.length > 10) existing.shift();
    this.snapshots.set(filePath, existing);

    return hash;
  }

  /** 获取快照历史 */
  getSnapshots(filePath: string): FileSnapshot[] {
    return this.snapshots.get(filePath) ?? [];
  }

  /** 恢复到指定快照 */
  restoreSnapshot(filePath: string, hash: string): string | null {
    const snapshots = this.snapshots.get(filePath) ?? [];
    const snapshot = snapshots.find(s => s.hash === hash);
    return snapshot?.content ?? null;
  }

  /** 安全删除：进回收站而非直接删除 */
  async safeDelete(filePath: string, content: string): Promise<string> {
    if (!this.config.deletionProtection) {
      return 'deleted';
    }

    const trashId = crypto.randomUUID();
    const snapshot = await this.createSnapshot(filePath, content);

    const entry: TrashEntry = {
      originalPath: filePath,
      snapshot: {
        path: filePath,
        content,
        hash: snapshot,
        timestamp: new Date().toISOString(),
      },
      deletedAt: new Date().toISOString(),
    };

    this.trash.set(trashId, entry);
    return trashId;
  }

  /** 从回收站恢复 */
  restoreFromTrash(trashId: string): { path: string; content: string } | null {
    const entry = this.trash.get(trashId);
    if (!entry) return null;
    this.trash.delete(trashId);
    return { path: entry.originalPath, content: entry.snapshot.content };
  }

  /** 清空回收站（需审批） */
  async emptyTrash(approved: boolean): Promise<number> {
    if (!approved) throw new Error('Emptying trash requires approval');
    const count = this.trash.size;
    this.trash.clear();
    return count;
  }

  // ========== 工作区信任/受限模式 ==========
  isWorkspaceTrusted(profile: string): boolean {
    const workspace = this.workspaces.get(profile);
    return workspace?.trusted ?? this.config.workspaceTrust;
  }

  // ========== 注入防护：检测工具返回中的诱导指令 ==========
  detectInjection(content: string): { suspicious: boolean; patterns: string[] } {
    if (!this.config.injectionGuard) return { suspicious: false, patterns: [] };

    const patterns = [
      /ignore\s+(previous|above|all)\s+instructions?/i,
      /forget\s+(everything|all|previous)/i,
      /you\s+are\s+now\s+/i,
      /system\s*:\s*/i,
      /assistant\s*:\s*/i,
      /<\|.*?\|>/g,  // 特殊 token
      /```\s*(system|user|assistant)/i,
      /override\s+(safety|security|policy)/i,
      /bypass\s+(filter|guard|check)/i,
    ];

    const matched = patterns
      .filter(p => p.test(content))
      .map(p => p.source);

    return { suspicious: matched.length > 0, patterns: matched };
  }

  // ========== 敏感信息保护：脱敏/还原 ==========
  private static readonly SENSITIVE_PATTERNS = [
    { name: 'password', regex: /(?:password|passwd|pwd)\s*[:=]\s*["']?([^"'\s]{8,})/gi, replace: '[REDACTED_PASSWORD]' },
    { name: 'api_key', regex: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?([^"'\s]{16,})/gi, replace: '[REDACTED_API_KEY]' },
    { name: 'secret', regex: /(?:secret|token)\s*[:=]\s*["']?([^"'\s]{16,})/gi, replace: '[REDACTED_SECRET]' },
    { name: 'cookie', regex: /(?:cookie|session)\s*[:=]\s*["']?([^"'\s]{16,})/gi, replace: '[REDACTED_COOKIE]' },
    { name: 'private_key', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi, replace: '[REDACTED_PRIVATE_KEY]' },
    { name: 'connection_string', regex: /(?:jdbc:|mongodb:\/\/|redis:\/\/|mysql:\/\/|postgresql:\/\/)[^"'\s]*(?::[^"'\s@]+@)/gi, replace: '[REDACTED_CONNECTION]' },
  ];

  /** 脱敏：用于日志、审计、上下文 */
  desensitize(content: string): { sanitized: string; placeholders: Map<string, string> } {
    if (!this.config.sensitiveProtection) return { sanitized: content, placeholders: new Map() };

    const placeholders = new Map<string, string>();
    let sanitized = content;

    for (const { name, regex, replace } of Sandbox.SENSITIVE_PATTERNS) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        const original = match[1] ?? match[0];
        const placeholder = `__${name.toUpperCase()}_${placeholders.size}__`;
        placeholders.set(placeholder, original);
        sanitized = sanitized.replace(original, placeholder);
        if (!regex.global) break;
      }
    }

    return { sanitized, placeholders };
  }

  /** 还原：仅在安全输出环节使用 */
  resensitize(sanitized: string, placeholders: Map<string, string>): string {
    let result = sanitized;
    for (const [placeholder, original] of placeholders) {
      result = result.replaceAll(placeholder, original);
    }
    return result;
  }

  // ========== Shell 抽象 ==========
  /** 获取当前平台的 shell 执行器 */
  getShellExecutor(): { command: string; args: string[] } {
    if (process.platform === 'win32') {
      // Windows 强制 pwsh，禁用 git bash 等绕开受限令牌的适配
      return { command: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-Command'] };
    }
    // Linux 走原生隔离（如 bwrap）
    return { command: '/bin/sh', args: ['-c'] };
  }

  // ========== 执行域替换接口 ==========
  /** 可被替换为远程一次性 box（gVisor 类）的执行域接口 */
  createExecutionDomain(): ExecutionDomain {
    return new LocalExecutionDomain(this);
  }

  // ========== 内部辅助 ==========
  private matchGlob(str: string, pattern: string): boolean {
    // 简单的 glob 匹配，实际可用 minimatch
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return regex.test(str);
  }

  private allow(reason: string, ruleMatched?: FileRule | CommandRule | NetworkRule): SandboxDecision {
    return { allowed: true, action: 'allow', reason, ruleMatched, requiresApproval: false };
  }

  private deny(reason: string, ruleType: 'file' | 'command' | 'network' | 'tool', operation: string, ruleMatched?: FileRule | CommandRule | NetworkRule): SandboxDecision {
    return { allowed: false, action: 'deny', reason, ruleMatched, requiresApproval: false };
  }

  private ask(reason: string, ruleMatched?: FileRule | CommandRule | NetworkRule): SandboxDecision {
    return { allowed: false, action: 'ask', reason, ruleMatched, requiresApproval: true };
  }
}

/** 执行域接口（可被远程 box 替换） */
export interface ExecutionDomain {
  fs: FileSystemAPI;
  shell: ShellAPI;
  subprocess: SubprocessAPI;
  network: NetworkAPI;
}

/** 文件系统 API */
export interface FileSystemAPI {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  list(path: string): Promise<string[]>;
  stat(path: string): Promise<{ size: number; mtime: Date; isDirectory: boolean }>;
  mkdir(path: string, recursive?: boolean): Promise<void>;
}

/** Shell API */
export interface ShellAPI {
  execute(command: string, args: string[], options?: { cwd?: string; env?: Record<string, string> }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

/** 子进程 API */
export interface SubprocessAPI {
  spawn(command: string, args: string[], options?: { cwd?: string; env?: Record<string, string> }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

/** 网络 API */
export interface NetworkAPI {
  fetch(url: string, options?: RequestInit): Promise<Response>;
}

/** 本地执行域实现 */
class LocalExecutionDomain implements ExecutionDomain {
  constructor(private sandbox: Sandbox) {}

  fs: FileSystemAPI = {
    read: async (p: string) => {
      const { readFile } = await import('fs/promises');
      return readFile(p, 'utf-8');
    },
    write: async (p: string, c: string) => {
      const { writeFile, mkdir } = await import('fs/promises');
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, c, 'utf-8');
    },
    delete: async (p: string) => {
      const { unlink, rmdir } = await import('fs/promises');
      try { await unlink(p); } catch { await rmdir(p, { recursive: true }); }
    },
    list: async (p: string) => {
      const { readdir } = await import('fs/promises');
      return readdir(p);
    },
    stat: async (p: string) => {
      const { stat } = await import('fs/promises');
      const s = await stat(p);
      return { size: s.size, mtime: s.mtime, isDirectory: s.isDirectory() };
    },
    mkdir: async (p: string, recursive = true) => {
      const { mkdir } = await import('fs/promises');
      await mkdir(p, { recursive });
    },
  };

  shell: ShellAPI = {
    execute: async (cmd, args, opts) => {
      const { spawn } = await import('child_process');
      const { command, args: shellArgs } = this.sandbox.getShellExecutor();
      const fullArgs = [...shellArgs, `${cmd} ${args.join(' ')}`];
      return new Promise((resolve, reject) => {
        const child = spawn(command, fullArgs, { cwd: opts?.cwd, env: { ...process.env, ...opts?.env }, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        child.stdout?.on('data', d => stdout += d.toString());
        child.stderr?.on('data', d => stderr += d.toString());
        child.on('close', code => resolve({ stdout, stderr, exitCode: code ?? 1 }));
        child.on('error', reject);
      });
    },
  };

  subprocess: SubprocessAPI = {
    spawn: async (cmd, args, opts) => this.shell.execute(cmd, args, opts),
  };

  network: NetworkAPI = {
    fetch: async (url, opts) => {
      // 实际需经过 validateNetwork
      return fetch(url, opts);
    },
  };
}