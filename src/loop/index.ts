// ============================================================================
// Loop - C2 快路径 + C3 PTC + C5 并发/恢复（可选替换 agent-loop）
// ============================================================================

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'node:crypto';
import {
  Registry,
  ToolSpec,
  TemplateSpec,
  TemplateStep,
  ToolResult,
  ToolCall,
  FastPathResult,
  PTCResult,
  SessionState,
  Barrier,
  Sandbox,
  ContextGovernance,
  MetricsSnapshot,
  Audit,
} from '../types.js';

/** 快路径执行器 */
export class FastPathExecutor {
  constructor(
    private registry: Registry,
    private sandbox: Sandbox,
    private contextGov: ContextGovernance,
    private audit: Audit,
    private profile: string
  ) {}

  /** 执行快路径 */
  async execute(input: string, template: TemplateSpec): Promise<FastPathResult> {
    const startTime = Date.now();
    const idempotencyKey = template.idempotencyKeyFn
      ? await template.idempotencyKeyFn(input)
      : this.generateIdempotencyKey(template.name, input);

    // 检查幂等性
    const existing = this.checkIdempotency(idempotencyKey);
    if (existing) {
      return {
        templateName: template.name,
        idempotencyKey,
        status: 'IDEMPOTENT_REPLAY',
        steps: [],
        totalDurationMs: 0,
        llmCalls: 0,
      };
    }

    const steps: FastPathResult['steps'] = [];
    const prevResults = new Map<string, ToolResult>();
    let status: FastPathResult['status'] = 'SUCCEEDED';

    for (const step of template.plan) {
      // 条件执行
      if (step.condition && !step.condition(prevResults)) {
        continue;
      }

      // 准备参数
      const args = typeof step.args === 'function'
        ? step.args(input, prevResults)
        : step.args;

      // 沙箱校验
      const toolSpec = this.registry.getTool(step.tool);
      if (!toolSpec) {
        throw new Error(`Tool "${step.tool}" not registered`);
      }

      const toolAllowed = this.sandbox.isToolAllowed(step.tool);
      if (!toolAllowed.allowed) {
        if (toolAllowed.requiresApproval) {
          status = 'BLOCKED';
          await this.audit.log({
            profile: this.profile,
            tool: step.tool,
            action: 'block',
            paramsHash: JSON.stringify(args),
            result: 'BLOCKED',
            durationMs: 0,
            error: toolAllowed.reason,
          });
          break;
        }
        throw new Error(`Tool "${step.tool}" not allowed: ${toolAllowed.reason}`);
      }

      // 执行工具
      const stepStart = Date.now();
      let result: ToolResult;

      try {
        result = await toolSpec.handler(args);
      } catch (error) {
        result = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      const durationMs = Date.now() - stepStart;

      // 治理返回
      const governed = await this.contextGov.governReturn(step.tool, result);

      // 记录审计
      await this.audit.log({
        profile: this.profile,
        tool: step.tool,
        action: 'call',
        paramsHash: JSON.stringify(args),
        result: governed.success ? 'SUCCESS' : 'FAILURE',
        durationMs,
        error: governed.error,
      });

      steps.push({
        tool: step.tool,
        result: governed,
        durationMs,
      });

      prevResults.set(step.tool, governed);

      // 状态变更屏障：如果是变更状态工具，同步阻塞
      if (step.isStateChanging ?? toolSpec.isStateChanging) {
        await this.waitForBarrier(step.tool);
      }

      if (!governed.success) {
        status = 'FAILED';
        break;
      }
    }

    const totalDurationMs = Date.now() - startTime;

    // 记录幂等键
    this.recordIdempotency(idempotencyKey, { status, steps });

    return {
      templateName: template.name,
      idempotencyKey,
      status,
      steps,
      totalDurationMs,
      llmCalls: 0,
    };
  }

  private generateIdempotencyKey(templateName: string, input: string): string {
    return crypto.createHash('sha256').update(`${templateName}:${input}`).digest('hex').slice(0, 32);
  }

  private checkIdempotency(key: string): FastPathResult | null {
    // 实际实现中从持久化存储读取
    return null;
  }

  private recordIdempotency(key: string, result: { status: string; steps: unknown }): void {
    // 实际实现中持久化存储
  }

  private async waitForBarrier(toolName: string): Promise<void> {
    // 实际实现中使用 Barrier 同步
    // 这里简化为空实现
  }
}

/** PTC 容器执行器 */
export class PTCExecutor {
  constructor(
    private registry: Registry,
    private sandbox: Sandbox,
    private contextGov: ContextGovernance,
    private audit: Audit,
    private profile: string,
    private maxToolCalls: number = 50,
    private timeoutMs: number = 120000
  ) {}

