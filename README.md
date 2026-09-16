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
| **复习** | 侧栏「待复习 N」→ 一次一个词：**先自己回想、再显示释义**（释义默认遮住，没看之前不能评分），三档评分（忘了 / 模糊 / 记得），间隔按 SM-2 逐次拉长。释义下面附上**你遇到它的那句原句**（点一下直接跳回原文）。**每天新词上限与复习范围都可以设** |
| **析** | 收藏时自动查词典：音标 + 中文释义 + 词形还原（`words` → `word`），释义自动收敛掉领域标记与近义罗列 |
| **看** | 左侧单词本 + 笔记列表，可按**本文件 / 全部**看，点一下跳回原文那句；**跳走后可以一步步退回来，而且不会弄丢阅读进度** |
| **跨书** | 同一个词在不同书里收过，自动合并成一条词条，并标出各自出处 |
| **补** | 词典没收录的词可以手写一句释义 |
| **带走** | 导出 Anki CSV（背单词） / Markdown（词表 + 笔记） |
| **管** | 文档可重命名 / 删除（级联清掉它的标注）；误删标注可一键撤销；笔记可编辑 |
| **存** | 本地 JSON 持久化，重启不丢；写盘前自动留一份备份，主文件坏了会自动用备份恢复并告诉你 |

范围与不做的部分见 [`docs/MVP.md`](docs/MVP.md)；**还缺什么、缺到什么程度，见 [`docs/ROADMAP.md`](docs/ROADMAP.md)**；
词库见 [`docs/DICTIONARY.md`](docs/DICTIONARY.md)，导出格式与 Anki 导入步骤见 [`docs/EXPORT.md`](docs/EXPORT.md)。

## 打包（安装包）

```bash
npm run dist        # 出安装包（Windows：release/InkPick-0.0.1-setup.exe）
npm run dist:dir    # 只出解包目录（快，不生成安装包）
npm run check:package   # 验打出来的产物真能跑（需先 dist:dir）
npm run icon        # 重新生成应用图标（改配色/形状时用）
```

安装包是 NSIS 的：可选安装目录、建桌面与开始菜单快捷方式、**不是静默安装**（`oneClick: false`）。

### 升级会不会把数据弄丢？

**不会。** 存档目录被显式定死成 `userData/inkpick`，
跟 `npm run dev` 时用的是**同一个目录**。

这一点必须显式做：Electron 的 userData 目录名取的是应用名，
而打包后的应用名是 `productName`（`InkPick`），dev 时是 `name`（`inkpick`）。
Windows 不区分大小写看不出问题，macOS / Linux 会变成两个目录 ——
用户会以为「升级之后数据全没了」（其实在旧目录）。
`npm run check:package` 会把这一点验一遍。

### 还没做的

- **代码签名**：没有证书，Windows 首次运行会弹 SmartScreen 警告，
  需要点「更多信息 → 仍要运行」
- **自动更新**：没配（`latest.yml` 已经生成了，接的时候能用）
- **macOS / Linux 包**：只在 Windows 上验过，`dist` 默认出当前平台的包

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
npm test             # 单元测试（Vitest，347 个）
npm run test:e2e     # 端到端（Playwright 驱动真实 Electron，120 个，会先构建）
npm run typecheck    # 类型检查
npm run build        # 构建到 out/
npm start            # 预览构建产物
npm run dist         # 出安装包（见上方「打包」）
npm run check:package  # 验打包产物能跑（需先 dist:dir）
npm run icon         # 重新生成应用图标
npm run shot         # 截图到 .shots/，人眼看外观用
npm run check:docs   # 查文档/测试里有没有被 shell 写坏的字符
npm run dict:build   # 重建内置词库（需 .dict-src/ 源数据）
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

- 目录名被**显式定死**成 `inkpick`，所以 `npm run dev` 与安装后的版本
  用的是**同一个目录**（见上方「打包」）
- 保存时会先留一份上一版：`inkpick-store.json.bak`。
  主文件读不了时会自动用备份顶上，并明确告诉你
- E2E 用临时目录（`--user-data-dir`），不会碰真实存档

## 协作约定

见 [`AGENTS.md`](AGENTS.md)：每轮改动必须**测试通过后再提交**。
