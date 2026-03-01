/**
 * 数据处理流程编排 v2
 *
 * 三种报表文件的完整处理链：
 *
 *  菜品销售明细  → 读 → 提取 stores → 解析品项 → 写 order_dishes + item_sales_summary + timeslot_summary
 *
 *  全渠道订单明细 → 读 → 解析订单 → 按 store_name 查 store_id
 *                → 写 orders → 计算 sales_summary(+channel) / monthly_summary(+channel)
 *
 *  收款明细      → 读 → 解析聚合 → 按 store_name 查 store_id
 *                → 写 payment_method_summary
 *
 * 注意：菜品销售明细是唯一含 机构编码 的报表，应优先处理，以便其他报表能查到 store_id。
 */

'use strict';

const path   = require('path');
const db     = require('./database');
const parser = require('./parser');

// ── 菜品销售明细处理流程 ──────────────────────────────────────────────────────

async function processDishSales(excelFilePath, log = console.log) {
    const result = {
        fileType: 'dish_sales',
        file: path.basename(excelFilePath),
        startTime: new Date().toISOString(),
        stores: 0, dishes: 0, items: 0, timeslots: 0,
        status: 'processing', error: null, endTime: null,
    };

    // 1. 读取
    log(`\n📖 读取菜品销售明细 Excel`);
    const rows = await parser.readDishSalesFile(excelFilePath, log);

    if (rows.length === 0) {
        log(`⚠️  无数据，跳过`);
        result.status = 'skipped';
        result.endTime = new Date().toISOString();
        return result;
    }

    // 2. 提取并更新 stores 表（机构编码来源）
    log(`\n🏪 第1步：更新门店信息`);
    const stores = parser.extractStoresFromDishSales(rows);
    result.stores = await parser.saveStoresToDB(stores, log);

    // 3. 解析品项明细
    log(`\n📝 第2步：解析品项数据`);
    const items = parser.parseDishSalesData(rows, log);

    if (items.length === 0) {
        log(`⚠️  无有效菜品数据，跳过`);
        result.status = 'skipped';
        result.endTime = new Date().toISOString();
        return result;
    }

    // 4. 写入 order_dishes（品项级明细，用于关联分析）
    log(`\n💾 第3步：写入品项明细`);
    const dishResult = await parser.saveDishesToDB(items, log);
    result.dishes = dishResult.inserted;

    // 5. 写入 item_sales_summary（按门店+日期+品项聚合）
    log(`\n📊 第4步：写入品项销售汇总`);
    const summaryResult = await parser.saveDishSalesToDB(items, log);
    result.items = summaryResult.inserted;

    // 6. 写入 timeslot_summary（按门店+日期+小时+渠道聚合，来自点菜时间）
    log(`\n⏱  第5步：写入时段销售统计`);
    const timeslotRows   = parser.calculateTimeslotFromItems(items);
    const timeslotResult = await parser.saveTimeslotsToDB(timeslotRows, log);
    result.timeslots = timeslotResult.inserted;

    result.status  = 'success';
    result.endTime = new Date().toISOString();
    log(`\n✅ 菜品销售明细处理完成: ${result.stores} 门店更新 / ${result.dishes} 品项记录 / ${result.items} 汇总条目 / ${result.timeslots} 时段统计`);
    return result;
}

// ── 全渠道订单明细处理流程 ────────────────────────────────────────────────────