  /** 执行 PTC 脚本 */
  async execute(script: string): Promise<PTCResult> {
    const startTime = Date.now();
    const toolCalls: PTCResult['toolCalls'] = [];
    let truncated = false;

    // 创建沙箱化的执行环境
    const container = this.createContainer();

    try {
      // 在容器中执行脚本
      // 实际实现：使用 vm2 或类似沙箱，或通过 worker_threads
      // 这里简化：解析脚本中的工具调用并顺序执行
      const calls = this.parseScript(script);

      for (const call of calls) {
        if (toolCalls.length >= this.maxToolCalls) {
          truncated = true;
          break;
        }

        const toolSpec = this.registry.getTool(call.name);
        if (!toolSpec) {
          toolCalls.push({
            tool: call.name,
            args: call.args,
            result: { success: false, error: `Tool "${call.name}" not registered` },
          });
          continue;
        }

        // 沙箱校验
        const allowed = this.sandbox.isToolAllowed(call.name);
        if (!allowed.allowed) {
          toolCalls.push({
            tool: call.name,
            args: call.args,
            result: { success: false, error: `Tool not allowed: ${allowed.reason}` },
          });
          if (allowed.requiresApproval) {
            await this.audit.log({
              profile: this.profile,
              tool: call.name,
              action: 'block',
              paramsHash: JSON.stringify(call.args),
              result: 'BLOCKED',
              durationMs: 0,
              error: allowed.reason,
            });
          }
          continue;
        }

        // 执行
        const stepStart = Date.now();
        let result: ToolResult;
        try {
          result = await toolSpec.handler(call.args);
        } catch (error) {
          result = { success: false, error: String(error) };
        }

        const governed = await this.contextGov.governReturn(call.name, result);

        await this.audit.log({
          profile: this.profile,
          tool: call.name,
          action: 'call',
          paramsHash: JSON.stringify(call.args),
          result: governed.success ? 'SUCCESS' : 'FAILURE',
          durationMs: Date.now() - stepStart,
          error: governed.error,
        });

        toolCalls.push({
          tool: call.name,
          args: call.args,
          result: governed,
        });
      }
    } catch (error) {
      truncated = true;
    }

    const durationMs = Date.now() - startTime;

    // 生成摘要（仅摘要进 context）
    const summary = this.generateSummary(toolCalls);

    return {
      script,
      summary,
      toolCalls,
      durationMs,
      truncated,
    };
  }

  /** 创建 PTC 容器（隔离环境） */
  private createContainer(): {
    callTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
    getToolSpec: (name: string) => ToolSpec | undefined;
  } {
    return {
      callTool: async (name, args) => {
        const toolSpec = this.registry.getTool(name);
        if (!toolSpec) throw new Error(`Tool "${name}" not registered`);
        return toolSpec.handler(args);
      },
      getToolSpec: (name) => this.registry.getTool(name),
    };
  }

