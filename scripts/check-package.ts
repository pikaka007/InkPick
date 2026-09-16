/**
 * 验证**打包产物**真的能跑。
 *
 *   npm run dist:dir && npm run check:package
 *
 * 为什么单独要有它：「能打包」不等于「打包后能用」。
 * asar 打包、CSP、file:// 加载、userData 目录名 —— 任何一处出问题，
 * 表现都是「开发时好好的，装完就不对」，而这恰恰是最晚才被发现的一类问题。
 *
 * 它验三件事：
 *   1. 打出来的 exe 能启动、界面能出来
 *   2. ★ 存档目录仍然是 `inkpick`（和 dev 时**同一个**）——
 *      不然用户会以为「升级之后数据全没了」
 *   3. 能真的存下东西（写盘链路在打包环境下没坏）
 *
 * 怎么做到不碰真实存档：
 *   - 路径那一项需要「不带 --user-data-dir 启动」，那就**只读路径、不做任何改动就关掉**
 *     （读一次存档和平时开一次应用没区别，而且它不加任何数据）
 *   - 功能验证那部分全程带 --user-data-dir，写的是临时目录
 */
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright-core'

const APP_DIR = join(process.cwd(), 'release', 'win-unpacked')
const EXE = join(APP_DIR, 'InkPick.exe')
/** 打包后 userData 必须落在这个目录名下（与 dev 一致） */
const PINNED_DIR_NAME = 'inkpick'

function fail(message: string): never {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

if (!existsSync(EXE)) {
  fail(`找不到打包产物：${EXE}\n  先跑一次 npm run dist:dir`)
}

console.log(`检查打包产物：${EXE}`)

/** 只读地拿一次「默认的存档路径」。不带 --user-data-dir 才能拿到真正会用的那个 */
async function readDefaultUserData(): Promise<string> {
  const onlyPath = await electron.launch({ executablePath: EXE })
  try {
    await onlyPath.firstWindow()
    return await onlyPath.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  } finally {
    // 不交互、不改数据，拿到就关
    await onlyPath.close()
  }
}

const userData = await readDefaultUserData()
console.log(`  userData：${userData}`)
const lastSegment = userData.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? ''
if (lastSegment.toLowerCase() !== PINNED_DIR_NAME) {
  fail(
    `打包后 userData 目录名是「${lastSegment}」，应该是「${PINNED_DIR_NAME}」——\n` +
      '  这会让用户以为升级后数据全丢了'
  )
}
console.log(`  ✓ 存档目录名是 ${PINNED_DIR_NAME}（与 dev 相同）`)

// 功能验证：写盘链路用临时目录，不碰上面那个真实目录
const userDataDir = await mkdtemp(join(tmpdir(), 'inkpick-pkg-'))
const app = await electron.launch({
  executablePath: EXE,
  args: [`--user-data-dir=${userDataDir}`]
})

try {
  const page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 20000 })

  console.log(`  应用名：${await app.evaluate(({ app: electronApp }) => electronApp.getName())}`)
  console.log(`  是不是打包版：${await app.evaluate(({ app: electronApp }) => electronApp.isPackaged)}`)

  // 欢迎页 + 侧栏都在，说明渲染层与 preload 都正常
  await page.waitForSelector('.welcome h1')
  await page.waitForSelector('.sidebar')
  console.log('  ✓ 界面渲染正常')

  // 真的能存下东西
  await page.getByRole('button', { name: '手动添加单词' }).click()
  await page.locator('.add-word-input').fill('packagedcheck')
  await page.locator('.add-word-input').press('Enter')
  await page.waitForTimeout(600)
  await app.close()

  const storeFile = join(userDataDir, 'inkpick-store.json')
  if (!existsSync(storeFile)) fail(`没写出存档文件：${storeFile}`)
  if (!(await readFile(storeFile, 'utf-8')).includes('packagedcheck')) fail('存档里没有刚加的那个词')
  console.log('  ✓ 写盘正常')

  console.log(`\n产物目录：${(await readdir(APP_DIR)).join(', ')}`)
  console.log('\n打包产物检查通过')
} catch (error) {
  console.error('\n✗ 打包产物检查失败：')
  console.error(error)
  process.exitCode = 1
} finally {
  await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined)
}
