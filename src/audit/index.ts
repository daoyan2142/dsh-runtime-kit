// ============================================================================
// Audit - C7 审计与指标
// append-only 流水 + 脱敏 + 指标采集 + 可导出
// ============================================================================

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  AuditConfig,
  AuditLogEntry,
  AuditLogFilter,
  MetricsSnapshot,
  Sandbox,
} from '../types';

/** 审计服务 */
export class Audit {
  private config: AuditConfig;
  private logBuffer: AuditLogEntry[] = [];
  private flushTimer?: NodeJS.Timeout;
  private logDir: string;
  private sandbox: Sandbox;

  constructor(config: AuditConfig, logDir: string, sandbox: Sandbox) {
    this.config = config;
    this.logDir = logDir;
    this.sandbox = sandbox;

    if (config.mode !== 'off') {
      this.flushTimer = setInterval(() => this.flush(), 5000);
      this.flushTimer.unref();
    }
  }

  /** 记录审计日志 */
  async log(entry: Omit<AuditLogEntry, 'timestamp'>): Promise<void> {
    if (this.config.mode === 'off') return;

    // 脱敏参数摘要
    let paramsHash = entry.paramsHash;
    if (this.config.desensitize) {
      const { sanitized } = this.sandbox.desensitize(entry.paramsHash);
      paramsHash = sanitized;
    }

    const fullEntry: AuditLogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
      paramsHash,
    };

    this.logBuffer.push(fullEntry);

    // 关键事件立即刷新
    if (entry.result === 'BLOCKED' || entry.action === 'block') {
      await this.flush();
    }
  }

  /** 刷新缓冲区到磁盘 */
  private async flush(): Promise<void> {
    if (this.logBuffer.length === 0) return;

    const byProfile = new Map<string, AuditLogEntry[]>();
    for (const entry of this.logBuffer) {
      const profile = entry.profile || 'default';
      if (!byProfile.has(profile)) byProfile.set(profile, []);
      byProfile.get(profile)!.push(entry);
    }

    await fs.mkdir(this.logDir, { recursive: true });

    for (const [profile, entries] of byProfile) {
      const logPath = path.join(this.logDir, `audit-${profile}.jsonl`);
      const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
      await fs.appendFile(logPath, lines, 'utf-8');
    }

    this.logBuffer = [];
  }

  /** 查询审计日志 */
  async getLogs(filter?: AuditLogFilter): Promise<AuditLogEntry[]> {
    const profile = filter?.profile || 'default';
    const logPath = path.join(this.logDir, `audit-${profile}.jsonl`);

    try {
      const content = await fs.readFile(logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      let entries = lines.map(l => JSON.parse(l) as AuditLogEntry);

      // 应用过滤器
      if (filter?.tool) entries = entries.filter(e => e.tool === filter.tool);
      if (filter?.action) entries = entries.filter(e => e.action === filter.action);
      if (filter?.result) entries = entries.filter(e => e.result === filter.result);
      if (filter?.since) entries = entries.filter(e => e.timestamp >= filter.since!);
      if (filter?.until) entries = entries.filter(e => e.timestamp <= filter.until!);

      // 按时间倒序
      entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return filter?.limit ? entries.slice(0, filter.limit) : entries;
    } catch {
      return [];
    }
  }

  /** 导出审计日志（可导出格式） */
  async exportLogs(filter?: AuditLogFilter, format: 'jsonl' | 'csv' = 'jsonl'): Promise<string> {
    const entries = await this.getLogs(filter);

    if (format === 'csv') {
      const headers = ['timestamp', 'profile', 'tool', 'action', 'paramsHash', 'result', 'durationMs', 'error'];
      const rows = entries.map(e => [
        e.timestamp,
        e.profile,
        e.tool,
        e.action,
        e.paramsHash,
        e.result,
        e.durationMs.toString(),
        e.error ?? '',
      ]);
      return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    }

    return entries.map(e => JSON.stringify(e)).join('\n');
  }

  /** 记录指标快照 */
  recordMetrics(snapshot: MetricsSnapshot): void {
    // 指标内存保留，定期可导出
  }

  /** 更新配置 */
  updateConfig(partial: Partial<AuditConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /** 清理过期日志 */
  async cleanup(): Promise<number> {
    if (this.config.mode === 'off') return 0;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.config.retentionDays);
    const cutoffStr = cutoff.toISOString();

    let cleaned = 0;
    const profiles = new Set<string>();
    try {
      const entries = await fs.readdir(this.logDir);
      for (const entry of entries) {
        if (entry.startsWith('audit-') && entry.endsWith('.jsonl')) {
          profiles.add(entry.slice(6, -6));
        }
      }
    } catch {
      return 0;
    }

    for (const profile of profiles) {
      const logPath = path.join(this.logDir, `audit-${profile}.jsonl`);
      try {
        const content = await fs.readFile(logPath, 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);
        const kept = lines
          .map(l => JSON.parse(l) as AuditLogEntry)
          .filter(e => e.timestamp >= cutoffStr)
          .map(e => JSON.stringify(e));
        await fs.writeFile(logPath, kept.join('\n') + (kept.length > 0 ? '\n' : ''), 'utf-8');
        cleaned += lines.length - kept.length;
      } catch {
        // 忽略单个文件错误
      }
    }

    return cleaned;
  }

  /** 关闭审计服务 */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    await this.flush();
  }
}