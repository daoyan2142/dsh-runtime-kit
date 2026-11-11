# dsh-runtime-kit

**DSH 通用运行时插件** —— 高执行效率与细粒度沙箱环境，**零业务依赖**。

> 对标规格：`DSH-快速执行与沙箱方案.md` v2.1（§0–§8）

---

## 🎯 核心定位

| 维度 | 说明 |
|------|------|
| **是什么** | 给 DSH 装上「上下文治理 + 快路径 + PTC + 沙箱 + 审计」的通用运行时能力 |
| **不是什么** | 不内置任何业务逻辑、不读业务文件、不驱动浏览器、不管账号/选择器/登录态 |
| **交付形态** | 单一插件包 `dsh-runtime-kit`，内部模块化，整体可一键启停 |
| **唯一耦合面** | `registry`：使用方注册 **工具 / 模板 / 工作区**，插件只认这三个结构 |

---

## 📦 能力矩阵（对标 v2.1 §4）

| 代号 | 能力 | 关键特性 | 验收指标 |
|------|------|----------|----------|
| **C1** | 上下文治理 | 返回体 ≤4KB 裁剪、字段投影、预算、pruner/compaction、**延迟工具加载** | M1/M2/M3 |
| **C2** | 快路径 | 模板注册表、命中即规则执行、**0 LLM 调用**、幂等键、状态机 | M4 |
| **C3** | PTC 封装 | 脚本容器内批量调工具、中间结果留容器内、仅摘要进 context、registry 强制约束 | M2/M3 |
| **C4** | 编排裁剪 | preset 补丁默认关 `plan/todo/goal/subagent`、可独立配置、`--dump-config` 核对 | M1 |
| **C5** | 并发与恢复（可选） | 只读工具并发上限 8、变更工具屏障串行、崩溃隔离、turn/step 持久化、一键回退 | M5/M9/M10/M12 |
| **C6** | 沙箱 | 三档基线 + **三态细粒度规则（文件读/写/删、命令前缀、网络域名）**、fail-closed、网络默认拒绝、Windows `pwsh`、变更快照/回收站、工具粒度管控、工作区信任/受限、注入防护、敏感脱敏、执行域可替换 | M6/M7/M8/M11/M13/M14 |
| **C7** | 审计与指标 | append-only 流水、脱敏、可导出、token/工具调用/拒绝/审批全指标 | M1–M14 全覆盖 |

---

## 🛡️ 治理钩子（0.2.0 起接入请求路径）

0.2.0 之前，上表所有能力都要靠命令手动触发。现在 C7 审计、C6 的脱敏/注入检测已接入
DSH 的工具调用链；沙箱拦截可以做，但**默认关闭**。

| 事件 | 做什么 | 开关 |
|---|---|---|
| `tools/result` | 每次工具调用写一条审计 | `governance.audit` |
| `tools/post-execute` | 返回体里的密钥替换成 `[redacted:kind]`；疑似注入追加警告块或拦截 | `governance.redaction` / `governance.injection` |
| `tools/pre-execute` | 按文件/命令/网络/工具启停规则拒绝调用 | `governance.sandbox`（默认 `false`） |

三条硬约束：**fail-open**（内部异常一律放行）、**失败结果不改写**、**默认只开零风险项**。

```jsonc
"governance": {
  "enabled": true,
  "audit": true,
  "redaction": true,
  "injection": "annotate",   // off | annotate | block
  "sandbox": false,          // 打开后会真的拒绝调用
  "profile": "default"
}
```

细节、`dsh-context` 共存策略与「返回体截断」的方案见 [`docs/GOVERNANCE.md`](docs/GOVERNANCE.md)。

---

## 🔌 对外契约：Registry（唯一耦合面）

```typescript
// 工具注册
registry.registerTool({
  name: 'my_tool',
  description: '...',
  schema: { type: 'object', properties: {...} },
  isStateChanging: false,      // 是否触发屏障/审批
  returnBudget: 4096,          // 返回体预算
  timeout: 30000,
  handler: async (args) => ({ success: true, data: {...} })
});

// 模板注册（快路径）
registry.registerTemplate({
  name: 'my_template',
  match: (input) => input.startsWith('do something'),
  plan: [
    { tool: 'tool_a', args: { param: 'value' } },
    { tool: 'tool_b', args: (input, prev) => ({ data: prev.get('tool_a')?.data }) },
  ],
  idempotencyKeyFn: (input) => `my_template:${input}`
});

// 工作区注册（沙箱边界）
registry.registerWorkspace({
  profile: 'my-profile',
  root: '/absolute/path/to/workspace',
  networkAllowlist: ['api.example.com'],
  permissionMode: 'workspace-write',
  envPrefix: 'MY_',
  trusted: false,
});
```

**插件不关心 handler 里跑什么**——浏览器、HTTP、纯计算均可。

---

## ⚙️ 配置（完整 schema 见 `config.schema.json`）

