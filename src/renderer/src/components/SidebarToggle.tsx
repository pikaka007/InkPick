import type { JSX } from 'react'

interface SidebarToggleProps {
  collapsed: boolean
  onToggle: () => void
}

/**
 * 侧栏折叠开关。收起后按钮会出现在主区域左上角 —— 不能让它随着侧栏一起消失，
 * 否则用户找不到把侧栏叫回来的入口。
 */
export default function SidebarToggle({ collapsed, onToggle }: SidebarToggleProps): JSX.Element {
  const label = collapsed ? '显示侧栏' : '隐藏侧栏'

  return (
    <button type="button" className="tool sidebar-toggle" title={`${label}（Ctrl/⌘+B）`} aria-label={label} onClick={onToggle}>
      {collapsed ? '»' : '«'}
    </button>
  )
}
