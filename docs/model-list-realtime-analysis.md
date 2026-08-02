# 模型列表实时性分析报告

> 调查对象：PiDeck（本地 `src/main/`）+ pi 0.82.1（已装源码 `dist/`）
> 日期：2026-08

## 1. 现状：模型列表怎么来的

### PiDeck 侧（展示列表）
- `fetchModelList()`（`src/main/pi/modelListCache.ts`）：fork `pi --list-models`，解析表格输出
- **每次 fork 都是新进程** → 新进程重新加载 models.json → **列表本身是实时的**
- 但有**全局缓存**（首次后不刷新），需 `invalidateModelListCache()` 才重新 fork
- `--list-models` 的表格解析**丢失字段**：contextWindow/maxTokens/input(images) 都被丢弃，只留 provider/id/name/reasoning

### pi 侧（切换模型校验）
- RPC `set_model` / `get_available_models` / `cycle_model` 都用 `session.modelRuntime.getAvailable()`
- `getAvailable()` 基于 **ModelRuntime 启动时加载的快照**（`ModelConfig.load(models.json)` 在 `create()` 时执行一次）
- **已运行的 pi 进程持旧快照**，RPC 不触发重新加载

## 2. 三个关键问题的答案

### Q1：没启动 Agent 时模型列表为空？
- `pi --list-models` 是独立进程，**不依赖 Agent 启动**
- 列表空的原因是 **`getAvailable()` 只返回"已认证 provider"的模型**（`available = all.filter(configuredProviders.has(provider))`）
- 若 auth.json 无凭据 / 凭据校验失败 → 列表为空
- **与"Agent 是否启动"无直接关系**，与"凭据是否就绪"有关

### Q2：直接解析本地 models.json 可行吗？
**✅ 完全可行且更优**：
- `ConfigManager.getModelsConfig()` 已能读 `~/.pi/agent/models.json`（嵌套 providers 结构）
- 字段完整：`contextWindow / maxTokens / reasoning / input(images) / cost` —— 比 `--list-models` 表格解析全得多
- 读取是同步文件读，**天然实时**（改文件即见），不需要 fork 子进程

### Q3：改 models.json 后 RPC 会报错吗？
**⚠️ 会（在已运行 Agent 内）**：
- `set_model` 用**启动时快照**校验，新加的模型在旧进程里返回 `Model not found: provider/model`
- **但 PiDeck 每次新建 Agent 都 spawn 新 pi 进程** → 新进程重载 models.json → 新模型可用
- 已运行 Agent 内 set_model 新模型 → 报错，直到该 Agent 重启

## 3. 关键限制：pi 没有"刷新模型"RPC

排查 pi 0.82.1 全部 RPC 命令（prompt/steer/abort/set_model/cycle_model/get_available_models/set_thinking_level/...），**没有任何 reload/refresh 命令**。

PiDeck `AgentManager.refreshModels()` 已预留：
- **策略 1**：`reload_config` RPC —— 待 [pi#6890](https://github.com/earendil-works/pi/issues/6890) 合并后自动生效（0.82.1 未合并，会静默跳过）
- **策略 2**（注释）：进程重启 —— 因会打断对话，暂未启用

## 4. 结论与可行方案

### 你的设想：读取本地 models.json 做列表 → ✅ 可行且推荐
改动：
1. `fetchModelList()` 改为优先读 `ConfigManager.getModelsConfig()`（本地 models.json），**保留** `pi --list-models` 作为 fallback（models.json 缺失/解析失败时）
2. 展示字段更丰富（contextWindow/maxTokens 可直接展示在模型选择器）
3. **实时刷新**：models.json 文件变化即生效（可加 file watcher 或每次打开选择器时重读）

### 切换模型：⚠️ 受 pi 快照限制
- **新 Agent**（spawn 新进程）：新模型直接可用，无问题
- **已运行 Agent 内切换**：新模型报 `Model not found`
  - 方案 A：`set_model` 失败时自动重启该 Agent（启用 `refreshModels` 策略 2 或独立实现）—— 会打断当前对话，需提示用户
  - 方案 B：只读列表实时化 + 切换模型时提示"需重启 Agent 生效"（保守）
  - 方案 C：上游 pi 合并 #6890 后，`reload_config` 自动生效（PiDeck 代码已就绪，零改动）

### 推荐落地路径
1. **短期**：列表改读本地 models.json（实时 + 字段全）—— 解决"列表空/不实时"
2. **中期**：`set_model` 失败时自动重启 Agent（带用户确认，避免打断对话）—— 让新模型在已有 Agent 生效
3. **长期**：跟随 pi 上游 #6890，reload_config 自动生效

## 5. 附：关键代码定位

| 位置 | 说明 |
|------|------|
| `src/main/pi/modelListCache.ts` | `fetchModelList` fork `--list-models` + 全局缓存 |
| `src/main/config/ConfigManager.ts:112` | `getModelsConfig()` 读 models.json |
| `src/main/ipc/systemIpc.ts:175` | 模型列表 IPC handler |
| `src/main/pi/AgentManager.ts:1502` | `setModel` 发 RPC（不校验，pi 侧校验） |
| `src/main/pi/AgentManager.ts:1526` | `refreshModels` 策略 1（reload_config，待上游） |
| pi `dist/modes/rpc/rpc-mode.js:363` | `set_model` 用 `getAvailable()` 快照校验 |
| pi `dist/core/model-runtime.js:364` | `refresh()` 会重读 models.json（但 RPC 不触发） |
