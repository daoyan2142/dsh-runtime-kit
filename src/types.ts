// ============================================================================
// dsh-runtime-kit 核心类型定义
// 零业务依赖，纯运行时能力
// ============================================================================

/** 工具调用参数 */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** 工具返回结果 */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  truncated?: boolean;
  totalBytes?: number;
}

/** 工具规格（注册时提供） */
export interface ToolSpec {
  name: string;
  description: string;
  schema: Record<string, unknown>;      // JSON Schema
  isStateChanging?: boolean;             // 是否变更状态（触发屏障/审批）
  returnBudget?: number;                 // 返回体预算（字节），默认取全局配置
  timeout?: number;                      // 超时毫秒
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

/** 模板规格（注册时提供） */
export interface TemplateSpec {
  name: string;
  description: string;
  match: (input: string) => boolean | Promise<boolean>;  // 命中判断
  plan: TemplateStep[];                  // 工具调用序列
  idempotencyKeyFn?: (input: string) => string | Promise<string>;  // 幂等键生成
}

/** 模板步骤 */
export interface TemplateStep {
  tool: string;                          // 工具名（必须已注册）
  args: Record<string, unknown> | ((input: string, prevResults: Map<string, ToolResult>) => Record<string, unknown>);
  isStateChanging?: boolean;             // 显式声明，覆盖工具默认值
  condition?: (prevResults: Map<string, ToolResult>) => boolean;  // 条件执行
}

/** 工作区规格（注册时提供） */
export interface WorkspaceSpec {
  profile: string;                       // 关联的 DSH profile
  root: string;                          // 工作区根路径（绝对路径）
  networkAllowlist?: string[];           // 网络白名单（精确域名）
  permissionMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  envPrefix?: string;                    // 环境变量前缀（用于凭据注入）
  trusted?: boolean;                     // 工作区信任状态
}

/** 注册表接口（唯一对外耦合面） */
export interface Registry {
  // 工具注册
  registerTool(spec: ToolSpec): void;
  unregisterTool(name: string): void;
  getTool(name: string): ToolSpec | undefined;
  listTools(): ToolSpec[];
  isToolEnabled(name: string): boolean;
  setToolEnabled(name: string, enabled: boolean): void;

  // 模板注册
  registerTemplate(spec: TemplateSpec): void;
  unregisterTemplate(name: string): void;
  getTemplate(name: string): TemplateSpec | undefined;
  listTemplates(): TemplateSpec[];
  matchTemplate(input: string): TemplateSpec | undefined;

  // 工作区注册
  registerWorkspace(spec: WorkspaceSpec): void;
  unregisterWorkspace(profile: string): void;
  getWorkspace(profile: string): WorkspaceSpec | undefined;
  listWorkspaces(): WorkspaceSpec[];

