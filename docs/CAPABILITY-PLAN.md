# 可交付改造方案：从「能演示」到「真能用」

> **落地状态（0.7.0）**：P0 + P1 全部完成，另加回收站保留策略（按天/按总量清理 + 页面清空）。
> 早前状态：P0 四项 + P1 四项已完成——写前快照/回收站接进 `tools/pre-execute`、
> 实测指标从审计流水派生、realpath 链接校验挂上沙箱、`workspaceTrust` 生效（默认信任）。
> P0 部分如下。——`runtime_kit_isolation` 改为真实检测、
> 沙箱工作区可配置（配置 + 页面）、新增 `commandDefault`（默认放行）、README 能力矩阵
> 改三态。P1/P2 仍未开始。测试：13 清单 + 47 冒烟 + 46 治理 + 14 页面 + 26 沙箱 = 146 项。

> 现状一句话：审计 / 脱敏 / 注入 / 截断已经长在真实调用链上，页面可用；
> 但 README 能力矩阵里还有 5 处是**桩、未实现或只在自家执行器里生效**，
> 沙箱尤其——判定逻辑是对的，却没有任何配置入口能注册工作区，所以一开就全拒。

本文列出全部需要调整的项、沙箱到底要配什么、每项的验收标准与工期，按优先级排序。

---

## 一、定义：「完全可以正常使用」

达到下面六条才算完成，缺一条都只能叫「部分可用」。

| # | 标准 | 现在的状态 |
|---|---|---|
| 1 | 装上、默认配置下不拒绝任何调用，页面能读到数据 | ✅ 已满足 |
| 2 | 每个开关打开后都有可观察效果，且与页面描述一致 | ⚠️ 沙箱不满足（一开全拒） |
| 3 | 危险能力（沙箱）在没有配置好之前无法开启，或开启时明确警告 | ❌ 无警告 |
| 4 | 拒绝时报文明白（哪条规则、哪个路径），并写审计 | ✅ 已满足 |
| 5 | 任何内部异常 fail-open，不拖垮调用 | ✅ 已满足 |
| 6 | README / 页面说法与代码一致：要么实现，要么标「未实现」 | ❌ 现状有 5 处虚标 |

---

## 二、沙箱需要配置什么（重点）

### 2.1 现在缺的那一格：工作区

`Sandbox` 的判定全部以「工作区」为锚点：

```ts
resolveAndValidate(profile, path, op)  // 先找 profile 对应的工作区，找不到直接 deny
```

但工作区只能由**代码**调用 `registry.registerWorkspace()` 注册，配置文件和页面都没有入口。
所以现在的真实行为是：**打开沙箱 = 所有带路径的调用立刻被拒**。

**改动**：把工作区变成配置项。

```jsonc
"sandbox": {
  "workspaces": [
    {
      "profile": "default",              // 与 governance.profile 对应
      "root": "D:\\Dsh",                 // 允许读写的根
      "permissionMode": "workspace-write", // read-only | workspace-write | danger-full-access
      "networkAllowlist": ["api.github.com", "registry.npmjs.org"]
    }
  ]
}
```

启动时由 `Sandbox` 自动注册；`updateConfig()` 时重新注册。`governance.profile` 决定用哪一个（默认 `default`）。

### 2.2 命令默认策略（当前不可用的第二根刺）

现在的 `validateCommand`：

```ts
if (mode === 'danger-full-access') return allow()
return deny(`Command not in allowlist: ${cmd}`)   // workspace-write 下，未列出的命令全拒
```

PowerShell 的命令没法用前缀白名单管（`Get-ChildItem`、`git`、`npm`、`node -e ...` 组合无穷）。
所以 `workspace-write` 一开，`pwsh` 基本全废——这正是"沙箱不可用"的第二根刺。

**改动**：新增 `commandDefault`，与 `networkDefault` 对称。

