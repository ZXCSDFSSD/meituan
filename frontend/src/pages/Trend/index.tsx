/**
 * Trend — 趋势分析页
 *
 * 同时展示三张趋势折线图（营业额 / 订单数 / 客单价），无需切换标签。
 * 底部附带月度数据明细表格。
 */

import { Row, Col, Card, Typography, Alert, Table, Empty } from 'antd'
import { useGlobalFilter } from '@/stores/globalFilter'
import { useTrend } from '@/hooks/useTrend'
import TrendLineChart from '@/components/charts/TrendLineChart'
import { formatAmount, formatTC, formatAC, formatMom } from '@/utils/formatters'
import type { ColumnsType } from 'antd/es/table'
import type { TrendDataPoint } from '@/types/api'

const { Title, Text } = Typography

export default function Trend() {
  const { month, selectedStoreId, channel, theme } = useGlobalFilter()
  const isDark = theme === 'dark'

  const { data: trendData, loading, error } = useTrend({
    month,
    store_id: selectedStoreId || undefined,
    channel: channel === 'all' ? undefined : channel,
    rangeMonths: 6,
  })

  const points = trendData?.data ?? []

  // 构建每个指标的 series（折线图数据）
  const channelName = channel === 'all' ? '全渠道' : channel

  const makeSeriesList = (valueGetter: (pt: TrendDataPoint) => number) =>
    points.length > 0
      ? [{
          name: channelName,
          channel: channel === 'all' ? 'all' : channel,
          data: points.map((pt) => ({ month: pt.month, value: valueGetter(pt) })),
        }]
      : []

  const revenueSeries = makeSeriesList((pt) => pt.total_amount)
  const ordersSeries  = makeSeriesList((pt) => pt.order_count)
  const acSeries      = makeSeriesList((pt) => pt.avg_ac)

  // 表格数据（最新月份在前）
  const tableData = [...points].reverse()

  const cardStyle = {
    background:   isDark ? '#161B22' : '#FFFFFF',
    border:       isDark ? '1px solid #21262D' : '1px solid #E5E7EB',
    borderRadius: 12,
  }

  const columns: ColumnsType<TrendDataPoint> = [
    { title: '月份', dataIndex: 'month', width: 90 },
    {
      title: '营业额', dataIndex: 'total_amount', width: 110,
      render: (v: number) => formatAmount(v),
    },
    {
      title: '环比', dataIndex: 'mom_pct', width: 80,
      render: (v: number | null) => (
        <Text style={{ color: v == null ? '#9CA3AF' : v >= 0 ? '#4ADE80' : '#F87171' }}>
          {formatMom(v)}
        </Text>
      ),
    },
    {
      title: 'TC（订单）', dataIndex: 'order_count', width: 100,
      render: (v: number) => formatTC(v),
    },
    {
      title: 'AC（客单价）', dataIndex: 'avg_ac', width: 110,
      render: (v: number) => formatAC(v),
    },
  ]

  return (
    <div>
      {/* 页头 */}
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0, color: isDark ? '#E6EDF3' : '#1F2937' }}>
          趋势分析
        </Title>
        <Text style={{ color: isDark ? '#8B949E' : '#6B7280', fontSize: 13 }}>
          近 6 个月 · {trendData?.store_id === 'all' ? '全区域' : (selectedStoreId || '全区域')}
        </Text>
      </div>

      {error && (
        <Alert message={`数据加载失败：${error}`} type="error" showIcon style={{ marginBottom: 16 }} />
      )}

      {/* 三张趋势图并排 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card
            title={<span style={{ fontSize: 13 }}>营业额趋势</span>}
            loading={loading}
            style={cardStyle}
            styles={{ body: { paddingTop: 4 } }}
          >
            {revenueSeries.length > 0
              ? <TrendLineChart seriesList={revenueSeries} metric="revenue" height={200} />
              : <Empty description="暂无数据" style={{ padding: '20px 0' }} />
            }
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card
            title={<span style={{ fontSize: 13 }}>订单数趋势</span>}
            loading={loading}
            style={cardStyle}
            styles={{ body: { paddingTop: 4 } }}
          >
            {ordersSeries.length > 0
              ? <TrendLineChart seriesList={ordersSeries} metric="orders" height={200} />
              : <Empty description="暂无数据" style={{ padding: '20px 0' }} />
            }
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card
            title={<span style={{ fontSize: 13 }}>客单价趋势</span>}
            loading={loading}
            style={cardStyle}
            styles={{ body: { paddingTop: 4 } }}
          >
            {acSeries.length > 0
              ? <TrendLineChart seriesList={acSeries} metric="ac" height={200} />
              : <Empty description="暂无数据" style={{ padding: '20px 0' }} />
            }
          </Card>
        </Col>
      </Row>

      {/* 月度数据明细表格 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card
            title={<span style={{ fontSize: 13 }}>月度数据明细</span>}
            style={cardStyle}
          >
            {tableData.length > 0
              ? (
                <Table
                  dataSource={tableData}
                  columns={columns}
                  rowKey="month"
                  size="small"
                  pagination={false}
                  loading={loading}
                />
              )
              : <Empty description="暂无数据" />
            }
          </Card>
        </Col>
      </Row>
    </div>
  )
}
