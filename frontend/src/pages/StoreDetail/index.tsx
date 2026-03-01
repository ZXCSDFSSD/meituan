/**
 * StoreDetail — 单店详情页
 *
 * ════════════════════════════════════════════
 * 【页面结构（5行布局）】
 *   顶部：门店选择器 + 渠道选择器
 *   Row 1: 4 个 KPI 卡片（营业额 / TC / AC / 优惠率）
 *   Row 2: 营业额趋势折线图（左 14格）+ 渠道占比圆环图（右 10格）
 *   Row 3: 品类 Top8 横向条形图（左 14格）+ 24h 时段面积图（右 10格）
 *   Row 4: 品项销售 TOP20 表格（左 14格）+ 收款方式圆环图（右 10格）
 *   Row 5: S2 月度环比透视表（全宽，仅有多个月数据时显示）
 *
 * 【Ant Design Grid 布局系统（12格）】
 *   AntD 把每行分成 12 格（span=12 是半宽）。
 *   xs={12} → 手机竖屏（小屏），2 列布局（各占半宽）
 *   sm={6}  → 平板以上，4 列布局（各占四分之一宽）
 *   lg={14} → 桌面大屏，左侧占 14/24
 *   这样同一套代码可以在手机和桌面上都有合理的布局。
 *
 * 【数据来源】
 *   useStoreDetail → 从 /api/analytics/store-detail/:id 获取门店详情
 *   useProducts    → 从 /api/analytics/products 获取品项排行
 * ════════════════════════════════════════════
 */

import { Row, Col, Card, Typography, Alert, Table, Tag, Empty } from 'antd'
import { ShopOutlined } from '@ant-design/icons'
import { useGlobalFilter } from '@/stores/globalFilter'
import { useStoreDetail } from '@/hooks/useStoreDetail'
import { useProducts } from '@/hooks/useProducts'
import KpiCard from '@/components/common/KpiCard'
import StoreTrendChart from '@/components/charts/StoreTrendChart'
import CategoryBarChart from '@/components/charts/CategoryBarChart'
import TimeslotAreaChart from '@/components/charts/TimeslotAreaChart'
import DonutChart from '@/components/charts/DonutChart'
import S2MonthlyPivot from '@/components/charts/S2MonthlyPivot'
import {
  formatAmount, formatAmountFull,
  formatTC, formatAC,
} from '@/utils/formatters'
import type { ColumnsType } from 'antd/es/table'
import type { ProductItem } from '@/types/api'

/**
 * Typography — AntD 排版组件
 *   Typography.Title  → 标题（h1-h6 级别）
 *   Typography.Text   → 行内文本（可设颜色、粗细等）
 *
 * 解构赋值写法：const { Title, Text } = Typography
 * 等价于：const Title = Typography.Title; const Text = Typography.Text;
 */
const { Title, Text } = Typography

/**
 * cardStyle — 根据主题返回 Card 的样式对象
 * 是一个普通函数，不是组件（没有 JSX 返回值）。
 * 以函数形式定义是因为暗色/亮色样式不同，需要 isDark 参数。
 *
 * 【CSS-in-JS 风格】
 *   React 中可以把样式写成 JS 对象（camelCase 属性名），
 *   通过 style={cardStyle(isDark)} 传给组件。
 */
const cardStyle = (isDark: boolean) => ({
  background:    isDark ? '#161B22' : '#FFFFFF',
  border:        isDark ? '1px solid #21262D' : '1px solid #E5E7EB',
  borderRadius:  12,
})

/**
 * StoreDetail — 页面组件（默认导出）
 *
 * 这个组件没有 Props（不接受外部传入的数据），
 * 所有数据都从 Zustand store 和自定义 Hook 获取。
 */
