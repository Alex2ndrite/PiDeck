# 内置安全模块规划（Security Guard Extension）

> 状态：规划中（未实现）。目标：为 PiDeck 内置一个默认关闭、可逐会话开关的
> 「危险操作确认」安全扩展，复用桌面端已有的 Ask 提问卡片与桌面通知能力。

## 一、调研结论：pi 生态怎么做权限控制

pi 核心刻意不做权限控制（YOLO 模式），把能力交给扩展系统。社区已有十余个
权限/安全扩展，核心机制完全一致：

```ts
// 官方示例（badlogic/pi-mono packages/coding-agent/examples/extensions/permission-gate.ts）
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "bash") return undefined;
  const command = event.input.command as string;
  const isDangerous = dangerousPatterns.some((p) => p.test(command));
  if (isDangerous) {
    if (!ctx.hasUI) {
      return { block: true, reason: "Dangerous command blocked (no UI for confirmation)" };
    }
    const choice = await ctx.ui.select(`⚠️ Dangerous command:\n\n  ${command}\n\nAllow?`, ["Yes", "No"]);
    if (choice !== "Yes") return { block: true, reason: "Blocked by user" };
  }
  return undefined; // undefined = 放行
});
```

**tool_call 钩子返回值语义**（协议约定）：
- `undefined` → 放行；
- `{ block: true, reason }` → 阻断，reason 会作为工具错误返回给模型；
- 调用 `ctx.ui.select/confirm/input` → 走 RPC Extension UI 协议，桌面端渲染成
  Ask 提问卡片，用户确认后继续或阻断。

**社区扩展清单与可借鉴点**：

| 扩展 | 亮点 |
|---|---|
| `pi-permission-suite` | Act/Auto/Ask/Plan 四模式 + 规则引擎 + `/approval-mode` 命令 |
| `MasuRii/pi-permission-system` | 工具可见性裁剪（agent 看不到未授权工具）+ 运行时确认 |
| `majorgilles/pi-permissions` | ask 模式对 write/edit 显示只读 diff + Allow/Deny |
| `jandrikus/pi-security-gates` | 分层（open/standard/secure）+ 项目边界 |
| `Guanzhw/pi-access-guard` | allow/ask/deny 三态策略 + 路径解析 |
| `Firstp1ck/pi-extension-safety-guard` | `/safety-guard on|off|status` 会话级开关 + SQL 规则 |
| `pi-perm` | config.toml 权限 profile（文件系统 read/write/deny + 网络边界） |
| `mwolff44/pi-secured-setup` | 审计日志 + 边界守卫 + 受保护路径 |

## 二、设计目标与原则

1. **默认关闭**：与 PiDeck 现有行为完全一致，零回归；用户显式开启后才拦截。
2. **复用现有能力**：确认弹框 = 现有 `pi-deck-ask-question.ts` 的 Ask 卡片
   （RPC UI 协议）；非聚焦会话的确认请求自动触发桌面通知（本次已实现
   `sessions:set-focused-session` + `notifyAskPending`）。
3. **单层防线**：只做 tool_call 时机的确认/阻断，不做工具可见性裁剪
   （裁剪会让 agent 行为不可预测，且与 pi 渐进披露理念冲突）。
4. **规则可配置**：危险命令模式、受保护路径、敏感文件在扩展内集中定义，
   后续升级为设置页可视化编辑。
5. **会话级开关**：`/safety on|off` 命令 + 设置页全局开关，二者叠加。

## 三、架构

```
resources/extensions/pi-deck-security-guard.ts   ← 内置扩展源文件
    │
    ├─ pi.on("tool_call")                          ← 拦截点
    │    ├─ bash    → 危险命令模式匹配（rm -rf / sudo / chmod 777 / curl|sh / git push -f / 磁盘格式化 …）
    │    ├─ write/edit → 受保护路径匹配（.env* / ~/.ssh / id_rsa / .git/config / 密钥文件 …）
    │    ├─ read    → 敏感文件读取确认（可选级别）
    │    └─ 命中 → ctx.ui.confirm(风险说明 + 命令/路径 + Allow/Deny)
    │              └─ 拒绝 → return { block: true, reason }
    │
    ├─ /safety 命令                                ← 会话级开关（on/off/status）
    ├─ session_start / session_end                 ← 会话开关状态清理
    └─ settings 读取                                ← 全局默认（PiDeck 设置下发为扩展配置）

src/main/settings/SettingsStore.ts                ← 新增 securityGuardEnabled（默认 false）
src/renderer/src/config/SecurityTab.tsx（或并入 TrustTab）← 设置页：全局开关 + 规则预览 + 说明
```

