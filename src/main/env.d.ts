// Vite 的 `?raw` 导入：把词库文件当字符串打进 bundle，
// 免去「开发态找项目根目录 / 打包后找 resourcesPath」的路径分支。
declare module '*.tsv?raw' {
  const content: string
  export default content
}
