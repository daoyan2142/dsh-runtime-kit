# 治理钩子与后续方案

本文记录 `dsh-runtime-kit` 从「命令工具箱」接入 DSH 请求路径的过程：已经做了什么、
开关在哪、失败时怎么退，以及尚未实施的两项（返回体截断、与 `dsh-context` 的共存）的
评估与方案。

---

## 一、已实现的钩子（0.2.0）

插件现在订阅三个 Host 事件（全部为 waterfall，可改写结论）：

| 事件 | 用途 | 实现 |
|---|---|---|
| `tools/result` | 观察每次工具调用，写一条审计 | `src/hooks/index.ts` |
| `tools/post-execute` | 工具返回后脱敏、注入检测 | 同上 |
| `tools/pre-execute` | 调用前做沙箱判定（文件/命令/网络/工具启停） | 同上 |

纯函数在 `src/hooks/policy.ts`：`redactSecrets` / `detectInjection` / `extractTargets` /
`inferFileOperation`，都不依赖 Host，可单独测试（`node test/governance.mjs`）。

### 三条硬约束

1. **fail-open**：任何内部异常都走 `next()`，插件自身的 bug 不会让工具调用失败。
2. **失败结果不改写**：`isError: true` 的返回原样放行——`accept` 会把错误变成成功。
3. **默认只开零风险项**：审计／脱敏／注入标注默认开；沙箱拦截默认关，因为它会真的拒绝调用。

### 开关

`config.schema.json` 新增 `governance` 段：

```jsonc
"governance": {
  "enabled": true,          // 总开关：false 时连钩子都不注册
  "audit": true,            // 只读观察
  "redaction": true,        // 密钥替换成 [redacted:kind]
  "injection": "annotate",  // off | annotate | block
  "sandbox": false,         // 开启后按文件/命令/网络规则拒绝调用
  "profile": "default"      // 用哪个已注册工作区做判定
}
```

`runtime_kit_config` 命令会把它一起打印出来，改配置不需要翻文档。

### 沙箱判定的顺序

`evaluateCall()` 依次检查，命中第一个非 `allow` 就返回：

1. `toolControl`（工具粒度启停，声明式，优先于参数规则）
2. 文件路径（从参数里按「键名 + 值的形态」双重判断抽出，`path` / `file_path` / `paths[]` 都能认）
3. 命令前缀（`command` / `cmd` / `script` 字段，以及形似命令的字符串）
4. 网络域名（`url` / `uri` / `endpoint`，以及 `http(s)://` 开头的值）

对应的判定仍由 `Sandbox` 负责：`isToolAllowed` / `resolveAndValidate` / `validateCommand` /
`validateNetwork`——钩子只做参数抽取和结论翻译。

---

## 二、二期 3 评估：配置化开关 vs 自动退让

**结论：用显式开关，不做隐式自动退让；但要在两者同时开启时告警一次。**

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. 隐式自动退让（检测到 `dsh-context` 就不干活） | 用户零配置 | 行为不可见，出问题无从排查；两个插件谁先加载就变结论 |
| B. 显式开关（已实现 `governance.*`） | 行为可读、可回滚、可逐项验证 | 用户要知道该关哪个 |
| C. 两者都做 | 兼顾 | 复杂度翻倍，退让规则本身也要测试 |

选择 B 的理由：这两个插件都在改「模型能看到什么」，一旦叠加，问题会表现为「输出莫名变短」，
排查成本极高。显式开关至少让「为什么短」有一个确定答案。

代价是用户需要知道该关哪一个，所以补充两条廉价措施：

1. 启动时如果检测到 `dsh-context` 也在运行，且 `governance.redaction/injection` 同时开启，
   在日志里 warn 一次（不改变行为）；
2. `runtime_kit_health` 输出里标出当前治理开关与检测到的同类插件。