### 扩展与设置的联动

PiDeck 内置扩展是部署到 `~/.pi/agent/extensions/` 的 `.ts` 文件（见
`src/main/index.ts` 的 `ensurePiDeckExtension`）。扩展无法直接读桌面设置，
采用**扩展配置环境变量**或**写入 pi settings.json** 两种方案（实现时二选一）：

- 方案 A：AgentManager 启动 pi 进程时注入 `PIDECK_SECURITY_GUARD=1` 环境变量
  （`sanitizePiChildEnv` 允许白名单变量）；扩展启动时读取 `process.env`。
- 方案 B：扩展读取 `~/.pi/agent/settings.json` 中的自定义键
  （`pideckSecurityGuard: true`），由桌面端写入。

推荐方案 A：环境变量随 Agent 启动快照，会话内改动即时生效、无文件并发问题。

## 四、规则集（v1 草案）

### 4.1 危险 bash 命令（命中即确认）

```
/\brm\s+(-rf?|--recursive)\b/i
/\bsudo\b/i
/\b(chmod|chown)\b.*777/i
/\b(?:mkfs|format)\b/i                       # 磁盘格式化
/\bcurl\b.*\|\s*(?:ba)?sh\b/i                # curl | sh 管道执行
/\bgit\s+push\b.*(-f|--force)\b/i            # 强制推送
/\b(?:dd|fdisk)\b/i                          # 底层磁盘操作
/\b>.*\/etc\/passwd\b/i                      # 系统关键文件覆写
```

### 4.2 受保护路径（write/edit 命中即确认）

```
\.env(\.\w+)?$          # 环境变量/密钥文件
(^|[/\\])\.ssh[/\\]     # SSH 私钥目录
id_rsa|id_ed25519|\.pem$
\.git[/\\]config$       # git 配置（hooks/远程地址）
\.pi[/\\](?:settings\.json|config\.toml)$   # pi 自身配置
```

### 4.3 敏感读取（可选：仅「secure」级别开启）

```
\.ssh[/\\].*(?:key|pem)$
\.aws[/\\]credentials$
```

## 五、UI 交互

1. **确认卡片**：完全复用现有 Ask 卡片（`SessionRuntimeUiOverlay`）。
   卡片标题带 ⚠️ 图标与红色描边（新增 `notifyType: "warning"` 变体，
   ask-question 扩展的 confirm 已支持 description）。
2. **桌面通知**：非聚焦会话触发确认时，走本次实现的
   `notifyAskPending` 系统通知，点击通知聚焦窗口。
3. **设置页**：TrustTab 增加「危险操作确认」区块：
   - 全局开关（默认关）；
   - 规则类别勾选（危险命令 / 受保护路径 / 敏感读取）；
   - 「当前会话已开启」状态提示与一键开启按钮。
4. **会话命令**：`/safety on|off|status`——在 composer 输入即可切换当前会话。

## 六、实施里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| M1 | 扩展骨架：tool_call 钩子 + 危险 bash 规则 + ctx.ui.confirm | 手动：rm -rf 触发确认卡片；拒绝后模型收到 reason |
| M2 | 受保护路径规则 + 会话开关 `/safety` | write 到 .env 触发确认；/safety off 后放行 |
| M3 | 设置联动（环境变量注入 + TrustTab 开关） | 设置关闭时扩展完全不拦截（零回归） |
| M4 | 非聚焦通知 + 通知点击聚焦 | 切走会话后另一会话触发确认 → 系统通知 |
| M5 | 规则可视化编辑 + 审计日志（扩展内 console/log 事件） | 设置页可勾选规则类别 |

## 七、风险与边界

- **确认疲劳**：只对高置信危险模式拦截；普通 write/edit 不拦（v1）。
- **绕过风险**：模型可先用非危险命令变体（如 `rm -r` 不带 -f）——规则覆盖
  常见变体即可，追求「降低事故概率」而非「绝对安全」。
- **与三方权限扩展冲突**：若用户安装了 ask 类三方扩展，走
  `BUILT_IN_CONFLICT_KEYWORDS` 自动让位机制（与 ask-question 相同）。
- **非交互模式**：`ctx.hasUI === false` 时直接 `{ block: true, reason }`，
  不挂起等待。
