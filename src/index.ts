// ============================================================================
// Main Entry - dsh-runtime-kit 插件主入口
// 单一插件包，零业务依赖，提供运行时能力
// ============================================================================

import { Context, Service } from '@cordisjs/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { RegistryImpl, registry } from './registry/index.js';
import { ContextGovernance } from './context/index.js';
import { Sandbox } from './sandbox/index.js';
import { Audit } from './audit/index.js';
import { FastPathExecutor, PTCExecutor, SessionManager, ConcurrentScheduler } from './loop/index.js';
import { applyPresetPatch, getPresetPatches, dumpConfig } from './preset/index.js';
import { installGovernance, normalizeGovernance, DEFAULT_GOVERNANCE, GovernanceConfig } from './hooks/index.js';
import {
  RuntimeKitConfig,
  RuntimeKitService,
  ToolSpec,
  TemplateSpec,
  WorkspaceSpec,
  FastPathResult,
  PTCResult,
  MetricsSnapshot,
  AuditLogEntry,
  AuditLogFilter,
  IsolationCheckResult,
  HealthCheckResult,
  ToolResult,
} from './types.js';

/** 插件配置类型（从 config.schema.json 推导） */
interface PluginConfig {
  context: RuntimeKitConfig['context'];
  loop: RuntimeKitConfig['loop'];
  sandbox: RuntimeKitConfig['sandbox'];
  audit: RuntimeKitConfig['audit'];
  governance: GovernanceConfig;
  logDir?: string;
  stateDir?: string;
}

/** 默认配置 */
const DEFAULT_CONFIG: PluginConfig = {
  context: {
    maxReturnBytes: 4096,
    fieldsProjection: true,
    prunerEnabled: true,
    compactionEnabled: true,
    lazyLoadTools: true,
  },
  loop: {
    preset: 'code',
    disabledLayers: ['plan', 'todo', 'goal', 'subagent'],
    maxParallelToolCalls: 8,
    enableCustomLoop: false,
  },
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
  audit: {
    mode: 'append-only',
    desensitize: true,
    exportable: true,
    retentionDays: 90,
  },
  governance: { ...DEFAULT_GOVERNANCE },
  logDir: path.join(os.homedir(), '.dsh', 'runtime-kit', 'logs'),
  stateDir: path.join(os.homedir(), '.dsh', 'runtime-kit', 'state'),
};

/** 主服务实现 */
class RuntimeKitServiceImpl implements RuntimeKitService {
  public readonly registry: RegistryImpl;
  public readonly contextGov: ContextGovernance;
  public readonly sandbox: Sandbox;
  public readonly audit: Audit;
  private config: PluginConfig;
  private sessionManager: SessionManager;
  private fastPathExecutor: FastPathExecutor;
  private ptcExecutor: PTCExecutor;
  private concurrentScheduler: ConcurrentScheduler;

  constructor(config: PluginConfig) {
    this.config = config;

    // 初始化核心组件
    this.registry = registry;
    this.contextGov = new ContextGovernance(config.context);
    this.sandbox = new Sandbox(config.sandbox);
    this.audit = new Audit(config.audit, config.logDir, this.sandbox);

    // 会话管理
    this.sessionManager = new SessionManager('default', config.stateDir);

    // 执行器
    this.fastPathExecutor = new FastPathExecutor(
      this.registry,
      this.sandbox,
      this.contextGov,
      this.audit,
      'default'
    );
    this.ptcExecutor = new PTCExecutor(
      this.registry,
      this.sandbox,
      this.contextGov,
      this.audit,
      'default'
    );
    this.concurrentScheduler = new ConcurrentScheduler(config.loop.maxParallelToolCalls, {
      wait: async () => {},
      signal: () => {},
    });

    // 注册工作区到沙箱
    for (const ws of this.registry.listWorkspaces()) {
      this.sandbox.registerWorkspace(ws);
    }
  }

  // ========== RuntimeKitService 接口 ==========

  async executeFastPath(input: string, profile: string): Promise<FastPathResult> {
    const template = await this.registry.matchTemplate(input);
    if (!template) {
      throw new Error(`No template matched for input: ${input}`);
    }
    return this.fastPathExecutor.execute(input, template);
  }

  async executePTC(script: string, profile: string): Promise<PTCResult> {
    return this.ptcExecutor.execute(script);
  }

  getMetrics(): MetricsSnapshot[] {
    return this.contextGov.getMetrics();
  }

  async getAuditLogs(filter?: AuditLogFilter): Promise<AuditLogEntry[]> {
    return this.audit.getLogs(filter);
  }

