import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * 内容安全策略。本地应用不加载任何远程内容，所以生产环境可以卡得很紧。
 *
 * 为什么写在 HTML 的 meta 里，而不是主进程拦截响应头：
 * 实测 `webRequest.onHeadersReceived` **对 file:// 不生效** ——
 * 打包后渲染层是用 file:// 加载的，那种写法在开发时看着有、上线后等于没配。
 * meta 标签与加载协议无关，两种场景都能套上。
 *
 * dev 不能用生产那一套：Vite 要内联脚本、要连 HMR 的 websocket。
 */
const CSP_PROD =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
// dev 必须比生产宽松：Vite 要内联脚本、要连 HMR 的 websocket，
// 而且它的开发期模块加载会用 eval（不加这条 `npm run dev` 直接白屏）
const CSP_DEV =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: http://localhost:*"

/** 往 index.html 的 head 里塞一条 CSP —— 开发与生产用不同的策略 */
function cspPlugin() {
  return {
    name: 'inkpick-csp',
    transformIndexHtml: {
      order: 'pre' as const,
      handler(html: string, context: { server?: unknown }) {
        const policy = context.server ? CSP_DEV : CSP_PROD
        return html.replace(
          '</head>',
          `  <meta http-equiv="Content-Security-Policy" content="${policy}" />\n  </head>`
        )
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@core': resolve('src/core'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), cspPlugin()]
  }
})