```jsonc
"commandDefault": "allow",   // allow | ask | deny，默认 allow
"rules": {
  "commands": [
    { "prefix": "rm -rf", "action": "deny" },
    { "prefix": "Remove-Item -Recurse", "action": "deny" },
    { "prefix": "format ", "action": "deny" },
    { "prefix": "reg delete", "action": "deny" }
  ]
}
```

语义：**默认放行，显式拦危险前缀**。这比"默认拒绝 + 白名单"实用得多，也符合 C6 的"fail-closed 只用于越界路径"。

### 2.3 网络：从「默认拒绝」改成「默认询问」

`networkDefault: "deny"` 会让 `web_fetch` / `web_search` 全废。建议默认 `ask`，由宿主弹审批（DSH 有 `ui-approval` 面板）；用户点过一次可以把域名加进 `rules.network` 的 `allow`。

### 2.4 一份可直接用的配置（针对这台机器）

```jsonc
"governance": {
  "enabled": true,
  "audit": true,
  "redaction": true,
  "injection": "annotate",
  "sandbox": false,          // 先关，等工作区配置好再开
  "profile": "default",
  "truncation": { "mode": "shadow", "maxBytes": 4096, "spill": true, "perTool": { "read": 16384, "grep": 8192 } }
},
"sandbox": {
  "mode": "workspace-write",
  "approval": "ask",
  "workspaces": [
    { "profile": "default", "root": "D:\\Dsh", "permissionMode": "workspace-write" }
  ],
  "commandDefault": "allow",
  "networkDefault": "ask",
  "rules": {
    "files": [
      { "pattern": "**/.env", "read": "ask", "write": "deny", "delete": "deny" },
      { "pattern": "**/.ssh/**", "read": "deny", "write": "deny", "delete": "deny" }
    ],
    "commands": [
      { "prefix": "rm -rf", "action": "deny" },
      { "prefix": "Remove-Item -Recurse", "action": "deny" }
    ],
    "network": [
      { "domain": "api.github.com", "action": "allow" },
      { "domain": "registry.npmjs.org", "action": "allow" }
    ]
  },
  "backupEnabled": true,
  "deletionProtection": true,
  "injectionGuard": true,
  "sensitiveProtection": true,
  "toolControl": {}
}
```

### 2.5 页面要配合的三件事

1. **工作区编辑**：`profile / root / 权限模式` 三个字段，可增删（最多 3 个）
2. **开关前置校验**：没有工作区时，`sandbox` 开关置灰，悬停说明"先配置工作区"
3. **状态条**：`2 个工作区 · 命令默认 allow · 网络默认 ask · 3 条文件规则`

---

## 三、全部需要调整的项

### P0（不修就是"假可用"）

| # | 项目 | 问题 | 改法 | 工期 | 风险 |
|---|---|---|---|---|---|
| 1 | `runtime_kit_isolation` | 注册了工作区就无条件返回"全部通过"，**在撒谎** | 真检测：根存在 / 非盘符根 / `..` 不逃逸 / 网络默认非 allow / 工具管控数；检测项各自返回明细，失败 `passed:false` | 0.3 天 | 低 |
| 2 | 沙箱工作区配置 | 无入口，打开即全拒 | `sandbox.workspaces` + 启动注册 + 页面表单 + 开关前置校验 | 0.5 天 | 中 |
| 3 | `commandDefault` | workspace-write 下命令全拒 | 新增字段，默认 `allow`，规则显式拦 | 0.2 天 | 低 |
| 4 | README 能力矩阵 | 5 处虚标（投影、pruner、lazyLoad、C5、快照） | 三态标注：已实现 / 部分（仅自家执行器）/ 未实现 | 0.2 天 | 无 |

### P1（补齐"声明了但没接上"）

