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
const { extractMonthFromFilename } = require('../common/utils');

// ── 数据库初始化 ──────────────────────────────────────────────────────────────

async function initDatabase(log = console.log) {
    await db.initializeDatabase(log);
}

// ── 导入单个文件 ──────────────────────────────────────────────────────────────

async function importFile(filePath, log = console.log) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
    }
    return await pipeline.processDataPipeline(filePath, log);
}

// ── 扫描 downloads 目录（含子目录）─────────────────────────────────────────────

/**
 * 递归收集 downloads/ 下所有 xlsx 文件，按报表类型分组
 * 返回 { dish_sales: [...], channel_orders: [...], payments: [...] }
 */
function scanDownloadFiles(rootDir) {
    const groups = { dish_sales: [], channel_orders: [], payments: [] };
    if (!fs.existsSync(rootDir)) return groups;

    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && entry.name.endsWith('.xlsx')) {
                const type = parser.detectFileType(entry.name);
                if (type !== 'unknown') groups[type].push(full);
            }
        }
    }
    walk(rootDir);

    // 各类型按文件名排序（保证月份顺序）
    for (const type of Object.keys(groups)) {
        groups[type].sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
    }
    return groups;
}

// ── 导入全部（幂等）──────────────────────────────────────────────────────────

/**
 * 扫描 downloads/ 下所有 Excel，按月份去重后导入。
 * 处理顺序：菜品销售明细 → 全渠道订单明细 → 收款明细
 *（菜品销售明细优先，以便建立 store_id 映射）
 */
async function importAll(log = console.log) {
    const rootDir = config.downloadDir;
    if (!fs.existsSync(rootDir)) {
        throw new Error(`downloads/ 目录不存在: ${rootDir}`);
    }

    const groups = scanDownloadFiles(rootDir);
    const totalFiles = Object.values(groups).reduce((s, arr) => s + arr.length, 0);
    log(`📂 扫描到 ${totalFiles} 个 Excel 文件（菜品:${groups.dish_sales.length} / 订单:${groups.channel_orders.length} / 收款:${groups.payments.length}）`);

    const results = [];

    // 按推荐顺序处理
    const ordered = [
        ...groups.dish_sales,
        ...groups.channel_orders,
        ...groups.payments,
    ];

    for (const filePath of ordered) {
        const filename = path.basename(filePath);
        const month    = extractMonthFromFilename(filename);
        const fileType = parser.detectFileType(filename);

        if (!month) {
            log(`⚠️  无法提取月份，跳过: ${filename}`);
            results.push({ file: filename, status: 'skipped', reason: '无法提取月份' });
            continue;
        }

        // 按类型独立去重
        const exists = await pipeline.isMonthDataExists(fileType, month);
        if (exists) {
            log(`⏭  已导入，跳过: ${filename} [${fileType}/${month}]`);
            results.push({ file: filename, status: 'skipped', reason: '已导入', fileType, month });
            continue;
        }

        try {
            const result = await importFile(filePath, log);
            results.push({ file: filename, fileType, month, ...result });
        } catch (e) {
            log(`❌ 导入失败: ${filename} — ${e.message}`);
            results.push({ file: filename, fileType, month, status: 'failed', error: e.message });
        }
    }

    const success = results.filter(r => r.status === 'success').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const failed  = results.filter(r => r.status === 'failed').length;
    log(`\n📊 导入汇总: 成功 ${success}，跳过 ${skipped}，失败 ${failed}`);

    return results;
}

// ── 数据库统计 ────────────────────────────────────────────────────────────────

async function getDatabaseStats() {
    const [
        storesRow, ordersRow, dishesRow,
        itemSummaryRow, salesSummaryRow, monthlySummaryRow, paymentMethodRow,
        monthsList, storesList
    ] = await Promise.all([
        db.queryOne('SELECT COUNT(*) AS cnt FROM stores'),
        db.queryOne('SELECT COUNT(*) AS cnt FROM orders'),
        db.queryOne('SELECT COUNT(*) AS cnt FROM order_dishes'),
        db.queryOne('SELECT COUNT(*) AS cnt FROM item_sales_summary'),
        db.queryOne('SELECT COUNT(*) AS cnt FROM sales_summary WHERE channel = \'all\''),
        db.queryOne('SELECT COUNT(*) AS cnt FROM monthly_summary WHERE channel = \'all\''),
        db.queryOne('SELECT COUNT(*) AS cnt FROM payment_method_summary'),
        db.query('SELECT DISTINCT order_month FROM orders ORDER BY order_month'),
        db.query('SELECT store_id, store_name, city FROM stores ORDER BY store_id'),
    ]);

    return {
        stores:          storesRow?.cnt        || 0,
        orders:          ordersRow?.cnt         || 0,
        order_dishes:    dishesRow?.cnt         || 0,
        item_summary:    itemSummaryRow?.cnt    || 0,
        sales_summary:   salesSummaryRow?.cnt   || 0,
        monthly_summary: monthlySummaryRow?.cnt || 0,
        payment_method:  paymentMethodRow?.cnt  || 0,
        months:          monthsList.map(r => r.order_month),
        stores_list:     storesList,
    };
}

// ── 重新计算统计 ──────────────────────────────────────────────────────────────

async function recalculate(storeId, date, log = console.log) {
    if (!storeId || !date) {
        throw new Error('请提供 storeId 和 date（YYYY-MM-DD）参数');
    }
    return await pipeline.recalculateSummary(storeId, date, log);
}

module.exports = {
    initDatabase,
    importFile,
    importAll,
    getDatabaseStats,
    recalculate,
    db,
    pipeline,
};
