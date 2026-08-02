# Vercel AI SDK 在 PiDeck 的可行性分析

> 版本：2026-08 · 基于 AI SDK v5（`ai` + `@ai-sdk/react`）与 PiDeck 当前代码（0.7.0-beta 分支）
> 结论先行：AI SDK 在 PiDeck 的**唯一高价值整合点是 Web 服务聊天前端的流式化**；桌面 renderer、飞书卡片已自研流式且更贴合 pi 事件模型，不建议替换；直调 LLM 的"辅助 AI"功能与 AGENTS.md 架构边界冲突，需产品决策后才值得做。

---

## 1. 背景：PiDeck 的 AI 架构现状

PiDeck 的核心边界（AGENTS.md 硬性规定）：**pi 负责 Agent 行为、工具调用、会话读写、模型调用；PiDeck 只做窗口/进程/会话浏览/Git/终端**。两者通过 stdio JSON-RPC 通信。

当前代码里"AI 触达面"只有三个，且**全部不直接调用 LLM**：

| 触达面 | 实现 | 流式能力 | 模型调用 |
|--------|------|----------|----------|
| 桌面 renderer | 自研 streamdown 渲染 + Jotai + streamGate 防串台 | ✅ 文本/思考/工具调用全流式 | ❌ 走 pi RPC |
| Web 服务 (`WebServiceManager`) | 内嵌 vanilla JS 单页（HTML 模板字符串） | ❌ **600ms 轮询** `/api/state` | ❌ 走 pi RPC |
| 飞书桥接 (`FeishuBridge` + `CardStream`) | CardKit 2.0 流式卡片 | ✅ 骨架卡→实时更新→终态 flush | ❌ 走 pi RPC |

已核实：`src/main/` 下无 `openai`/`anthropic`/`chat/completions`/`fetch(LLM)` 直接调用；`ClaudeSessionImporter` 只解析本地 JSONL；`PiProxyTester` 只测代理连通性。

**这意味着**：AI SDK 的"Core 直调"能力在 PiDeck 主链路里没有用武之地——除非新增"不经 pi 的独立 AI 功能"，而那正是架构边界禁止的（详见 §4-B）。

---

## 2. Vercel AI SDK 全景（哪些是我可用的）

AI SDK v5 分四层，逐层对照本项目：

### 2.1 Core 层（`ai` 包）
- `generateText` / `streamText` —— 单次/流式文本生成
- `generateObject` / `streamObject` —— **结构化输出**（Zod/JSON Schema 校验）
- `embed` / `embedMany` —— 向量嵌入（语义检索前置）
- `ToolLoopAgent` —— 多步工具循环 agent（自带 stop 条件、运行时上下文、工具审批）
- MCP 客户端 —— 从 MCP server 拉工具/资源/提示词

### 2.2 UI 层（`@ai-sdk/react`）
- `useChat`：消息流式渲染、**状态机**（submitted/streaming/ready/error）、**stop 停止 / regenerate 重试 / setMessages 编辑**、throttle 节流、事件回调（onFinish/onError/onData）
- 消息 `parts` 模型：text / reasoning（思考）/ tool-invocation（工具调用）/ file / source（引用来源）——比裸字符串能表达更多结构
- Transport 抽象：
  - `DefaultChatTransport`（HTTP + AI SDK 流协议）
  - `TextStreamChatTransport`（纯文本流，兼容任意后端）
  - `DirectChatTransport`（进程内直连 `ToolLoopAgent`，**不走 HTTP**）

### 2.3 协议层
- `createUIMessageStreamResponse` / `toUIMessageStream` / `convertToModelMessages` —— 服务端把模型流封装成 AI SDK 标准流（SSE），前端统一 `useChat` 消费
- 好处：**协议统一**。无论后端是 OpenAI、Anthropic 还是自研 RPC，只要输出这个协议，前端体验一致

### 2.4 Provider 生态
- `@ai-sdk/openai` / `@ai-sdk/anthropic` / `@ai-sdk/google` …
- `@ai-sdk/openai-compatible` —— **对 DeepSeek / GLM / Qwen / one-api / new-api 等 OpenAI 兼容端点尤其重要**（本项目中文用户常用这些）

### 2.5 其他
- Telemetry（OTel 集成）、`ai/eval`（LLM 评估）—— 本项目为本地桌面应用，收益有限，不展开

---

## 3. 候选整合点逐项分析

### A. Web 服务聊天前端流式化 —— ✅ 推荐（唯一高价值点）

