// ============================================================================
// Governance policy — pure functions (no I/O, no DSH types)
//
// Everything here is deliberately dependency-free and synchronous so it can be
// unit-tested without a Host: secret redaction, injection detection, and the
// extraction of paths/commands/URLs from arbitrary tool arguments.
// ============================================================================

export interface TruncationConfig {
  /** off 不碰返回；shadow 只记账；on 真的截断 */
  mode: 'off' | 'shadow' | 'on';
  /** 单个文本块的字节预算 */
  maxBytes: number;
  /** 把被截掉的全文写到 <stateDir>/spill/ 下 */
  spill: boolean;
  /** 按工具覆盖预算，例如 { read: 16384 } */
  perTool: Record<string, number>;
}

/** 治理开关。全部能力都受这里控制，默认只开零风险的三项。 */
export interface GovernanceConfig {
  /** 总开关：false 时每次调用都直接放行 */
  enabled: boolean;
  /** 观察每次工具调用并写入审计流水（只读，不改变行为） */
  audit: boolean;
  /** 把工具返回里的密钥替换成 [redacted:kind] */
  redaction: boolean;
  /** 提示注入处理：off 不检测 / annotate 追加警告块 / block 直接拦截 */
  injection: 'off' | 'annotate' | 'block';
  /** 沙箱规则（文件/命令/网络/工具启停）——默认关闭，开启后会真的拒绝调用 */
  sandbox: boolean;
  /** 返回体裁剪——默认关闭，shadow 只记账 */
  truncation: TruncationConfig;
  /** 行投影——默认关闭，按工具限制行数 */
  projection: ProjectionConfig;
  /** 用哪个已注册工作区做沙箱判定 */
  profile: string;
}

export const DEFAULT_TRUNCATION: TruncationConfig = {
  mode: 'off',
  maxBytes: 4096,
  spill: true,
  perTool: {},
};

export const DEFAULT_GOVERNANCE: GovernanceConfig = {
  enabled: true,
  audit: true,
  redaction: true,
  injection: 'annotate',
  sandbox: false,
  truncation: { ...DEFAULT_TRUNCATION },
  projection: { mode: 'off', maxLines: {} },
  profile: 'default',
};

function normalizeTruncation(raw: unknown): TruncationConfig {
  const input = (raw ?? {}) as Partial<TruncationConfig>;
  const mode = input.mode === 'shadow' || input.mode === 'on' ? input.mode : 'off';
  const maxBytes = Number(input.maxBytes);
  const perTool: Record<string, number> = {};
  if (input.perTool && typeof input.perTool === 'object') {
    for (const [tool, value] of Object.entries(input.perTool)) {
      const bytes = Number(value);
      if (Number.isFinite(bytes) && bytes >= 256) perTool[tool] = Math.round(bytes);
    }
  }
  return {
    mode,
    maxBytes: Number.isFinite(maxBytes) && maxBytes >= 256 ? Math.round(maxBytes) : DEFAULT_TRUNCATION.maxBytes,
    spill: input.spill !== false,
    perTool,
  };
}

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
    truncation: normalizeTruncation(input.truncation),
    projection: normalizeProjection(input.projection),
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

/** UTF-8 字节数（预算按字节算，不引 tokenizer）。 */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** 按字符边界切到不超过 budget 字节，不产生半个汉字。 */
export function sliceToBytes(text: string, budget: number): string {
  if (budget <= 0) return '';
  if (byteLength(text) <= budget) return text;
  let bytes = 0;
  let out = '';
  for (const char of text) {
    const size = byteLength(char);
    if (bytes + size > budget) break;
    out += char;
    bytes += size;
  }
  return out;
}

export interface TruncatedBlock {
  /** 被截断的块下标 */
  index: number;
  /** 原始全文，交给调用方落盘 */
  fullText: string;
  cutBytes: number;
}

export interface TruncateResult {
  blocks: Array<{ type?: string; text?: string; [key: string]: unknown }>;
  cutBytes: number;
  touched: TruncatedBlock[];
}

/**
 * 把超过预算的文本块切掉，并在结尾注明截了多少、全文在哪。
 *
 * 只动 `text` 块；图片/结构化块原样保留。返回的 `touched` 让调用方决定要不要
 * 落盘——纯函数不碰文件系统。
 */
export function truncateBlocks(
  blocks: Array<{ type?: string; text?: string; [key: string]: unknown }>,
  budget: number,
  marker: (cutBytes: number, fullTextPath: string | null) => string
): TruncateResult {
  const out: TruncateResult['blocks'] = [];
  const touched: TruncatedBlock[] = [];
  let cutBytes = 0;

  blocks.forEach((block, index) => {
    if (!block || typeof block !== 'object' || typeof block.text !== 'string') {
      out.push(block);
      return;
    }
    const size = byteLength(block.text);
    if (size <= budget) {
      out.push(block);
      return;
    }
    const kept = sliceToBytes(block.text, budget);
    const cut = size - byteLength(kept);
    cutBytes += cut;
    touched.push({ index, fullText: block.text, cutBytes: cut });
    out.push({ ...block, text: kept });
  });

  return { blocks: out, cutBytes, touched };
}



