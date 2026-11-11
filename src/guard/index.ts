// ============================================================================
// Trash — the half of `backupEnabled` / `deletionProtection` that was missing.
//
// Both switches existed in the schema and did nothing: nothing copied a file
// before a tool wrote or deleted it. This module does exactly that, and nothing
// else — it is not a git replacement, just a last-resort copy so a bad `write`
// or `remove` is not final.
//
// Rules:
//   - only regular files, only under the size cap, only when the switch is on
//   - a failure here is ignored by the caller (fail-open)
//   - the copy keeps the original extension so it can be opened as-is
// ============================================================================

import { copyFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface TrashOptions {
  stateDir?: string;
  /** 单文件上限，超过就跳过（不复制一个大视频） */
  maxBytes?: number;
  enabled: boolean;
  /** 同一批调用共用一个时间戳目录 */
  stamp: string;
}

export interface TrashResult {
  saved: number;
  skipped: number;
  dir: string | null;
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/** 文件名冲突时用的短哈希（只依赖字符串，避免引入 crypto）。 */
function shortName(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** `C:\work\a.txt` → `C_work_a.txt`，保留扩展名便于直接打开。 */
export function flattenPath(value: string): string {
  const normalized = String(value).replace(/^[a-zA-Z]:/, (drive) => drive[0]).replace(/[\\/]+/g, '_').replace(/^_+/, '');
  const safe = normalized.replace(/[<>:"|?*]/g, '_').slice(-120);
  return safe || `file-${shortName(String(value))}`;
}

/**
 * 在工具执行前把会被改动/删除的文件复制到 `<stateDir>/trash/<stamp>/`。
 *
 * 复制失败不抛错：调用方只关心"有没有尽力保住一份"。
 */
export async function snapshotPaths(paths: string[], options: TrashOptions): Promise<TrashResult> {
  const dir = options.stateDir ? join(options.stateDir, 'trash', options.stamp) : null;
  if (!options.enabled || !dir) return { saved: 0, skipped: 0, dir };
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  let saved = 0;
  let skipped = 0;
  const seen = new Set<string>();

  for (const target of paths) {
    const abs = String(target ?? '');
    if (!abs || seen.has(abs)) continue;
    seen.add(abs);

    let info;
    try {
      info = await stat(abs);
    } catch {
      continue; // 文件不存在：没有东西可备份（新文件）
    }
    if (!info.isFile()) continue;
    if (info.size > maxBytes) {
      skipped += 1;
      continue;
    }

    try {
      await mkdir(dir, { recursive: true });
      await copyFile(abs, join(dir, flattenPath(abs)));
      saved += 1;
    } catch {
      skipped += 1; // 权限/占用：不阻断调用
    }
  }

  return { saved, skipped, dir: saved ? dir : null };
}

/** 一次调用的时间戳目录名。 */
export function trashStamp(now = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '-');
}
