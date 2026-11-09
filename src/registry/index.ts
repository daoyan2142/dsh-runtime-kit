// ============================================================================
// Registry - 唯一对外耦合面
// 零业务依赖，只管注册/查询/启停
// ============================================================================

import {
  ToolSpec,
  TemplateSpec,
  WorkspaceSpec,
  Registry as IRegistry,
} from './types';

export class RegistryImpl implements IRegistry {
  private tools = new Map<string, ToolSpec>();
  private toolEnabled = new Map<string, boolean>();
  private templates = new Map<string, TemplateSpec>();
  private workspaces = new Map<string, WorkspaceSpec>();

  // ========== 工具注册 ==========
  registerTool(spec: ToolSpec): void {
    if (this.tools.has(spec.name)) {
      throw new Error(`Tool "${spec.name}" already registered`);
    }
    this.tools.set(spec.name, spec);
    this.toolEnabled.set(spec.name, true);
  }

  unregisterTool(name: string): void {
    this.tools.delete(name);
    this.toolEnabled.delete(name);
  }

  getTool(name: string): ToolSpec | undefined {
    return this.tools.get(name);
  }

  listTools(): ToolSpec[] {
    return Array.from(this.tools.values());
  }

  isToolEnabled(name: string): boolean {
    return this.toolEnabled.get(name) ?? false;
  }

  setToolEnabled(name: string, enabled: boolean): void {
    if (!this.tools.has(name)) {
      throw new Error(`Tool "${name}" not registered`);
    }
    this.toolEnabled.set(name, enabled);
  }

  // ========== 模板注册 ==========
  registerTemplate(spec: TemplateSpec): void {
    if (this.templates.has(spec.name)) {
      throw new Error(`Template "${spec.name}" already registered`);
    }
    this.templates.set(spec.name, spec);
  }

  unregisterTemplate(name: string): void {
    this.templates.delete(name);
  }

  getTemplate(name: string): TemplateSpec | undefined {
    return this.templates.get(name);
  }

  listTemplates(): TemplateSpec[] {
    return Array.from(this.templates.values());
  }

  async matchTemplate(input: string): Promise<TemplateSpec | undefined> {
    for (const template of this.templates.values()) {
      if (await template.match(input)) {
        return template;
      }
    }
    return undefined;
  }

  // ========== 工作区注册 ==========
  registerWorkspace(spec: WorkspaceSpec): void {
    if (this.workspaces.has(spec.profile)) {
      throw new Error(`Workspace for profile "${spec.profile}" already registered`);
    }
    this.workspaces.set(spec.profile, spec);
  }

  unregisterWorkspace(profile: string): void {
    this.workspaces.delete(profile);
  }

  getWorkspace(profile: string): WorkspaceSpec | undefined {
    return this.workspaces.get(profile);
  }

  listWorkspaces(): WorkspaceSpec[] {
    return Array.from(this.workspaces.values());
  }

  // ========== 状态管理 ==========
  clear(): void {
    this.tools.clear();
    this.toolEnabled.clear();
    this.templates.clear();
    this.workspaces.clear();
  }
}

// 单例导出（插件内部使用）
export const registry = new RegistryImpl();