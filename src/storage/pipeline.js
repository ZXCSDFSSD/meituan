/**
 * 数据处理流程编排
 *
 * 三种报表文件的完整处理链：
 *
 *  全渠道订单明细  → 读3个Sheet → 解析 → 写 orders/order_dishes/order_payments
 *                 → 计算 sales_summary / item_sales_summary / monthly_summary
 *
 *  菜品销售明细    → 读Sheet → 解析 → 直接写 item_sales_summary（INSERT OR REPLACE）
 *
 *  收款明细        → 读Sheet → 按店/日/方式聚合 → 写 payment_method_summary
 */

'use strict';

const path       = require('path');
const db         = require('./database');
const dataParser = require('./parser');

// ── 全渠道订单明细处理流程 ────────────────────────────────────────────────────

async function processChannelOrders(excelFilePath, log = console.log) {
    const result = {
        fileType: 'channel_orders',
        file: path.basename(excelFilePath),
        startTime: new Date().toISOString(),
        orders: 0, dishes: 0, payments: 0,
        stores: 0, dates: 0, months: 0,
        status: 'processing', error: null, endTime: null
    };

    // 1. 读 Excel
    log(`\n📖 第1步：读取全渠道订单明细 Excel`);
    const { orderData, dishData, paymentData } = await dataParser.readChannelOrdersFile(excelFilePath, log);

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
                     total_discount,discount_ratio,order_count,avg_order_amount,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
                    [ds.id, storeId, storeName, ds.date, ds.date.substring(0, 7),
                     ds.total_revenue, ds.total_sales, ds.total_discount,
                     ds.discount_ratio, ds.order_count, ds.avg_order_amount]
                );
                result.dates++;
            }

            // 菜品统计（从 order_dishes 聚合）
            const itemStats = await dataParser.calculateItemSales(storeId, date);
            for (const item of itemStats) {
                await db.run(
                    `INSERT OR REPLACE INTO item_sales_summary
                    (id,store_id,store_name,item_id,item_name,category,date,month,
                     total_quantity,total_amount,order_count,contribution_ratio,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
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
                     total_discount,discount_ratio,order_count,avg_order_amount,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
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
}

// ── 菜品销售明细处理流程 ──────────────────────────────────────────────────────

async function processDishSales(excelFilePath, log = console.log) {
    const result = {
        fileType: 'dish_sales',
        file: path.basename(excelFilePath),
        startTime: new Date().toISOString(),
        items: 0,
        status: 'processing', error: null, endTime: null
    };

    // 1. 读取
    log(`\n📖 读取菜品销售明细 Excel`);
    const rows = await dataParser.readDishSalesFile(excelFilePath, log);

    // 2. 解析
    log(`\n📝 解析菜品销售数据`);
    const items = dataParser.parseDishSalesData(rows, log);

    if (items.length === 0) {
        log(`⚠️  无有效菜品销售数据，跳过`);
        result.status = 'skipped';
        result.endTime = new Date().toISOString();
        return result;
    }

    // 3. 写入 item_sales_summary（INSERT OR REPLACE，覆盖旧数据）
    log(`\n💾 写入 item_sales_summary`);
    const saveResult = await dataParser.saveDishSalesToDB(items, log);

    result.status  = 'success';
    result.items   = saveResult.inserted;
    result.endTime = new Date().toISOString();

    log(`\n✅ 菜品销售明细导入完成: ${saveResult.inserted} 条`);
    return result;
}

// ── 收款明细处理流程 ──────────────────────────────────────────────────────────

async function processPaymentsDetail(excelFilePath, log = console.log) {
    const result = {
        fileType: 'payments',
        file: path.basename(excelFilePath),
        startTime: new Date().toISOString(),
        records: 0,
        status: 'processing', error: null, endTime: null
    };

    // 1. 读取
    log(`\n📖 读取收款明细 Excel`);
    const rows = await dataParser.readPaymentsDetailFile(excelFilePath, log);

    // 2. 解析（按店/日/方式聚合）
    log(`\n📝 解析收款数据`);
    const records = dataParser.parsePaymentRecords(rows, log);

    if (records.length === 0) {
        log(`⚠️  无有效收款数据，跳过`);
        result.status = 'skipped';
        result.endTime = new Date().toISOString();
        return result;
    }

    // 3. 写入 payment_method_summary（INSERT OR REPLACE）
    log(`\n💾 写入 payment_method_summary`);
    const saveResult = await dataParser.savePaymentMethodSummary(records, log);

    result.status  = 'success';
    result.records = saveResult.inserted;
    result.endTime = new Date().toISOString();

    log(`\n✅ 收款明细导入完成: ${saveResult.inserted} 条`);
    return result;
}

// ── 统一入口（按文件类型路由）────────────────────────────────────────────────

/**
 * 处理单个 Excel 文件，自动识别类型并路由到对应处理流程
 */
async function processDataPipeline(excelFilePath, log = console.log) {
    const filename = path.basename(excelFilePath);
    const fileType = dataParser.detectFileType(filename);

    log(`\n${'='.repeat(60)}`);
    log(`🔄 开始处理: ${filename}`);
    log(`   类型: ${fileType}`);
    log(`${'='.repeat(60)}`);

    try {
        switch (fileType) {
            case 'channel_orders':
                return await processChannelOrders(excelFilePath, log);
            case 'dish_sales':
                return await processDishSales(excelFilePath, log);
            case 'payments':
                return await processPaymentsDetail(excelFilePath, log);
            default:
                log(`⚠️  未知文件类型，跳过: ${filename}`);
                return { fileType: 'unknown', file: filename, status: 'skipped',
                         error: '无法识别文件类型（文件名需包含：全渠道订单明细/菜品销售明细/收款明细）' };
        }
    } catch (e) {
        log(`\n❌ 处理失败: ${e.message}`);
        return {
            fileType, file: filename, status: 'failed',
            error: e.message, endTime: new Date().toISOString()
        };
    }
}

// ── 去重检查（各文件类型独立判断）────────────────────────────────────────────

async function isChannelOrdersExists(month) {
    const r = await db.queryOne(
        `SELECT COUNT(*) AS cnt FROM orders WHERE order_month = ?`, [month]
    );
    return r && r.cnt > 0;
}

async function isDishSalesExists(month) {
    const r = await db.queryOne(
        `SELECT COUNT(*) AS cnt FROM item_sales_summary WHERE month = ?`, [month]
    );
    return r && r.cnt > 0;
}

async function isPaymentsExists(month) {
    const r = await db.queryOne(
        `SELECT COUNT(*) AS cnt FROM payment_method_summary WHERE month = ?`, [month]
    );
    return r && r.cnt > 0;
}

/** 按文件类型检查对应月份数据是否已存在 */
async function isMonthDataExists(fileType, month) {
    switch (fileType) {
        case 'channel_orders': return isChannelOrdersExists(month);
        case 'dish_sales':     return isDishSalesExists(month);
        case 'payments':       return isPaymentsExists(month);
        default:               return false;
    }
}

module.exports = {
    processDataPipeline,
    processChannelOrders,
    processDishSales,
    processPaymentsDetail,
    isMonthDataExists,
    isChannelOrdersExists,
    isDishSalesExists,
    isPaymentsExists,
};
