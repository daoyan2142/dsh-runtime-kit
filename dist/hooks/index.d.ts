import { DEFAULT_GOVERNANCE, normalizeGovernance, GovernanceConfig } from './policy.js';
export { DEFAULT_GOVERNANCE, normalizeGovernance };
export type { GovernanceConfig };
/** 只认识用到的那几个方法，避免把 DSH 类型拖进编译依赖。 */
interface SandboxLike {
    isToolAllowed(toolName: string): {
        allowed: boolean;
        action: string;
        reason: string;
    };
    resolveAndValidate(profile: string, requestedPath: string, operation: 'read' | 'write' | 'delete'): {
        allowed: boolean;
        action: string;
        reason: string;
    } | null;
    validateCommand(request: {
        command: string;
        args: string[];
    }): {
        allowed: boolean;
        action: string;
        reason: string;
    };
    validateNetwork(request: {
        url: string;
    }): {
        allowed: boolean;
        action: string;
        reason: string;
    };
}
interface AuditLike {
    log(entry: {
        profile: string;
        tool: string;
        action: 'call' | 'return' | 'block' | 'ask' | 'error';
        paramsHash: string;
        result: 'SUCCESS' | 'FAILURE' | 'BLOCKED' | 'ASKED' | 'ERROR';
        durationMs: number;
        error?: string;
    }): Promise<void>;
}
interface BlockLike {
    type?: string;
    text?: string;
    [key: string]: unknown;
}
interface HookService {
    sandbox: SandboxLike;
    audit: AuditLike;
}
interface Inspector {
    blocks: BlockLike[];
    redacted: string[];
    injected: string[];
}
/** 逐块扫描工具返回：先脱敏，再检测注入。不修改入参。 */
export declare function inspectBlocks(blocks: BlockLike[], config: GovernanceConfig): Inspector;
/** 沙箱判定：先看工具开关，再看文件/命令/网络。返回第一个非 allow 的结论。 */
export declare function evaluateCall(exec: {
    name?: string;
    arguments?: unknown;
}, sandbox: SandboxLike, config: GovernanceConfig): {
    action: 'allow' | 'ask' | 'deny';
    reason: string;
    rule: string;
};
/**
 * 安装治理钩子。
 *
 * @param ctx     Host 上下文（只用到 `on`）
 * @param service runtime-kit 服务（提供 sandbox / audit）
 */
export declare function installGovernance(ctx: {
    on?: (name: string, listener: (...args: any[]) => any) => unknown;
}, service: HookService, raw: unknown): GovernanceConfig;
//# sourceMappingURL=index.d.ts.map