// ============================================================================
// 行投影
// ============================================================================

export interface ProjectionConfig {
  /** off 不动；on 才按工具限制行数 */
  mode: 'off' | 'on';
  /** 按工具给行数上限，键 `default` 兜底；0 表示不限制 */
  maxLines: Record<string, number>;
}

export const DEFAULT_PROJECTION: ProjectionConfig = { mode: 'off', maxLines: {} };

export function normalizeProjection(raw: unknown): ProjectionConfig {
  const input = (raw ?? {}) as Partial<ProjectionConfig>;
  const maxLines: Record<string, number> = {};
  if (input.maxLines && typeof input.maxLines === 'object') {
    for (const [tool, value] of Object.entries(input.maxLines)) {
      const lines = Number(value);
      if (Number.isFinite(lines) && lines > 0) maxLines[tool] = Math.floor(lines);
    }
  }
  return { mode: input.mode === 'on' ? 'on' : 'off', maxLines };
}

/**
 * 只保留前 N 行。返回 null 表示不需要改动。
 *
 * 与按字节截断的区别：这条按"行"算，给表格/搜索结果这类结构化文本用——
 * 切掉整行不会把一行里的字段切开。
 */
export function projectLines(text: string, maxLines: number): { text: string; shown: number; total: number } | null {
  if (!Number.isFinite(maxLines) || maxLines <= 0) return null;
  const lines = String(text).split('\n');
  if (lines.length <= maxLines) return null;
  return {
    text: lines.slice(0, maxLines).join('\n'),
    shown: maxLines,
    total: lines.length,
  };
}

// ============================================================================
// 快照策略表
// ============================================================================

export type FileOperation = 'read' | 'write' | 'delete';

export interface SnapshotPolicyEntry {
  /** 参数里哪几个字段是路径，支持 `arguments.path` 与 `arguments.files[]` */
  paths: string[];
  operation: FileOperation;
}

export type SnapshotPolicy = Record<string, SnapshotPolicyEntry>;

/** 按 `a.b[].c` 取值，返回其中所有字符串。 */
export function readPathSpec(source: unknown, spec: string): string[] {
  const segments = String(spec ?? '')
    .split('.')
    .filter(Boolean);
  let current: unknown[] = [source];

  for (const segment of segments) {
    const isArray = segment.endsWith('[]');
    const key = isArray ? segment.slice(0, -2) : segment;
    const next: unknown[] = [];
    for (const item of current) {
      if (item == null || typeof item !== 'object') continue;
      const value = (item as Record<string, unknown>)[key];
      if (value === undefined) continue;
      if (isArray) {
        if (Array.isArray(value)) next.push(...value);
        else next.push(value);
      } else {
        next.push(value);
      }
    }
    current = next;
  }

  return current.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

/**
 * 决定这次调用要备份哪些文件。
 *
 * 有策略就完全照策略来（字段名与操作都由配置说了算，契约明确）；
 * 没有策略才回落到按参数形状猜——那是为了没登记的工具也能尽量保住一份。
 */
export function resolveSnapshotTargets(
  toolName: string,
  args: unknown,
  policy?: SnapshotPolicy
): { paths: string[]; operation: FileOperation } {
  const entry = policy?.[String(toolName ?? '')];
  if (entry && Array.isArray(entry.paths) && entry.paths.length) {
    const paths: string[] = [];
    for (const spec of entry.paths) {
      for (const value of readPathSpec(args, spec)) {
        if (!paths.includes(value)) paths.push(value);
      }
    }
    return { paths, operation: entry.operation ?? 'write' };
  }

  const targets = extractTargets(args);
  return { paths: targets.paths, operation: inferFileOperation(toolName) };
}

export type PolicyAction = 'allow' | 'ask' | 'deny';

export interface CommandRule {
  prefix: string;
  action: PolicyAction;
}

/**
 * 命令判定：**默认放行，规则显式拦截**。
 *
 * 为什么不是白名单：`workspace-write` 模式原来把"不在白名单里的命令"全拒，
 * 而 PowerShell 的命令空间是开放的（`Get-ChildItem`、`git status`、`node -e ...`），
 * 白名单永远列不全，结果就是沙箱一开 pwsh 全废。命令这条线改成黑名单语义，
 * 路径和网络仍然可以 fail-closed。
 */
export function decideCommand(
  command: string,
  rules: CommandRule[] = [],
  fallback: PolicyAction = 'allow'
): { action: PolicyAction; reason: string; matched?: string } {
  const value = String(command ?? '').trim().toLowerCase();
  if (!value) return { action: fallback, reason: 'empty command', };

  for (const rule of rules) {
    const prefix = String(rule?.prefix ?? '').trim().toLowerCase();
    if (!prefix) continue;
    if (value === prefix || value.startsWith(prefix) || value.startsWith(`${prefix} `)) {
      return {
        action: rule.action ?? fallback,
        reason: `命令规则 ${rule.action}: ${rule.prefix}`,
        matched: rule.prefix,
      };
    }
  }
  return { action: fallback, reason: `命令默认策略: ${fallback}` };
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