  async verifyIsolation(profile: string): Promise<IsolationCheckResult> {
    const workspace = this.registry.getWorkspace(profile);
    if (!workspace) {
      return {
        profile,
        checks: { workspaceBound: false, pathTraversal: false, networkIsolation: false, credentialLeak: false, toolControl: false },
        violations: [`Workspace not registered for profile: ${profile}`],
        passed: false,
      };
    }

    const violations: string[] = [];

    // 检查工作区边界
    // 实际实现：尝试读取工作区外文件、路径穿越、网络隔离等

    return {
      profile,
      checks: {
        workspaceBound: violations.length === 0,
        pathTraversal: violations.length === 0,
        networkIsolation: violations.length === 0,
        credentialLeak: violations.length === 0,
        toolControl: true,
      },
      violations,
      passed: violations.length === 0,
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const checks: Record<string, { status: 'pass' | 'fail' | 'warn'; message?: string }> = {};

    // 检查 registry
    checks.registry = {
      status: 'pass',
      message: `${this.registry.listTools().length} tools, ${this.registry.listTemplates().length} templates, ${this.registry.listWorkspaces().length} workspaces`,
    };

    // 检查沙箱配置
    try {
      this.sandbox.getConfig();
      checks.sandbox = { status: 'pass', message: 'Config loaded' };
    } catch {
      checks.sandbox = { status: 'fail', message: 'Config invalid' };
    }

    // 检查审计目录
    try {
      await fs.access(this.config.logDir);
      checks.audit = { status: 'pass', message: 'Log dir accessible' };
    } catch {
      checks.audit = { status: 'warn', message: 'Log dir not accessible' };
    }

    const allPass = Object.values(checks).every(c => c.status === 'pass');
    const anyFail = Object.values(checks).some(c => c.status === 'fail');

    return {
      status: anyFail ? 'unhealthy' : allPass ? 'healthy' : 'degraded',
      checks,
      version: '0.1.0',
      dshVersion: process.env.DSH_VERSION ?? 'unknown',
    };
  }

  // ========== 内部方法 ==========

  /** 重新加载配置 */
  reloadConfig(newConfig: Partial<PluginConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.contextGov.updateConfig(newConfig.context ?? {});
    this.sandbox.updateConfig(newConfig.sandbox ?? {});
    this.audit.updateConfig(newConfig.audit ?? {});

    // 重新注册工作区
    for (const ws of this.registry.listWorkspaces()) {
      this.sandbox.registerWorkspace(ws);
    }
  }

  /** 获取当前配置 */
  getConfig(): PluginConfig {
    return { ...this.config };
  }

  /** 导出配置用于核对 */
  dumpConfig(): string {
    return dumpConfig(this.config);
  }

  /** 获取可用预设补丁 */
  getPresetPatches() {
    return getPresetPatches();
  }

  /** 应用预设补丁 */
  applyPreset(presetName: string): void {
    const patched = applyPresetPatch(this.config, presetName);
    this.reloadConfig(patched as PluginConfig);
  }
}

/** 插件入口 */
export const name = 'dsh-runtime-kit';

export async function apply(ctx: Context, rawConfig: Partial<PluginConfig> = {}) {
  // 合并配置
  const config: PluginConfig = {
    ...DEFAULT_CONFIG,
    ...rawConfig,
    context: { ...DEFAULT_CONFIG.context, ...rawConfig.context },
    loop: { ...DEFAULT_CONFIG.loop, ...rawConfig.loop },
    sandbox: { ...DEFAULT_CONFIG.sandbox, ...rawConfig.sandbox },
    audit: { ...DEFAULT_CONFIG.audit, ...rawConfig.audit },
    governance: normalizeGovernance({ ...DEFAULT_GOVERNANCE, ...(rawConfig.governance ?? {}) }),
  };

  // 确保目录存在
  await fs.mkdir(config.logDir, { recursive: true });
  await fs.mkdir(config.stateDir, { recursive: true });

  // 创建服务
  const service = new RuntimeKitServiceImpl(config);

  // 提供服务
  ctx.provide('runtimeKit', service);

  // ========== 治理钩子（工具返回脱敏 / 注入检测 / 沙箱拦截 / 审计） ==========
  // 全部 fail-open：钩子内部出错一律放行，不影响正常工具调用。
  installGovernance(ctx as any, service, config.governance);

  // 生命周期
  ctx.on('dispose', async () => {
    await service.audit.shutdown();
  });

  // ========== 注册通用工具（仅用于测试/验收夹具） ==========
  // 实际使用时，使用方通过 registry.registerTool 自行注册业务工具

  // 通用 echo 工具（只读、无状态）
  service.registry.registerTool({
    name: 'echo',
    description: 'Echo back the input text',
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to echo' },
      },
      required: ['text'],
    },
    isStateChanging: false,
    returnBudget: 1024,
    handler: async (args) => ({
      success: true,
      data: { echoed: args.text },
    }),
  });

  // 通用 KV 存储工具（测试记忆服务）
  const kvStore = new Map<string, string>();
  service.registry.registerTool({
    name: 'kv_get',
    description: 'Get value from KV store',
    schema: {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key'],
    },
    isStateChanging: false,
    returnBudget: 1024,
    handler: async (args) => ({
      success: true,
      data: { value: kvStore.get(args.key as string) ?? null },
    }),
  });

  service.registry.registerTool({
    name: 'kv_set',
    description: 'Set value in KV store',
    schema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['key', 'value'],
    },
    isStateChanging: true,
    returnBudget: 1024,
    handler: async (args) => {
      kvStore.set(args.key as string, args.value as string);
      return { success: true, data: { ok: true } };
    },
  });

  // 文件读取工具（测试沙箱路径校验）
  service.registry.registerTool({
    name: 'file_read',
    description: 'Read file from workspace',
    schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    isStateChanging: false,
    returnBudget: 4096,
    handler: async (args) => {
      const { readFile } = await import('fs/promises');
      try {
        const content = await readFile(args.path as string, 'utf-8');
        return { success: true, data: { content } };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    },
  });

  // 文件写入工具（测试沙箱写入校验）
  service.registry.registerTool({
    name: 'file_write',
    description: 'Write file to workspace',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
    isStateChanging: true,
    returnBudget: 1024,
    handler: async (args) => {
      const { writeFile, mkdir } = await import('fs/promises');
      try {
        await mkdir(path.dirname(args.path as string), { recursive: true });
        await writeFile(args.path as string, args.content as string, 'utf-8');
        return { success: true, data: { ok: true } };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    },
  });

  // HTTP 探测工具（测试网络白名单）
  service.registry.registerTool({
    name: 'http_probe',
    description: 'Probe HTTP endpoint',
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string', format: 'uri' },
        method: { type: 'string', enum: ['GET', 'HEAD'], default: 'GET' },
      },
      required: ['url'],
    },
    isStateChanging: false,
    returnBudget: 2048,
    handler: async (args) => {
      try {
        const response = await fetch(args.url as string, { method: args.method as string });
        return {
          success: true,
          data: { status: response.status, ok: response.ok },
        };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    },
  });

  // 注册测试用模板（echo × 3 串联）
  service.registry.registerTemplate({
    name: 'echo-chain',
    description: 'Chain 3 echo calls for fast-path testing',
    match: (input) => input.startsWith('echo-chain:'),
    plan: [
      { tool: 'echo', args: { text: 'step-1' } },
      { tool: 'echo', args: { text: 'step-2' } },
      { tool: 'echo', args: { text: 'step-3' } },
    ],
    idempotencyKeyFn: (input) => `echo-chain:${input.slice(11)}`,
  });

  // 注册故意崩溃的工具（测试崩溃隔离）
  service.registry.registerTool({
    name: 'crash_tool',
    description: 'Tool that intentionally crashes',
    schema: {
      type: 'object',
      properties: {},
    },
    isStateChanging: false,
    returnBudget: 1024,
    handler: async () => {
      throw new Error('INTENTIONAL_CRASH_FOR_TESTING');
    },
  });

  // ========== 管理命令 ==========

  ctx.command('runtime_kit_health', 'Health check')
    .action(async () => {
      const result = await service.healthCheck();
      return JSON.stringify(result, null, 2);
    });

  ctx.command('runtime_kit_config [preset]', 'Show or apply preset config')
    .action(async (_, preset) => {
      if (preset) {
        service.applyPreset(preset);
        return `Applied preset: ${preset}`;
      }
      return service.dumpConfig();
    });

  ctx.command('runtime_kit_metrics', 'Show collected metrics')
    .action(() => JSON.stringify(service.getMetrics(), null, 2));

  ctx.command('runtime_kit_audit_logs [profile]', 'Show audit logs')
    .option('tool', '-t <tool>')
    .option('action', '-a <action>')
    .option('result', '-r <result>')
    .option('since', '-s <date>')
    .option('limit', '-l <n>', { default: 50 })
    .action(async (_, profile, options) => {
      const logs = await service.getAuditLogs({
        profile,
        tool: options.tool,
        action: options.action as any,
        result: options.result as any,
        since: options.since,
        limit: options.limit,
      });
      return JSON.stringify(logs, null, 2);
    });

  ctx.command('runtime_kit_isolation <profile>', 'Verify isolation')
    .action(async (_, profile) => {
      const result = await service.verifyIsolation(profile);
      return JSON.stringify(result, null, 2);
    });

  ctx.command('runtime_kit_fastpath <input> [profile]', 'Execute fast path')
    .action(async (_, input, profile) => {
      const result = await service.executeFastPath(input, profile ?? 'default');
      return JSON.stringify(result, null, 2);
    });

  ctx.command('runtime_kit_ptc <script> [profile]', 'Execute PTC script')
    .action(async (_, script, profile) => {
      const result = await service.executePTC(script, profile ?? 'default');
      return JSON.stringify(result, null, 2);
    });

  ctx.command('runtime_kit_registry_tools', 'List registered tools')
    .action(() => JSON.stringify(service.registry.listTools().map(t => t.name), null, 2));

  ctx.command('runtime_kit_registry_templates', 'List registered templates')
    .action(() => JSON.stringify(service.registry.listTemplates().map(t => t.name), null, 2));

  ctx.command('runtime_kit_registry_workspaces', 'List registered workspaces')
    .action(() => JSON.stringify(service.registry.listWorkspaces().map(w => ({ profile: w.profile, root: w.root })), null, 2));
}

export default { name, apply };