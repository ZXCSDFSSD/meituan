/**
 * MonthlyPivotTable — 月度环比数据表（AntD Table 实现）
 *
 * 展示门店近几个月的关键指标：营业额 / TC / AC / 优惠率
 * 每行 = 一个月份，列 = 指标 + 环比
 */

import { Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { StoreTrendPoint } from '@/types/api'

interface Props {
  data: StoreTrendPoint[]
  height?: number
}

interface TableRow {
  key: string
  month: string
  revenue: string
  revenueMom: string | null
  tc: string
  tcMom: string | null
  ac: string
  acMom: string | null
  discountRate: string
}

function fmtAmount(v: number) {
  if (!v && v !== 0) return '-'
  return v >= 10000
    ? `${(v / 10000).toFixed(1)}万`
    : `¥${v.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`
}

function fmtMom(v: number | null): string | null {
  if (v == null) return null
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}%`
}

function calcMom(curr: number, prev: number): number | null {
  if (!prev) return null
  return +((curr - prev) / prev * 100).toFixed(1)
}

function MomCell({ value }: { value: string | null }) {
  if (value == null) return <span style={{ color: '#9CA3AF' }}>—</span>
  const positive = value.startsWith('+')
  return (
    <span style={{ color: positive ? '#4ADE80' : '#F87171', fontSize: 12 }}>
      {value}
    </span>
  )
}

export default function S2MonthlyPivot({ data }: Props) {
  if (data.length === 0) return null

  // 构建表格行（最新月份在前）
  const rows: TableRow[] = [...data].reverse().map((d, idx, arr) => {
    const prev = idx < arr.length - 1 ? arr[idx + 1] : null
    return {
      key: d.month,
      month: d.month,
      revenue:     fmtAmount(d.total_amount),
      revenueMom:  prev ? fmtMom(calcMom(d.total_amount, prev.total_amount)) : null,
      tc:          String(d.order_count),
      tcMom:       prev ? fmtMom(calcMom(d.order_count, prev.order_count)) : null,
      ac:          `¥${d.avg_order_amount.toFixed(1)}`,
      acMom:       prev ? fmtMom(calcMom(d.avg_order_amount, prev.avg_order_amount)) : null,
      discountRate: d.total_amount > 0
        ? `${(d.total_discount / d.total_amount * 100).toFixed(1)}%`
        : '0.0%',
    }
  })

  const columns: ColumnsType<TableRow> = [
    { title: '月份', dataIndex: 'month', width: 80, fixed: 'left' },
    {
      title: '营业额', dataIndex: 'revenue', width: 80,
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: '环比', dataIndex: 'revenueMom', width: 72,
      render: (v: string | null) => <MomCell value={v} />,
    },
    {
      title: 'TC（单）', dataIndex: 'tc', width: 70,
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: '环比', dataIndex: 'tcMom', width: 72,
      render: (v: string | null) => <MomCell value={v} />,
    },
    {
      title: 'AC（元）', dataIndex: 'ac', width: 76,
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: '环比', dataIndex: 'acMom', width: 72,
      render: (v: string | null) => <MomCell value={v} />,
    },
    { title: '优惠率', dataIndex: 'discountRate', width: 72 },
  ]

  return (
    <Table
      dataSource={rows}
      columns={columns}
      rowKey="month"
      size="small"
      pagination={false}
      scroll={{ x: 'max-content' }}
    />
  )
}
