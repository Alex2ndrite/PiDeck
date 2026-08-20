# PiDeck Delegation Plan

## 0. 目标与设计原则

Delegation 的目标不是在 PiDeck 中复制传统 Harness 的隐藏 sub-agent 系统，而是建立一种**显式、可见、可恢复的多 Session 委托关系**。

核心模型：

```text
PiDeck
├─ Main Session · Sol
├─ Worker Session · Luna
├─ Explore Session · Sol
└─ Review Session · Sol
```

每个 child 都是普通、完整的 Pi session：

- 使用现有 `pi --mode rpc`；
- 由 Pi 自己负责模型、工具、会话、compaction；
- 可以在 PiDeck 中直接打开完整对话；
- 用户知道它使用什么模型、收到什么任务；
- Delegation 只描述 Session A 与 Session B 的关系，不复制 transcript，不成为第二套 Agent runtime。

### 核心边界

1. **PiDeck 是可见的 orchestration owner**。
2. **Pi session JSONL 是 conversation 的唯一真相来源**。
3. **Fresh context 默认优先**，不要默认复制主会话全部历史。
4. **子会话必须可直接打开和人工干预**。
5. **结果回传必须显式可见**，禁止隐藏 summary 注入 parent。
6. **第一版不做递归 delegation**。
7. **不要把 `pi-subagents` 作为 P1 的隐藏 runtime**；它只作为后续可复用的 preflight / locking / async supervision 参考或可选 backend。
8. **严格 P1 → P6 递进**。当前 Phase 完成后停止，不顺手实现后续阶段。

---

# 1. 非目标

除非进入对应 Phase，否则不要实现：

- 隐藏 sub-agent tool；
- 自动多 Agent fan-out；
- child 自动再 spawn child；
- 自动 reviewer；
- 自动 summary 注入 parent；
- 多 writer 共享同一 working tree；
- 完整 workflow DSL；
- Mission / DAG / Agent Team 系统；
- 为 Delegation 重新实现 Pi 的 tool/model/session/compaction 生命周期；
- 为“验证 Delegation”重新测试 Pi 已有的全部能力。
- 没有提到的测试要求。

---

# 2. 数据原则

Delegation 只保存关系元数据，不保存 conversation。

建议最小模型：

```ts
interface DelegationRecord {
  id: string;

  parentSessionId: string;
  childSessionId: string;

  task: string;
  role: "explore" | "implement" | "review" | "consult";

  model?: string;

  contextMode: "fresh" | "selected" | "fork";

  workspace: {
    mode: "shared" | "worktree";
    path: string;
  };

  createdAt: number;
}
```

不要在 P1 提前引入复杂状态机。

运行中 / 停止 / 错误等实时状态优先复用现有 SessionRuntime 状态投影，而不是再维护：

```text
starting → running → waiting → completed → failed → cancelled
```

这样一套容易发生竞态的第二状态机。

如果后续确实需要 Delegation 自己的 durable lifecycle，再在 P2/P6 单独设计。

---

# 3. Context 模式

最终支持：

```text
fresh
selected
fork
```

但分阶段实现。

## Fresh

默认。

Child 只收到：

```text
Task Brief
+ 项目 AGENTS.md / Skills / Extensions
+ Repository
```

然后自己用 FastCtx / repo 重新获取代码上下文。

## Selected

用户明确选择 parent 中少量消息作为额外上下文。

不要复制整段 raw transcript；由 `DelegationBriefBuilder` 生成结构化 brief。

## Fork

完整 fork Pi session。

只作为高级选项，复用 Pi 自己的 fork/clone/session 能力，不手工复制 JSONL。

---

# 4. Delegation Presets

最终仅提供四种 preset，不建立十几个“人格 Agent”。

## Explore

- 目的：代码调查、架构理解、文件/符号定位。
- 默认 fresh。
- read-only。
- shared workspace。

## Implement

- 目的：明确实现任务。
- 默认 fresh / selected。
- writer。
- P3 起默认 isolated worktree。

## Review

- 目的：独立审查实际代码 / diff。
- 默认 fresh。
- read-only。
- 尽量只给“原始需求 + 实际代码 + diff”，避免被 worker 解释 anchoring。

## Consult

- 目的：架构/调试第二意见。
- 默认 fresh。
- read-only。

---

# 5. 最小验证总则

Delegation 开发必须遵守项目 `AGENTS.md` 的最小验证策略。

默认每个 Phase 只允许：

1. `npm run typecheck` 一次；
2. 与该 Phase 新增核心规则直接相关的少量定向测试；
3. 若该 Phase 修改了 Electron / IPC / session 启动路径，最多一次人工 smoke。

默认禁止：

- `npm test`；
- `npm run test:serial`；
- 全量 Playwright/Electron E2E；
- 真实付费模型自动化 E2E；
- Windows / WSL 双平台测试矩阵；
- 为测试修复 `node_modules`、optional binary、TEMP、PATH、CI；
- 因无关 flaky 修改既有测试或产品代码。

