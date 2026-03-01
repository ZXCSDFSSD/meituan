import { Row, Col, Card, Typography, Alert, Empty } from 'antd'
import { useGlobalFilter } from '@/stores/globalFilter'
import { useOverview } from '@/hooks/useOverview'
import { useStoreRank } from '@/hooks/useStoreRank'
import { useCategories } from '@/hooks/useCategories'
import KpiCard from '@/components/common/KpiCard'
import DonutChart from '@/components/charts/DonutChart'
import RevenueBarChart from '@/components/charts/RevenueBarChart'
import { formatAmount, formatAmountFull, formatTC, formatAC } from '@/utils/formatters'

const { Title, Text } = Typography

export default function Overview() {
  const { month, selectedStoreId, channel, theme } = useGlobalFilter()
  const isDark = theme === 'dark'

  const { data: ov, loading: ovLoading, error: ovError } = useOverview({
    month,
    store_id: selectedStoreId || undefined,
  })

  const { data: storeRankData, loading: rankLoading } = useStoreRank({
    month,
    channel: channel === 'all' ? undefined : channel,
  })

  const { data: catData, loading: catLoading } = useCategories({
    month,
    store_id: selectedStoreId || undefined,
  })

  // 门店排名（水平柱状图）
  const rankBarData = (storeRankData?.stores ?? []).slice(0, 8).map((s) => ({
    label: s.store_name.replace('常青', '').replace('麦香园', ''),
    value: s.total_amount,
  }))

  // 品类构成（Donut）
  const catDonutData = (catData?.categories ?? []).slice(0, 9).map((c) => ({
    name: c.category,
    value: c.total_amount,
  }))

  // 渠道构成（Donut）— 从 overview.channels 构建
  const channelDonutData = ov
    ? [
        { name: '堂食', value: ov.channels.dine_in.amount },
        { name: '美团外卖', value: ov.channels.meituan.amount },
        { name: '饿了么', value: ov.channels.eleme.amount },
        { name: '京东秒送', value: ov.channels.jd.amount },
      ].filter((d) => d.value > 0)
    : []

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0, color: isDark ? '#E6EDF3' : '#1F2937' }}>
          区域总览
        </Title>
        <Text style={{ color: isDark ? '#8B949E' : '#6B7280', fontSize: 13 }}>
          {month} · {selectedStoreId
            ? (storeRankData?.stores.find((s) => s.store_id === selectedStoreId)?.store_name ?? selectedStoreId)
            : `全区域（${ov?.store_count ?? '-'} 家门店）`}
        </Text>
      </div>

      {ovError && (
        <Alert
          message={`数据加载失败：${ovError}`}
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {/* KPI 卡片行 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            title="营业额"
            value={formatAmount(ov?.summary.total_amount)}
            fullValue={formatAmountFull(ov?.summary.total_amount)}
            color="#4ECDC4"
            loading={ovLoading}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            title="订单数 (TC)"
            value={formatTC(ov?.summary.order_count)}
            color="#FFB347"
            loading={ovLoading}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            title="客单价 (AC)"
            value={formatAC(ov?.summary.avg_ac)}
            color="#5B9BD5"
            loading={ovLoading}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            title="优惠金额"
            value={formatAmount(ov?.summary.total_discount)}
            fullValue={formatAmountFull(ov?.summary.total_discount)}
            color="#A78BFA"
            loading={ovLoading}
          />
        </Col>
      </Row>

      {/* 图表行：门店排名 + 品类构成 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {!selectedStoreId && (
          <Col xs={24} lg={14}>
            <Card
              title={<span style={{ fontSize: 13 }}>门店营业额排名</span>}
              bordered={false}
              loading={rankLoading}
              style={{
                background: isDark ? '#161B22' : '#FFFFFF',
                border: isDark ? '1px solid #21262D' : '1px solid #E5E7EB',
                borderRadius: 12,
              }}
              styles={{ body: { paddingTop: 0 } }}
            >
              {rankBarData.length > 0
                ? <RevenueBarChart data={rankBarData} horizontal height={280} />
                : <Empty description="暂无数据" />
              }
            </Card>
          </Col>
        )}

        <Col xs={24} lg={selectedStoreId ? 12 : 10}>
          <Card
            title={<span style={{ fontSize: 13 }}>品类营业额构成</span>}
            bordered={false}
            loading={catLoading}
            style={{
              background: isDark ? '#161B22' : '#FFFFFF',
              border: isDark ? '1px solid #21262D' : '1px solid #E5E7EB',
              borderRadius: 12,
            }}
            styles={{ body: { paddingTop: 0 } }}
          >
            {catDonutData.length > 0
              ? <DonutChart data={catDonutData} colorKey="auto" height={280} />
              : <Empty description="暂无数据" />
            }
          </Card>
        </Col>

        {/* 渠道构成（全区域时显示） */}
        {!selectedStoreId && channelDonutData.length > 0 && (
          <Col xs={24} lg={10}>
            <Card
              title={<span style={{ fontSize: 13 }}>渠道营业额构成</span>}
              bordered={false}
              loading={ovLoading}
              style={{
                background: isDark ? '#161B22' : '#FFFFFF',
                border: isDark ? '1px solid #21262D' : '1px solid #E5E7EB',
                borderRadius: 12,
              }}
              styles={{ body: { paddingTop: 0 } }}
            >
              <DonutChart data={channelDonutData} colorKey="channel" height={280} />
            </Card>
          </Col>
        )}
      </Row>
    </div>
  )
}
