# dsh-runtime-kit vs dsh-fast-loop 详细对比

> 对比基准：`dsh-fast-loop@0.4.6` (npm registry) vs `dsh-runtime-kit@0.1.0` (本地开发版)
> 规格参考：`DSH-快速执行与沙箱方案.md` v2.1 (§0–§8)

---

## 🎯 核心定位差异

| 维度 | **dsh-fast-loop** | **dsh-runtime-kit** |
|------|-------------------|---------------------|
| **定位** | 替换核心 `agent-loop` 的**单一插件** | 提供**通用运行时能力套件**的单一插件包 |
| **风险等级** | 🔴 **高** — 替换会话状态主干，破坏性变更风险大 | 🟢 **低** — 不替换核心 loop，仅通过扩展点增强 |
| **架构层级** | L1 调度层（C5） | L2 插件层（C1–C4, C6–C7） |
| **v2.1 规格对齐** | 仅覆盖 C5（并发/屏障/恢复） | 覆盖 C1–C7 完整规格（C5 可选） |
| **回退机制** | CLI `enable/disable` 修改 `cordis.patch.yml` | 运行时 `disable` 服务，官方 loop 立即接管 |
| **社区状态** | Archived、manifest 声明矛盾，**不推荐主力 profile 直接使用** | 全新开发，遵循 v2.1 禁止项 |

---

## 📊 能力矩阵对标（v2.1 §4–§6）

| 能力代号 | 能力名称 | dsh-fast-loop | dsh-runtime-kit | 备注 |
|----------|----------|---------------|-----------------|------|
| **C1** | 上下文治理 | ❌ 无 | ✅ 完整实现 | 返回体 ≤4KB、字段投影、预算、pruner/compaction、延迟加载 |
| **C2** | 快路径 | ❌ 无 | ✅ 完整实现 | 模板注册表、0 LLM 调用、幂等、状态机 |
| **C3** | PTC 封装 | ⚠️ 间接支持 | ✅ 完整实现 | fast-loop 依赖 DSH 原生 `ptc-runtime`；runtime-kit 自带容器 |
| **C4** | 编排裁剪 | ⚠️ 隐式（替换 loop 自然关闭） | ✅ 显式 preset 补丁 | 可独立配置、支持 `--dump-config` 核对 |
| **C5** | 并发与恢复 | ✅ **核心优势** | ✅ 可选模块 | fast-loop 更成熟；runtime-kit 可选、默认关、临时 profile 验证 |
| **C6** | 沙箱环境 | ❌ 无 | ✅ 完整实现 | 三档+三态规则、fail-closed、网络/命令/文件、快照/回收站、注入防护、脱敏、shell抽象、执行域替换 |
| **C7** | 审计与指标 | ❌ 无 | ✅ 完整实现 | append-only、脱敏、可导出、全指标采集 |

**结论**：**两者正交互补，非替代关系**
- fast-loop 解决 **C5（wall-clock 优化）**，不省 token
- runtime-kit 解决 **C1–C4, C6–C7（token、隔离、审计、合规）**，不解决 wall-clock

---

## ⚙️ 配置对比

### dsh-fast-loop (v0.4.6)
```yaml
# cordis.patch.yml
- id: agent-loop
  disabled: true
- insert:
  - id: fast-loop
    name: dsh-fast-loop
    config:
      maxParallelToolCalls: 10        # 1-32
      enableStreamingTools: true
      enablePathAwareBarrier: true
      enableSteeringSoftInterrupt: true
      agents: []                       # 静态 Agent 声明
```
**Web UI**：设置面板有滑块调整 `maxParallelToolCalls`，Volatile 响应式即时生效。

### dsh-runtime-kit
```json
{
  "context": { "maxReturnBytes": 4096, "fieldsProjection": true, "prunerEnabled": true, "compactionEnabled": true, "lazyLoadTools": true },
  "loop": { "preset": "code", "disabledLayers": ["plan","todo","goal","subagent"], "maxParallelToolCalls": 8, "enableCustomLoop": false },
  "sandbox": {
    "mode": "workspace-write",
    "approval": "ask",
    "rules": { "files": [], "commands": [], "network": [] },
    "networkDefault": "deny",
    "backupEnabled": true,
    "deletionProtection": true,
    "injectionGuard": true,
    "sensitiveProtection": true,
    "shell": "pwsh",
    "workspaceTrust": false,
    "toolControl": {}
  },
  "audit": { "mode": "append-only", "desensitize": true, "exportable": true, "retentionDays": 90 }
}
```

