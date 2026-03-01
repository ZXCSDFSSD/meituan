/**
 * AppLayout — 全局布局框架
 *
 * 结构：
 *   Top header (52px)  : Logo | 导航标签 | 主题切换
 *   Left sidebar (180px): 时间选择 | 区域筛选（Radio）| 渠道筛选（Radio）
 *   Content area        : 各页面内容（Outlet 插槽）
 */

import { Layout, Radio, DatePicker, Button, Tooltip, Typography } from 'antd'
import { BulbOutlined } from '@ant-design/icons'
import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import { useGlobalFilter } from '@/stores/globalFilter'
import dayjs from 'dayjs'
import type { Channel } from '@/types/api'

const { Header, Content } = Layout
const { Text } = Typography

const NAV_TABS = [
  { key: '/', label: '区域总览' },
  { key: '/trend', label: '趋势分析' },
  { key: '/store', label: '单店详情' },
]

const CHANNEL_OPTIONS: { value: Channel; label: string }[] = [
  { value: 'all',    label: '全渠道' },
  { value: '堂食',   label: '堂食' },
  { value: '外卖',   label: '外卖合计' },
  { value: '美团外卖', label: '美团外卖' },
  { value: '饿了么', label: '饿了么' },
  { value: '京东秒送', label: '京东秒送' },
]

const SIDEBAR_WIDTH = 180

export default function AppLayout() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const {
    month, setMonth,
    selectedStoreId, setStoreId,
    channel, setChannel,
    theme, toggleTheme,
    storeOptions,
  } = useGlobalFilter()

  const isDark      = theme === 'dark'
  const currentPath = location.pathname

  // 缩短门店名用于侧边栏显示
  const areaOptions = [
    { value: '', label: '全区域' },
    ...storeOptions.map((s) => ({
      value: s.store_id,
      label: s.store_name
        .replace('常青麦香园', '')
        .replace('常青', '')
        .replace('麦香园', '') || s.store_name,
    })),
  ]

  // 主题相关颜色
  const headerBg    = isDark ? '#0D1117' : '#FFFFFF'
  const sidebarBg   = isDark ? '#0F1318' : '#F7F8FA'
  const contentBg   = isDark ? '#0D1117' : '#F0F2F5'
  const borderColor = isDark ? '#21262D' : '#E8E8E8'
  const textColor   = isDark ? '#E6EDF3' : '#1F2937'
  const subColor    = isDark ? '#8B949E' : '#8C8C8C'

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* ── 顶部 Header ─────────────────────────────────────────────── */}
      <Header style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
        height: 52, lineHeight: '52px', padding: '0 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: headerBg,
        borderBottom: `1px solid ${borderColor}`,
        boxShadow: isDark ? 'none' : '0 1px 4px rgba(0,0,0,.06)',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 7,
            background: 'linear-gradient(135deg, #4ECDC4, #26A69A)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 13, letterSpacing: '-0.5px' }}>常</span>
          </div>
          <div style={{ lineHeight: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: textColor }}>常青麦香园</div>
            <div style={{ fontSize: 10, color: subColor, marginTop: 1 }}>餐饮数据看板</div>
          </div>
        </div>

        {/* 导航标签 */}
        <div style={{ display: 'flex', gap: 2 }}>
          {NAV_TABS.map((tab) => {
            const active = currentPath === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => navigate(tab.key)}
                style={{
                  padding: '5px 14px', borderRadius: 6, border: 'none',
                  cursor: 'pointer', fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  background: active
                    ? (isDark ? 'rgba(78,205,196,.18)' : 'rgba(78,205,196,.12)')
                    : 'transparent',
                  color: active ? '#4ECDC4' : subColor,
                  transition: 'all .15s',
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* 主题切换 */}
        <Tooltip title={isDark ? '切换浅色' : '切换深色'}>
          <Button
            icon={<BulbOutlined />}
            type="text" size="small"
            onClick={toggleTheme}
            style={{ color: subColor }}
          />
        </Tooltip>
      </Header>

      <Layout style={{ marginTop: 52 }}>
        {/* ── 左侧筛选栏 ────────────────────────────────────────────── */}
        <div style={{
          position: 'fixed', top: 52, left: 0, bottom: 0,
          width: SIDEBAR_WIDTH, zIndex: 100,
          overflowY: 'auto', overflowX: 'hidden',
          background: sidebarBg,
          borderRight: `1px solid ${borderColor}`,
          padding: '16px 14px',
        }}>

          {/* 时间 */}
          <div style={{ marginBottom: 20 }}>
            <Text style={{
              fontSize: 10, fontWeight: 700, color: subColor,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              display: 'block', marginBottom: 8,
            }}>
              时间
            </Text>
            <DatePicker
              picker="month"
              value={dayjs(month, 'YYYY-MM')}
              onChange={(d) => d && setMonth(d.format('YYYY-MM'))}
              allowClear={false}
              size="small"
              style={{ width: '100%' }}
            />
          </div>

          {/* 区域 */}
          <div style={{ marginBottom: 20 }}>
            <Text style={{
              fontSize: 10, fontWeight: 700, color: subColor,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              display: 'block', marginBottom: 8,
            }}>
              区域
            </Text>
            <Radio.Group
              value={selectedStoreId}
              onChange={(e) => setStoreId(e.target.value as string)}
              style={{ display: 'flex', flexDirection: 'column', gap: 1 }}
            >
              {areaOptions.map((opt) => (
                <Radio
                  key={opt.value}
                  value={opt.value}
                  style={{ fontSize: 12, color: textColor, margin: 0, padding: '4px 0' }}
                >
                  {opt.label}
                </Radio>
              ))}
            </Radio.Group>
          </div>

          {/* 渠道 */}
          <div>
            <Text style={{
              fontSize: 10, fontWeight: 700, color: subColor,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              display: 'block', marginBottom: 8,
            }}>
              渠道
            </Text>
            <Radio.Group
              value={channel}
              onChange={(e) => setChannel(e.target.value as Channel)}
              style={{ display: 'flex', flexDirection: 'column', gap: 1 }}
            >
              {CHANNEL_OPTIONS.map((opt) => (
                <Radio
                  key={opt.value}
                  value={opt.value}
                  style={{ fontSize: 12, color: textColor, margin: 0, padding: '4px 0' }}
                >
                  {opt.label}
                </Radio>
              ))}
            </Radio.Group>
          </div>
        </div>

        {/* ── 主内容区 ──────────────────────────────────────────────── */}
        <Content style={{
          marginLeft: SIDEBAR_WIDTH,
          padding: '20px 24px',
          background: contentBg,
          minHeight: 'calc(100vh - 52px)',
        }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
