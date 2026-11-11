// ============================================================================
// Context Governance - C1 上下文治理
// 工具返回中间件：裁剪、投影、预算、pruner、compaction、延迟加载
// ============================================================================

import {
  ToolResult,
  ToolSpec,
  ContextGovernanceConfig,
  MetricsSnapshot,
} from '../types.js';

/** 裁剪后的工具返回 */
export interface GovernedToolResult extends ToolResult {
  governance: {
    originalBytes: number;
    governedBytes: number;
    truncated: boolean;
    fieldsProjected?: string[];
  };
}

/** 字段投影选项 */
export interface ProjectionOptions {
  include?: string[];
  exclude?: string[];
  maxDepth?: number;
  maxArrayLength?: number;
}

/** 上下文治理服务 */
export class ContextGovernance {
  private config: ContextGovernanceConfig;
  private toolSchemas = new Map<string, Record<string, unknown>>();
  private schemasLoaded = new Map<string, boolean>();
  private metrics: MetricsSnapshot[] = [];
  private currentTurn = 0;

  constructor(config: ContextGovernanceConfig) {
    this.config = config;
  }

  /** 注册工具 schema（延迟加载支持） */
  registerToolSchema(name: string, schema: Record<string, unknown>): void {
    this.toolSchemas.set(name, schema);
    this.schemasLoaded.set(name, false);
  }

  /** 获取工具 schema（按需加载） */
  async getToolSchema(name: string): Promise<Record<string, unknown> | undefined> {
    if (!this.config.lazyLoadTools) {
      return this.toolSchemas.get(name);
    }

    if (!this.schemasLoaded.get(name)) {
      this.schemasLoaded.set(name, true);
      // 实际实现中，这里会从 DSH 的工具注册表按需加载
      // 当前返回已注册的 schema
    }
    return this.toolSchemas.get(name);
  }

  /** 治理工具返回：裁剪 + 投影 + 预算 */
  async governReturn(
    toolName: string,
    result: ToolResult,
    projection?: ProjectionOptions
  ): Promise<GovernedToolResult> {
    const originalStr = JSON.stringify(result);
    const originalBytes = Buffer.byteLength(originalStr, 'utf-8');
    let governed = { ...result };
    let governedBytes = originalBytes;
    let truncated = false;
    let fieldsProjected: string[] | undefined;

    // 1. 字段投影
    if (this.config.fieldsProjection && projection && governed.data) {
      governed.data = this.projectFields(governed.data, projection);
      fieldsProjected = projection.include ?? Object.keys(projection.exclude ?? {});
    }

    // 2. 返回体预算裁剪
    const budget = this.getReturnBudget(toolName);
    const governedStr = JSON.stringify(governed);
    governedBytes = Buffer.byteLength(governedStr, 'utf-8');

    if (governedBytes > budget) {
      governed = this.truncateToBudget(governed, budget);
      governedBytes = budget;
      truncated = true;
    }

    // 3. 记录治理信息
    const governedResult: GovernedToolResult = {
      ...governed,
      governance: {
        originalBytes,
        governedBytes,
        truncated,
        fieldsProjected,
      },
    };

    return governedResult;
  }

  /** 字段投影实现 */
  private projectFields(obj: unknown, options: ProjectionOptions): unknown {
    const { include, exclude, maxDepth = 10, maxArrayLength = 50 } = options;

    function visit(value: unknown, path: string, depth: number): unknown {
      if (depth > maxDepth) return '[MAX_DEPTH_EXCEEDED]';

      if (Array.isArray(value)) {
        if (value.length > maxArrayLength) {
          return [
            ...value.slice(0, maxArrayLength).map((v, i) => visit(v, `${path}[${i}]`, depth + 1)),
            `[...${value.length - maxArrayLength} more items]`,
          ];
        }
        return value.map((v, i) => visit(v, `${path}[${i}]`, depth + 1));
      }

      if (value && typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
          const fullPath = path ? `${path}.${key}` : key;

          // include 过滤
          if (include && include.length > 0) {
            const matched = include.some(p => fullPath === p || fullPath.startsWith(p + '.'));
            if (!matched) continue;
          }
          // exclude 过滤
          if (exclude && exclude.length > 0) {
            const matched = exclude.some(p => fullPath === p || fullPath.startsWith(p + '.'));
            if (matched) continue;
          }

          result[key] = visit(val, fullPath, depth + 1);
        }
        return result;
      }

      return value;
    }

    return visit(obj, '', 0);
  }

  /** 预算内截断 */
  private truncateToBudget(result: ToolResult, budget: number): ToolResult {
    const truncated: ToolResult = { ...result };

    if (truncated.data) {
      const dataStr = JSON.stringify(truncated.data);
      const dataBytes = Buffer.byteLength(dataStr, 'utf-8');
      const overhead = Buffer.byteLength(JSON.stringify({ ...truncated, data: '' }), 'utf-8');
      const availableForData = budget - overhead - 100; // 留余量

      if (availableForData > 100) {
        // 尝试保留 data 的前半部分
        if (typeof truncated.data === 'string') {
          const maxChars = Math.floor(availableForData / 3); // 粗略估算
          if (truncated.data.length > maxChars) {
            truncated.data = truncated.data.slice(0, maxChars) + '\n... [TRUNCATED]';
          }
        } else if (Array.isArray(truncated.data)) {
          // 数组保留前 N 项
          let kept: unknown[] = [];
          let bytes = 0;
          for (const item of truncated.data) {
            const itemBytes = Buffer.byteLength(JSON.stringify(item), 'utf-8');
            if (bytes + itemBytes > availableForData) break;
            kept.push(item);
            bytes += itemBytes;
          }
          truncated.data = [...kept, `[...${truncated.data.length - kept.length} more items TRUNCATED]`];
        } else if (typeof truncated.data === 'object') {
          truncated.data = { ...(truncated.data as object), _truncated: true };
        }
      } else {
        truncated.data = '[TRUNCATED: EXCEEDS BUDGET]';
      }
    }

    truncated.truncated = true;
    truncated.totalBytes = budget;
    return truncated;
  }

  /** 获取工具返回预算 */
  private getReturnBudget(toolName: string): number {
    // 实际实现中，从工具 spec 读取 returnBudget，回退到全局配置
    return this.config.maxReturnBytes;
  }

  /** 记录指标快照 */
  recordMetrics(snapshot: MetricsSnapshot): void {
    this.metrics.push(snapshot);
    if (this.metrics.length > 1000) {
      this.metrics.shift(); // 保留最近 1000 轮
    }
  }

  /** 获取指标历史 */
  getMetrics(): MetricsSnapshot[] {
    return [...this.metrics];
  }

  /** 更新配置 */
  updateConfig(partial: Partial<ContextGovernanceConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /** 获取当前配置 */
  getConfig(): ContextGovernanceConfig {
    return { ...this.config };
  }

  /** 下一轮 */
  nextTurn(): void {
    this.currentTurn++;
  }

  getCurrentTurn(): number {
    return this.currentTurn;
  }
}