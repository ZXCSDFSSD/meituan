/**
 * 数据处理流程编排
 * 读 Excel → 解析 → 存入3张表 → 计算统计数据
 */

'use strict';

const path       = require('path');
const db         = require('./database');
const dataParser = require('./parser');

// ── 核心流程 ──────────────────────────────────────────────────────────────────

async function processDataPipeline(excelFilePath, log = console.log) {
    const result = {
        status: 'processing',
        file: path.basename(excelFilePath),
        startTime: new Date().toISOString(),
        orders: 0, dishes: 0, payments: 0,
        stores: 0, dates: 0, months: 0,
        error: null, endTime: null
    };

    try {
        log(`\n${'='.repeat(60)}`);
        log(`🔄 开始处理: ${path.basename(excelFilePath)}`);
        log(`${'='.repeat(60)}`);

        // 1. 读 Excel
        log(`\n📖 第1步：读取 Excel`);
        const { orderData, dishData, paymentData } = await dataParser.readExcelFile(excelFilePath, log);

        // 2. 解析
        log(`\n📝 第2步：解析数据`);
        const { orders, dishes, payments } = dataParser.parseAllData(orderData, dishData, paymentData, log);
        log(`✅ 解析完成: ${orders.length} 订单 / ${dishes.length} 菜品 / ${payments.length} 支付`);

        if (orders.length === 0) {
            log(`⚠️  无有效订单，跳过`);
            result.status = 'skipped';
            result.endTime = new Date().toISOString();
            return result;
        }

        // 3. 存入数据库
        log(`\n💾 第3步：保存到数据库`);
        const saveResult = await dataParser.saveToDatabase(orders, dishes, payments, log);

        if (saveResult.insertedOrders === 0 && saveResult.duplicateOrders > 0) {
            log(`⏭  全部重复，统计数据无需重算`);
            result.status = 'skipped';
            result.orders = saveResult.duplicateOrders;
            result.endTime = new Date().toISOString();
            return result;
        }

        // 4. 计算统计数据（门店 × 日期 × 月份）
        log(`\n📊 第4步：计算统计数据`);

        const storeMap = new Map();
        for (const o of orders) {
            if (!o.business_date) continue;
            if (!storeMap.has(o.store_id)) {
                storeMap.set(o.store_id, { name: o.store_name, dates: new Set(), months: new Set() });
            }
            storeMap.get(o.store_id).dates.add(o.business_date);
            storeMap.get(o.store_id).months.add(o.order_month);
        }

        result.stores = storeMap.size;
        log(`   涉及 ${storeMap.size} 个门店`);

        for (const [storeId, { name: storeName, dates, months }] of storeMap) {
            log(`   门店: ${storeName} (${storeId}) — ${dates.size} 天`);

            for (const date of dates) {
                // 日度统计
                const ds = await dataParser.calculateDailySales(storeId, date);
                if (ds) {
                    await db.run(
                        `INSERT OR REPLACE INTO sales_summary
                        (id,store_id,store_name,date,month,total_revenue,total_sales,
                         total_discount,discount_ratio,order_count,avg_order_amount)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
                        [ds.id, storeId, storeName, ds.date, ds.date.substring(0, 7),
                         ds.total_revenue, ds.total_sales, ds.total_discount,
                         ds.discount_ratio, ds.order_count, ds.avg_order_amount]
                    );
                    result.dates++;
                }

                // 菜品统计
                const itemStats = await dataParser.calculateItemSales(storeId, date);
                for (const item of itemStats) {
                    await db.run(
                        `INSERT OR REPLACE INTO item_sales_summary
                        (id,store_id,store_name,item_id,item_name,category,date,month,
                         total_quantity,total_amount,order_count,contribution_ratio)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
                        [item.id, storeId, storeName, item.item_id, item.item_name, item.category,
                         item.date, item.date.substring(0, 7), item.total_quantity,
                         item.total_amount, item.order_count, item.contribution_ratio]
                    );
                }
            }

            // 月度统计
            for (const month of months) {
                const ms = await dataParser.calculateMonthlySales(storeId, month);
                if (ms) {
                    await db.run(
                        `INSERT OR REPLACE INTO monthly_summary
                        (id,store_id,store_name,month,total_revenue,total_sales,
                         total_discount,discount_ratio,order_count,avg_order_amount)
                        VALUES (?,?,?,?,?,?,?,?,?,?)`,
                        [ms.id, storeId, storeName, ms.month, ms.total_revenue,
                         ms.total_sales, ms.total_discount, ms.discount_ratio,
                         ms.order_count, ms.avg_order_amount]
                    );
                    result.months++;
                }
            }
        }

        result.status   = 'success';
        result.orders   = orders.length;
        result.dishes   = dishes.length;
        result.payments = payments.length;
        result.endTime  = new Date().toISOString();

        log(`\n✅ 完成: ${orders.length} 订单 / ${dishes.length} 菜品 / ${payments.length} 支付 / ${storeMap.size} 门店`);
        return result;

    } catch (e) {
        log(`\n❌ 处理失败: ${e.message}`);
        result.status = 'failed';
        result.error  = e.message;
        result.endTime = new Date().toISOString();
        throw e;
    }
}

/**
 * 检查某个月的数据是否已存在
 */
async function isMonthDataExists(month) {
    const r = await db.queryOne(
        `SELECT COUNT(*) AS cnt FROM orders WHERE order_month = ?`, [month]
    );
    return r && r.cnt > 0;
}

module.exports = { processDataPipeline, isMonthDataExists };
