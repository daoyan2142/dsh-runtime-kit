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
export declare const DEFAULT_GOVERNANCE: GovernanceConfig;
export declare function normalizeGovernance(raw: unknown): GovernanceConfig;
export interface RedactResult {
    text: string;
    /** 命中的模式名（去重），用于审计 */
    hits: string[];
}
/** 抹掉一段文本里的凭据。没有命中时原样返回，便于调用方判断是否需要改写。 */
export declare function redactSecrets(input: string): RedactResult;
export interface InjectionResult {
    /** 命中的模式名（去重） */
    hits: string[];
}
/** 检测工具返回里是否夹带“让模型改行为”的指令。 */
export declare function detectInjection(text: string): InjectionResult;
export interface ExtractedTargets {
    paths: string[];
    commands: string[];
    urls: string[];
}
/**
 * 从工具参数里抽出可能触发沙箱规则的值。
 *
 * 工具的参数形状各不相同（`path` / `file_path` / `paths[]` / `cwd` …），这里按
 * 键名与值的形态双重判断，宁可多抽几个交给规则匹配，也不漏掉真正的写操作。
 */
export declare function extractTargets(args: unknown): ExtractedTargets;
/** 工具名 → 文件操作类型（决定读/写/删三种文件规则里用哪一组）。 */
export declare function inferFileOperation(toolName: string): 'read' | 'write' | 'delete';
/** 稳定短哈希：审计里只记参数指纹，不记原文。 */
export declare function shortHash(value: unknown): string;
//# sourceMappingURL=policy.d.ts.map