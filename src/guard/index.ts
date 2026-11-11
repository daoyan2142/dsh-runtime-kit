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

import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
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


export interface TrashUsage {
  dir: string | null;
  files: number;
  bytes: number;
  stamps: number;
}

/** 回收站当前占用：文件数、字节数、时间戳目录数。 */
export async function trashUsage(stateDir?: string): Promise<TrashUsage> {
  const dir = stateDir ? join(stateDir, 'trash') : null;
  if (!dir) return { dir, files: 0, bytes: 0, stamps: 0 };
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return { dir, files: 0, bytes: 0, stamps: 0 };
  }
  let files = 0;
  let bytes = 0;
  for (const stamp of entries) {
    let listed: any[] = [];
    try {
      listed = await readdir(join(dir, stamp), { recursive: true, withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of listed) {
      if (!entry.isFile()) continue;
      files += 1;
      try {
        bytes += (await stat(join(entry.parentPath ?? entry.path, entry.name))).size;
      } catch {
        /* 文件刚被删：跳过 */
      }
    }
  }
  return { dir, files, bytes, stamps: entries.length };
}

export interface PruneOptions {
  retentionDays?: number;
  maxMB?: number;
}

export interface PruneResult {
  removed: number;
  bytes: number;
  kept: number;
}

/**
 * 按时间与总量清理回收站。
 *
 * 两轮：先删超过保留天数的，再按目录从旧到新删到总量低于上限。
 * 任何一步失败都继续，最后返回真实删掉了多少。
 */
export async function pruneTrash(stateDir: string | undefined, options: PruneOptions = {}): Promise<PruneResult> {
  const dir = stateDir ? join(stateDir, 'trash') : undefined;
  if (!dir) return { removed: 0, bytes: 0, kept: 0 };

  let stamps: string[] = [];
  try {
    stamps = (await readdir(dir)).sort();
  } catch {
    return { removed: 0, bytes: 0, kept: 0 };
  }

  const retentionDays = Number(options.retentionDays);
  const cutoff = Number.isFinite(retentionDays) && retentionDays > 0 ? Date.now() - retentionDays * 86400_000 : undefined;
  const maxBytes = Number(options.maxMB) > 0 ? Number(options.maxMB) * 1024 * 1024 : undefined;

  const sizes = new Map<string, number>();
  const removedDirs = new Set<string>();
  let removed = 0;
  let freed = 0;

  for (const stamp of stamps) {
    const full = join(dir, stamp);
    let info;
    try {
      info = await stat(full);
    } catch {
      continue;
    }
    const size = (await trashUsageOf(full)).bytes;
    sizes.set(stamp, size);

    if (cutoff && info.mtimeMs < cutoff) {
      try {
        await rm(full, { recursive: true, force: true });
        removedDirs.add(stamp);
        removed += 1;
        freed += size;
      } catch {
        /* 占用中：下轮再删 */
      }
    }
  }

  if (maxBytes) {
    let total = [...sizes.entries()].filter(([stamp]) => !removedDirs.has(stamp)).reduce((sum, [, size]) => sum + size, 0);
    for (const stamp of stamps) {
      if (total <= maxBytes) break;
      if (removedDirs.has(stamp)) continue;
      try {
        await rm(join(dir, stamp), { recursive: true, force: true });
        removed += 1;
        const size = sizes.get(stamp) ?? 0;
        total -= size;
        freed += size;
      } catch {
        /* 跳过 */
      }
    }
  }

  return { removed, bytes: freed, kept: stamps.length - removed };
}

async function trashUsageOf(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  let listed: any[] = [];
  try {
    listed = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch {
    return { files, bytes };
  }
  for (const entry of listed) {
    if (!entry.isFile()) continue;
    files += 1;
    try {
      bytes += (await stat(join(entry.parentPath ?? entry.path, entry.name))).size;
    } catch {
      /* 忽略 */
    }
  }
  return { files, bytes };
}

/** 一次调用的时间戳目录名。 */
export function trashStamp(now = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '-');
}
