# InkPick

一边读，一边把词和想法钉在原文上；读完之后，这些东西能带走。

集 **阅读器**、**单词本**、**笔记** 于一体，**数据全部存在本地**。

## 当前状态：MVP 闭环 + 词典 + 导出已跑通

七个功能：

| | 说明 |
|---|---|
| **读** | 打开 TXT / Markdown，滚动阅读，关掉再打开还在原位置 |
| **钉** | 选中一段文字 → 收藏为**单词** 或 **笔记**（自动记下所在的那句话） |
| **析** | 收藏时自动查词典：音标 + 中文释义 + 词形还原（`words` → `word`） |
| **看** | 左侧按**原形分组**的单词本 + 笔记列表，点一下跳回原文那句 |
| **补** | 词典没收录的词可以手写一句释义 |
| **带走** | 导出 Anki CSV（背单词） / Markdown（词表 + 笔记） |
| **存** | 本地 JSON 持久化，重启不丢 |

范围与不做的部分见 [`docs/MVP.md`](docs/MVP.md)，词库见 [`docs/DICTIONARY.md`](docs/DICTIONARY.md)，
导出格式与 Anki 导入步骤见 [`docs/EXPORT.md`](docs/EXPORT.md)。

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
npm test             # 单元测试（Vitest，144 个）
npm run test:e2e     # 端到端测试（Playwright 驱动真实 Electron，14 个，会先构建）
npm run typecheck    # 类型检查
npm run build        # 构建到 out/
npm start            # 预览构建产物
```

## 架构

```
src/core/            纯 TypeScript，无框架、无 DOM 依赖 —— 业务逻辑都在这里
  anchor.ts          定位 / 重定位（最值钱的一段代码）
  dictionary.ts      词典解析、查词、词形还原
  vocab.ts           单词本分组（按 lemma 合并同一词的不同形态）
  export.ts          Anki CSV / Markdown 生成
  csv.ts             ECDICT 的 CSV 解析（容错脏引号）
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
