# InkPick

一边读，一边把词和想法钉在原文上；读完之后，这些东西能带走。

集 **阅读器**、**单词本**、**笔记** 于一体，**数据全部存在本地**。

## 当前状态：MVP 闭环已跑通

四个功能：

| | 说明 |
|---|---|
| **读** | 打开 TXT / Markdown，滚动阅读，关掉再打开还在原位置 |
| **钉** | 选中一段文字 → 收藏为**单词** 或 **笔记**（自动记下所在的那句话） |
| **看** | 左侧列表查看全部标注，点一下跳回原文那句 |
| **存** | 本地 JSON 持久化，重启不丢 |

范围与不做的部分见 [`docs/MVP.md`](docs/MVP.md)。

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
npm test             # 单元测试（Vitest）
npm run test:e2e     # 端到端测试（Playwright 驱动真实 Electron，会先构建）
npm run typecheck    # 类型检查
npm run build        # 构建到 out/
npm start            # 预览构建产物
```

## 架构

```
src/core/            纯 TypeScript，无框架、无 DOM 依赖 —— 业务逻辑都在这里
  anchor.ts          定位 / 重定位（最值钱的一段代码）
  text.ts            文本归一化、分段、取上下文句子
  store.ts           状态操作与序列化（纯函数）
  types.ts           领域模型：Annotation 统一承载单词与笔记
src/main/            Electron 主进程：窗口、IPC、文件读写
src/preload/         contextBridge 暴露的最小 API（仅 5 个方法）
src/renderer/        React 界面
  src/selection.ts   DOM 选区 ⇄ 全文偏移量映射（标注功能的地基）
tests/               Vitest 单测；tests/e2e 是真实 Electron 的验收测试
```

两条不能破的约定：

1. **业务逻辑必须放 `core/`**，保持纯函数、可单测；`shell`（main/preload/renderer）只负责渲染、文件访问与 IPC。
2. **标注必须带上下文和位置**。没有「原句」的单词本是废的，没有「位置」的笔记回不到原文。

## 数据在哪

`app.getPath('userData')/inkpick-store.json`，Windows 上通常是
`%APPDATA%/inkpick/inkpick-store.json`。删掉它等于清空所有数据。

## 协作约定

见 [`AGENTS.md`](AGENTS.md)：每轮改动必须**测试通过后再提交**。
