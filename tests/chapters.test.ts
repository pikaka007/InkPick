import { describe, expect, it } from 'vitest'
import {
  chapterBoundarySegments,
  chapterIndexAtSegment,
  chapterLength,
  classifyHeading,
  detectChapters,
  truncateTitle
} from '@core/chapters'
import { splitParagraphs } from '@core/text'

/** 造一本有章节的书：标题行 + 每章若干正文段 */
function makeBook(headings: string[], bodyPerChapter = 2): string {
  return headings
    .map((head, index) => {
      const body = Array.from({ length: bodyPerChapter }, (_, i) => `第${index + 1}章的正文第${i + 1}段。`).join(
        '\n'
      )
      return `${head}\n${body}`
    })
    .join('\n')
}

function chaptersOf(content: string) {
  return detectChapters(splitParagraphs(content), content.length)
}

describe('classifyHeading', () => {
  it('认出中文章节的各种写法', () => {
    const yes = [
      '第一章 重生',
      '第1章 重生',
      '第 12 章 试探',
      '第一百零八章 结局',
      '第一章',
      '第1回 夜行',
      '第十节 归途',
      '第一章　重生', // 全角空格
      '第一章（上）', // 括号不该被当成句读
      '第一百零八章：重逢'
    ]
    for (const line of yes) {
      expect(classifyHeading(line), line).not.toBeNull()
    }
  })

  it('认出卷、部、篇', () => {
    for (const line of ['第一卷 少年游', '第二部 归来', '第三篇 远行']) {
      expect(classifyHeading(line), line).toBe('卷部篇')
    }
  })

  it('认出特殊章名', () => {
    for (const line of ['楔子', '序章', '尾声', '大结局', '番外一', '番外：十年之后', '后记']) {
      expect(classifyHeading(line), line).not.toBeNull()
    }
  })

  it('认出英文章节', () => {
    for (const line of ['Chapter 1', 'CHAPTER XII', 'Chapter 12 The Return', 'Part Two', 'Part One']) {
      expect(classifyHeading(line), line).toBe('英文')
    }
  })

  it('认出 Markdown 标题', () => {
    expect(classifyHeading('# 第一卷')).toBe('Markdown')
    expect(classifyHeading('## 楔子')).toBe('Markdown')
    expect(classifyHeading('###### 小标题')).toBe('Markdown')
  })

  it('正文句子不会被当成标题', () => {
    const no = [
      '他说：“你去看看第一章就明白了。”',
      '我翻回第一章，发现那个人早就出现过。',
      '第一章的内容我已经忘了，只记得那场雨。',
      '第一章讲了什么？我忘了。',
      '　　第一章的内容，其实很无聊。', // 全角缩进的正文
      '这本书的第一章就劝退了我',
      '第一章的内容，其实很无聊。',
      'The first chapter was long.',
      'Participants were told to wait.' // Part 开头但是个普通词
    ]
    for (const line of no) {
      expect(classifyHeading(line), line).toBeNull()
    }
  })

  it('空行与超长行不算标题', () => {
    expect(classifyHeading('')).toBeNull()
    expect(classifyHeading('   ')).toBeNull()
    // 超过 80 字符的行直接放弃，避免把整段正文当成标题
    expect(classifyHeading(`第一章 ${'很长'.repeat(45)}`)).toBeNull()
  })

  it('已知边界：没有标点的整段正文若以「第X章」开头会被误判', () => {
    // 这是刻意记下来的已知代价，不是 bug：
    // 一行里既没有任何标点、又刚好整段以「第一章」开头，在中文小说里几乎不会出现。
    // 一旦出现，代价只是目录里多一条垃圾，不影响阅读与标注。
    expect(classifyHeading('第一章的内容没有标点符号最后一直到行尾才结束')).not.toBeNull()
  })
})