export default function StoreDetail() {
  /**
   * 从全局 store 读取筛选状态
   * 解构赋值同时读取多个值：const { a, b, c } = useGlobalFilter()
   */
  const { selectedStoreId, storeOptions, month, channel, theme } = useGlobalFilter()
  const isDark = theme === 'dark'

  /**
   * effectiveStoreId — 实际使用的门店 ID
   *
   * 如果用户没选门店（selectedStoreId === ''），
   * 自动使用门店列表的第一个（storeOptions[0]?.store_id）。
   *
   * ?. 是"可选链"：storeOptions[0] 可能是 undefined，
   *    ?. 确保不报错，直接返回 undefined
   * ?? 是"空值合并"：undefined 时用 '' 代替
   */
  const effectiveStoreId = selectedStoreId || (storeOptions[0]?.store_id ?? '')

  /**
   * useStoreDetail — 获取单店详情数据
   *
   * channel === 'all' ? undefined : channel
   *   全渠道时不传 channel 参数（后端默认 all）
   *   这是三元运算符（条件 ? 真值 : 假值）
   */
  const { data: detail, loading: detailLoading, error } = useStoreDetail({
    storeId: effectiveStoreId,
    month,
    channel: channel === 'all' ? undefined : channel,
  })

  /**
   * useProducts — 获取品项排行数据（独立请求，不依赖 useStoreDetail）
   *
   * 【为什么分开请求？】
   *   品项数据来自 /analytics/products 接口，
   *   而其他数据来自 /analytics/store-detail/:id 接口。
   *   分开请求可以并行加载，提升速度。
   *   data 改名为 productsData 避免与 detail 同名冲突（利用 : 重命名解构）
   */
  const { data: productsData, loading: prodLoading } = useProducts({
    month,
    store_id: effectiveStoreId || undefined,
    limit: 20,
  })

  // ── 计算衍生数据 ────────────────────────────────────────────────────

  /**
   * summaryRow — 当月汇总行（对应所选渠道）
   *
   * detail?.channels — 可选链：detail 可能为 null（数据未加载），?.channels 避免报错
   * .find((c) => c.channel === channelKey) — 找到匹配渠道的那一行数据
   *
   * channelKey：全渠道时用 'all'（后端 monthly_summary 中存有 channel='all' 的汇总行）
   */
  const channelKey   = channel === 'all' ? 'all' : channel
  const summaryRow   = detail?.channels.find((c) => c.channel === channelKey)

  /**
   * discountRatio — 优惠率（%）
   *
   * 优惠率 = 优惠金额 / 营业额 × 100
   * 只有当两个值都存在且营业额不为零时才计算，否则为 null。
   * null 时 KpiCard 显示 '--'。
   *
   * 【短路求值】
   * summaryRow?.total_amount && summaryRow?.total_discount
   * 两个都有值（非 0 非 null）时才进入 ? 后面的计算
   */
  const discountRatio = summaryRow?.total_amount && summaryRow?.total_discount
    ? summaryRow.total_discount / summaryRow.total_amount * 100
    : null

  /**
   * channelDonut — 渠道占比圆环图数据
   *
   * .filter((c) => c.channel !== 'all' && c.total_amount > 0)
   *   - 排除 'all' 汇总行（不需要把总计算进占比）
   *   - 排除营业额为 0 的渠道（没有数据就不显示那个扇形）
   *
   * .map((c) => ({ name: c.channel, value: c.total_amount }))
   *   DonutChart 需要的格式：[{ name: '堂食', value: 85000 }, ...]
   *
   * ?? [] — detail 为 null 时用空数组代替（防止对 null 调用 .filter 报错）
   */
  const channelDonut = (detail?.channels ?? [])
    .filter((c) => c.channel !== 'all' && c.total_amount > 0)
    .map((c) => ({ name: c.channel, value: c.total_amount }))

  /** 收款方式圆环图数据（格式同上） */
  const paymentDonut = (detail?.payments ?? [])
    .map((p) => ({ name: p.payment_method, value: p.total_amount }))
    .filter((d) => d.value > 0)

  /** 品项列表（如果没有数据则空数组） */
  const products = productsData?.products ?? []

  // ── 表格列定义 ────────────────────────────────────────────────────

  /**
   * ColumnsType<ProductItem> — AntD Table 列配置的 TypeScript 类型
   *   泛型参数 ProductItem 指定每行数据的类型，
   *   这样 render 函数的参数 v 会有正确的类型提示。
   *
   * 每列配置：
   *   title      → 列标题（显示在表头）
   *   dataIndex  → 数据字段名（从数据对象中取哪个字段）
   *   width      → 列宽（px）
   *   ellipsis   → 超长文字显示省略号（...）
   *   render     → 自定义渲染函数 (值, 整行数据, 行下标) => ReactNode
   */
  const productColumns: ColumnsType<ProductItem> = [
    { title: '排名', dataIndex: 'rank',           width: 48 },
    { title: '品项名称', dataIndex: 'item_name',  ellipsis: true },
    {
      title: '品类', dataIndex: 'category', width: 80,
      render: (v: string) => <Tag>{v}</Tag>,  // 渲染成 AntD Tag 标签
    },
    {
      title: '销售额', dataIndex: 'total_amount', width: 90,
      render: (v: number) => formatAmount(v),
    },
    {
      title: '数量', dataIndex: 'total_quantity', width: 60,
      render: (v: number) => v.toLocaleString(),  // 添加千位分隔符（如 1,234）
    },
  ]

  // 还没有门店数据时，显示空状态提示（用户需要先导入数据）
  if (!effectiveStoreId) {
    return <Empty description="暂无门店数据，请先完成数据导入" style={{ marginTop: 80 }} />
  }

  // ── JSX 渲染 ────────────────────────────────────────────────────────
  return (
    <div>
      {/* ──── 页面顶部：标题 + 门店/渠道选择器 ──── */}
      <div style={{
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',   // 小屏时换行
        gap: 12,
      }}>
        {/* 左侧：图标 + 标题 + 门店属性标签 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ShopOutlined style={{ fontSize: 18, color: isDark ? '#4ECDC4' : '#0891B2' }} />
          <div>
            <Title level={4} style={{ margin: 0, color: isDark ? '#E6EDF3' : '#1F2937' }}>
              单店详情
            </Title>
            <Text style={{ color: isDark ? '#8B949E' : '#6B7280', fontSize: 13 }}>
              {month}
              {/* detail?.store — 可选链，detail 为 null 时不渲染标签 */}
              {detail?.store && (
                <>
                  {' · '}
                  {/* 有合伙人用橙色，无合伙人用青色 */}
                  <Tag color={detail.store.has_partner ? 'orange' : 'cyan'} style={{ marginLeft: 4 }}>
                    {detail.store.location_type ?? '未知'}  {/* 选址类型（社区/商圈/写字楼）*/}
                  </Tag>
                  {detail.store.has_partner ? <Tag color="gold">有合伙</Tag> : null}
                </>
              )}
            </Text>
          </div>
        </div>

      </div>

      {/* 错误提示（只有 error 不为 null 时才渲染） */}
      {error && (
        <Alert message={`加载失败：${error}`} type="error" showIcon style={{ marginBottom: 16 }} />
      )}

      {/* ──── Row 1: KPI 卡片（4个）──── */}
      {/**
       * Row gutter={[16, 16]} — AntD 栅格行
       *   gutter={[水平间距, 垂直间距]} 单位: px
       *   Row 负责分配 12 格，内部的 Col 通过 xs/sm/lg 指定占几格
       */}
      <Row gutter={[16, 16]}>
        {/* xs={12}=手机竖屏2列，sm={6}=平板4列 */}
        <Col xs={12} sm={6}>
          <KpiCard
            title="营业额"
            value={formatAmount(summaryRow?.total_amount)}
            fullValue={formatAmountFull(summaryRow?.total_amount)}  // 展开显示完整金额
            color="#4ECDC4"
            loading={detailLoading}
          />
        </Col>
        <Col xs={12} sm={6}>
          <KpiCard
            title="订单数 (TC)"
            value={formatTC(summaryRow?.order_count)}
            color="#FFB347"
            loading={detailLoading}
          />
        </Col>
        <Col xs={12} sm={6}>
          <KpiCard
            title="客单价 (AC)"
            value={formatAC(summaryRow?.avg_order_amount)}
            color="#5B9BD5"
            loading={detailLoading}
          />
        </Col>
        <Col xs={12} sm={6}>
          <KpiCard
            title="优惠率"
            value={discountRatio != null ? `${discountRatio.toFixed(1)}%` : '--'}
            color="#E8524A"
            loading={detailLoading}
          />
        </Col>
      </Row>

      {/* ──── Row 2: 营业额趋势 + 渠道占比圆环 ──── */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {/* lg={14} — 桌面大屏占 14/24 格（约 58%） */}
        <Col xs={24} lg={14}>
          <Card
            title={<span style={{ fontSize: 13 }}>营业额趋势 + 环比</span>}
            loading={detailLoading}
            style={cardStyle(isDark)}
            styles={{ body: { paddingTop: 0 } }}  // AntD v5 用 styles.body 覆盖内边距
          >
            {/* (detail?.trend ?? []).length > 0 — 有趋势数据才渲染图表，否则显示空状态 */}
            {(detail?.trend ?? []).length > 0 ? (
              <StoreTrendChart data={detail!.trend} height={220} />
              // detail! — TypeScript 非空断言（告诉编译器 detail 此时一定不为 null）
              // 因为前面 .length > 0 已确保 detail 存在
            ) : (
              <Empty description="暂无趋势数据" />
            )}
          </Card>
        </Col>
        {/* lg={10} — 桌面大屏占 10/24 格（约 42%） */}
        <Col xs={24} lg={10}>
          <Card
            title={<span style={{ fontSize: 13 }}>渠道营业额占比</span>}
            loading={detailLoading}
            style={cardStyle(isDark)}
            styles={{ body: { paddingTop: 0 } }}
          >
            {channelDonut.length > 0 ? (
              <DonutChart data={channelDonut} colorKey="channel" height={220} />
            ) : (
              <Empty description="暂无渠道数据" />
            )}
          </Card>
        </Col>
      </Row>

      {/* ──── Row 3: 品类 Top8 + 24h 时段面积图 ──── */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={14}>
          <Card
            title={<span style={{ fontSize: 13 }}>品类销售 Top 8</span>}
            loading={detailLoading}
            style={cardStyle(isDark)}
            styles={{ body: { paddingTop: 0 } }}
          >
            {(detail?.categories ?? []).length > 0 ? (
              <CategoryBarChart data={detail!.categories} height={240} />
            ) : (
              <Empty description="暂无品类数据" />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card
            title={<span style={{ fontSize: 13 }}>24h 点单时段分布</span>}
            loading={detailLoading}
            style={cardStyle(isDark)}
            styles={{ body: { paddingTop: 0 } }}
          >
            {(detail?.hours ?? []).length > 0 ? (
              <TimeslotAreaChart data={detail!.hours} height={240} />
            ) : (
              <Empty description="暂无时段数据" />
            )}
          </Card>
        </Col>
      </Row>

      {/* ──── Row 4: 品项销售排行 + 收款方式圆环 ──── */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={14}>
          <Card
            title={<span style={{ fontSize: 13 }}>品项销售排行 TOP 20</span>}
            loading={prodLoading}
            style={cardStyle(isDark)}
          >
            {/**
             * AntD Table 组件
             * dataSource → 数据数组（每个元素是一行）
             * columns    → 列配置（决定每列显示什么、宽度多少）
             * rowKey     → 每行的唯一 key（类似 React 的 key prop）
             * size="small" → 紧凑样式（行高更小）
             * pagination={false} → 不分页（显示全部 20 条）
             * scroll={{ y: 300 }} → 内容超出 300px 时滚动（固定表头）
             */}
            <Table
              dataSource={products}
              columns={productColumns}
              rowKey="item_id"
              size="small"
              pagination={false}
              scroll={{ y: 300 }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card
            title={<span style={{ fontSize: 13 }}>收款方式构成</span>}
            loading={detailLoading}
            style={cardStyle(isDark)}
            styles={{ body: { paddingTop: 0 } }}
          >
            {paymentDonut.length > 0 ? (
              <DonutChart data={paymentDonut} colorKey="auto" height={300} />
            ) : (
              <Empty description="暂无收款数据" />
            )}
          </Card>
        </Col>
      </Row>

      {/* ──── Row 5: S2 月度环比透视表 ──── */}
      {/**
       * 条件渲染：只有趋势数据超过 1 个月时才显示透视表
       * （只有 1 个月时环比没意义，表格也只有一列，体验差）
       *
       * 【React 条件渲染语法】
       *   {条件 && <JSX>} — 条件为 true 时渲染 JSX，否则不渲染（渲染 false/null）
       *   这是 React 中最常用的"可选渲染"写法
       */}
      {(detail?.trend ?? []).length > 1 && (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col span={24}>
            <Card
              title={<span style={{ fontSize: 13 }}>月度环比透视表（营业额 / TC / AC / 优惠率）</span>}
              style={cardStyle(isDark)}
              styles={{ body: { paddingTop: 0, paddingLeft: 0, paddingRight: 0 } }}
              // paddingLeft/Right: 0 — S2 表格自带边框，Card body 不需要额外内边距
            >
              <S2MonthlyPivot data={detail!.trend} height={260} />
            </Card>
          </Col>
        </Row>
      )}
    </div>
  )
}