如果定向验证通过而全仓库其他部分存在问题，**当前 Phase 仍可结束**。无关问题记录为 follow-up。

---

# P1 — Session Relationship MVP

## 目标

只证明一件事：

> 一个正常 Pi session 可以从另一个正常 Pi session 被显式创建为 child，并且 PiDeck 能持久化、展示这层 parent → child 关系。

P1 是 **Session Relationship**，不是完整 Delegation runtime。

## 必须实现

1. 新增最小 `DelegationRecord` 持久化。
2. 复用 PiDeck 现有 Pi RPC / session infrastructure 创建一个 **fresh 普通 Pi session**。
3. Delegate UI 最少支持：
   - Task；
   - Role；
   - Target Model（因为 Main Sol → Worker Luna 是核心用例）。
4. P1 只支持：
   - `contextMode = fresh`
   - `workspace = shared`
5. 创建 child 后，将 task 作为它的首条正常 user prompt。
6. 记录：
   - `parentSessionId`
   - `childSessionId`
7. Sidebar / Session UI 能看出 parent → child 关系。
8. 点击 child 后进入原本的正常 `SessionView`，不创建特殊 transcript renderer。
9. PiDeck 重启后，parent-child 关系仍可恢复。
10. Child 仍由现有 session/runtime 入口进行正常 stop / send / resume 操作；P1 不额外复制这些能力。

## P1 明确不做

- Selected context；
- Fork；
- Worktree；
- Return to Parent；
- 自动 completed/failed lifecycle；
- Delegation 专属复杂状态机；
- thinking override；
- 并发 delegation orchestration；
- 同一 parent 并发策略；
- agent-proposed delegation；
- recursive delegation；
- capability profile；
- preflight；
- reviewer；
- async supervision；
-真实 provider 自动化 E2E。

## P1 验证

只做：

1. `npm run typecheck`
2. 1～2 个直接测试：
   - Delegation relation 能保存并重载；
   - parent/child tree projection 或创建契约中的核心纯逻辑。
3. 一次人工 smoke：
   - 打开开发 PiDeck；
   - 从 Main 创建一个 fresh child；
   - child 出现在 sidebar；
   - 能打开 child；
   - child 能正常收到 task；
   - 重启应用后关系仍存在。

**不要为 P1 建完整 Playwright E2E。**
**不要分别验证 FastCtx、compaction、tool card、thinking、所有模型行为。**

只要 child 走的是现有普通 Pi runtime，就视为继承 Pi 已有能力。

P1 达成后立即停止，等待用户确认再进入 P2。

---

# P2 — Explicit Handoff

## 目标

让 child 的结果可以**显式、可见、有限长度地**返回 parent。

## 实现

1. Child 页面提供 `Return to Parent`。
2. 生成可编辑 handoff：
   - Task
   - Result
   - Changed files（若可获得）
   - Validation（若可获得）
   - Child session link / id
3. Handoff 以正常可见消息加入 parent。
4. 不自动复制 child transcript。
5. 不隐藏注入 summary。
6. 可以增加很轻量的 Delegation 展示状态，例如：
   - active
   - returned
   但不要建立完整进程状态机。

## P2 验证

- typecheck；
- handoff formatter 的定向测试（若为纯函数）；
- 一次人工 `child → Return to Parent → parent` smoke。

不跑全量 E2E。

---

# P3 — Selected Context + Worktree

P3 分两部分。

## A. Selected Context

实现：

```text
Fresh
Selected
Fork
```

### Selected

用户选择 parent 中少量消息。

由 `DelegationBriefBuilder` 生成：

```text
Task
Selected context
Constraints
Acceptance criteria
Relevant files (optional)
```

### Fork

复用 Pi 的原生 fork/clone/session 能力。

禁止手工复制完整 JSONL。

## B. Worktree

Implement preset 支持 isolated worktree：

```text
create
inspect diff
integrate/cherry-pick
discard
cleanup
```

Writer child 的 cwd 指向自己的 worktree。

PiDeck 拥有 worktree 生命周期，不交给隐藏 Agent runtime。

### Worktree 安全

- 多 writer 不共享同一工作树；
- discard 前停止相关 child / background job；
- 不共享或跨平台混用同一 `node_modules`；
- 不为了测试 worktree 自动重建依赖。

## P3 验证

- context brief builder 的纯函数定向测试；
- WorktreeManager 的最小路径测试（优先临时 Git repo）；
- 一次人工 worker worktree smoke。

---

# P4 — Capability Profiles + Preflight

## 目标

将角色从“人格 prompt”收敛为明确能力配置。

## Profiles

### Explore / Review / Consult

read-only：

- FastCtx inspect
- grep
- glob