describe('detectChapters', () => {
  const content = makeBook(['第一章 重生', '第二章 试探', '楔子', 'Chapter 4 The End'])

  it('顺序、标题、偏移都对', () => {
    const chapters = chaptersOf(content)
    expect(chapters.map((c) => c.title)).toEqual(['第一章 重生', '第二章 试探', '楔子', 'Chapter 4 The End'])
    expect(chapters.map((c) => c.index)).toEqual([0, 1, 2, 3])

    // start 必须真的指向标题行首
    for (const chapter of chapters) {
      expect(content.slice(chapter.start, chapter.start + chapter.title.length)).toBe(chapter.title)
    }
  })

  it('end 与下一章的 start 首尾相接，最后一章到全文末尾', () => {
    const chapters = chaptersOf(content)
    for (let i = 0; i < chapters.length - 1; i++) {
      expect(chapters[i].end).toBe(chapters[i + 1].start)
    }
    expect(chapters[chapters.length - 1].end).toBe(content.length)
  })

  it('segStart 与标题所在段落序号一致', () => {
    const segments = splitParagraphs(content)
    const chapters = detectChapters(segments, content.length)
    for (const chapter of chapters) {
      // 段落序号必须是「内容等于标题」的那一段
      expect(segments[chapter.segStart].text.trim()).toBe(chapter.title)
      expect(segments[chapter.segStart].start).toBe(chapter.start)
    }
  })

  it('segEnd 覆盖到下一章标题之前，最后一章到段落总数', () => {
    const segments = splitParagraphs(content)
    const chapters = detectChapters(segments, content.length)
    for (let i = 0; i < chapters.length - 1; i++) {
      expect(chapters[i].segEnd).toBe(chapters[i + 1].segStart)
    }
    expect(chapters[chapters.length - 1].segEnd).toBe(segments.length)
  })

  it('章内的正文段落都落在本章区间里', () => {
    const segments = splitParagraphs(content)
    const chapters = detectChapters(segments, content.length)
    const first = chapters[0]
    // 第一章有 1 个标题 + 2 段正文
    expect(first.segEnd - first.segStart).toBe(3)
    for (let i = first.segStart; i < first.segEnd; i++) {
      expect(chapterIndexAtSegment(chapters, i)).toBe(0)
    }
  })

  it('没有章节标记的文件返回空 —— 界面据此整个隐藏目录', () => {
    const plain = 'It is a truth universally acknowledged.\n\nHe was an old man who fished alone.\n\nCall me Ishmael.'
    expect(chaptersOf(plain)).toEqual([])
  })

  it('空内容返回空', () => {
    expect(detectChapters([], 0)).toEqual([])
  })

  it('只有一章也正常', () => {
    const chapters = chaptersOf('第一章 唯一\n正文\n')
    expect(chapters).toHaveLength(1)
    expect(chapters[0].index).toBe(0)
  })

  it('书名与简介在第一章之前，不算任何一章', () => {
    const book = '《测试小说》\n作者：某人\n\n第一章 重生\n正文\n'
    const chapters = chaptersOf(book)
    expect(chapters).toHaveLength(1)
    expect(chapters[0].segStart).toBe(2)
  })
})

describe('chapterIndexAtSegment', () => {
  const chapters = chaptersOf(makeBook(['第一章 甲', '第二章 乙', '第三章 丙']))

  it('落在章内返回该章', () => {
    expect(chapterIndexAtSegment(chapters, 0)).toBe(0) // 第一章标题
    expect(chapterIndexAtSegment(chapters, 1)).toBe(0) // 第一章正文
    expect(chapterIndexAtSegment(chapters, 3)).toBe(1) // 第二章标题
    expect(chapterIndexAtSegment(chapters, 8)).toBe(2) // 最后一章
  })

  it('落在第一章之前返回 -1', () => {
    const book = '书名\n作者\n\n第一章 甲\n正文\n'
    const withFront = chaptersOf(book)
    expect(chapterIndexAtSegment(withFront, 0)).toBe(-1)
    expect(chapterIndexAtSegment(withFront, 1)).toBe(-1)
    expect(chapterIndexAtSegment(withFront, 2)).toBe(0)
  })

  it('超出的段落序号返回最后一章，不越界', () => {
    expect(chapterIndexAtSegment(chapters, 9999)).toBe(2)
  })

  it('没有章节时返回 -1', () => {
    expect(chapterIndexAtSegment([], 0)).toBe(-1)
  })
})

describe('chapterBoundarySegments', () => {
  it('给出第二章及以后的章首段落序号（第一章前面不画分隔线）', () => {
    const chapters = chaptersOf(makeBook(['第一章 甲', '第二章 乙', '第三章 丙']))
    const boundaries = chapterBoundarySegments(chapters)
    expect(boundaries.has(chapters[0].segStart)).toBe(false)
    expect(boundaries.has(chapters[1].segStart)).toBe(true)
    expect(boundaries.has(chapters[2].segStart)).toBe(true)
    expect(boundaries.size).toBe(2)
  })

  it('没有章节时是空集合', () => {
    expect(chapterBoundarySegments([]).size).toBe(0)
  })
})

describe('chapterLength / truncateTitle', () => {
  it('章节字数按到下一章开头的距离算', () => {
    const chapters = chaptersOf(makeBook(['第一章 甲', '第二章 乙']))
    expect(chapterLength(chapters[0])).toBe(chapters[1].start - chapters[0].start)
    expect(chapterLength(chapters[1])).toBeGreaterThan(0)
  })

  it('长标题截断，短标题原样', () => {
    expect(truncateTitle('第一章 重生')).toBe('第一章 重生')
    const long = '第' + '一'.repeat(40) + '章'
    expect(truncateTitle(long, 10)).toBe(`${long.slice(0, 10)}…`)
  })
})