async function processChannelOrders(excelFilePath, log = console.log) {
    const result = {
        fileType: 'channel_orders',
        file: path.basename(excelFilePath),
        startTime: new Date().toISOString(),
        orders: 0, duplicate: 0,
        stores_covered: 0, dates: 0, months: 0,
        status: 'processing', error: null, endTime: null,
    };

    // 1. 读取（1 个 Sheet）
    log(`\n📖 第1步：读取全渠道订单明细 Excel`);
    const { orderData } = await parser.readChannelOrdersFile(excelFilePath, log);

    // 2. 解析订单
    log(`\n📝 第2步：解析订单数据`);
    const orders = parser.parseOrders(orderData, log);

    if (orders.length === 0) {
        log(`⚠️  无有效订单，跳过`);
        result.status = 'skipped';
        result.endTime = new Date().toISOString();
        return result;
    }

    // 3. 加载 store_name → store_id 映射
    log(`\n🔍 第3步：加载门店映射`);
    const storeNameMap = await parser.buildStoreNameMap();
    log(`   已加载 ${storeNameMap.size} 家门店映射`);

    // 4. 写入 orders
    log(`\n💾 第4步：写入订单`);
    const saveResult = await parser.saveOrdersToDB(orders, storeNameMap, log);
    result.orders    = saveResult.inserted;
    result.duplicate = saveResult.duplicate;

    if (saveResult.inserted === 0) {
        log(`⏭  全部重复，统计数据无需重算`);
        result.status  = 'skipped';
        result.endTime = new Date().toISOString();
        return result;
    }

    // 5. 计算销售统计（日度 + 月度，按门店 × 渠道）
    log(`\n📊 第5步：计算销售统计`);

    // 收集需要重算的门店×日期×月份（只处理新写入的订单）
    const storeMap = new Map();
    for (const o of orders) {
        if (!o.business_date || !o.store_name) continue;
        const storeId = storeNameMap.get(o.store_name);
        if (!storeId) continue;
        if (!storeMap.has(storeId)) {
            storeMap.set(storeId, { name: o.store_name, dates: new Set(), months: new Set() });
        }
        storeMap.get(storeId).dates.add(o.business_date);
        storeMap.get(storeId).months.add(o.order_month);
    }

    result.stores_covered = storeMap.size;
    log(`   涉及 ${storeMap.size} 个门店`);

    for (const [storeId, { name: storeName, dates, months }] of storeMap) {
        log(`   门店: ${storeName} (${storeId}) — ${dates.size} 天`);

        // 日度统计（含渠道拆分）
        for (const date of dates) {
            const summaries = await parser.calculateDailySales(storeId, date);
            for (const s of summaries) {
                await db.run(
                    `INSERT OR REPLACE INTO sales_summary
                    (id, store_id, store_name, date, month, channel,
                     total_amount, total_income, total_discount,
                     discount_ratio, order_count, avg_order_amount, updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
                    [
                        s.id, storeId, storeName, s.date, s.month, s.channel,
                        s.total_amount, s.total_income, s.total_discount,
                        s.discount_ratio, s.order_count, s.avg_order_amount,
                    ]
                );
                if (s.channel === 'all') result.dates++;
            }
        }

        // 月度统计（含渠道拆分）
        for (const month of months) {
            const summaries = await parser.calculateMonthlySales(storeId, month);
            for (const s of summaries) {
                await db.run(
                    `INSERT OR REPLACE INTO monthly_summary
                    (id, store_id, store_name, month, channel,
                     total_amount, total_income, total_discount,
                     discount_ratio, order_count, avg_order_amount, updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
                    [
                        s.id, storeId, storeName, s.month, s.channel,
                        s.total_amount, s.total_income, s.total_discount,
                        s.discount_ratio, s.order_count, s.avg_order_amount,
                    ]
                );
                if (s.channel === 'all') result.months++;
            }
        }
    }

    result.status  = 'success';
    result.endTime = new Date().toISOString();
    log(`\n✅ 订单处理完成: ${result.orders} 新订单 / ${result.dates} 日统计 / ${result.months} 月统计`);
    return result;
}

// ── 收款明细处理流程 ──────────────────────────────────────────────────────────

async function processPaymentsDetail(excelFilePath, log = console.log) {
    const result = {
        fileType: 'payments',
        file: path.basename(excelFilePath),
        startTime: new Date().toISOString(),
        records: 0,
        status: 'processing', error: null, endTime: null,
    };

    // 1. 读取
    log(`\n📖 读取收款明细 Excel`);
    const rows = await parser.readPaymentsDetailFile(excelFilePath, log);

    // 2. 解析（按门店+日期+结账方式+业务子类聚合）
    log(`\n📝 解析收款数据`);
    const records = parser.parsePaymentRecords(rows, log);

    if (records.length === 0) {
        log(`⚠️  无有效收款数据，跳过`);
        result.status = 'skipped';
        result.endTime = new Date().toISOString();
        return result;
    }

    // 3. 加载 store_name → store_id 映射
    const storeNameMap = await parser.buildStoreNameMap();

    // 4. 写入 payment_method_summary
    log(`\n💾 写入收款汇总`);
    const saveResult = await parser.savePaymentsToDB(records, storeNameMap, log);

    // 5. 修补历史 store_id=null（首次导入时门店表可能尚未建立）
    await db.run(
        `UPDATE payment_method_summary
         SET store_id = (SELECT s.store_id FROM stores s WHERE s.store_name = payment_method_summary.store_name LIMIT 1)
         WHERE store_id IS NULL`
    );

    result.records = saveResult.inserted;
    result.status  = 'success';
    result.endTime = new Date().toISOString();
    log(`\n✅ 收款明细处理完成: ${result.records} 条汇总`);
    return result;
}

// ── 统一入口（按文件类型路由）────────────────────────────────────────────────

/**
 * 处理单个 Excel 文件，自动识别类型并路由到对应处理流程
 */
async function processDataPipeline(excelFilePath, log = console.log) {
    const filename = path.basename(excelFilePath);
    const fileType = parser.detectFileType(filename);

    log(`\n${'='.repeat(60)}`);
    log(`🔄 开始处理: ${filename}`);
    log(`   类型: ${fileType}`);
    log(`${'='.repeat(60)}`);

    try {
        switch (fileType) {
            case 'dish_sales':
                // 优先处理：建立 store_id 映射
                return await processDishSales(excelFilePath, log);
            case 'channel_orders':
                return await processChannelOrders(excelFilePath, log);
            case 'payments':
                return await processPaymentsDetail(excelFilePath, log);
            default:
                log(`⚠️  未知文件类型，跳过: ${filename}`);
                return {
                    fileType: 'unknown', file: filename, status: 'skipped',
                    error: '无法识别文件类型（文件名需包含：全渠道订单明细 / 菜品销售明细 / 收款明细）',
                };
        }
    } catch (e) {
        log(`\n❌ 处理失败: ${e.message}`);
        log(e.stack);
        return {
            fileType, file: filename, status: 'failed',
            error: e.message, endTime: new Date().toISOString(),
        };
    }
}

/**
 * 按推荐顺序处理同一时间段的三个文件：
 * 菜品销售明细 → 全渠道订单明细 → 收款明细
 * （菜品销售明细需先处理，以建立 store_id 映射）
 */
async function processThreeFiles(dishSalesPath, channelOrdersPath, paymentsPath, log = console.log) {
    const results = [];

    if (dishSalesPath) {
        log('\n【1/3】处理菜品销售明细');
        results.push(await processDataPipeline(dishSalesPath, log));
    }
    if (channelOrdersPath) {
        log('\n【2/3】处理全渠道订单明细');
        results.push(await processDataPipeline(channelOrdersPath, log));
    }
    if (paymentsPath) {
        log('\n【3/3】处理收款明细');
        results.push(await processDataPipeline(paymentsPath, log));
    }

    return results;
}

// ── 去重检查 ──────────────────────────────────────────────────────────────────

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

async function isMonthDataExists(fileType, month) {
    switch (fileType) {
        case 'channel_orders': return isChannelOrdersExists(month);
        case 'dish_sales':     return isDishSalesExists(month);
        case 'payments':       return isPaymentsExists(month);
        default:               return false;
    }
}

// ── 重新计算统计（用于修复数据）──────────────────────────────────────────────

/**
 * 重新计算指定门店+日期的日度和月度统计
 */
async function recalculateSummary(storeId, date, log = console.log) {
    const month = date.substring(0, 7);
    const storeName = (await db.queryOne(
        `SELECT store_name FROM stores WHERE store_id = ?`, [storeId]
    ))?.store_name || storeId;

    log(`🔄 重算统计: ${storeId} ${date}`);

    const dailySummaries = await parser.calculateDailySales(storeId, date);
    for (const s of dailySummaries) {
        await db.run(
            `INSERT OR REPLACE INTO sales_summary
            (id, store_id, store_name, date, month, channel,
             total_amount, total_income, total_discount,
             discount_ratio, order_count, avg_order_amount, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
            [
                s.id, storeId, storeName, s.date, s.month, s.channel,
                s.total_amount, s.total_income, s.total_discount,
                s.discount_ratio, s.order_count, s.avg_order_amount,
            ]
        );
    }

    const monthlySummaries = await parser.calculateMonthlySales(storeId, month);
    for (const s of monthlySummaries) {
        await db.run(
            `INSERT OR REPLACE INTO monthly_summary
            (id, store_id, store_name, month, channel,
             total_amount, total_income, total_discount,
             discount_ratio, order_count, avg_order_amount, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
            [
                s.id, storeId, storeName, s.month, s.channel,
                s.total_amount, s.total_income, s.total_discount,
                s.discount_ratio, s.order_count, s.avg_order_amount,
            ]
        );
    }

    log(`✅ 重算完成: ${dailySummaries.length} 日统计 / ${monthlySummaries.length} 月统计`);
    return { daily: dailySummaries.length, monthly: monthlySummaries.length };
}

module.exports = {
    processDataPipeline,
    processThreeFiles,
    processChannelOrders,
    processDishSales,
    processPaymentsDetail,
    recalculateSummary,
    isMonthDataExists,
    isChannelOrdersExists,
    isDishSalesExists,
    isPaymentsExists,
};
