# AGENTS.md

本文件是给 AI 编码代理（及人类协作者）的工作约定。**每次接手任务前先读本文件。**

## 项目简介

InkPick：集阅读器、单词本、笔记于一体的个人学习工具。

- 需求范围见 `docs/MVP.md`（当前阶段只做「读 / 钉 / 看 / 存」四件事）。
- 技术栈：**Electron + electron-vite + React + TypeScript + Tailwind + Zustand + better-sqlite3**，仅桌面端。
- 架构分层：`core/` 为纯 TS（无框架无 DOM 依赖，`anchor.ts` 是定位/重定位核心），`shell/` 为 Electron 壳。**不要把业务逻辑写进 `shell/`。**

## 核心工作流（必须遵守）

每完成一轮代码修改，按以下顺序执行，**不允许跳步**：

1. **实现**：完成本轮需求的代码改动。
2. **自测**：运行测试与检查，直到全部通过。
   - 有测试框架后：运行完整测试套件（不只是新写的用例）。
   - 同时运行 lint / 类型检查 / 构建（按项目实际脚本）。
   - 新增功能或修复 bug 时，**必须补充对应测试**。
3. **提交**：`git add` + `git commit`，一个逻辑变更一个 commit。
4. **汇报**：向用户说明「改了什么 / 测试结果 / commit 号」。

**测试未通过不得提交，也不得汇报为完成。** 若某项检查无法运行（如环境缺失），必须明确说明原因，而不是静默略过。

## Git 约定

- 主分支：`main`；远程：`origin` → https://github.com/pikaka007/InkPick.git
- 未经用户明确要求，**不要** `git push --force`、`git reset --hard`、改写已推送历史。
- 用户要求「提交」默认指本地 commit；**推送前先确认**（除非用户已说明要推送到远程）。
- 提交前检查 `git status`，确认没有误提交敏感信息（密钥、`.env`、本地配置）。

### Commit message

采用 Conventional Commits，中文描述：

```
<type>: <简短描述>
```

常用 type：`feat` `fix` `docs` `test` `refactor` `chore` `style` `perf`

示例：
- `feat: 阅读器支持划词高亮`
- `fix: 修正生词本重复收藏`
- `test: 补充笔记关联的单元测试`

## 测试命令

| 用途 | 命令 |
|---|---|
| 单元测试 | `npm test`（Vitest） |
| 端到端 | `npm run test:e2e`（Playwright 驱动真实 Electron，会先 `build`） |
| 类型检查 | `npm run typecheck` |
| 构建 | `npm run build` |
| Lint | **尚未接入** —— 补上之前不要假装跑过 |

改动后的最低要求：

- 任何改动：`npm test && npm run typecheck`
- 动了界面 / 主进程 / 持久化：还要跑 `npm run test:e2e`
- 改了 `src/core/anchor.ts`、`src/renderer/src/selection.ts`、`src/main/storeFile.ts`、
  或关窗落盘握手：**必须**跑 `npm run test:e2e`

### 测试要能失败

改了上述高风险模块后，除了跑通，还要确认测试真能抓到回归：
故意把逻辑改坏 → 确认测试失败 → 改回来。
不要拿“测试通过”给一个其实没断言到东西的测试交差。

## 项目结构

```
src/core/       纯 TS，无框架无 DOM 依赖 —— 业务逻辑全在这里
src/main/       Electron 主进程：窗口、IPC、文件读写（含关窗落盘握手）
src/preload/    contextBridge 最小 API
src/renderer/   React 界面；selection.ts 是 DOM 选区 ⇄ 全文偏移量的映射
tests/          Vitest 单测；tests/e2e 是真实 Electron 的验收测试
```

## 代码约定

- 保持改动聚焦，不顺手重构无关代码。
- 业务逻辑一律放在 `core/`，保持纯 TS、可单测；`shell/` 只做渲染、文件访问与 IPC。
- 遵循项目内已确立的分层与命名风格；新目录/新依赖先说明理由。
- 依赖新增需在汇报中列出。

## 汇报格式

一轮工作结束时，简要给出：

```
改动：<要点>
测试：<命令> → <结果>
提交：<commit 短哈希> <message>
遗留：<未完成项 / 风险，可写「无」>
```

## 维护本文件

当项目技术栈、测试命令、Git 流程发生变化时，同步更新本文件。