**现状痛点**（已从代码核实）：
- `WebServiceManager` 前端是内嵌 HTML 模板字符串，`setInterval(refresh, 600)` 每 600ms 轮询 `/api/state`，`el("messages").innerHTML` 全量重渲染
- 发消息 `POST /api/sessions/:id/prompt` 后只能等下一次轮询才看到回复，**没有打字机效果**；回复期间用户看不到任何进度；消息多时全量重绘会卡

**改动方案（两档，按投入分）**：

**A1 · 协议层流式化（小改动，先拿打字机效果）**
1. `WebServiceManager` 新增 `GET /api/chat/stream?sessionId=...`（或复用 `/api/sessions/:id/prompt` 加 `Accept: text/event-stream`）端点：
   - 订阅 `AgentManager` 的 `agent_start / thinking_delta / text_delta / tool_execution_* / agent_end` 事件（主进程内部已有此事件流，`FeishuBridge` 就是这么消费的）
   - 按 AI SDK **UIMessageStream 协议**（`createUIMessageStreamResponse` 的 SSE 格式）逐段写出
2. Web 前端保持 vanilla JS，用 `fetch` + `ReadableStream` 消费 SSE，增量 append 到消息区（保留现有轮询做兜底/同步历史）

- 改动量：~1 个流式端点 + ~80 行前端消费代码
- 收益：真流式打字效果、实时看到思考/工具调用过程；与后续 A2 完全兼容（协议一致）
- 注意：这一步严格说只是"借用了 AI SDK 的协议格式"，没引入 `useChat`

**A2 · React + `useChat`（完整方案）**
1. 上述流式端点不变
2. Web 前端 React 化：新增 Vite 多入口 `web/`（独立 bundle），`useChat({ transport: new DefaultChatTransport({ api: "/api/chat/stream" }) })`
3. 用 `parts` 模型渲染文本/思考/工具调用/来源；`status` 驱动停止按钮、错误重试；`regenerate` 现成

- 改动量：新增 web 构建链 + 打包进 asar + 前端重写（中等偏大）
- 收益：
  - 状态机（submitted/streaming/ready/error）→ 停止、重试、重生成全部现成，不用手写
  - `parts` 结构化 → 思考折叠、工具调用卡片、引用来源，与桌面体验对齐
  - 摆脱 600ms 轮询（省带宽/CPU，弱网更稳）
  - **多端协议统一**：以后任何新前端（移动端、第三方嵌入）只要实现 AI SDK 流协议即可复用同一套 UI 逻辑
- 风险：web React 化引入构建/体积成本；`WebServiceManager` 现有内嵌单页逻辑需迁移

**结论**：A1 低成本立刻改善体验；A2 是长期正确形态。**建议先做 A1，协议就绪后按需升级 A2。**

---

### B. "快速问答"独立入口（不经 pi 的轻量 AI）—— ⚠️ 架构边界冲突，需产品决策

**现状**：所有对话都必须启动 pi agent 会话（有进程、有会话文件、有工具），对于"选中代码解释一下""生成 commit message"这种轻量请求是重武器。

**AI SDK 可提供的**：`generateText` / `streamText` / `generateObject` 一行调用；配合 `DirectChatTransport` + `ToolLoopAgent` 还能在桌面内嵌一个"不落盘、不走 RPC"的迷你聊天面板；`@ai-sdk/openai-compatible` 直接对接用户已有的兼容端点。

**收益**：秒级响应、不占 pi 会话、结构化输出（如 commit message 直接给 JSON）。

**代价 / 风险（关键）**：
- **违反 AGENTS.md 硬边界**："pi 负责模型调用——pi 的事不要替它做"；"禁止引入第二条通信通道"。直调 LLM = 引入第二条模型通道
- 需要独立的 API key / 模型配置通道与密钥管理（当前模型密钥都在 pi 侧，PiDeck 根本接触不到）
- 与 pi 会话的上下文无法互通（要么重发 context，要么限制只能做无上下文小任务）

**结论**：技术上 AI SDK 是最合适的实现手段，但**是否允许"PiDeck 侧直调 LLM"是一个产品边界决策，不是技术问题**。若产品方向确认要做"轻问答/快捷 AI"，建议在独立模块（如 `src/main/quickai/`）内实现、设置里显式开关，不与 pi 会话链路耦合；若不做，则本项整体搁置。

---

### C. 桌面 renderer 替换为 `useChat` —— ❌ 不建议

**现状**：桌面端已有完整自研方案：streamdown 流式渲染、thinking 流式、工具调用卡片、streamGate 按 generation 封印防串台、队列 flush、节流。这些恰好是 `useChat` 提供能力（消息管理/status/stop/regenerate）的**超集且更贴合 pi 事件模型**（pi 是"推送事件"模型，`useChat` 是"请求-响应"模型，强行套用要写 transport 适配层，把 pi 的 agent_start/text_delta/tool 事件翻译成 UIMessageStream，得不偿失）。

