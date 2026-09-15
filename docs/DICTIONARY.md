# 词典

## 内置词库

`resources/dictionary/` 下两个文件已提交进仓库，开箱即用：

| 文件 | 大小 | 内容 |
|---|---|---|
| `mini.tsv` | 1.7 MB | 23,900 个常用词条：`词 \t 音标 \t 释义 \t 柯林斯星级 \t 词频` |
| `lemma.tsv` | 0.4 MB | 23,059 条「变形词 → 原形」映射，如 `moves → move` |

运行时开销（实测）：加载 **79ms**、堆内存 **29MB**。

## 数据来源与许可

词库数据来自 [ECDICT](https://github.com/skywind3000/ECDICT)（MIT 协议），
原始许可全文见 [`ECDICT-LICENSE`](../../resources/dictionary/ECDICT-LICENSE)。

## 筛选策略

用全量 ECDICT（77 万词条）里满足**任一**条件的词：

- 词频排名 ≤ 20,000（`frq` 或 `bnc`）
- 柯林斯星级 ≥ 1
- 牛津三千词（`oxford = 1`）

且必须满足：单个英文词（`^[a-z][a-z'-]*$`）、长度 ≤ 24。

选这个阈值的原因：它覆盖了日常英文阅读 95% 以上的用词，而体积和内存只有全量的 4%。

## 词形还原（lemma）

把 `running / ran / runs` 归到 `run`。没有这一步，单词本会被同一堆变体碎片填满。

两个来源，合并使用：

1. **ECDICT 的 `exchange` 字段**（如 `p:ran/d:run/i:running/3:runs`）—— 每个词条自带。
2. **ECDICT 仓库的 `lemma.en.txt`**（BNC 语料统计）—— 兜底。

### 一条明确的取舍

**本身能独立成词的变形词不归并。** 例如 `reading` 有自己的词条（`n. 阅读`），
就让它独立，不并入 `read`。

理由：lemmatization 存在真实歧义，`left` 既可能是 `leave` 的过去式，也可能是「左边」。
保守规则不会把 `left` 错并到 `leave` 底下；代价是 `read` 和 `reading` 在单词本里分列两条。
对背单词来说，这个代价远小于错并。

## 重建词库

一般不需要。只有想换筛选阈值、或升级 ECDICT 版本时才做。

先准备源数据（约 66MB，**不要提交进仓库**）：

```bash
mkdir -p .dict-src
cd .dict-src
curl -L -o ecdict.full.csv https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv
curl -L -o lemma.en.txt    https://raw.githubusercontent.com/skywind3000/ECDICT/master/lemma.en.txt
```

> 国内直连 `raw.githubusercontent.com` 可能只有几十 KB/s，66MB 要下很久。
> 实在慢可以用代理，或者从 npmmirror 上别人打包好的 ECDICT 数据里取 CSV。

然后：

```bash
npm run dict:build
```

脚本会先校验源数据的列数（超过千分之一异常就直接失败），再筛选、写出、
最后抽检 8 个常用词必须查得到 —— 任何一步不对都不会静默产出坏词库。

## 为什么不做「完整词典下载」

原计划是「mini 内置 + 完整版按需下载」。实测全量 ECDICT（767,575 词条）后**放弃**：

| | mini（内置） | 全量 |
|---|---|---|
| 解析耗时 | 79 ms | 3,232 ms |
| 堆内存 | 29 MB | **1,464 MB** |
| 磁盘 | 2.1 MB | 42 MB |
| 词形映射 | 23,059 条 | **272 条** |

两个致命问题：

1. **1.4 GB 内存**。对一个阅读器来说完全不可接受。
2. **全量下词形还原几乎失效**（只剩 272 条映射）—— 因为 ECDICT 把几乎每个变形词都收录成了
   独立词条，按「独立成词不归并」的规则就不再有词形映射了。也就是说多花的 1.4GB
   买到的正是我们最需要的那件事的对立面。

结论：**提升覆盖率的正确做法是调 `FREQ_LIMIT` 后重新 `dict:build`，而不是装全量**。
真的查不到的词，走「手动补一句释义」—— 成本低，而且比从 77 万条里翻出一句生僻释义更有用。