  /** 解析脚本中的工具调用（简化版，实际可用 AST） */
  private parseScript(script: string): ToolCall[] {
    // 简化：查找 callTool("name", {...}) 模式
    const calls: ToolCall[] = [];
    const regex = /callTool\s*\(\s*["']([^"']+)["']\s*,\s*(\{[\s\S]*?\})\s*\)/g;
    let match;
    while ((match = regex.exec(script)) !== null) {
      try {
        calls.push({ name: match[1], arguments: JSON.parse(match[2]) });
      } catch {
        // 忽略解析失败
      }
    }
    return calls;
  }

  /** 生成执行摘要 */
  private generateSummary(toolCalls: PTCResult['toolCalls']): unknown {
    return {
      totalCalls: toolCalls.length,
      succeeded: toolCalls.filter(c => c.result.success).length,
      failed: toolCalls.filter(c => !c.result.success).length,
      tools: [...new Set(toolCalls.map(c => c.tool))],
    };
  }
}

/** 会话状态管理（C5 恢复） */
export class SessionManager {
  private statePath: string;
  private state: SessionState;

  constructor(profile: string, stateDir: string) {
    this.statePath = path.join(stateDir, `session-${profile}.json`);
    this.state = this.createInitialState();
  }

  private createInitialState(): SessionState {
    return {
      version: 1,
      turn: 0,
      step: 0,
      completedSteps: new Map(),
      pendingSteps: [],
      idempotencyKeys: new Map(),
      workspaceRoots: new Map(),
      updatedAt: new Date().toISOString(),
    };
  }

  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.statePath, 'utf-8');
      const parsed = JSON.parse(content);
      this.state = {
        ...parsed,
        completedSteps: new Map(Object.entries(parsed.completedSteps ?? {})),
        idempotencyKeys: new Map(Object.entries(parsed.idempotencyKeys ?? {})),
        workspaceRoots: new Map(Object.entries(parsed.workspaceRoots ?? {})),
      };
    } catch {
      // 文件不存在或损坏，使用初始状态
    }
  }

  async save(): Promise<void> {
    const serialized = {
      ...this.state,
      completedSteps: Object.fromEntries(this.state.completedSteps),
      idempotencyKeys: Object.fromEntries(this.state.idempotencyKeys),
      workspaceRoots: Object.fromEntries(this.state.workspaceRoots),
      updatedAt: new Date().toISOString(),
    };
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    await fs.writeFile(this.statePath, JSON.stringify(serialized, null, 2), 'utf-8');
  }

  getState(): SessionState {
    return this.state;
  }

  markStepCompleted(stepId: string, result: ToolResult): void {
    this.state.completedSteps.set(stepId, result);
    this.state.step++;
  }

  isStepCompleted(stepId: string): boolean {
    return this.state.completedSteps.has(stepId);
  }

  getStepResult(stepId: string): ToolResult | undefined {
    return this.state.completedSteps.get(stepId);
  }

  setIdempotencyResult(key: string, result: ToolResult): void {
    this.state.idempotencyKeys.set(key, result);
  }

  getIdempotencyResult(key: string): ToolResult | undefined {
    return this.state.idempotencyKeys.get(key);
  }

  nextTurn(): void {
    this.state.turn++;
    this.state.step = 0;
  }
}

/** 并发调度器（C5） */
export class ConcurrentScheduler {
  constructor(
    private maxParallel: number = 8,
    private barrier: Barrier
  ) {}

  /** 执行只读工具并发调度 */
  async executeReadOnly<T>(
    calls: Array<{ tool: string; args: Record<string, unknown>; execute: () => Promise<T> }>
  ): Promise<T[]> {
    const results: (T | Error)[] = [];
    const executing: Promise<void>[] = [];

    for (const call of calls) {
      const promise = call.execute()
        .then(r => { results.push(r); })
        .catch(e => { results.push(e); });

      executing.push(promise);

      if (executing.length >= this.maxParallel) {
        await Promise.race(executing);
        // 移除已完成的
        const idx = executing.findIndex(p => results.length > executing.indexOf(p));
        if (idx >= 0) executing.splice(idx, 1);
      }
    }

    await Promise.all(executing);
    return results as T[];
  }
}