```json
{
  "context": { "maxReturnBytes": 4096, "fieldsProjection": true, "prunerEnabled": true, "compactionEnabled": true, "lazyLoadTools": true },
  "loop": { "preset": "code", "disabledLayers": ["plan","todo","goal","subagent"], "maxParallelToolCalls": 8, "enableCustomLoop": false },
  "sandbox": {
    "mode": "workspace-write",
    "approval": "ask",
    "rules": {
      "files": [{ "pattern": "**/*.secret", "read": "deny", "write": "deny", "delete": "deny" }],
      "commands": [{ "prefix": "rm -rf", "action": "ask" }],
      "network": [{ "domain": "api.github.com", "action": "allow" }]
    },
    "networkDefault": "deny",
    "backupEnabled": true,
    "deletionProtection": true,
    "injectionGuard": true,
    "sensitiveProtection": true,
    "shell": "pwsh",
    "workspaceTrust": false,
    "toolControl": { "dangerous_tool": false }
  },
  "audit": { "mode": "append-only", "desensitize": true, "exportable": true, "retentionDays": 90 }
}
```

---

## 🧪 验收指标（§6，纯通用夹具，零业务）

| # | 指标 | 通过线 |
|---|------|--------|
| M1 | 首请求输入 token | 显著下降，给出实测值 |
| M2 | 重复模板任务 10 次平均输入 token | **降幅 ≥70%**（vs 原生 loop） |
| M3 | 每轮进入 context 的 tool result 字节 | **≤4 KB** |
| M4 | 快路径命中时的 LLM 调用次数 | **= 0** |
| M5 | 8 个 `echo` 并发 wall-clock | 明显缩短，无状态错乱 |
| M6 | 跨工作区读 / 路径穿越 | **100% 拒绝 + 审计** |
| M7 | 白名单外外联 | **100% 阻断 + 审计** |
| M8 | 策略配置损坏行为 | **fail-closed（拒绝）** |
| M9 | `disable` 后官方 loop | 立即可用、无状态残留 |
| M10 | 跨重启恢复 | 已成功步骤不重复执行 |
| M11 | 凭据/Cookie 在返回/日志/上下文出现次数 | **0**（脱敏测试） |
| M12 | 崩溃工具后的会话主干 | 继续可用、错误结构化 |
| M13 | 工具返回含诱导指令 | 疑似内容不进上下文 + 需确认 |
| M14 | 越界写入/修改已有文件 | 拒绝或需确认 + 变更前快照可回退 |

**测试夹具**：`echo` / `kv_get/kv_set` / `file_read/file_write` + 两个临时目录 / `http_probe` / `echo-chain` 模板 / `crash_tool`

---

## 🚀 快速开始

```bash
git clone https://github.com/daoyan2142/dsh-runtime-kit.git
cd dsh-runtime-kit
pnpm install
pnpm build
```

在 DSH profile 中启用：

```json
{
  "plugins": {
    "dsh-runtime-kit": {
      "enabled": true,
      "config": { /* 见上方配置示例 */ }
    }
  }
}
```

---

## 📋 管理命令

```bash
# 健康检查
runtime_kit_health

# 配置核对 / 应用预设
runtime_kit_config [minimal-no-orchestration|code-ptc-friendly]

# 指标查看
runtime_kit_metrics

# 审计日志
runtime_kit_audit_logs [profile] -t <tool> -a <action> -r <result> -s <date> -l 50

# 隔离验证
runtime_kit_isolation <profile>

# 快路径执行
runtime_kit_fastpath "echo-chain:test" [profile]

# PTC 执行
runtime_kit_ptc 'callTool("echo", {"text":"hi"})' [profile]

# 注册表查看
runtime_kit_registry_tools
runtime_kit_registry_templates
runtime_kit_registry_workspaces
```

---

## 🏗️ 内部架构

```
src/
├── types.ts              # 所有类型定义（零业务）
├── registry/             # 唯一对外耦合面
├── context/              # C1 上下文治理（中间件）
├── sandbox/              # C6 沙箱（路径/网络/命令/工具/快照/回收站/注入/脱敏/shell/执行域）
├── audit/                # C7 审计（append-only + 脱敏 + 指标）
├── loop/                 # C2 快路径 + C3 PTC + C5 并发/恢复
├── preset/               # C4 编排裁剪补丁
└── index.ts              # 插件主入口，组装所有能力
```

---

## 📌 实施阶段（§7）

| 阶段 | 交付 | 验收 | 外部依赖 |
|------|------|------|----------|
| **P0 上下文治理** | registry + C1 + C4 + 通用夹具 | M1/M2/M3 | 无 |
| **P1 沙箱与审计** | C6 + C7 + Windows `pwsh` 抽象 | M6/M7/M8/M11 | 无 |
| **P2 快路径** | C2 + C3 + 幂等/状态机 | M4 | 无 |
| **P3 并发与恢复（可选）** | C5 自定义 loop + 回退 | M5/M9/M10/M12 | 临时 profile 验证 |

> **每阶段独立验收，无需任何业务信息。**

---

## ⚠️ 禁止项（§8.2）

1. 禁止在插件内引用任何业务脚本、记忆文件、账号、选择器、登录态
2. 禁止内置任何具体任务模板或业务参数
3. 禁止把工具返回的大对象、二进制、日志全文塞进 context
4. 禁止把 `danger-full-access` 设为默认；禁止策略异常时降级放行
5. 禁止依赖 git bash 或任何绕开受限令牌的 shell 适配
6. 禁止在验收夹具里出现真实业务系统、真实 URL、真实凭据
7. 禁止在主力 profile 直接试用未经验证的第三方 loop 实现
8. **禁止让插件核心 import 使用方代码——耦合只允许发生在 registry**

---

## 🔗 关键参考

- 对标规格：内部《DSH 快速执行与沙箱方案》v2.1（§0–§8）
- DSH 运行时：宿主安装目录下的 `resources/app.asar/dsh/`