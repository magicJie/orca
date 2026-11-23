# Orca fork 补丁托管扩展化重构（第一刀：启动管线）

- 日期：2026-11-23；任务：`task_09d6b3b0871c`（ANALYSIS.md §2 推荐顺序第 1 条 / §3.2 A 块 / §4 表第 1 行）
- 角色：omp（dev profile），只做 fork 内实现。没有 PR、issue、远端 ref、prod/updater、policy、部署改动。
- 候选分支：`managed-ext-v1`（worktree `/tmp/orca-managed-ext`），基于 `9d170efe0f`（v1.4.271 + 5 补丁）。本地 main 未动。
- 依据文档：`/data/sre-jay/orca/changes/20261123-orca-patch-upstreaming/ANALYSIS.md`。

## 0. 协调者裁决与范围修正

任务单原文要求扩展「不用 OMP 私有 API（writeSync(1)），用托管扩展公开 API + ACP session/update _meta 通道」。实测该通道不存在，升级上报后协调者裁决走 **C 方案：只迁扩展骨架，私有通知通道收敛到一个最小文件保留**。

**证据**（`/data/jay/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent` 18.13.3 源码 + 生产 `omp` 19.1.0 二进制双重核对）：

1. `ExtensionAPI`/`ExtensionContext` 全部成员只有 `sendMessage`/`sendUserMessage`/`appendEntry`/`registerCommand`/`getServiceTiers`/`setServiceTier`/`setModel` 等，没有 `sessionUpdate`/自定义通知方法。
2. ACP 模式下 `ctx.ui.notify` 只进 `logger.debug`（`acp-agent.ts` `createAcpExtensionUiContext`），`ctx.sessionModes` 为 `undefined`。
3. `pi.sendMessage` 走 `sendCustomMessage` → 进入模型上下文，不产生 `session/update`。
4. OMP 发出的 `sessionUpdate` 枚举全集：`agent_message_chunk`/`agent_thought_chunk`/`user_message_chunk`/`tool_call`/`tool_call_update`/`plan`/`current_mode_update`/`available_commands_update`/`config_option_update`/`session_info_update`/`usage_update`/`compaction_update`/`compaction_summary_chunk`，全部内部硬编码，无扩展入口。
5. `configOptions` 只有 `mode`/`model`/`thought_level`，没有 service tier（19.1.0 二进制确认）。
6. `extNotification` 是客户端→agent 方向且实现为空。

因此 `_orca/omp/options`、`_orca/omp/generation` 两种上报在公开 API 下没有等价物；`writeSync(1)` 通道按裁决保留在最小文件 `orca-omp-native-chat-notify.ts` 中，注释标明随第二刀删除。

## 1. 改了什么

### 新增

