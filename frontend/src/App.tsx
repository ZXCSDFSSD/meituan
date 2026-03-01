/**
 * App.tsx — 应用根组件
 *
 * ════════════════════════════════════════════
 * 【这个文件的职责】
 *   1. 路由配置（决定哪个 URL 显示哪个页面）
 *   2. Ant Design 主题配置（暗色/亮色，主色调，字体）
 *   3. 应用启动时加载门店列表（一次性副作用）
 *
 * 【文件在整个项目中的位置】
 *   main.tsx（入口）
 *     └── App（这里）
 *           └── AppLayout（侧边栏 + 顶部工具栏 + 内容区）
 *                 ├── Overview    → /       总览页
 *                 ├── Trend       → /trend  趋势页
 *                 └── StoreDetail → /store  单店详情页
 *
 * 【React 路由（react-router-dom）是什么？】
 *   单页应用（SPA）中，URL 改变不会真正刷新页面，
 *   而是由 React Router 拦截 URL 变化，渲染对应的组件。
 *   用户看起来像"跳转了页面"，实际上只是组件切换。
 * ════════════════════════════════════════════
 */

/**
 * lazy(() => import(...)) — 懒加载（代码分割）
 *   不在一开始就加载所有页面代码，
 *   而是用户第一次访问对应页面时才下载 JS 代码块。
 *   好处：首次加载更快。
 *
 * Suspense fallback={<Spin />}
 *   懒加载代码时显示转圈占位符，代码到位后自动替换为真实组件。
 */
import { lazy, Suspense, useEffect } from 'react'

/**
 * react-router-dom v6 路由组件：
 *   BrowserRouter → 使用 HTML5 History API（URL 不带 #）
 *   Routes        → 路由容器（包含所有 Route）
 *   Route         → 单条路由规则（path → element 的映射）
 *   Navigate      → 重定向组件
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'

/**
 * Ant Design v5 主题相关：
 *   ConfigProvider → AntD 全局配置提供者（类似 React Context Provider）
 *   theme          → AntD 内置主题算法和 token（设计变量）
 *   Spin           → 转圈加载组件
 *
 * ConfigProvider 包裹在最外层，其配置（语言、主题色、字体）
 * 会自动传递给内部所有 AntD 组件。
 */
import { ConfigProvider, theme as antdTheme, Spin } from 'antd'
import zhCN from 'antd/locale/zh_CN'  // AntD 中文语言包

import AppLayout from '@/components/layout/AppLayout'
import { useGlobalFilter } from '@/stores/globalFilter'
import { analyticsApi } from '@/api'

// 懒加载三个页面组件（@/ 是 src/ 目录的路径别名）
const Overview    = lazy(() => import('@/pages/Overview'))
const Trend       = lazy(() => import('@/pages/Trend'))
const StoreDetail = lazy(() => import('@/pages/StoreDetail'))

/**
 * AppInner — 内部应用组件
 * 分离出来是为了能在内部使用 Zustand hooks，
 * 然后根据 theme 状态配置 ConfigProvider。
 */
function AppInner() {
  // 从 Zustand 全局 store 读取当前主题和门店列表 setter
  const { theme, setStoreOptions } = useGlobalFilter()
  const isDark = theme === 'dark'

  /**
   * 应用启动时加载门店列表（只执行一次）
   * setStoreOptions 是 Zustand action，引用稳定，依赖数组等同于 []
   */
  useEffect(() => {
    analyticsApi.getStores()
      .then(setStoreOptions)
      .catch(() => { /* 忽略，门店列表加载失败不影响主流程 */ })
  }, [setStoreOptions])

  return (
    /**
     * ConfigProvider — AntD 全局主题配置
     *
     * locale={zhCN} → 设置组件文案为中文
     *
     * theme.algorithm
     *   AntD v5 用"算法"生成主题（而非写死 CSS 变量）：
     *   darkAlgorithm    → 暗色模式
     *   defaultAlgorithm → 亮色模式
     *
     * theme.token — 设计 Token（全局变量），派生所有组件的颜色/圆角等：
     *   colorPrimary → 主色调（按钮、链接、选中态）
     *   borderRadius → 圆角大小
     *   fontFamily   → 字体栈（多个备选字体，浏览器按顺序尝试）
     *
     * theme.components — 针对特定组件的覆盖配置：
     *   Layout/Menu 需要特殊背景色，这里单独设置
     */
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#4ECDC4',   // 品牌主色：青绿色
          borderRadius: 8,
          fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif",
        },
        components: {
          Layout: {
            siderBg:  isDark ? '#0D1117' : '#FFFFFF',  // 侧边栏背景
            headerBg: isDark ? '#0D1117' : '#FFFFFF',  // 顶部导航背景
            bodyBg:   isDark ? '#0D1117' : '#F8FAFC',  // 内容区背景
          },
          Menu: {
            darkItemBg:        '#0D1117',
            darkSubMenuItemBg: '#0D1117',
          },
        },
      }}
    >
      {/**
       * BrowserRouter — 路由容器（提供路由上下文）
       * Routes → 遍历子 Route，只渲染第一个匹配的（互斥）
       *
       * 外层 Route element={<AppLayout />} 是"布局路由"：
       *   不匹配具体 path，只提供公共布局（侧边栏+头部）。
       *   子页面会渲染在 AppLayout 的 <Outlet /> 插槽位置。
       */}
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            {/* index → 匹配根路径 "/" */}
            <Route
              index
              element={
                <Suspense fallback={<Spin size="large" style={{ display: 'block', marginTop: 80 }} />}>
                  <Overview />
                </Suspense>
              }
            />
            {/* /trend → 月度趋势页 */}
            <Route
              path="/trend"
              element={
                <Suspense fallback={<Spin size="large" style={{ display: 'block', marginTop: 80 }} />}>
                  <Trend />
                </Suspense>
              }
            />
            {/* /store → 单店详情页 */}
            <Route
              path="/store"
              element={
                <Suspense fallback={<Spin size="large" style={{ display: 'block', marginTop: 80 }} />}>
                  <StoreDetail />
                </Suspense>
              }
            />
            {/* path="*" → 未匹配的 URL 重定向到首页 */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  )
}

/**
 * App — 导出的根组件
 *
 * 【export default】
 *   默认导出：import App from './App'（不需要花括号）
 *   一个文件只能有一个默认导出。
 */
export default function App() {
  return <AppInner />
}
