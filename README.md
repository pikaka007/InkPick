# InkPick

一边读，一边把词和想法钉在原文上；读完之后，这些东西能带走。

集 **阅读器**、**单词本**、**笔记** 于一体，**数据全部存在本地**。

## 当前状态：MVP 闭环 + 词典 + 导出已跑通

七个功能：

| | 说明 |
|---|---|
| **读** | 打开 TXT / Markdown（**UTF-8 / UTF-16 / GBK 都能读**，不是 UTF-8 会告知一声），滚动阅读，关掉再打开还在原位置 |
| **章** | 自动从正文里认出章节（`第X章` / `楔子` / `Chapter N` / Markdown 标题…），侧栏目录可跳转，头部显示当前章名与「第 3 / 340 章」，`[` `]` 或按钮翻章，章尾有分隔线。整本没有章节标记时这个功能整个消失 |
| **读得舒服** | 字号 / 行距 / 行宽 / 三套主题全在工具栏上（每个选项一个按钮，一次点击到位），可拖的进度条，侧栏可收起（Ctrl/⌘+B）与拖宽；正文区不挂原生滚动条 |
| **搜** | 文内搜索（Ctrl/⌘+F）：输入时只高亮**不跳转**，回车或上下键才跳，另有「回到原处」 |
| **钉** | 选中一段文字 → 收藏为**单词** 或 **笔记**（自动记下所在的那句话）|
| **记** | **不导入书也能用**：手动记下遇到的生词（看视频 / 读论文时），释义自动查；可连着记一串。同一个词只会存一条 |
| **析** | 收藏时自动查词典：音标 + 中文释义 + 词形还原（`words` → `word`），释义自动收敛掉领域标记与近义罗列 |
| **看** | 左侧单词本 + 笔记列表，可按**本文件 / 全部**看，点一下跳回原文那句；**跳走后可以一步步退回来，而且不会弄丢阅读进度** |
| **跨书** | 同一个词在不同书里收过，自动合并成一条词条，并标出各自出处 |
| **补** | 词典没收录的词可以手写一句释义 |
| **带走** | 导出 Anki CSV（背单词） / Markdown（词表 + 笔记） |
| **管** | 文档可重命名 / 删除（级联清掉它的标注）；误删标注可一键撤销；笔记可编辑 |
| **存** | 本地 JSON 持久化，重启不丢；写盘前自动留一份备份，主文件坏了会自动用备份恢复并告诉你 |

范围与不做的部分见 [`docs/MVP.md`](docs/MVP.md)；**还缺什么、缺到什么程度，见 [`docs/ROADMAP.md`](docs/ROADMAP.md)**；
词库见 [`docs/DICTIONARY.md`](docs/DICTIONARY.md)，导出格式与 Anki 导入步骤见 [`docs/EXPORT.md`](docs/EXPORT.md)。

## 快速开始

```bash
npm install
npm run dev          # 开发模式
```

首次运行 `npm run dev` 时 Electron 会下载二进制（约 100MB）。
若下载慢，项目里的 `.npmrc` 已把 `electron_mirror` 指向国内镜像；
npm 11 会为此打一条 `Unknown project config` 警告，可忽略。

打开应用后点「示例」，或点「打开 TXT」选一个文本文件。

## 常用命令

```bash
npm test             # 单元测试（Vitest，236 个）
npm run test:e2e     # 端到端测试（Playwright 驱动真实 Electron，56 个，会先构建）
npm run typecheck    # 类型检查
npm run build        # 构建到 out/
npm start            # 预览构建产物
npm run shot         # 截五张图到 .shots/（主题/选中态），人眼看外观用
```

## 架构

```
src/core/            纯 TypeScript，无框架、无 DOM 依赖 —— 业务逻辑都在这里
  anchor.ts          定位 / 重定位（最值钱的一段代码）
  dictionary.ts      词典解析、查词、词形还原
  vocab.ts           单词本分组（按 lemma 合并同一词的不同形态）
  senses.ts          释义收敛（去领域标记 / 限制义项与近义）
  export.ts          Anki CSV / Markdown 生成
  csv.ts             ECDICT 的 CSV 解析（容错脏引号）
  prefs.ts           阅读偏好档位与进度换算
  search.ts          文内搜索（命中上限、循环跳转）
  text.ts            文本归一化、分段、取上下文句子
  store.ts           状态操作与序列化（纯函数）
  types.ts           领域模型：Annotation 统一承载单词与笔记
src/main/            Electron 主进程：窗口、IPC、文件读写、词典
src/preload/         contextBridge 暴露的最小 API
src/renderer/        React 界面
  src/selection.ts   DOM 选区 ⇄ 全文偏移量映射（标注功能的地基）
resources/dictionary/  内置 mini 词库（23,900 词条，已提交）
tests/               Vitest 单测；tests/e2e 是真实 Electron 的验收测试
```

三条不能破的约定：

1. **业务逻辑必须放 `core/`**，保持纯函数、可单测；`shell`（main/preload/renderer）只负责渲染、文件访问与 IPC。
2. **标注必须带上下文和位置**。没有「原句」的单词本是废的，没有「位置」的笔记回不到原文。
3. **先钉住、再查词**。词典出任何问题都不能让「收藏」这个动作失败。

## 词库

内置 [ECDICT](https://github.com/skywind3000/ECDICT)（MIT）裁出的 23,900 个常用词，
加载耗时 79ms / 内存 29MB。重建与筛选策略见 [`docs/DICTIONARY.md`](docs/DICTIONARY.md)。

## 数据在哪

`app.getPath('userData')/inkpick-store.json`，Windows 上通常是
`%APPDATA%/inkpick/inkpick-store.json`。删掉它等于清空所有数据。

## 协作约定

见 [`AGENTS.md`](AGENTS.md)：每轮改动必须**测试通过后再提交**。
