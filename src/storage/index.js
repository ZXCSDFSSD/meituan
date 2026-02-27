/**
 * 存储模块入口
 * 对外暴露高层接口，供 API 路由和 main.js 调用
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const db       = require('./database');
const pipeline = require('./pipeline');
const parser   = require('./parser');
const config   = require('../common/config');
const { extractMonthFromFilename, extractReportTypeFromFilename } = require('../common/utils');

// ── 数据库初始化 ──────────────────────────────────────────────────────────────

async function initDatabase(log = console.log) {
    await db.initializeDatabase(log);
}

// ── 导入单个文件 ──────────────────────────────────────────────────────────────

async function importFile(filename, log = console.log) {
    const filePath = path.join(config.downloadDir, filename);
    if (!fs.existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
    }
    return await pipeline.processDataPipeline(filePath, log);
}

// ── 导入全部（幂等）──────────────────────────────────────────────────────────

/**
 * 按文件名中的报表类型前缀分类处理所有 Excel 文件
 * 每种类型 × 月份 独立去重，互不影响
 */
async function importAll(log = console.log) {
    if (!fs.existsSync(config.downloadDir)) {
        throw new Error(`downloads/ 目录不存在: ${config.downloadDir}`);
    }

    const files = fs.readdirSync(config.downloadDir)
        .filter(f => f.endsWith('.xlsx'))
        .sort();

    log(`📂 找到 ${files.length} 个 Excel 文件`);

    const results = [];

    for (const file of files) {
        const month    = extractMonthFromFilename(file);
        const fileType = parser.detectFileType(file);

        if (!month) {
            log(`⚠️  无法提取月份，跳过: ${file}`);
            results.push({ file, status: 'skipped', reason: '无法提取月份（文件名格式不符）' });
            continue;
        }

        if (fileType === 'unknown') {
            log(`⚠️  未知报表类型，跳过: ${file}`);
            results.push({ file, status: 'skipped', reason: '未知报表类型（文件名需含：全渠道订单明细/菜品销售明细/收款明细）' });
            continue;
        }

        // 按类型独立去重
        const exists = await pipeline.isMonthDataExists(fileType, month);
        if (exists) {
            log(`⏭  已导入，跳过: ${file} [${fileType}/${month}]`);
            results.push({ file, status: 'skipped', reason: '已导入', fileType, month });
            continue;
        }

        try {
            const result = await importFile(file, log);
            results.push({ file, fileType, month, ...result });
        } catch (e) {
            log(`❌ 导入失败: ${file} — ${e.message}`);
            results.push({ file, fileType, month, status: 'failed', error: e.message });
        }
    }

    // 汇总
    const success = results.filter(r => r.status === 'success').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const failed  = results.filter(r => r.status === 'failed').length;
    log(`\n📊 导入汇总: 成功 ${success}，跳过 ${skipped}，失败 ${failed}`);

    return results;
}

// ── 数据库统计 ────────────────────────────────────────────────────────────────

async function getDatabaseStats() {
    const [
        ordersRow, dishesRow, paymentsRow,
        itemSummaryRow, paymentMethodRow,
        monthsList, storesList
    ] = await Promise.all([
        db.queryOne('SELECT COUNT(*) AS cnt FROM orders'),
        db.queryOne('SELECT COUNT(*) AS cnt FROM order_dishes'),
        db.queryOne('SELECT COUNT(*) AS cnt FROM order_payments'),
        db.queryOne('SELECT COUNT(*) AS cnt FROM item_sales_summary'),
        db.queryOne('SELECT COUNT(*) AS cnt FROM payment_method_summary'),
        db.query('SELECT DISTINCT order_month FROM orders ORDER BY order_month'),
        db.query('SELECT DISTINCT store_id, store_name FROM orders ORDER BY store_id')
    ]);

    return {
        orders:              ordersRow?.cnt       || 0,
        dishes:              dishesRow?.cnt        || 0,
        payments:            paymentsRow?.cnt      || 0,
        item_summary:        itemSummaryRow?.cnt   || 0,
        payment_method:      paymentMethodRow?.cnt || 0,
        months:              monthsList.map(r => r.order_month),
        stores:              storesList
    };
}

// ── 重新计算统计 ──────────────────────────────────────────────────────────────

async function recalculate(storeId, date, log = console.log) {
    if (!storeId || !date) {
        throw new Error('请提供 storeId 和 date（YYYY-MM-DD）参数');
    }

    const month = date.substring(0, 7);

    const storeRow = await db.queryOne(
        'SELECT store_name FROM orders WHERE store_id = ? LIMIT 1', [storeId]
    );
    const storeName = storeRow?.store_name || storeId;

    // 日度统计
    const ds = await parser.calculateDailySales(storeId, date);
    if (ds) {
        await db.run(
            `INSERT OR REPLACE INTO sales_summary
            (id,store_id,store_name,date,month,total_revenue,total_sales,
             total_discount,discount_ratio,order_count,avg_order_amount,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
            [ds.id, storeId, storeName, ds.date, month,
             ds.total_revenue, ds.total_sales, ds.total_discount,
             ds.discount_ratio, ds.order_count, ds.avg_order_amount]
        );
        log(`✅ 已重算 ${storeId} ${date} 日度统计`);
    }

    // 月度统计
    const ms = await parser.calculateMonthlySales(storeId, month);
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
        log(`✅ 已重算 ${storeId} ${month} 月度统计`);
    }

    // 菜品统计（从 order_dishes 重算）
    const itemStats = await parser.calculateItemSales(storeId, date);
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
    log(`✅ 已重算 ${storeId} ${date} 菜品统计（${itemStats.length} 条）`);

    return { storeId, date, month, recalculated: true };
}

module.exports = {
    initDatabase,
    importFile,
    importAll,
    getDatabaseStats,
    recalculate,
    db,
    pipeline
};