「检测同类插件」用 `ctx.get('pluginManager')` 或读 `package.json` 的 bundles 即可，
不需要新依赖；是否要做，等二期 1 真正落地后再决定——现在两边都还没动返回体的大小。

---

## 三、二期 1 方案：工具返回体截断（未实施）

### 现状

`tools/post-execute` 目前只做「替换敏感串」，不改长度。工具返回多大，模型就看多大。
最贵的是三类：`read`（整文件）、`grep`（大结果集）、`pwsh`（编译/测试输出）。

### 三个候选

| 方案 | 做法 | 代价 |
|---|---|---|
| A. 硬截断 | 超过预算就切，追加 `…[truncated N bytes]`，全文落到 spill 文件并给出路径 | 会切坏 JSON / 代码；模型可能完全无法用 |
| B. 结构化投影 | 按工具策略表：保留字段、丢列、限行数 | 需要知道每个工具的输出形状，维护成本高 |
| C. LLM 摘要 | 再调用一次模型压缩 | 多一次调用，延迟与费用都上去，不划算 |

**推荐 A + B 的组合**：按工具分类，默认只对「可再取」的文本动手。

### 工具策略表（建议）

| 类别 | 例子 | 策略 |
|---|---|---|
| 文本可再取 | `read`、`grep`、`glob`、`pwsh` | 截断到预算 + 全文写 spill + 提示「完整内容在 `<path>`，可用 offset 或再次检索」 |
| 结构化 | `db_list_objects`、`db_execute_sql` | 限制行数 + 字段投影，超出给「已省略 N 行」 |
| 媒体 | `read_image` | 不截断（本来就是二进制块） |
| 未知工具 | 其他 | 只记账，不截断（保守） |

### 关键决策（需要你拍板）

1. **默认状态**：建议 `mode: "shadow"`——只统计「如果截断能省多少」，不改返回。跑一周看真实收益再开。
2. **spill 落盘**：路径 `<profile>/.runtime-kit/spill/<session>/<callId>.txt`；落盘前必须先脱敏；
   保留期与 `audit.retentionDays` 一致；关掉截断时自动清理。
3. **与 dsh-context 的顺序**：建议 runtime-kit 只做「记账 + spill」，真正的裁剪让 dsh-context 做，
   避免双重截断。这需要先确认 dsh-context 的裁剪触发条件（它已有 4 KB 上限的配置项）。
4. **预算单位**：用字节而不是 token（简单、无需 tokenizer），但每个工具可覆盖，
   例如 `read` 允许 16 KB 而 `grep` 只给 4 KB。

### 落地形态

```jsonc
"context": {
  "truncation": {
    "mode": "off",        // off | shadow | on
    "maxBytes": 4096,
    "spill": true,
    "perTool": { "read": 16384, "grep": 4096, "pwsh": 8192 }
  }
}
```

### 验收指标

- 同一批任务下，输入 token 下降 ≥ 20%，工具调用失败率不上升；
- shadow 期间记录：被截断的调用占比、平均节省比例、`read` 类是否出现「需要二次读取」；
- 一旦出现「模型改用正则再次读取」的比例超过阈值，说明预算给小了。

### 实施顺序（建议）

1. 加 `truncation` 配置与 shadow 记账（约 80 行 + 测试，风险≈0，不改返回）；
2. 跑一周，拿数据决定预算；
3. 开 `read`/`grep` 两类，观察失败率；
4. 最后才动 `pwsh` 与结构化工具。

---

## 四、验证方式

```bash
node test/smoke.mjs        # 47 项：原有能力与命令契约
node test/governance.mjs   # 30 项：脱敏/注入/抽取/沙箱判定/fail-open
```

在真实会话里检查：

- `runtime_kit_audit_logs -l 20` —— 每次工具调用都有一条 `return` 记录；
- `runtime_kit_config` —— 查看 `governance` 段的当前值；
- 把 `governance.sandbox` 打开后调用一个越界路径，确认返回里带 `runtime_kit sandbox` 前缀的拒绝原因。