---

## 🧪 验收指标覆盖（v2.1 §6.2 M1–M14）

| # | 指标 | dsh-fast-loop | dsh-runtime-kit |
|---|------|---------------|-----------------|
| M1 | 首请求输入 token（脚手架税） | ❌ 不关注 | ✅ 目标：显著下降 |
| M2 | 重复模板任务 token 降幅 ≥70% | ❌ 无快路径 | ✅ **核心目标** |
| M3 | 每轮 tool result 进 context ≤4KB | ❌ 无治理 | ✅ **硬性上限** |
| M4 | 快路径 LLM 调用 = 0 | ❌ 无快路径 | ✅ **强制 0** |
| M5 | 8 echo 并发 wall-clock 缩短 | ✅ **核心优势** | ✅ 可选模块支持 |
| M6 | 跨工作区读/路径穿越 100% 拒绝 | ❌ 无沙箱 | ✅ **核心能力** |
| M7 | 白名单外外联 100% 阻断 | ❌ 无网络隔离 | ✅ **核心能力** |
| M8 | 策略损坏 fail-closed | ❌ 无策略 | ✅ **强制拒绝** |
| M9 | disable 后官方 loop 立即可用 | ✅ CLI 回退 | ✅ 运行时回退 |
| M10 | 跨重启恢复不重复执行 | ✅ Turn/Step 持久化 | ✅ 会话状态管理 |
| M11 | 凭据/Cookie 零泄漏 | ❌ 无脱敏 | ✅ **脱敏 + 敏感保护** |
| M12 | 崩溃工具后会话主干可用 | ✅ 容错自愈 | ✅ 崩溃隔离 |
| M13 | 诱导指令不进上下文 | ❌ 无检测 | ✅ **注入防护** |
| M14 | 越界写入需确认+快照回退 | ❌ 无变更恢复 | ✅ **快照+回收站** |

**覆盖率**：fast-loop **2/14 (14%)** vs runtime-kit **14/14 (100%)**

---

## 🔄 组合使用策略（推荐）

