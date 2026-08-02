感谢反馈！我们对这个问题做了完整排查（包括比对 pi 0.82.1 的源码），结论是：**这不是 PiDeck 的问题，而是 pi 上游 0.80.7+ 的行为变化 + 模型训练数据截止日期共同导致的现象**。下面给出详细原因、验证方法和工作区。

## 根因分析

### 1. pi 从 0.80.7 起，不再把「当前日期」注入系统提示词

pi 在 [0.80.7](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/CHANGELOG.md)（2026-07-14 发布）做了一项改动：

> Fixed system prompt cache invalidation across dates by removing the current date from the default prompt (#6621)

也就是说，为了保持 LLM 的 prompt prefix cache 跨日期可复用（避免每天都命中不了缓存、拖慢响应），pi **把默认系统提示词里的 `Current date: YYYY-MM-DD` 这一行移除了**。

你当前用的 pi 0.82.1（2026-07-25 发布）已经不包含这行日期。我们在本地安装的 pi 0.82.1 源码中验证过：`dist/core/system-prompt.js` 生成的系统提示词只包含工具列表、行为准则和 `Current working directory`，**没有任何日期信息**。

### 2. PiDeck 不会注入日期，也不会修改系统提示词

PiDeck 启动 agent 的完整方式就是：

```
pi --mode rpc --no-themes --offline [--session <path>]
```

模型选择、模型配置、系统提示词全部来自 pi 本身（同一份 `~/.pi/config.json`），PiDeck 只做 stdin/stdout 的 JSON-RPC 转发，**不注入日期、不改写提示词、不改模型、不改搜索行为**。这也是项目架构边界：pi 的事 PiDeck 不做。

### 3. 模型「不知道今天几号」，只能按训练截止时间锚定

因为 pi 不再告诉模型当前日期，模型回答「目前美股怎么样」这类问题时，会锚定到**自身训练数据的截止时间**。很多模型的训练截止在 2025 年中，于是它把 2025-07 当作「最近」，返回的就是 2025 年 7 月的美股情况——在你 2026-07-30 提问时，看起来就是「去年今日」。这与 PiDeck 无关，CLI 端换成同一个 pi 0.82.1 + 同一个模型，也会得到同样的结果。

## 为什么 CLI 端没遇到？

CLI 和桌面端用的是同一个 pi 和同一份配置，区别通常来自以下之一：

- **CLI 终端里的 pi 还是旧版本**（≤ 0.80.6，仍会注入当前日期）；或
- **两端选择的模型不同**（桌面端模型选择器里可能选到了知识截止更早的模型）；或
- 所用模型的 API 通道在**服务端注入了日期**（部分 OpenAI 系模型的 Responses API 会在服务端自动附加当前日期，此时无论 CLI 还是桌面端都正常）。

## 如何验证

在 PiDeck 里新建 agent 后，直接问一句：**「今天是哪一天？」** 如果模型答错日期，或回答「我的知识截止于 2025 年 X 月」，即可确认根因（模型拿不到真实日期）。

## 解决办法（任选其一）

1. **提问时带上日期**：`今天是 2026 年 7 月 30 日，请查一下目前美股行情`
2. **让 agent 先查系统时间再搜索**：`先运行 date 命令获取今天的日期，再搜索目前美股行情`（agent 有 bash 工具，能拿到真实日期）
3. **加一份全局追加提示词**：在 `~/.pi/agent/APPEND_SYSTEM.md` 写入：
   ```md
   当用户询问任何"当前/最新/最近"的信息时，先用 bash 执行 date 命令确认今天的日期，再开始回答或搜索。
   ```
   这样所有会话都会自动先校准日期（pi 原生支持 `~/.pi/agent/APPEND_SYSTEM.md`，追加到默认提示词、不替换）。
4. **换用知识截止更新、或服务端注日期的模型**。

## 结论

- 该现象是 **pi 0.80.7 移除系统提示词日期（#6621）+ 模型训练截止时间** 共同导致，PiDeck 只是忠实转发，无任何日期/提示词干预。
- 如果你希望 pi 恢复注入当前日期，建议到 [earendil-works/pi](https://github.com/earendil-works/pi) 提 issue 反馈（上游已有相关讨论：[#2559](https://github.com/earendil-works/pi/issues/2559)、[#2814](https://github.com/earendil-works/pi/issues/2814)）。

我先关闭这个 issue。如果按上面方法验证后仍有问题，欢迎在 issue 下继续回复，我们会重新打开处理。
