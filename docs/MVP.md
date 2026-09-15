# InkPick MVP

## 一句话定位

> 一边读，一边把词和想法钉在原文上；读完之后，这些东西能带走。

MVP 的唯一命题：**标注闭环能不能跑通** —— 选中 → 钉住 → 找得回 → 不丢。

## 范围：只有 4 件事

| # | 事 | 最小形态（再砍就不成立） |
|---|---|---|
| 1 | **读** | 打开一个 TXT，上下滚动，关掉再打开还在原位置 |
| 2 | **钉** | 选中一段文字 → 存为**词条** 或 **笔记** |
| 3 | **看** | 一个列表看全部词条/笔记，点一下**跳回原文那句** |
| 4 | **存** | 本地持久化，重启不丢 |

第 2 件是产品的全部意义，其余三件为它服务。

## 铁律：标注必须带上下文 + 位置

每个标注都要存下两样东西，**MVP 阶段就要存对**：

```
词条 = 选中的词 + 它所在的那句话 + 位置
笔记 = 笔记内容   + 它挂靠的那段原文 + 位置
```

- 没有「原句」的单词本是废的：日后想不起为什么收藏它。
- 没有「位置」的笔记回不到原文，等于死数据。

加字段容易，事后补历史数据的坑填不回来。

### 统一标注模型

词条和笔记是同一个东西：**一段原文 + 一个位置**，只是负载不同。用一张表，不要建三张。

```
Annotation {
  id
  docId              # 所属文档
  type               # 'vocab' | 'note'
  selectedText       # 选中的原文
  contextText        # 所在的那句话（上下文）
  anchor             # 位置：{ offset, text, prefix(32), suffix(32) }
  createdAt, updatedAt
}

Vocab = Annotation + { term, definition? }   # definition 第二步接词典自动填
Note  = Annotation + { content }
```

`anchor` 里除偏移量外必须冗余存 `text` + 前后各 32 字符。换版本、改排版后偏移会漂，靠 `prefix`/`suffix` 做模糊重定位。这是数据能否活过版本升级的命门。

## 验收标准

拿一本书从第 1 页读到最后一页，攒出一份词表 + 几条笔记，**关掉程序、重开，全部还在，且都能点回原文**。做到即 MVP 成立。

## 本轮明确不做

目录 / 翻页 / 字体主题 / 高亮颜色 / 搜索 / 标签 / 词典释义 / 词形还原 / 复习算法 / 导出 / 账号同步 / EPUB / PDF。

**最想加回来的两个**：词典释义、导出（Anki CSV / Markdown）。都放第二步 —— 第一步先证明「钉得住、找得回」。

## 落地顺序

1. 上述 4 件事闭环（TXT）
2. 词典释义自动填充 + 词形还原（lemma，避免 running/ran/runs 变三个词条）
3. 导出 Anki CSV / Markdown
4. EPUB（换渲染引擎，标注逻辑复用，只换 anchor 实现）
5. 复习算法 / 同步 / PDF

## 技术选型

### 平台

**仅桌面**（Windows / macOS / Linux）。不做移动端，不做 Web 版。

### 外壳：Electron

选它的核心理由：**本产品的核心原语是「文本选中 + 精确字符偏移」**。Electron 自带 Chromium，三平台渲染与 Selection / Range 行为一致，把这个最容易踩坑的点变成已知问题；主进程可直接访问文件与 SQLite，没有浏览器沙箱的绕路。

代价（已知并接受）：安装包 80~150MB、内存占用较高、启动比原生慢。个人工具可接受。

**备选 Tauri 2**：包体仅 5~10MB，但使用系统 WebView（WebView2 / WKWebView / WebKitGTK），三平台文本渲染与选中行为不一致，对以「选中文本」为全部功能的产品风险过高。

### 分层原则：外壳可替换

不把逻辑焊死在 Electron 上：

```
core/          纯 TS，无框架、无 DOM 依赖
  anchor.ts    定位、重定位、模糊匹配   ← 最该写单测的地方
  model.ts     Annotation 与存储接口
shell/         Electron 壳：渲染、文件访问、IPC
```

将来若换 Tauri，只需重写 `shell/`，`core/` 完全复用。

### 依赖清单

| 用途 | 选择 |
|---|---|
| 脚手架 | electron-vite |
| UI | React + TypeScript |
| 样式 | Tailwind CSS + shadcn/ui |
| 状态 | Zustand |
| 存储 | better-sqlite3（需 electron-rebuild） |
| 测试 | Vitest（`core/`）+ Playwright（Electron E2E） |
| 打包 | electron-builder |

### 安全基线

`contextIsolation: true`、`nodeIntegration: false`、preload 经 `contextBridge` 暴露最小 API。

### 测试策略

- `core/anchor.ts` 的重定位是**最高价值单测点**：改排版、改版本后能否找回原文，全靠它。
- 纯逻辑走 Vitest，跑得快。
- 交互闭环（选中 → 收藏 → 列表 → 跳回）走 Playwright E2E。

### 待定

- 词典方案（离线词典包 vs 联网 API）—— 第二步再定，不影响 MVP 开工。
