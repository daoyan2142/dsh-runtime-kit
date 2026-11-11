# 变更记录

按版本倒序。每条注明了「改了什么」和「为什么」——只写事实，不写宣传语。
从 0.5.0 起逐版记录；0.1.0–0.4.1 依据当时的提交补写。

## 0.14.1 — 2026-11-11 · Documentation: changelog

- 新增本文件，逐版记录从 0.1.0 到 0.14.0 的改动
- README 增加入口

## 0.14.0 — 2026-11-11 · Per-switch impact, measured

- 每个开关下面直接显示它实际做过什么：截断命中次数与节省字节、投影裁掉的行数、历史裁剪可回收与已省、拦截/询问次数、脱敏与注入命中
- 钩子层新增计数器：`redactions`、`injectionHits`、`projectedCalls`、`projectedLines`
- 目的：把「要不要开」的判断从读文档变成看一眼数字

## 0.13.0 — 2026-11-11 · Page ordered by what each switch does to you

- 页面按影响重排为三组：① 基础防护（无风险，默认开）② 上下文节省（改变输出）③ 沙箱保护（可能拒绝），每组带风险徽标
- 三个分散的保存按钮换成单一粘性保存条，出现时说明「有几处未保存」，并带「放弃」
- 顶部新增「套用推荐」：安全项全开，两个省 token 项设为观察，沙箱保持关闭
- 审计流水与注册表折叠到底部，常用数字留在顶部

## 0.12.0 — 2026-11-11 · Its own save button, a shorter audit list

- 修复：上下文治理卡没有保存按钮，改完关面板即丢失（后端一直是好的，是 UI 缺按钮）
- 审计流水改为只看今天（默认 8 条，可展开全部今天），去掉与工具名重复的「动作」列
- 宿主侧新增 `auditToday` / `auditOlder`，按本机时区计算

## 0.11.0 — 2026-11-11 · History pruning, write mode

- `governance.pruner.mode = on`：缩短旧工具返回的文本
- 安全约束：只替换字符串，不删消息、不删块、不改块类型；最近 `keepTurns` 轮不动；认不出结构则零改动
- 认两种形状：`role: 'tool'` 的字符串内容、`content` 数组里的 `tool-result` 块
- 默认仍是 `off`

## 0.10.0 — 2026-11-11 · Pruning observer, honest labels

- `governance.pruner.mode = shadow`：只统计消息条数、角色分布、块类型与「只保留最近 N 轮能省多少」，绝不改写
- 页面上 `pruner / compaction` 与「延迟工具加载」改为「宿主负责」——此前显示「开」只表示配置值是 true
- schema 描述同步写明哪些字段在当前版本不生效

## 0.9.0 — 2026-11-11 · Snapshot policy table, line projection

- `sandbox.snapshotPolicy`：按工具声明参数里的路径字段，支持 `arguments.path` 与 `files[].path`；未登记的工具仍回落启发式
- `governance.projection`：按工具限制展示行数（整行裁剪，切点有标注），与按字节截断是两个维度

## 0.8.0 — 2026-11-11 · Audit retention, trash restore

- 修复：`audit.retentionDays` 从未被使用——`Audit.cleanup()` 写好了但无人调用，现在安装时执行一次
- 回收站可恢复：每个时间戳目录写入 `.index.json` 记录原路径，页面列出最近 6 份
- 覆盖需二次确认（先返回 conflict，再点一次才写），避免覆盖是这类功能的初衷

## 0.7.0 — 2026-11-11 · Trash keeps its own house

- `sandbox.trashRetentionDays`（默认 7）与 `trashMaxMB`（默认 256），启动时按时间与总量清理
- 页面显示回收站文件数与占用，并提供「清空」
- 占用按真实 `stat` 统计，索引文件不计入

## 0.6.0 — 2026-11-11 · Snapshots before writes, realpath, trust

- `backupEnabled` / `deletionProtection` 生效：写/删之前把目标文件复制到 `<stateDir>/trash/<时间戳>/`，8 MB 上限，失败不阻断
- 指标改为从审计流水派生（调用、拦截、脱敏、截断、回收站副本、最忙工具）
- `resolveAndValidate` 增加 realpath 校验：指向工作区外的 junction 即使字符串在根内也会被拒
- `workspaceTrust` 生效（未信任 = 只读），默认改为信任

## 0.5.0 — 2026-11-11 · P0: configurable sandbox

- 工作区可配置，`verifyIsolation` 换成真实探测（不再谎报全通过）
- `sandbox.commandDefault`：未命中规则时的默认行为
- 沙箱开关前置于判定，无工作区时拒绝打开
- README 能力矩阵改为三态（✅ / ◐ / ✗），不再给未实现的能力打勾

## 0.4.1 — 2026-11-11 · Glob and version fixes

- 沙箱路径匹配规范化分隔符：`secrets\key.txt` 与规则 `secrets/**` 之前永远匹配不上
- 健康检查的版本号改为从 `package.json` 读取，不再硬编码

## 0.4.0 — 2026-11-11 · Governance on platform tool calls

- 上下文治理真正作用于平台工具调用（`tools/post-execute`），带开关

## 0.3.3 — 2026-11-11 · Show context governance on the page

- 页面展示上下文治理及其真实作用域

## 0.3.2 — 2026-11-11 · Drop the BOM

- 去掉 `package.json` 的 BOM：BOM 会让插件管理器 `JSON.parse` 失败，整个插件被判为 missing

## 0.3.1 — 2026-11-11 · Page at sidebar width

- 页面适配侧栏宽度：标签换行、审计表不再被裁切

## 0.3.0 — 2026-11-11 · First page

- 第一个页面：治理开关、审计流水、注册表

## 0.2.0 — 2026-11-11 · Governance hooks

- 治理钩子：审计、脱敏、注入检测、沙箱拦截

## 0.1.1 — 2026-11-11 · Schema fix

- 修复 `config.schema.json` 里一个缺失引号——整个文件不是合法 JSON

## 0.1.0 — 2026-11-10 · First release

- 上下文治理、快路径模板、PTC、沙箱、审计；10 个 `runtime_kit_*` 斜杠命令
