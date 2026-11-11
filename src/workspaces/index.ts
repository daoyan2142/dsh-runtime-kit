// ============================================================================
// Workspaces — the missing half of the sandbox.
//
// `Sandbox.resolveAndValidate()` anchors every decision on a registered
// workspace, but registering one used to require code: `registry.registerWorkspace()`.
// With no entry point in config or on the page, turning the sandbox on meant
// "deny every path-bearing call". This module makes workspaces configurable,
// registers them at startup, and replaces the stub isolation check with a real
// one.
// ============================================================================

import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

export interface WorkspaceInput {
  profile: string;
  root: string;
  permissionMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  networkAllowlist?: string[];
}

const PROFILE_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const DRIVE_ROOT_RE = /^[a-zA-Z]:[\\/]?$/;
const MODES = ['read-only', 'workspace-write', 'danger-full-access'] as const;
const MAX_WORKSPACES = 3;

export interface NormalizedWorkspaces {
  workspaces: WorkspaceInput[];
  errors: string[];
}

/** 校验并归一化配置里的工作区列表。非法项被丢弃并报告，不静默通过。 */
export function normalizeWorkspaces(raw: unknown): NormalizedWorkspaces {
  const errors: string[] = [];
  const workspaces: WorkspaceInput[] = [];
  const input = Array.isArray(raw) ? raw : [];
  if (input.length > MAX_WORKSPACES) errors.push(`最多 ${MAX_WORKSPACES} 个工作区`);

  for (const entry of input) {
    if (workspaces.length >= MAX_WORKSPACES) break;
    const profile = String((entry as any)?.profile ?? '').trim();
    const root = String((entry as any)?.root ?? '').trim();
    if (!PROFILE_RE.test(profile)) {
      errors.push(`工作区 profile "${profile || '(空)'}" 不合法：小写字母开头，仅含 a-z 0-9 _ -`);
      continue;
    }
    if (!root) {
      errors.push(`工作区 "${profile}" 缺少 root`);
      continue;
    }
    if (!isAbsolute(root)) {
      errors.push(`工作区 "${profile}" 的 root 必须是绝对路径：${root}`);
      continue;
    }
    if (DRIVE_ROOT_RE.test(root)) {
      errors.push(`工作区 "${profile}" 的 root 不能是盘符根：${root}`);
      continue;
    }
    if (workspaces.some((ws) => ws.profile === profile)) {
      errors.push(`工作区 profile "${profile}" 重复`);
      continue;
    }
    const mode = (entry as any)?.permissionMode;
    workspaces.push({
      profile,
      root: resolve(root),
      ...(MODES.includes(mode) ? { permissionMode: mode as WorkspaceInput['permissionMode'] } : {}),
      ...(Array.isArray((entry as any)?.networkAllowlist)
        ? { networkAllowlist: (entry as any).networkAllowlist.filter((d: unknown) => typeof d === 'string' && d) }
        : {}),
    });
  }
  return { workspaces, errors };
}

interface SandboxLike {
  registerWorkspace(spec: any): void;
  getWorkspace?(profile: string): any;
  resolveAndValidate?(profile: string, path: string, operation: string): { allowed: boolean; action: string; reason: string } | null;
}

interface ServiceLike {
  getConfig?(): any;
  reloadConfig?(partial: any): void;
  sandbox: SandboxLike;
  registry?: { listWorkspaces?(): any[] };
  verifyIsolation?(profile: string): Promise<any>;
}

/** 把配置里的工作区注册进沙箱（幂等：重复调用只是覆盖同名 profile）。 */
export function registerWorkspaces(service: ServiceLike, list: WorkspaceInput[]): number {
  let count = 0;
  for (const ws of list) {
    try {
      service.sandbox.registerWorkspace({
        profile: ws.profile,
        root: ws.root,
        ...(ws.permissionMode ? { permissionMode: ws.permissionMode } : {}),
        ...(ws.networkAllowlist ? { networkAllowlist: ws.networkAllowlist } : {}),
      });
      count += 1;
    } catch {
      /* 单个工作区注册失败不影响其它 */
    }
  }
  return count;
}