```
┌─────────────────────────────────────────────────────────────────────┐
│  推荐：先用 runtime-kit 跑通 P0–P2，指标达标后再评估是否上 fast-loop  │
├─────────────────────────────────────────────────────────────────────┤
│  Phase 1 (P0–P2)：runtime-kit 单独运行                               │
│  ├─ C1 上下文治理 → M1/M2/M3 达标                                    │
│  ├─ C4 编排裁剪 → M1 达标（脚手架税降低）                            │
│  ├─ C2 快路径 → M4 达标（0 LLM 调用）                                │
│  ├─ C3 PTC → M2/M3 辅助                                             │
│  ├─ C6 沙箱 → M6/M7/M8/M11/M13/M14 达标                             │
│  └─ C7 审计 → 全指标可采集                                           │
│                                                                     │
│  Phase 2 (P3 可选)：若 wall-clock 仍不满足，引入 fast-loop          │
│  ├─ 仅开启 C5 并发调度                                              │
│  ├─ 关闭 runtime-kit 的 enableCustomLoop                            │
│  ├─ 共用 registry、沙箱策略、审计                                   │
│  └─ 一键 disable fast-loop 回退 runtime-kit 完整能力                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## ⚠️ 风险对比（v2.1 §8.1）

| 风险 | dsh-fast-loop | dsh-runtime-kit |
|------|---------------|-----------------|
| DSH 破坏性变更导致失效 | 🔴 **极高** — 紧耦合核心 loop 内部 | 🟢 低 — 仅用稳定扩展点 |
| 会话状态/持久化异常 | 🔴 高 — 替换主干 | 🟢 无 — 不动主干 |
| PTC 边界不明导致 token 不降 | 🟡 中 — 依赖原生 ptc-runtime | 🟢 可控 — 自带容器边界 |
| 脚手架 token 税抵消收益 | 🔴 不解决 | 🟢 显式关闭重编排层 |
| 并发增加瞬时 token/限流压力 | 🟡 明确文档警示 | 🟡 仅只读工具并发，文档明示 |
| manifest 声明矛盾不生效 | 🔴 **官方标记 Archived、声明矛盾** | 🟢 显式声明 bundle + status 自检 |
| 插件自身不在沙箱内可读凭据 | 🟡 同等 | 🟡 同等（最小权限、源码审计、pin 版本） |

---

## 📦 安装与集成对比

| 方面 | dsh-fast-loop | dsh-runtime-kit |
|------|---------------|-----------------|
| 安装命令 | `dsh plugin --profile web add dsh-fast-loop@latest` | 本地 bundle `file:...` 或发布 npm 后安装 |
| 配置方式 | 修改 `cordis.patch.yml`（CLI 自动） | Profile 配置 JSON（标准 DSH 方式） |
| 启用/禁用 | `dsh-fast-loop enable/disable` | 标准插件启停，运行时 `disable` 服务 |
| 依赖要求 | `@deepseek-ai/cordis@~4.0.5` 等特定版本 | 仅 `@cordisjs/core@^3.0.0`，版本宽松 |
| Web UI 集成 | 原生设置卡片（Volatile 响应式） | 标准配置编辑器，无专用 UI |
| 多 Profile 支持 | 需每 profile 单独配置 patch | 天然支持，配置随 profile 走 |

---

## 🎯 选型建议

| 场景 | 推荐 |
|------|------|
| **仅需并发加速**，已有完善沙箱/审计/上下文治理 | 可考虑 fast-loop（但在临时 profile 验证） |
| **需要完整 v2.1 合规**（token、隔离、审计、合规） | **必须用 runtime-kit** |
| **生产环境首次接入 DSH 运行时增强** | **runtime-kit 单独跑 P0–P2**，风险可控 |
| **已有 fast-loop，发现 token/隔离不达标** | 叠加 runtime-kit（共用 registry/沙箱/审计） |
| **团队无 DSH 核心 loop 维护经验** | **禁用 fast-loop**，用 runtime-kit |
| **需要极细粒度沙箱规则** | **只有 runtime-kit 有**（三态文件/命令/网络规则） |

---

## 🔬 实测计划（建议）

### Test 1：基线对比（同一临时 profile）
```bash
# Baseline: 原生 loop + 默认 preset
# Test A: + runtime-kit (C1-C4, C6-C7)
# Test B: + fast-loop (C5 only)
# Test C: + runtime-kit + fast-loop (组合)
```

### Test 2：指标采集点
| 指标 | 采集方式 |
|------|----------|
| input_tokens / output_tokens | `token-meter` 服务 |
| tool result bytes in context | runtime-kit C1 中间件统计 |
| LLM 调用次数 | 请求日志计数 |
| wall-clock | 客户端计时 |
| 拒绝/审批计数 | runtime-kit C7 审计日志 |

### Test 3：隔离渗透测试
- 跨工作区读取 → 预期 100% 拒绝
- 路径穿越 `../../etc/passwd` → 预期拒绝 + 审计
- 白名单外 `http://evil.com` → 预期阻断 + 审计
- 工具返回注入 `ignore previous instructions` → 预期不进 context + 需确认
- 凭据泄漏 `password=secret123` → 预期脱敏

---

## 📝 总结

| 维度 | dsh-fast-loop | dsh-runtime-kit |
|------|---------------|-----------------|
| **v2.1 规格覆盖** | 14% (仅 C5) | **100% (C1–C7)** |
| **生产可用性** | 🔴 Archived、声明矛盾、高风险 | 🟢 遵循规格、低风险、可回退 |
| **Token 优化** | ❌ 无 | ✅ C1+C2+C3+C4 组合拳 |
| **沙箱合规** | ❌ 无 | ✅ 细粒度三态 + fail-closed + 脱敏 + 注入防护 |
| **审计合规** | ❌ 无 | ✅ append-only + 导出 + 全指标 |
| **并发加速** | ✅ 成熟、Web UI 可配 | ✅ 可选模块、默认关 |
| **推荐策略** | **最后可选、临时 profile 验证** | **首选、P0 起步、全程可用** |

> **一句话**：**先把 runtime-kit 跑通 P0–P2（零业务依赖、全指标可测），wall-clock 真有瓶颈了，再在临时 profile 试 fast-loop。不要反了。**