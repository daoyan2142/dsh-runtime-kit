// ============================================================================
// Preset - C4 编排裁剪补丁
// ============================================================================

export interface PresetPatch {
  name: string;
  description: string;
  apply(config: Record<string, unknown>): Record<string, unknown>;
}

/** 预设补丁：关闭重编排层 */
export const minimalPresetPatch: PresetPatch = {
  name: 'minimal-no-orchestration',
  description: '关闭 plan/todo/goal/subagent，开启 pruner/compaction',
  apply(config) {
    return {
      ...config,
      loop: {
        ...config.loop,
        disabledLayers: ['plan', 'todo', 'goal', 'subagent'],
        prunerEnabled: true,
        compactionEnabled: true,
      },
    };
  },
};

/** 预设补丁：code 模式（PTC 友好） */
export const codePresetPatch: PresetPatch = {
  name: 'code-ptc-friendly',
  description: '适合 PTC 批量调用的 code 模式',
  apply(config) {
    return {
      ...config,
      loop: {
        ...config.loop,
        preset: 'code',
        disabledLayers: ['plan', 'todo', 'goal', 'subagent'],
        prunerEnabled: true,
        compactionEnabled: true,
        maxParallelToolCalls: 8,
      },
    };
  },
};

/** 获取所有可用预设补丁 */
export function getPresetPatches(): PresetPatch[] {
  return [minimalPresetPatch, codePresetPatch];
}

/** 应用预设补丁 */
export function applyPresetPatch(config: Record<string, unknown>, presetName: string): Record<string, unknown> {
  const patch = getPresetPatches().find(p => p.name === presetName);
  if (!patch) {
    throw new Error(`Unknown preset patch: ${presetName}`);
  }
  return patch.apply(config);
}

/** 导出配置用于核对（对标 --dump-config） */
export function dumpConfig(config: Record<string, unknown>): string {
  return JSON.stringify(config, null, 2);
}