| # | 项目 | 问题 | 改法 | 工期 | 风险 |
|---|---|---|---|---|---|
| 5 | 写前快照 / 回收站 | `backupEnabled` / `deletionProtection` 只是配置 | `tools/pre-execute` 里对 `write`/`edit`/`delete` 类工具：先把目标文件复制到 `<stateDir>/trash/<stamp>/`，删除类再移到回收站；单文件上限 8 MB，失败 fail-open | 0.5 天 | 中 |
| 6 | 指标 | 只有自家执行器产生 metrics，页面永远"没有采样" | 从审计流水派生：每工具调用数 / 被拒数 / 截断字节 / 平均返回大小，另开一块「实测」区 | 0.3 天 | 低 |
| 7 | 符号链接检查 | `resolveAndValidate` 里 0 处 `lstat/realpath` | 对根和最近已存在祖先做 `realpath`，逃逸则 deny | 0.3 天 | 中 |
| 8 | `workspaceTrust` | 配置项无逻辑 | 未信任时降级为 `read-only` 基线（或直接删掉这个字段） | 0.2 天 | 低 |

### P2（真做需要设计）

| # | 项目 | 说明 | 工期 |
|---|---|---|---|
| 9 | 字段投影 | 按工具策略表（`read` 行数、`grep` 命中、`db_*` 列），先把 3-4 个高频工具做出来 | 1 天 |
| 10 | pruner / compaction | 要改会话历史（`agent/pre-step`），出错难回滚。**建议不做**：宿主已有 `compaction-basic` / `tool-result-pruner`，重复实现只会打架 | — |
| 11 | lazyLoadTools | 需要按轮过滤工具列表，`tools.restrict` 是全局的，做不到。**建议标为未实现** | — |
| 12 | C5 并发/恢复 | 目前只在自家执行器里；替换 `agent-loop` 风险极高。**建议标为未实现** | — |

---

## 四、执行顺序与验收

### 第 1 步（P0，1 天）
交付后应当能跑通这套验证：

```bash
node test/manifest.mjs      # 清单不坏
node test/sandbox.mjs       # 新增：工作区配置 + commandDefault 场景
node test/governance.mjs    # 原有 46 项
```

人工验收：
1. 页面配一个工作区 `D:\Dsh`，打开沙箱 → 读写工作区内正常
2. 读 `C:\Windows\...` → 拒绝，提示带规则名
3. `pwsh` 跑 `git status` → 正常（commandDefault allow）
4. `pwsh` 跑 `rm -rf /` → 拒绝
5. 不配工作区就点沙箱开关 → 开关点不动，提示原因
6. `runtime_kit_isolation default` 返回真实明细，故意删掉根目录后 `passed:false`

### 第 2 步（P1，1.5 天）
- 写文件前在 `<stateDir>/trash/` 留副本，删文件先进回收站（页面给个"清空"按钮）
- 页面新增「实测指标」：调用数 / 拒绝数 / 截断字节 / 平均返回大小
- 符号链接逃逸测试（建一个 junction 指向工作区外，确认被拒）

### 第 3 步（P2，1 天）
- 字段投影策略表：`read`（保留行号+截断行）、`grep`（保留文件+命中数）、`db_*`（保留列名+前 N 行）
- pruner / lazyLoad / C5 在 README 里明确标"未实现"，能力矩阵改成三态

---

## 五、工期汇总

| 阶段 | 内容 | 工期 | 完成后状态 |
|---|---|---|---|
| P0 | 诚实 + 沙箱可配 + 命令默认策略 | 1 天 | **可以正常使用**：六条标准全部满足 |
| P1 | 快照/回收站 + 实测指标 + 符号链接 | 1.5 天 | 安全能力补齐 |
| P2 | 字段投影 | 1 天 | C1 完整 |
| 不做 | pruner / compaction / lazyLoad / C5 | — | README 标注未实现 |

---

## 六、风险与不变的约束

- **fail-open 不动摇**：任何新钩子出错都必须 `next()`，这是这个插件最重要的性质。
- **截断默认 off**：即使做完 P2，`truncation.mode` 仍保持默认关闭，由用户按数据决定。
- **沙箱默认 off**：配置好工作区也不会自动打开，需要显式开启（第 3 条标准要求的"明确警告"由开关前置校验提供）。
- **不碰宿主已有能力**：compaction、pruner、工具裁剪宿主已经有一份，重复实现只会互相干扰。