**结论**：桌面端不换。最多借鉴两个思想：`throttle` 节流（已有同类实现）、`parts` 消息模型（未来消息类型扩展时参考其结构设计）。

---

### D. 飞书卡片 —— ❌ 不适用

`CardStream` 已实现 CardKit 2.0 流式卡片（骨架→更新→flush），且飞书卡片 API 与 AI SDK 协议无关。不动。

---

### E. 语义检索 / Embedding —— ⏸ 远期，低优先级

- 会话全文语义搜索需要 embedding 通道 + 向量存储，且 embedding 调用同样属于"模型调用"，与边界冲突
- 当前会话检索是 JSONL 扫描 + SQLite（中文提示词库），够用
- 若未来要"跨会话语义记忆"，建议仍优先在 pi 侧实现（pi 的 compaction/摘要能力已在做），而非 PiDeck 直调 embedding

---

### F. AI SDK 作为"流协议标准"（架构视角）—— ✅ 与 A 绑定，推荐

把 pi RPC 事件翻译成 AI SDK 的 UIMessageStream 协议后，PiDeck 获得一个稳定的"标准 AI 流"接口：

```
pi 事件流 → (适配层) → AI SDK UIMessageStream → 任意前端 useChat
```

收益：
- Web（现在）、未来移动端/桌面内嵌面板/第三方嵌入，全部复用同一协议与 UI 逻辑
- pi 协议演进只影响适配层一处，前端零改动
- 与"禁止第二条通道"不冲突——它仍是同一条 pi RPC 通道，只是**出口协议标准化**

---

## 4. 收益/成本汇总

| 方案 | 改动量 | 收益 | 边界冲突 | 建议 |
|------|--------|------|----------|------|
| A1 Web 流式化（协议层） | 小（1 端点 + 前端 SSE 消费） | 打字机效果、弱网更稳、省轮询 | 无 | ✅ 短期做 |
| A2 Web React + useChat | 中偏大（web 构建链 + 前端重写） | 状态机/停止/重试/parts 结构化、多端复用 | 无 | ✅ 协议就绪后做 |
| B 快速问答直调 LLM | 中 | 秒级轻量 AI | **有（第二条模型通道）** | ⚠️ 需产品决策 |
| C 桌面换 useChat | 大 | 无（自研已是超集） | — | ❌ 不做 |
| D 飞书接 AI SDK | — | 无 | — | ❌ 不做 |
| E 语义检索 | 大 | 远期不确定 | 有 | ⏸ 暂缓 |

---

## 5. 建议路线图

1. **短期（1–2 周）**：做 A1 —— `WebServiceManager` 加流式端点，消费 pi 事件输出 AI SDK SSE 协议；web 前端 vanilla 消费实现打字机效果。顺带把现有轮询降频做兜底。
2. **中期（产品确认后）**：做 A2 —— web 前端 React 化，引入 `@ai-sdk/react` 的 `useChat`，状态机/停止/重试/parts 展示一步到位。
3. **决策点**：是否允许 PiDeck 侧直调 LLM（方案 B）。若允许，用 AI SDK Core + `openai-compatible` 在独立模块实现，且必须在设置中显式开启；若不允许，长期搁置。
4. **远期**：语义检索（E）依赖 B 的边界决策，暂缓。

---

## 6. 附：AI SDK v5 关键 API（供实现时参考）

```ts
// Core：单次/流式/结构化
import { generateText, streamText, generateObject } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
const provider = createOpenAICompatible({ baseURL: "https://api.deepseek.com/v1", apiKey });
const { text } = await generateText({ model: provider("deepseek-chat"), prompt });

// UI：React 端消费
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
const { messages, sendMessage, status, stop, regenerate } = useChat({
  transport: new DefaultChatTransport({ api: "/api/chat/stream" }),
});

// 服务端：把任何流包装成 AI SDK 标准协议（A1/A2 适配层核心）
import { createUIMessageStreamResponse, toUIMessageStream } from "ai";
return createUIMessageStreamResponse({
  stream: toUIMessageStream({ stream: /* 把 pi 事件转成 text/thinking/tool parts */ }),
});

// 进程内迷你 agent（方案 B 若获批）
import { ToolLoopAgent } from "ai";
import { DirectChatTransport } from "ai";
```

---

*本文档仅作可行性评估，不含已落地的代码改动。*