必须从能力层面不可写，而不是只靠提示词说“不要修改”。

### Implement

允许：

- FastCtx inspect/grep/glob；
- FastCtx run / background jobs（如需要）；
- FastCtx deterministic replace；
- 语义编辑工具（如 apply_patch）。

## Preflight

Spawn 前检查：

- model available；
- provider authenticated；
- cwd exists；
- required extensions/tools available；
- FastCtx available；
- worktree 可创建（若需要）。

可以研究/复用：

```text
pi-subagents/preflight
pi-subagents/capability-ceiling
```

不要重新实现复杂 agent discovery / MCP resolution，除非现有 API 无法使用。

## P4 验证

只测试 profile resolution / preflight adapter 的核心纯逻辑。

不为每个工具建立真实 E2E。

---

# P5 — Agent-Proposed Delegation

## 目标

Main Agent 可以**建议**委托，但不能静默启动另一个模型。

实现：

```text
propose_delegation
```

而不是：

```text
spawn_subagent
```

提议内容：

- task
- role
- suggested model
- context
- workspace
- reason

PiDeck 显示 approval：

```text
Reject
Edit
Delegate
```

默认：

```text
Ask before every delegation
```

后续可增加：

```text
Auto-allow read-only delegation
```

但 writer 默认仍需确认。

Child 默认不能 propose/spawn grandchild。

### Parent Timeline Delegation Event

当 Delegation 由 parent Agent 的 response / proposal 触发并成功创建 child 后，
必须在 parent session 的 timeline 中留下一个持久、用户可见的 Delegation event。

该事件至少显示：

- child role；
- target model / display name；
- task 的简短摘要；
- 当前状态（active / returned / failed 等适合当前阶段的状态）；
- 可点击的 child session 跳转入口。

点击该事件必须直接打开对应 child session。

该事件不是 assistant/user 聊天消息，不应伪造或修改 Pi transcript。
应由 PiDeck 使用 DelegationStore 与 parent session entries 做 timeline projection。

DelegationRecord 应保存足以恢复该投影的 parent timeline anchor
（例如 `triggeredByEntryId` / `sourceEntryId`）。

应用重启后，该事件必须仍能在原位置恢复。

Delegation 完成后不得删除该记录；它是 parent conversation 的永久可观察历史。

## P5 验证

- proposal schema / IPC 定向测试；
- 一次人工 approval smoke。

---

# P6 — Advanced Delegation

只有 P1-P5 稳定后才进入。

候选能力：

- background delegation；
- parallel delegation；
- automatic reviewer（可选且默认关闭）；
- retained child resume；
- usage / concurrency budget；
- async supervision；
- richer status projection；
- optional `PiSubagentsBackend`。

## Optional backend abstraction

如果后期确实需要，可形成：

```ts
interface DelegationBackend {
  create(spec: DelegationSpec): Promise<DelegationHandle>;
  steer(id: string, message: string): Promise<void>;
  cancel(id: string): Promise<void>;
  resume(id: string, message: string): Promise<void>;
}
```

默认：

```text
NativePiBackend
```

使用 PiDeck 自己现有的 Pi RPC infrastructure。

可选：

```text
PiSubagentsBackend
```

复用 `pi-subagents` 的：

- structured delegation API；
- preflight；
- async supervision；
- resume locking；
- capability ceiling；
- budget semantics。

无论 backend 如何变化：

- child 仍必须是用户可见完整 session；
- PiDeck 仍是 UI/orchestration owner；
- 不允许退回不可观察黑盒 subagent。

---

# 6. 性能原则

1. DelegationStore 不保存 transcript。
2. Inactive child 不持续全量渲染。
3. Session JSONL 是 source of truth，UI 只做 projection。
4. Streaming 更新只影响对应 session。
5. Delegation sidebar 只保存必要 metadata。
6. 不因 parent 有多个 child 就加载所有 child history。

---

# 7. 透明性原则

必须始终满足：

1. 创建 child 是用户可见事件；
2. 模型可见；
3. context mode 可见；
4. workspace 可见；
5. child session 可直接打开；
6. tool call / 修改 / reasoning summary 仍按普通 PiDeck session 展示；
7. Return to Parent 内容可见；
8. 不存在隐藏 transcript 注入；
9. 默认不允许 recursive delegation。
10. 由 Agent 发起的 Delegation 必须在 parent timeline 中留下持久、可点击的可视记录；sidebar 中出现 child 不能是用户知道它存在的唯一途径。

---

# 8. 当前执行阶段

**当前阶段为 P3 — Selected Context + Worktree，已实现，等待用户验收；P1/P2 已交付。**

**P3 完成后等待用户验收；P4-P6 不得推进。**
**不要因为发现无关测试或环境问题而修复它们。**
**不要自行运行全量测试。**
**不要自行重装或修复 node_modules。**