/** 配置里的工作区，已归一化。 */
export function configuredWorkspaces(service: ServiceLike): WorkspaceInput[] {
  try {
    return normalizeWorkspaces(service.getConfig?.()?.sandbox?.workspaces).workspaces;
  } catch {
    return [];
  }
}

export interface IsolationCheck {
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

export interface IsolationReport {
  profile: string;
  checks: Record<string, IsolationCheck>;
  violations: string[];
  passed: boolean;
}

/**
 * 真的检查隔离，而不是回一句"全绿"。
 *
 * 四项：工作区存在且可用 / 路径逃逸被挡 / 盘符外路径被挡 / 网络默认不是放行。
 * 另外报一条 `symlink` 警告——当前实现没有做 realpath 校验，如实标出来。
 */
export async function verifyIsolation(service: ServiceLike, profile: string): Promise<IsolationReport> {
  const checks: Record<string, IsolationCheck> = {};
  const violations: string[] = [];
  // 沙箱里注册的才算数（配置与代码注册两条路都会落到这里）；配置只是补充字段。
  const registered = service.sandbox.getWorkspace?.(profile);
  const ws = registered
    ? {
        profile,
        root: String(registered.root ?? ''),
        permissionMode: registered.permissionMode,
      }
    : configuredWorkspaces(service).find((item) => item.profile === profile);

  if (!ws) {
    checks.workspace = { status: 'fail', message: `未配置工作区：${profile}` };
    violations.push(`no workspace "${profile}"`);
    return { profile, checks, violations, passed: false };
  }

  let exists = false;
  try {
    exists = (await stat(ws.root)).isDirectory();
  } catch {
    exists = false;
  }
  checks.workspace = exists
    ? { status: 'pass', message: `${ws.root}（${ws.permissionMode ?? 'workspace-write'}）` }
    : { status: 'fail', message: `根目录不存在：${ws.root}` };
  if (!exists) violations.push(`root missing: ${ws.root}`);

  // 用一个必然越界的探针，确认规则真的会拦
  const escapeProbe = resolve(ws.root, '..', 'runtime-kit-escape-probe');
  const escapeDecision = service.sandbox.resolveAndValidate?.(profile, escapeProbe, 'read');
  const traversalOk = Boolean(escapeDecision && escapeDecision.allowed === false);
  checks.traversal = traversalOk
    ? { status: 'pass', message: '越界路径被拒绝' }
    : { status: 'fail', message: '越界探针没有被拒绝' };
  if (!traversalOk) violations.push('traversal probe allowed');

  const outside = resolve(ws.root, '..', '..', 'Windows', 'System32');
  const outsideDecision = service.sandbox.resolveAndValidate?.(profile, outside, 'read');
  const outsideOk = Boolean(outsideDecision && outsideDecision.allowed === false);
  checks.outsideRoot = outsideOk
    ? { status: 'pass', message: '根外路径被拒绝' }
    : { status: 'fail', message: '根外路径没有被拒绝' };
  if (!outsideOk) violations.push('outside-root probe allowed');

  const sandboxConfig = service.getConfig?.()?.sandbox ?? {};
  const network = sandboxConfig.networkDefault ?? 'deny';
  checks.network = network === 'allow'
    ? { status: 'fail', message: '网络默认放行' }
    : { status: 'pass', message: `网络默认 ${network}` };
  if (network === 'allow') violations.push('network default is allow');

  checks.symlink = { status: 'warn', message: '当前版本不做 realpath 校验，junction 逃逸检测未实现' };

  return {
    profile,
    checks,
    violations,
    passed: Object.values(checks).every((check) => check.status !== 'fail'),
  };
}

/**
 * 安装：注册工作区 + 用真实实现替换 `verifyIsolation`。
 *
 * 返回注册数量，供启动日志使用。
 */
export function installWorkspaces(service: ServiceLike): number {
  const list = configuredWorkspaces(service);
  const count = registerWorkspaces(service, list);
  try {
    service.verifyIsolation = (profile: string) => verifyIsolation(service, profile);
  } catch {
    /* 只读服务对象：保持原实现 */
  }
  return count;
}
