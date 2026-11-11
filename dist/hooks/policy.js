// ============================================================================
// Governance policy — pure functions (no I/O, no DSH types)
//
// Everything here is deliberately dependency-free and synchronous so it can be
// unit-tested without a Host: secret redaction, injection detection, and the
// extraction of paths/commands/URLs from arbitrary tool arguments.
// ============================================================================
export const DEFAULT_TRUNCATION = {
    mode: 'off',
    maxBytes: 4096,
    spill: true,
    perTool: {},
};
export const DEFAULT_GOVERNANCE = {
    enabled: true,
    audit: true,
    redaction: true,
    injection: 'annotate',
    sandbox: false,
    truncation: { ...DEFAULT_TRUNCATION },
    projection: { mode: 'off', maxLines: {} },
    pruner: { mode: 'off', keepTurns: 4, maxChars: 2000 },
    profile: 'default',
};
function normalizeTruncation(raw) {
    const input = (raw ?? {});
    const mode = input.mode === 'shadow' || input.mode === 'on' ? input.mode : 'off';
    const maxBytes = Number(input.maxBytes);
    const perTool = {};
    if (input.perTool && typeof input.perTool === 'object') {
        for (const [tool, value] of Object.entries(input.perTool)) {
            const bytes = Number(value);
            if (Number.isFinite(bytes) && bytes >= 256)
                perTool[tool] = Math.round(bytes);
        }
    }
    return {
        mode,
        maxBytes: Number.isFinite(maxBytes) && maxBytes >= 256 ? Math.round(maxBytes) : DEFAULT_TRUNCATION.maxBytes,
        spill: input.spill !== false,
        perTool,
    };
}
export function normalizeGovernance(raw) {
    const input = (raw ?? {});
    const injection = input.injection === 'off' || input.injection === 'block' || input.injection === 'annotate'
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
        pruner: normalizePruner(input.pruner),
        profile: typeof input.profile === 'string' && input.profile ? input.profile : DEFAULT_GOVERNANCE.profile,
    };
}
const SECRET_PATTERNS = [
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
/** 抹掉一段文本里的凭据。没有命中时原样返回，便于调用方判断是否需要改写。 */
export function redactSecrets(input) {
    if (typeof input !== 'string' || input.length === 0)
        return { text: input, hits: [] };
    let text = input;
    const hits = [];
    for (const pattern of SECRET_PATTERNS) {
        // 带捕获组的替换函数需要拿到分组，先收集再统一替换
        text = text.replace(pattern.re, (...args) => {
            hits.push(pattern.name);
            if (pattern.replace) {
                const groups = args.slice(1, -2);
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
const INJECTION_PATTERNS = [
    { name: 'ignore-previous', re: /ignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)\s+(?:instructions?|prompts?|rules?)/i },
    { name: 'disregard-instructions', re: /disregard\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|system)\s+(?:instructions?|prompts?)/i },
    { name: 'ignore-zh', re: /忽略(?:以上|之前|前面|上述)(?:的)?(?:所有)?(?:指令|提示|要求|规则)/ },
    { name: 'role-override', re: /\byou\s+are\s+now\s+(?:a|an|the)\s+[a-z]/i },
    { name: 'system-tag', re: /<\|?im_start\|?>|<\/?system>/i },
    { name: 'system-colon', re: /(?:^|\n)\s*system\s*(?:prompt|message)?\s*[:：]/i },
    { name: 'reveal-prompt', re: /reveal\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions)/i },
    { name: 'hide-from-user', re: /do\s+not\s+(?:tell|inform|mention\s+to)\s+the\s+user/i },
];
/** 检测工具返回里是否夹带“让模型改行为”的指令。 */
export function detectInjection(text) {
    if (typeof text !== 'string' || text.length === 0)
        return { hits: [] };
    const hits = [];
    for (const pattern of INJECTION_PATTERNS) {
        if (pattern.re.test(text))
            hits.push(pattern.name);
    }
    return { hits };
}
const PATH_KEY = /(?:^|[_-])(path|paths|file|files|filepath|filename|dir|directory|folder|target|root|cwd|workdir|workspace)$/i;
const COMMAND_KEY = /(?:^|[_-])(command|cmd|script|shell|line)$/i;
const URL_KEY = /(?:url|uri|endpoint|href|src)$/i;
const MAX_DEPTH = 4;
const MAX_ITEMS = 32;
function looksLikePath(value) {
    if (value.length === 0 || value.length > 4096)
        return false;
    if (value.startsWith('file:'))
        return true;
    if (/^[a-zA-Z]:[\\/]/.test(value))
        return true;
    if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../'))
        return true;
    return /[\\/]/.test(value);
}
function looksLikeCommand(value) {
    if (value.length === 0 || value.length > 4096)
        return false;
    return /^[\w./\\:-]+\s+/.test(value) || /^(?:sudo|git|npm|pnpm|node|python|pwsh|powershell|cmd|bash|sh|curl|rm|mv|cp|del)\b/i.test(value);
}
function looksLikeUrl(value) {
    return /^https?:\/\//i.test(value);
}
/**
 * 从工具参数里抽出可能触发沙箱规则的值。
 *
 * 工具的参数形状各不相同（`path` / `file_path` / `paths[]` / `cwd` …），这里按
 * 键名与值的形态双重判断，宁可多抽几个交给规则匹配，也不漏掉真正的写操作。
 */
export function extractTargets(args) {
    const out = { paths: [], commands: [], urls: [] };
    const push = (list, value) => {
        if (list.length < MAX_ITEMS && !list.includes(value))
            list.push(value);
    };
    const walk = (value, key, depth) => {
        if (depth > MAX_DEPTH)
            return;
        if (typeof value === 'string') {
            if (looksLikeUrl(value) || URL_KEY.test(key)) {
                if (looksLikeUrl(value))
                    push(out.urls, value);
                return;
            }
            if (COMMAND_KEY.test(key) || looksLikeCommand(value)) {
                if (looksLikeCommand(value))
                    push(out.commands, value);
            }
            if (PATH_KEY.test(key) || looksLikePath(value)) {
                if (looksLikePath(value))
                    push(out.paths, value);
            }
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value)
                walk(item, key, depth + 1);
            return;
        }
        if (value && typeof value === 'object') {
            for (const [childKey, child] of Object.entries(value)) {
                walk(child, childKey, depth + 1);
            }
        }
    };
    walk(args, '', 0);
    return out;
}
/** 工具名 → 文件操作类型（决定读/写/删三种文件规则里用哪一组）。 */
export function inferFileOperation(toolName) {
    const name = String(toolName ?? '');
    if (/delete|remove|\brm\b|^rm[_-]|unlink|trash|purge/i.test(name))
        return 'delete';
    if (/write|edit|create|append|move|rename|patch|apply|replace|mkdir|touch/i.test(name))
        return 'write';
    return 'read';
}
/** UTF-8 字节数（预算按字节算，不引 tokenizer）。 */
export function byteLength(text) {
    return Buffer.byteLength(text, 'utf8');
}
/** 按字符边界切到不超过 budget 字节，不产生半个汉字。 */
export function sliceToBytes(text, budget) {
    if (budget <= 0)
        return '';
    if (byteLength(text) <= budget)
        return text;
    let bytes = 0;
    let out = '';
    for (const char of text) {
        const size = byteLength(char);
        if (bytes + size > budget)
            break;
        out += char;
        bytes += size;
    }
    return out;
}
/**
 * 把超过预算的文本块切掉，并在结尾注明截了多少、全文在哪。
 *
 * 只动 `text` 块；图片/结构化块原样保留。返回的 `touched` 让调用方决定要不要
 * 落盘——纯函数不碰文件系统。
 */
export function truncateBlocks(blocks, budget, marker) {
    const out = [];
    const touched = [];
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
export const DEFAULT_PROJECTION = { mode: 'off', maxLines: {} };
export function normalizeProjection(raw) {
    const input = (raw ?? {});
    const maxLines = {};
    if (input.maxLines && typeof input.maxLines === 'object') {
        for (const [tool, value] of Object.entries(input.maxLines)) {
            const lines = Number(value);
            if (Number.isFinite(lines) && lines > 0)
                maxLines[tool] = Math.floor(lines);
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
export function projectLines(text, maxLines) {
    if (!Number.isFinite(maxLines) || maxLines <= 0)
        return null;
    const lines = String(text).split('\n');
    if (lines.length <= maxLines)
        return null;
    return {
        text: lines.slice(0, maxLines).join('\n'),
        shown: maxLines,
        total: lines.length,
    };
}
export const DEFAULT_PRUNER = { mode: 'off', keepTurns: 4, maxChars: 2000 };
export function normalizePruner(raw) {
    const input = (raw ?? {});
    const keepTurns = Number(input.keepTurns);
    const maxChars = Number(input.maxChars);
    return {
        mode: input.mode === 'shadow' ? 'shadow' : 'off',
        keepTurns: Number.isFinite(keepTurns) && keepTurns >= 0 ? Math.floor(keepTurns) : DEFAULT_PRUNER.keepTurns,
        maxChars: Number.isFinite(maxChars) && maxChars >= 256 ? Math.floor(maxChars) : DEFAULT_PRUNER.maxChars,
    };
}
function textLength(value) {
    if (typeof value === 'string')
        return value.length;
    if (Array.isArray(value))
        return value.reduce((sum, item) => sum + textLength(item), 0);
    if (value && typeof value === 'object') {
        let sum = 0;
        for (const item of Object.values(value))
            sum += textLength(item);
        return sum;
    }
    return 0;
}
/**
 * 只读地描述一次请求要发送的消息。
 *
 * 不假设任何具体字段名：把对象里的字符串都算进去，把 `content` 数组里每个块的
 * `type` 记下来。这样即使结构和我预期不同，观察结果仍然是事实。
 */
export function describeMessages(messages, keepTurns) {
    const roles = {};
    const blockTypes = {};
    let chars = 0;
    const list = Array.isArray(messages) ? messages : [];
    for (const message of list) {
        if (!message || typeof message !== 'object')
            continue;
        const record = message;
        const role = typeof record.role === 'string' ? record.role : 'unknown';
        roles[role] = (roles[role] ?? 0) + 1;
        chars += textLength(record);
        const content = record.content;
        if (Array.isArray(content)) {
            for (const block of content) {
                if (!block || typeof block !== 'object')
                    continue;
                const type = block.type;
                const key = typeof type === 'string' ? type : 'untyped';
                blockTypes[key] = (blockTypes[key] ?? 0) + 1;
            }
        }
    }
    // 保守估计：前 (总条数 - keepTurns) 条里，超过 maxChars 的部分才算可回收
    const older = Math.max(0, list.length - Math.max(0, keepTurns));
    let reclaimable = 0;
    for (let i = 0; i < older; i++) {
        const size = textLength(list[i]);
        if (size > 0)
            reclaimable += size;
    }
    return { messages: list.length, roles, blockTypes, chars, reclaimable };
}
/** 按 `a.b[].c` 取值，返回其中所有字符串。 */
export function readPathSpec(source, spec) {
    const segments = String(spec ?? '')
        .split('.')
        .filter(Boolean);
    let current = [source];
    for (const segment of segments) {
        const isArray = segment.endsWith('[]');
        const key = isArray ? segment.slice(0, -2) : segment;
        const next = [];
        for (const item of current) {
            if (item == null || typeof item !== 'object')
                continue;
            const value = item[key];
            if (value === undefined)
                continue;
            if (isArray) {
                if (Array.isArray(value))
                    next.push(...value);
                else
                    next.push(value);
            }
            else {
                next.push(value);
            }
        }
        current = next;
    }
    return current.filter((item) => typeof item === 'string' && item.length > 0);
}
/**
 * 决定这次调用要备份哪些文件。
 *
 * 有策略就完全照策略来（字段名与操作都由配置说了算，契约明确）；
 * 没有策略才回落到按参数形状猜——那是为了没登记的工具也能尽量保住一份。
 */
export function resolveSnapshotTargets(toolName, args, policy) {
    const entry = policy?.[String(toolName ?? '')];
    if (entry && Array.isArray(entry.paths) && entry.paths.length) {
        const paths = [];
        for (const spec of entry.paths) {
            for (const value of readPathSpec(args, spec)) {
                if (!paths.includes(value))
                    paths.push(value);
            }
        }
        return { paths, operation: entry.operation ?? 'write' };
    }
    const targets = extractTargets(args);
    return { paths: targets.paths, operation: inferFileOperation(toolName) };
}
/**
 * 命令判定：**默认放行，规则显式拦截**。
 *
 * 为什么不是白名单：`workspace-write` 模式原来把"不在白名单里的命令"全拒，
 * 而 PowerShell 的命令空间是开放的（`Get-ChildItem`、`git status`、`node -e ...`），
 * 白名单永远列不全，结果就是沙箱一开 pwsh 全废。命令这条线改成黑名单语义，
 * 路径和网络仍然可以 fail-closed。
 */
export function decideCommand(command, rules = [], fallback = 'allow') {
    const value = String(command ?? '').trim().toLowerCase();
    if (!value)
        return { action: fallback, reason: 'empty command', };
    for (const rule of rules) {
        const prefix = String(rule?.prefix ?? '').trim().toLowerCase();
        if (!prefix)
            continue;
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
export function shortHash(value) {
    // 延迟引入，避免把 crypto 拖进纯函数模块的静态依赖图
    const text = (() => {
        try {
            return JSON.stringify(value ?? null);
        }
        catch {
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