| 文件                                                                 | 内容                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/pi/managed-extensions/omp-native-chat-extension-source.ts` | 生成 `orca-omp-native-chat.ts`：**只用公开扩展 API**（`pi.on`/`pi.registerCommand`/`pi.getServiceTiers`/`pi.setServiceTier`/`pi.events`）。承载 `/orca-service-tier` 命令、serviceTierFamily 分类与 OPTIONS 常量（内联复制自 `pi-ai`/`pi-coding-agent`，注释标明镜像）、tier 选项报告数据、generation 累计测量。报告通过会话级共享 `pi.events` 总线发出，本身不碰任何私有通道。 |
| `src/main/pi/managed-extensions/omp-native-chat-notify-source.ts`    | 生成 `orca-omp-native-chat-notify.ts`：**唯一私有通道**，~15 行桥接：`process.argv.includes('acp')` 守卫 + `require('node:fs').writeSync(1, …)`，把总线上的 `orca-omp-options`/`orca-omp-generation` 事件转成 `_orca/omp/options`/`_orca/omp/generation` JSON-RPC 通知。文件头注释「等 OMP configOptions 上游化后删除」。                                                       |

两个文件都带 `@orca-managed-pi-extension` 标记（`withOrcaManagedExtensionMarker`），只在 `kind === 'omp'` 时写入。

### 修改

| 文件                                                             | 改动                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/pi/managed-extensions/titlebar-extension-service.ts`   | `installManagedExtensions` 在 `kind === 'omp'` 时多写上述两个文件。                                                                                                                                                                                                                                                                                                                                                                                            |
| `src/main/pi/managed-extensions/legacy-omp-overlay-migration.ts` | 两个新文件名加入 `MANAGED_EXTENSION_FILES`（旧 overlay 迁移时跳过，视为 Orca 拥有）。                                                                                                                                                                                                                                                                                                                                                                          |
| `src/main/acp/launch/acp-structured-launch-resolution.ts`        | 删除 `extensionSkill`/`extensionPath` 组装；`readAcpLaunchInvocation` 在 `spec.agent === 'omp'` 且账号为本地目录绑定时调用 `piTitlebarExtensionService.installManagedExtensions(agentDir, 'omp')`（ACP 聊天、模型目录探测、at-rest 命令共用此路径；远程宿主场景下该调用与旧 `--extension` 本地路径同样不适用）。                                                                                                                                               |
| `src/main/acp/launch/acp-launch-contract.ts`                     | `AcpLaunchSpec.args` 的 `extensionPath?: string` 删除 —— **与上游完全一致**。                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/main/acp/launch/acp-launch-registry.ts`                     | OMP spec 去掉 `--extension` 拼接 —— **与上游完全一致**。                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/main/acp/discovery/acp-at-rest-commands.ts`                 | 去掉 `extensionPath` 拼接 —— **与上游完全一致**。                                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/main/acp/discovery/acp-model-catalog-probe.ts`              | 去掉 `pluginDir`/`extensionPath`；`pluginDirs` 恢复上游 `[]`（probe/listing 只为 visuals-skill 传插件目录的需求随扩展迁移消失）。残留 diff 只剩补丁 3 的 session-listing 抽取。                                                                                                                                                                                                                                                                                |
| `src/main/acp/discovery/acp-model-catalog-session-listing.ts`    | 输入删掉 `extensionPath` 字段；tierReport/`withOmpServiceTiers`（tier 功能本体）保留。                                                                                                                                                                                                                                                                                                                                                                         |
| `resources/native-chat-visuals/omp-native-chat.mjs`              | **删除**（103 行整文件移出补丁栈）。                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `docs/development.md`                                            | OMP native chat 段落改为描述托管扩展安装。                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 测试                                                             | `src/main/acp/launch/omp-native-extension-launch.test.ts`：改为验证「OMP ACP launch 调用 `installManagedExtensions` 且 args 无 `--extension`」。`src/main/omp/omp-native-chat-extension.test.ts`：改为 VM 执行两个托管扩展源码（esbuild transform + runInNewContext），覆盖 generation 累计/测量守卫、非 ACP 静默、per-model tier 报告、命令写入与 re-report。`titlebar-extension-service.test.ts` 增加「只给 OMP 写两个新文件、公开文件不含 writeSync」用例。 |

## 2. 冲突面收敛对照（对 v1.4.271 base `6e73dac4be63`）

A 块（启动管线）补丁表面：

| 文件                                                | 补丁栈 diff（前）               | 本分支 diff（后）                                                           |
| --------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------- |
| `acp-launch-contract.ts`                            | +7/−7（签名加 `extensionPath`） | **0**                                                                       |
| `acp-launch-registry.ts`                            | +3/−2（`--extension` 拼接）     | **0**                                                                       |
| `acp-at-rest-commands.ts`                           | +8/−8                           | **0**                                                                       |
| `acp-structured-launch-resolution.ts`               | +44/−40                         | 38 行小 diff（新增 install 调用 7 行 + 补丁栈既有 resume 抽取）             |
| `acp-model-catalog-probe.ts`                        | +117/−112                       | +106/−88（仅剩 session-listing 抽取；`pluginDir`/`extensionPath` 全部消失） |
| `acp-model-catalog-session-listing.ts`              | +139（新文件）                  | +138（`extensionPath` 字段已删）                                            |
| `resources/native-chat-visuals/omp-native-chat.mjs` | +103                            | **0**（文件删除）                                                           |

按 v1.4.271 冲突计，目标 4 个文件（contract/registry/launch-resolution/at-rest）+ probe/session-listing 的扩展参数部分全部收敛：contract/registry/at-rest 归零，probe 的扩展部分消失，session-listing 不再含扩展参数，launch-resolution 只剩 +7 行新增托管安装。

## 3. 没有迁的东西（如实记录）

- **tier 上报与 generation 上报的私有通道**：`writeSync(1)` JSON-RPC 仍在 `orca-omp-native-chat-notify.ts`（协调者裁决 C：等 OMP configOptions 上游化，第二刀删）。`src/main/omp/omp-native-chat-options.ts` 的接收、`serviceTierCommand`/`_orca/omp/*` 方言字段、`tierReport` 链路保持不动。
- **tier 写路径（B 块）**：`acp-structured-options`、`acp-message-execution-options`、`omp-service-tier` 相关文件未动。
- **tok/s UI/journal（C 块）**：未动。
- `pluginDirs`/`skillRoots`/`resolveNativeChatVisualsSkillLocation` 在 at-rest/launch-resolution 的 visuals-skill 用法保留（那不是启动管线扩展参数，是 visuals skill 机制）。
- patch 3 抽出的 `acp-model-catalog-session-listing.ts` 等重构文件保留。

## 4. 行为变化与风险

- ACP 聊天、模型探测、at-rest 命令的 `PI_CODING_AGENT_DIR` 账号目录现在会写入**全部** managed 扩展（titlebar/prefill/agent-status/native-chat/notify），而不再只装载 `omp-native-chat.mjs`。titlebar/prefill/agent-status 在无 hook 坐标环境时均为 no-op；`orca-model`/`orca-plan-review` 命令会出现在会话可用命令中（既有托管扩展语义，与 PTY 会话一致）。
- `PI_CODING_AGENT_DIR` 指向 named profile 目录时，扩展装进 `profiles/<name>/extensions`——符合 profile 语义（与 #45706 的预期交互一致）。
- 托管扩展在所有 OMP 会话加载（包括终端 TUI）：notify 文件有 `acp` argv 守卫，公共文件的命令在 TUI 下注册即 `/orca-service-tier` 可用（Orca UI 侧仍被 `withheldCommands` 隐藏）。
- `/orca-service-tier` 与 options 报告解耦为两个文件：命令触发 re-report 通过 `pi.events` 总线（会话共享、公开 API），无延迟回归。
- 远程宿主（SSH/WSL guest）：`installManagedExtensions` 写的是本地路径，与旧 `--extension` 本地插件路径同样不适用于远程；未引入新风险，旧逻辑也是本地路径。

## 5. 验证

见「最低证据」：本文件完成时附 `pnpm install`、`pnpm tc`、`pnpm test`、`oxfmt`/`oxlint` 输出摘要（下方 §6 填实测结果）。

## 6. 实测输出

在 `/tmp/orca-managed-ext`（managed-ext-v1）实际执行：

- `pnpm install --frozen-lockfile --ignore-scripts`：`Done in 375ms using pnpm v12.18.0`（此前带 lifecycle scripts 的安装两次超时，postinstall 的 Electron 二进制下载与 native rebuild 被 SIGTERM；tc/test 不需要它们。install 造成的 `pnpm-lock.yaml` 版本字段漂移已 `git checkout` 还原，最终 diff 无 lockfile）。
- `pnpm tc`：`exit=0`，`.cache/typecheck/tsrs/.../tsconfig.node-*.tsbuildinfo` 时间戳为当次运行（真实执行，非缓存假阳性）。
- `oxlint`（13 个改动文件，`node_modules/oxlint/bin/oxlint` 直跑）：**0 错误 0 警告**。
- `oxfmt --check`（同 13 文件）：`All matched files use the correct format.`（4 个新写/重写文件先经 `oxfmt` 自动格式化）。
- `npx vitest run` 实测：
  - 触及的 3 个测试文件（`omp-native-chat-extension.test.ts`、`titlebar-extension-service.test.ts`、`omp-native-extension-launch.test.ts`）：**12 passed**。
  - 相邻模块 7 个测试文件（listing-session-models、structured-launch-instructions、structured-agent-turns、structured-compaction、antigravity-acp-client-info、antigravity-host-acp、agent-model-catalog-input-stamp）：**82 passed**。
  - OMP 目录 + tier/options 5 个测试文件（含 `omp-service-tier.test.ts`、`acp-session-slash-command.test.ts`）：**18 passed**。
- 未跑全仓 `pnpm test` 与 UAT（`testenv/omp-chat-uat/uat.py`）——后者需真实 OMP ACP 进程，留给集成验收；本刀只证明构建与单测。

修复过程中发现并已解决的问题：esbuild transform 需 `loader: 'ts'`；VM 沙箱需本地 `module` 对象（避免覆盖 vitest CJS 模块）与 `performance` 全局；oxlint curly 规则。

## 7. 返工（codex 审阅 REVIEW.md 三条必修，2026-11-23 二次提交）

审阅 FAIL 的三条必修与处理方式：

1. **命名 profile 丢扩展（高危）**：安装目录解析改为 OMP 有效环境语义——`OMP_PROFILE`/`PI_PROFILE` 命名 profile 时写 `<HOME>/<PI_CONFIG_DIR|.omp>/profiles/<name>/agent/extensions`，否则 `PI_CODING_AGENT_DIR`，再否则 `~/.omp/agent`（OMP 19.x `getConfigAgentDirName` 同款优先级，对照 `pi-utils/src/dirs.ts:333` 与 profile 解析 `dirs.ts:470+`）。`ompAgentDir` 从 `omp-mcp-servers.ts` 抽到 `src/main/omp/omp-agent-dir.ts` 复用；`readOmpMcpServers` 改用共享实现（行为不变）。聊天、模型探测、at-rest 共用同一解析（§ 2 实现）。
2. **`argv.includes('acp')` 误匹配（高危）**：两份生成扩展改为位置子命令判定——`argv[1]`（即 `process.argv.slice(1)` 首元素）恰为 `acp`，或其为脚本路径（含 `/`、`\\` 或 `.{js,cjs,mjs,ts,bun}` 后缀）且下一位置参数为 `acp`（`node cli.js acp`）。`--session-dir acp`、`omp chat acp` 等 flag 值不再触发；判定同时 gate 公共文件（TUI/RPC 下不注册钩子与命令，回归基线 0 钩子行为）。新增 it.each 用例覆盖「无子命令」「acp 作 flag 值」「acp 跟在其他子命令后」三种静默场景与「脚本路径+acp」正向场景——审阅复现的 `--session-dir acp` RPC 会话对应第二项。
3. **`acp-structured-launch-resolution.ts` 残留 38 行差异（验收）**：安装调用移入 `acp-launch-command.ts` 的 `resolveAcpLaunchCommand`——chat/probe/at-rest/text-task/sign-in 共用的唯一生产调用点，在四文件之外且保持上游干净集合外仅 +8 行；`acp-structured-launch-resolution.ts` 整文件恢复上游字节（含恢复上游 inline resume，`acp-structured-launch-resume.ts` 抽取文件删除——该文件是补丁栈 `4f9295abc3` 新增，无其他调用方）。逐字节核验：`acp-launch-contract`/`acp-launch-registry`/`acp-structured-launch-resolution`/`acp-at-rest-commands` 四文件 blob hash 与 `6e73dac4be63` 完全一致（`72fc128c`/`db1ed798`/`15e47a72`/`90d3028c`）。

附带修复审阅第 5 项（低）：Ultrafast 描述对齐 OMP 19.1.0 运行串「…or Codex **and relay models** that advertise it」（二进制 strings 取证）。审阅第 4 项（只读 extensions/ 静默失能，非阻断）保留：installManagedExtensions 返回值已含写入状态，调用侧传播是另一个切片。

**返工后 diff 面（对 `6e73dac4be63`）**：四目标文件 0 行；launch/discovery 残留 = `acp-launch-command.ts` +8（OMP 安装 hook）、`acp-model-catalog-probe.ts`（patch3 session-listing 抽取，非本刀范围）、`acp-model-catalog-session-listing.ts` +138（同）、新增 `omp-native-extension-launch.test.ts` +56。tier 写路径/journal/UI 未动。

**返工后实测（2026-11-23 重跑）**：`pnpm tc` exit=0；oxlint 8 个本轮改动文件 0 错误；oxfmt --check 全过；vitest：`omp-native-chat-extension.test.ts`（7 用例，含 3 新静默场景 + 脚本路径正向）+ `omp-agent-dir.test.ts`（2 用例，profile/绑定/默认三级解析）+ `titlebar-extension-service.test.ts` + `omp-native-extension-launch.test.ts` + `omp-mcp-servers.test.ts` 共 **21 passed**；相邻 8 测试文件（含 antigravity 三件套）**90 passed**。

## 8. 返工第二轮（codex REVIEW2.md 两条必修）

REVIEW2 确认命名 profile 恢复、RPC 误写转绿、四文件字节一致，但仍有两个语义边界，本轮处理：

1. **CLI `--profile` 覆盖环境（高危）**：`omp-agent-dir.ts` 的 `ompAgentDir`/`installOmpManagedExtensions` 增加 `launchArgv` 参数，按 OMP 自己的优先级解析最终 profile——`cliProfileArg` 镜像 `cli/profile-bootstrap.ts` 的 `extractProfileFlags`：`--profile`/`--profile=` 在第一个位置参数（子命令）之前扫描、后者覆盖，`--` 结束选项处理，string/optional/unknown 标志按 `flagConsumesValue` 规则吞值；CLI > `OMP_PROFILE`/`PI_PROFILE` > `PI_CODING_AGENT_DIR` > `<config home>/agent`。`resolveAcpLaunchCommand` 改为**先解析命令（拿到 Command override 的 prefixArgs）再安装**（`acp-launch-command.ts`，+21/−9），chat/probe/at-rest 仍共享同一入口。新增 `omp-agent-dir.test.ts` 用例：`OMP_PROFILE=from-env` + `--profile from-cli` → 装到 from-cli（含 `--profile=` 形式）；`--model gpt-4.1 --profile work` 的 flag 值不被误判为子命令；`acp --profile later` 中 acp 之后的 profile 不生效；`--` 截断；并通过真实 `resolveAcpLaunchCommand` + Command override 端到端断言安装目录。
2. **ACP 判定按 OMP 真实启动语义（高危）**：判定块抽成 `src/main/pi/managed-extensions/omp-acp-mode-source.ts` 的 `getOmpAcpModeSourceLines()`，两份生成扩展各自内联同一份实现（沿用 agent-status `...SourceLines` 共享先例，生成文件保持自包含无 Orca import）。语义镜像 OMP `resolveCliArgv`/`leadingSubcommandIndex`：跳过 flag 及其值后**第一个位置参数**为 `acp` 才激活；`--acp-terminal-auth` 无论位置一律排除（该入口进 TUI）。静默用例新增：终端认证 `acp --acp-terminal-auth`、`launch --mode rpc --session-dir acp`、`-- acp`、未知 flag 吞掉 acp；激活性用例新增：`--profile work acp`、`--profile=work acp`、`--print acp`（VALUELESS 标志不吞位置参数）及脚本路径正向，覆盖 REVIEW2 §② 表两个反例与原 RPC 对照。

**返工第二轮后实测（2026-11-23 重跑）**：`pnpm tc` exit=0；oxlint 9 个本轮改动文件 0 错误；oxfmt 全过（omp-agent-dir.test.ts 自动格式化后重跑通过）；vitest 触及+新增 5 文件 **31 passed**（`omp-native-chat-extension` 11、`omp-agent-dir` 5、`titlebar-extension-service` 6、`omp-native-extension-launch` 2、`omp-mcp-servers` 4），相邻 8 文件 **90 passed**。四目标文件 blob hash 再次核验与 `6e73dac4be63` 一致。

## 9. 返工第三轮（codex REVIEW3：`-e` 值消费遗漏）

REVIEW3 确认原反例全过，但两处扫描漏掉 `-e`：OMP `STRING_SETTERS` 中唯一的带值短参数（`-e` = `--extension`，STRING_VALUE_FLAGS 成员，`flag-tables.ts:243`）。`omp -e file.js --profile work acp` 时 `file.js` 被误判为位置参数——`cliProfileArg` 提前停在 `file.js` 漏掉 `--profile work`（装错目录），ACP 判定把 `file.js` 当子命令而漏报激活。

修复：`-e` 加入 `omp-agent-dir.ts` 的 `PROFILE_SCAN_VALUE_FLAGS` 与 `omp-acp-mode-source.ts` 的 `orcaAcpValueFlags`——两处本就共用同一份判定实现（生成扩展各自内联）。核对 `flag-tables.ts` 全部单字符参数：带值者仅 `-e`；`-r` 已在 optional 集，`-c`/`-p`/`-h`/`-v` 不吞值，无其余短参数遗漏。

新增用例：`omp-agent-dir.test.ts` 补 `['-e','file.js','--profile','work','acp']` → `profiles/work/agent`（REVIEW3 原反例）与 `['-e','acp']` → 默认目录；`omp-native-chat-extension.test.ts` 补 `['omp','-e','acp']` → 静默（acp 是 `-e` 的值）。实测：触及 5 文件 vitest **33 passed**，oxlint/oxfmt/`pnpm tc` 均净；四目标文件字节一致不变。
