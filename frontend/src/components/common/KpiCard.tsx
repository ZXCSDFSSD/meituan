import { Card, Typography, Tooltip } from 'antd'
import { ArrowUpOutlined, ArrowDownOutlined, MinusOutlined } from '@ant-design/icons'
import { formatMom, getMomDirection } from '@/utils/formatters'
import { useGlobalFilter } from '@/stores/globalFilter'

const { Text, Title } = Typography

interface KpiCardProps {
  title: string
  value: string
  fullValue?: string    // Tooltip 中显示完整值
  mom?: number | null   // 环比%
  suffix?: string
  color?: string
  loading?: boolean
}

export default function KpiCard({
  title,
  value,
  fullValue,
  mom,
  suffix,
  color = '#4ECDC4',
  loading = false,
}: KpiCardProps) {
  const { theme } = useGlobalFilter()
  const isDark = theme === 'dark'
  const direction = getMomDirection(mom)

  const momIcon = direction === 'up'
    ? <ArrowUpOutlined style={{ color: '#4ADE80' }} />
    : direction === 'down'
    ? <ArrowDownOutlined style={{ color: '#F87171' }} />
    : <MinusOutlined style={{ color: '#9CA3AF' }} />

  const momColor = direction === 'up' ? '#4ADE80' : direction === 'down' ? '#F87171' : '#9CA3AF'

  return (
    <Card
      loading={loading}
      size="small"
      bordered={false}
      style={{
        background: isDark ? '#161B22' : '#FFFFFF',
        borderRadius: 12,
        border: isDark ? '1px solid #21262D' : '1px solid #E5E7EB',
        boxShadow: isDark
          ? '0 1px 3px rgba(0,0,0,0.4)'
          : '0 1px 3px rgba(0,0,0,0.08)',
      }}
      styles={{ body: { padding: '16px 20px' } }}
    >
      <Text style={{ fontSize: 12, color: isDark ? '#8B949E' : '#6B7280' }}>{title}</Text>

      <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <Tooltip title={fullValue}>
          <Title
            level={3}
            style={{
              margin: 0,
              color: color,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: '-0.5px',
              cursor: fullValue ? 'help' : undefined,
            }}
          >
            {value}
          </Title>
        </Tooltip>
        {suffix && (
          <Text style={{ color: isDark ? '#8B949E' : '#9CA3AF', fontSize: 13 }}>{suffix}</Text>
        )}
      </div>

      {mom !== undefined && (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
          {momIcon}
          <Text style={{ fontSize: 12, color: momColor }}>{formatMom(mom)} 环比</Text>
        </div>
      )}
    </Card>
  )
}