  // 状态
  clear(): void;
}

/** 上下文治理配置 */
export interface ContextGovernanceConfig {
  maxReturnBytes: number;
  fieldsProjection: boolean;
  prunerEnabled: boolean;
  compactionEnabled: boolean;
  lazyLoadTools: boolean;
}

/** 沙箱配置 */
export interface SandboxConfig {
  mode: 'read-only' | 'workspace-write' | 'danger-full-access';
  approval: 'auto' | 'ask' | 'deny';
  rules: {
    files: FileRule[];
    commands: CommandRule[];
    network: NetworkRule[];
  };
  networkDefault: 'allow' | 'ask' | 'deny';
  backupEnabled: boolean;
  deletionProtection: boolean;
  injectionGuard: boolean;
  sensitiveProtection: boolean;
  shell: 'pwsh' | 'native';
  workspaceTrust: boolean;
  toolControl: Record<string, boolean>;
}

/** 文件规则（三态：读/写/删分别设置） */
export interface FileRule {
  pattern: string;          // glob pattern
  read: 'allow' | 'ask' | 'deny';
  write: 'allow' | 'ask' | 'deny';
  delete: 'allow' | 'ask' | 'deny';
}

/** 命令规则（前缀匹配） */
export interface CommandRule {
  prefix: string;           // 命令前缀，如 "rm", "git push"
  action: 'allow' | 'ask' | 'deny';
}

/** 网络规则（域名精确匹配，禁止泛域名通配） */
export interface NetworkRule {
  domain: string;           // 精确域名，如 "api.github.com"
  action: 'allow' | 'ask' | 'deny';
}

/** 审计配置 */
export interface AuditConfig {
  mode: 'append-only' | 'off';
  desensitize: boolean;
  exportable: boolean;
  retentionDays: number;
}

/** 循环配置 */
export interface LoopConfig {
  preset: 'minimal' | 'code' | 'default';
  disabledLayers: ('plan' | 'todo' | 'goal' | 'subagent')[];
  maxParallelToolCalls: number;
  enableCustomLoop: boolean;
}

/** 完整插件配置 */
export interface RuntimeKitConfig {
  context: ContextGovernanceConfig;
  loop: LoopConfig;
  sandbox: SandboxConfig;
  audit: AuditConfig;
}

/** 审计日志条目 */
export interface AuditLogEntry {
  timestamp: string;
  profile: string;
  tool: string;
  action: 'call' | 'return' | 'block' | 'ask' | 'error';
  paramsHash: string;       // 参数哈希（不记录敏感原文）
  result: 'SUCCESS' | 'FAILURE' | 'BLOCKED' | 'ASKED' | 'ERROR';
  durationMs: number;
  error?: string;
  sandboxDecision?: {
    ruleType: 'file' | 'command' | 'network';
    rulePattern: string;
    action: 'allow' | 'ask' | 'deny';
  };
}

/** 指标采集点 */
export interface MetricsSnapshot {
  turn: number;
  inputTokens: number;
  outputTokens: number;
  toolResultBytesInContext: number;
  toolCallsCount: number;
  wallClockMs: number;
  fastPathHits: number;
  parallelCalls: number;
  approvalsCount: number;
  rejectionsCount: number;
}

/** 快路径执行结果 */
export interface FastPathResult {
  templateName: string;
  idempotencyKey: string;
  status: 'IDEMPOTENT_REPLAY' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED';
  steps: Array<{
    tool: string;
    result: ToolResult;
    durationMs: number;
  }>;
  totalDurationMs: number;
  llmCalls: 0;  // 快路径强制为 0
}

/** PTC 容器执行结果 */
export interface PTCResult {
  script: string;
  summary: unknown;        // 仅最终摘要进 context
  toolCalls: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: ToolResult;
  }>;
  durationMs: number;
  truncated: boolean;
}

/** 并发执行屏障 */
export interface Barrier {
  wait(): Promise<void>;
  signal(): void;
}

/** 会话持久化状态 */
export interface SessionState {
  version: number;
  turn: number;
  step: number;
  completedSteps: Map<string, ToolResult>;  // stepId -> result
  pendingSteps: string[];
  idempotencyKeys: Map<string, ToolResult>;  // key -> result
  workspaceRoots: Map<string, string>;       // profile -> root
  updatedAt: string;
}

/** 插件服务接口 */
export interface RuntimeKitService {
  registry: Registry;
  executeFastPath(input: string, profile: string): Promise<FastPathResult>;
  executePTC(script: string, profile: string): Promise<PTCResult>;
  getMetrics(): MetricsSnapshot[];
  getAuditLogs(filter?: AuditLogFilter): Promise<AuditLogEntry[]>;
  verifyIsolation(profile: string): Promise<IsolationCheckResult>;
  healthCheck(): Promise<HealthCheckResult>;
}

/** 审计日志过滤 */
export interface AuditLogFilter {
  profile?: string;
  tool?: string;
  action?: AuditLogEntry['action'];
  result?: AuditLogEntry['result'];
  since?: string;
  until?: string;
  limit?: number;
}

/** 隔离检查结果 */
export interface IsolationCheckResult {
  profile: string;
  checks: {
    workspaceBound: boolean;
    pathTraversal: boolean;
    networkIsolation: boolean;
    credentialLeak: boolean;
    toolControl: boolean;
  };
  violations: string[];
  passed: boolean;
}

/** 健康检查结果 */
export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Record<string, { status: 'pass' | 'fail' | 'warn'; message?: string }>;
  version: string;
  dshVersion: string;
}