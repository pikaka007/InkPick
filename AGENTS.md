# AGENTS.md

本文件是给 AI 编码代理（及人类协作者）的工作约定。**每次接手任务前先读本文件。**

## 项目简介

InkPick：集阅读器、单词本、笔记于一体的个人学习工具。

- 需求范围见 `docs/MVP.md`（当前已跑通「读 / 钉 / 析 / 看 / 补 / 带走 / 存」）。
- 技术栈：**Electron + electron-vite + React + TypeScript + Zustand**，仅桌面端。
  样式是手写 CSS（没用 Tailwind），存储是本地 JSON 单文件（没用 better-sqlite3）——
  偏离原因见 `docs/MVP.md` 的「已知偏离计划之处」。
- 架构分层：`core/` 为纯 TS（无框架无 DOM 依赖，`anchor.ts` 是定位/重定位核心），
  `shell/` 为 Electron 壳。**不要把业务逻辑写进 `shell/`。**

## 核心工作流（必须遵守）

每完成一轮代码修改，按以下顺序执行，**不允许跳步**：

1. **实现**：完成本轮需求的代码改动。
2. **自测**：运行测试与检查，直到全部通过。
   - 有测试框架后：运行完整测试套件（不只是新写的用例）。
   - 同时运行 lint / 类型检查 / 构建（按项目实际脚本）。
   - 新增功能或修复 bug 时，**必须补充对应测试**。
3. **更新文档**：本轮改动影响到的文档必须同步修改，不允许留成“下次再说”。
   - `README.md`：使用方式、命令、目录结构
   - `docs/MVP.md`：范围、已经做了什么、计划偏离
   - `AGENTS.md`：流程、测试命令、约束
   - `docs/DICTIONARY.md`：词库相关
  - `docs/EXPORT.md`：导出格式相关
  - `docs/ROADMAP.md`：未完成清单与优先级（有新的缺口发现就写这里）
   - 发现与计划不符（如某方案实测不可行），**必须写下来**，而不是默默不做。
4. **提交并推送**：`git add` + `git commit` + `git push`。一个逻辑变更一个 commit。
5. **汇报**：向用户说明「改了什么 / 测试结果 / 文档 / commit 号」。

**测试未通过不得提交，也不得汇报为完成。** 若某项检查无法运行（如环境缺失），必须明确说明原因，而不是静默略过。

## Git 约定

- 主分支：`main`；远程：`origin` → https://github.com/pikaka007/InkPick.git
- **每完成一个 commit 都要 `git push` 到 `origin/main`**，不要留在本地。
- **推送可能因网络失败，要重试。** 实测 `github.com:443` 间歇性不可达（同一会话内有时通有时断，
  报 `Failed to connect to github.com port 443`）。失败时的正确做法：
  - 重试 3~5 次，间隔几秒；多数情况能过
  - 判断是否真的没推上去用 `git log --oneline origin/main..HEAD | wc -l`，
    **不要靠管道后的退出码**（`git push | tail` 的退出码是 `tail` 的，会把失败当成功）
  - 推送失败**不算代码问题**，但必须在汇报里说明「已提交未推送」
- 未经用户明确要求，**不要** `git push --force`、`git reset --hard`、改写已推送历史。
- 提交前检查 `git status`，确认没有误提交敏感信息（密钥、`.env`、本地配置）。
- 大体积的第三方数据（如 ECDICT 全量 CSV）不入库：放 `.dict-src/`（已在 .gitignore），
  只提交裁好的产物到 `resources/dictionary/`。

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
| 重建词库 | `npm run dict:build`（需 `.dict-src/` 源数据，见 docs/DICTIONARY.md） |
| 截图 | `npm run shot`（产物在 `.shots/`） |
| 文档体检 | `npm run check:docs`（查有没有被 shell 吃掉的字符） |
| Lint | **尚未接入** —— 补上之前不要假装跑过 |

改动后的最低要求：

- 任何改动：`npm test && npm run typecheck`
- 动了界面 / 主进程 / 持久化：还要跑 `npm run test:e2e`
- 改了 `src/core/anchor.ts`、`src/renderer/src/selection.ts`、`src/main/storeFile.ts`、
  关窗落盘握手、或 `resources/dictionary/` 里的词库文件：**必须**跑 `npm run test:e2e`

### 界面改动怎么验证

- 计算值用 E2E 断言（字号变了没有、主题换了没有、**对比度是否达得到 WCAG AA**）
- **外观好不好看得人眼看**：`npm run shot` 出图到 `.shots/`，不要用「断言过了」冒充「看着没问题」
- E2E 里过滤单个用例跑不了（它们依赖前面用例先加载文档），要验证就整跑

### 拖拽类交互

用**窗口级 pointermove/pointerup 监听**，不要用 `setPointerCapture`：
捕获一旦在某次拖拽里没释放干净，后续事件会直接收不到（实测踩过，表现为
pointerdown 到了、pointerup 永远不来）。E2E 里拖拽路径也要留在窗口内。

### 测试要能失败

改了上述高风险模块后，除了跑通，还要确认测试真能抓到回归：
故意把逻辑改坏 → 确认测试失败 → 改回来。
不要拿“测试通过”给一个其实没断言到东西的测试交差。

## 项目结构

```
src/core/       纯 TS，无框架无 DOM 依赖 —— 业务逻辑全在这里
  anchor.ts     定位 / 重定位
  dictionary.ts 词典解析、查词、词形还原
  vocab.ts      单词本分组（按 lemma 合并）
  senses.ts     释义收敛（去领域标记 / 限制义项与近义）
  prefs.ts      阅读偏好档位（字号/行距/行宽/主题/侧栏）与进度换算
  search.ts     文内搜索（命中上限、循环跳转）
  csv.ts        ECDICT 的 CSV 解析（容错）
src/main/       Electron 主进程：窗口、IPC、文件读写、词典
src/preload/    contextBridge 最小 API
src/renderer/   React 界面；selection.ts 是 DOM 选区 ⇄ 全文偏移量的映射
resources/dictionary/  内置 mini 词库（已提交，1.7MB）
scripts/        dict:build 词库构建脚本
.dict-src/      ECDICT 源数据，不入库
```

## 代码约定

- 保持改动聚焦，不顺手重构无关代码。
- 业务逻辑一律放在 `core/`，保持纯 TS、可单测；`shell/` 只做渲染、文件访问与 IPC。
- 遵循项目内已确立的分层与命名风格；新目录/新依赖先说明理由。
- 依赖新增需在汇报中列出。
- **不要把含中文 / emoji / 反引号的文本写进 `bash -c "node -e ..."` 这类脚本里**：
  反引号会被 shell 当命令替换（会把 Markdown 链接文字吃掉），emoji 会被换成 `?`。
  改文档用编辑工具直接改文件；改动后用 `npm run check:docs` 兜底体检。
  已踩过两次：Markdown 链接文字被吃掉、✅ 与 ⌘ 被换成 `?`。这类损坏很静默，务必跑体检。

## 汇报格式

一轮工作结束时，简要给出：

```
改动：<要点>
测试：<命令> → <结果>
文档：<本次同步了哪些文档>
提交：<commit 短哈希> <message>（已推送）
遗留：<未完成项 / 风险，可写「无」>
```

## 维护本文件

当项目技术栈、测试命令、Git 流程发生变化时，同步更新本文件。
