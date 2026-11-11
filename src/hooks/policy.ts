// ============================================================================
// Governance policy — pure functions (no I/O, no DSH types)
//
// Everything here is deliberately dependency-free and synchronous so it can be
// unit-tested without a Host: secret redaction, injection detection, and the
// extraction of paths/commands/URLs from arbitrary tool arguments.
// ============================================================================

/** 治理开关。全部能力都受这里控制，默认只开零风险的三项。 */
export interface GovernanceConfig {
  /** 总开关：false 时不注册任何钩子 */
  enabled: boolean;
  /** 观察每次工具调用并写入审计流水（只读，不改变行为） */
  audit: boolean;
  /** 把工具返回里的密钥替换成 [redacted:kind] */
  redaction: boolean;
  /** 提示注入处理：off 不检测 / annotate 追加警告块 / block 直接拦截 */
  injection: 'off' | 'annotate' | 'block';
  /** 沙箱规则（文件/命令/网络/工具启停）——默认关闭，开启后会真的拒绝调用 */
  sandbox: boolean;
  /** 用哪个已注册工作区做沙箱判定 */
  profile: string;
}

export const DEFAULT_GOVERNANCE: GovernanceConfig = {
  enabled: true,
  audit: true,
  redaction: true,
  injection: 'annotate',
  sandbox: false,
  profile: 'default',
};

export function normalizeGovernance(raw: unknown): GovernanceConfig {
  const input = (raw ?? {}) as Partial<GovernanceConfig>;
  const injection =
    input.injection === 'off' || input.injection === 'block' || input.injection === 'annotate'
      ? input.injection
      : DEFAULT_GOVERNANCE.injection;
  return {
    enabled: input.enabled !== false,
    audit: input.audit !== false,
    redaction: input.redaction !== false,
    injection,
    sandbox: input.sandbox === true,
    profile: typeof input.profile === 'string' && input.profile ? input.profile : DEFAULT_GOVERNANCE.profile,
  };
}

// ============================================================================
// 脱敏
// ============================================================================

interface SecretPattern {
  name: string;
  re: RegExp;
  /** 命中后如何替换；缺省是整体替换成 [redacted:name] */
  replace?: (match: string, groups: string[]) => string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // GitHub PAT / OAuth / app token
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  // npm granular token
  { name: 'npm-token', re: /\bnpm_[A-Za-z0-9]{30,}\b/g },
  // AWS access key id
  { name: 'aws-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  // Slack token
  { name: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  // 常见 PEM 私钥块
  {
    name: 'private-key',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  // Authorization: Bearer xxx
  {
    name: 'bearer',
    re: /\bBearer\s+([A-Za-z0-9._~+/-]{16,}=*)/gi,
    replace: () => 'Bearer [redacted:bearer]',
  },
  // scheme://user:password@host —— 只抹掉密码，保留 scheme 与用户名
  {
    name: 'url-password',
    re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+):[^\s/@]+@/gi,
    replace: (match, groups) => `${groups[0]}:***@`,
  },
];

export interface RedactResult {
  text: string;
  /** 命中的模式名（去重），用于审计 */
  hits: string[];
}

/** 抹掉一段文本里的凭据。没有命中时原样返回，便于调用方判断是否需要改写。 */
export function redactSecrets(input: string): RedactResult {
  if (typeof input !== 'string' || input.length === 0) return { text: input, hits: [] };
  let text = input;
  const hits: string[] = [];
  for (const pattern of SECRET_PATTERNS) {
    // 带捕获组的替换函数需要拿到分组，先收集再统一替换
    text = text.replace(pattern.re, (...args: any[]) => {
      hits.push(pattern.name);
      if (pattern.replace) {
        const groups = args.slice(1, -2) as string[];
        return pattern.replace(String(args[0]), groups);
      }
      return `[redacted:${pattern.name}]`;
    });
  }
  return { text, hits: [...new Set(hits)] };
}

// ============================================================================
// 提示注入检测
// ============================================================================

/** 保守的高置信度模式：宁可漏报，也不要把正常代码/文档判成注入。 */
const INJECTION_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'ignore-previous', re: /ignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)\s+(?:instructions?|prompts?|rules?)/i },
  { name: 'disregard-instructions', re: /disregard\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|system)\s+(?:instructions?|prompts?)/i },
  { name: 'ignore-zh', re: /忽略(?:以上|之前|前面|上述)(?:的)?(?:所有)?(?:指令|提示|要求|规则)/ },
  { name: 'role-override', re: /\byou\s+are\s+now\s+(?:a|an|the)\s+[a-z]/i },
  { name: 'system-tag', re: /<\|?im_start\|?>|<\/?system>/i },
  { name: 'system-colon', re: /(?:^|\n)\s*system\s*(?:prompt|message)?\s*[:：]/i },
  { name: 'reveal-prompt', re: /reveal\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions)/i },
  { name: 'hide-from-user', re: /do\s+not\s+(?:tell|inform|mention\s+to)\s+the\s+user/i },
];

