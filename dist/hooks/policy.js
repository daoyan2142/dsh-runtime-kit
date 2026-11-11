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