export interface InjectionResult {
  /** 命中的模式名（去重） */
  hits: string[];
}

/** 检测工具返回里是否夹带“让模型改行为”的指令。 */
export function detectInjection(text: string): InjectionResult {
  if (typeof text !== 'string' || text.length === 0) return { hits: [] };
  const hits: string[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.re.test(text)) hits.push(pattern.name);
  }
  return { hits };
}

// ============================================================================
// 参数抽取（给沙箱用）
// ============================================================================

export interface ExtractedTargets {
  paths: string[];
  commands: string[];
  urls: string[];
}

const PATH_KEY = /(?:^|[_-])(path|paths|file|files|filepath|filename|dir|directory|folder|target|root|cwd|workdir|workspace)$/i;
const COMMAND_KEY = /(?:^|[_-])(command|cmd|script|shell|line)$/i;
const URL_KEY = /(?:url|uri|endpoint|href|src)$/i;
const MAX_DEPTH = 4;
const MAX_ITEMS = 32;

function looksLikePath(value: string): boolean {
  if (value.length === 0 || value.length > 4096) return false;
  if (value.startsWith('file:')) return true;
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
  if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) return true;
  return /[\\/]/.test(value);
}

function looksLikeCommand(value: string): boolean {
  if (value.length === 0 || value.length > 4096) return false;
  return /^[\w./\\:-]+\s+/.test(value) || /^(?:sudo|git|npm|pnpm|node|python|pwsh|powershell|cmd|bash|sh|curl|rm|mv|cp|del)\b/i.test(value);
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * 从工具参数里抽出可能触发沙箱规则的值。
 *
 * 工具的参数形状各不相同（`path` / `file_path` / `paths[]` / `cwd` …），这里按
 * 键名与值的形态双重判断，宁可多抽几个交给规则匹配，也不漏掉真正的写操作。
 */
export function extractTargets(args: unknown): ExtractedTargets {
  const out: ExtractedTargets = { paths: [], commands: [], urls: [] };
  const push = (list: string[], value: string) => {
    if (list.length < MAX_ITEMS && !list.includes(value)) list.push(value);
  };

  const walk = (value: unknown, key: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    if (typeof value === 'string') {
      if (looksLikeUrl(value) || URL_KEY.test(key)) {
        if (looksLikeUrl(value)) push(out.urls, value);
        return;
      }
      if (COMMAND_KEY.test(key) || looksLikeCommand(value)) {
        if (looksLikeCommand(value)) push(out.commands, value);
      }
      if (PATH_KEY.test(key) || looksLikePath(value)) {
        if (looksLikePath(value)) push(out.paths, value);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key, depth + 1);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
        walk(child, childKey, depth + 1);
      }
    }
  };

  walk(args, '', 0);
  return out;
}

/** 工具名 → 文件操作类型（决定读/写/删三种文件规则里用哪一组）。 */
export function inferFileOperation(toolName: string): 'read' | 'write' | 'delete' {
  const name = String(toolName ?? '');
  if (/delete|remove|\brm\b|^rm[_-]|unlink|trash|purge/i.test(name)) return 'delete';
  if (/write|edit|create|append|move|rename|patch|apply|replace|mkdir|touch/i.test(name)) return 'write';
  return 'read';
}

/** 稳定短哈希：审计里只记参数指纹，不记原文。 */
export function shortHash(value: unknown): string {
  // 延迟引入，避免把 crypto 拖进纯函数模块的静态依赖图
  const text = (() => {
    try {
      return JSON.stringify(value ?? null);
    } catch {
      return String(value);
    }
  })();
  let h1 = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h1 ^= text.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0');
}
