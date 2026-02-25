/**
 * 数据解析模块
 *
 * 美团 Excel 格式：
 * - 5个 Sheet：订单明细 / 联台子单明细 / 菜品明细 / 支付明细 / 优惠明细
 * - 前2行为标题和筛选条件，第3行（range:2）才是真正表头
 *
 * 解析3张表：
 *   订单明细  → orders
 *   菜品明细  → order_dishes
 *   支付明细  → order_payments
 */

'use strict';

const XLSX        = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const db          = require('./database');

// ── 读取 Excel ────────────────────────────────────────────────────────────────

async function readExcelFile(filePath, log = console.log) {
    log(`📖 读取 Excel: ${filePath}`);

    const wb = XLSX.readFile(filePath);
    const required = ['订单明细', '菜品明细', '支付明细'];
    for (const name of required) {
        if (!wb.SheetNames.includes(name)) {
            throw new Error(`Excel 缺少 "${name}" Sheet，实际: ${wb.SheetNames.join(', ')}`);
        }
    }

    const opts = { range: 2, defval: '' };
    const orderData   = XLSX.utils.sheet_to_json(wb.Sheets['订单明细'],  opts);
    const dishData    = XLSX.utils.sheet_to_json(wb.Sheets['菜品明细'],  opts);
    const paymentData = XLSX.utils.sheet_to_json(wb.Sheets['支付明细'], opts);

    log(`✅ 读取完成：订单 ${orderData.length} 行，菜品 ${dishData.length} 行，支付 ${paymentData.length} 行`);
    return { orderData, dishData, paymentData };
}

// ── 解析 ──────────────────────────────────────────────────────────────────────

function parseAllData(orderData, dishData, paymentData, log = console.log) {
    const orders   = parseOrders(orderData, log);
    const dishes   = parseDishes(dishData, log);
    const payments = parsePayments(paymentData, log);
    return { orders, dishes, payments };
}

// 订单明细列名：门店, 机构编码, 营业日期, 订单号, 经营模式, 订单来源, 用餐方式,
//               下单时间, 结账时间, 退单时间, 取餐号, 桌牌号, 全渠道流水号, 桌台区域,
//               用餐人数, 订单金额（元）, 顾客应付（元）, 支付合计（元）, 订单优惠（元）,
//               订单收入（元）, 结账方式, 订单状态, 退单标识, 菜品收入（元）, ...
function parseOrders(rows, log = console.log) {
    const orders = [];
    let skipped = 0;

    for (const row of rows) {
        const orderId   = str(row['订单号']);
        const storeId   = str(row['机构编码']);
        const storeName = str(row['门店']);

        if (!orderId || storeId === '--' || storeName === '合计') { skipped++; continue; }
        if (str(row['退单标识']) === '是') { skipped++; continue; }

        const businessDate = extractDate(str(row['营业日期']));

        orders.push({
            order_id:         orderId,
            store_id:         storeId,
            store_name:       storeName,
            business_date:    businessDate,
            order_month:      businessDate ? businessDate.substring(0, 7) : '',
            order_mode:       str(row['经营模式']),
            order_source:     str(row['订单来源']),
            dining_type:      str(row['用餐方式']),
            order_time:       str(row['下单时间']),
            checkout_time:    str(row['结账时间']),
            refund_time:      str(row['退单时间']),
            meal_number:      str(row['取餐号']),
            table_number:     str(row['桌牌号']),
            channel_flow_no:  str(row['全渠道流水号']),
            table_area:       str(row['桌台区域']),
            guest_count:      num(row['用餐人数']),
            order_amount:     num(row['订单金额（元）']),
            customer_payable: num(row['顾客应付（元）']),
            payment_total:    num(row['支付合计（元）']),
            order_discount:   num(row['订单优惠（元）']),
            order_income:     num(row['订单收入（元）']),
            checkout_method:  str(row['结账方式']),
            order_status:     str(row['订单状态']) || '已完成',
            refund_flag:      str(row['退单标识']),
            dish_income:      num(row['菜品收入（元）']),
            reserved_time:    str(row['预定用餐时间']),
            member:           str(row['会员']),
            remark:           str(row['整单备注'])
        });
    }

    log(`   订单解析: ${orders.length} 条，跳过 ${skipped} 条`);
    return orders;
}

// 菜品明细列名：门店, 机构编码, 订单编号, 取餐号, 桌牌号, 菜品编码, 菜品名称,
//               规格, 做法, 加料, 销售数量, 单位, 金额合计（元）, 菜品优惠（元）, 菜品收入（元）, 备注
function parseDishes(rows, log = console.log) {
    const dishes = [];
    let skipped = 0;

    for (const row of rows) {
        const orderId  = str(row['订单编号']);   // 注意：菜品用"订单编号"
        const storeId  = str(row['机构编码']);
        const dishName = str(row['菜品名称']);

        if (!orderId || !dishName || storeId === '--') { skipped++; continue; }

        dishes.push({
            order_id:     orderId,
            store_id:     storeId,
            store_name:   str(row['门店']),
            meal_number:  str(row['取餐号']),
            table_number: str(row['桌牌号']),
            dish_code:    str(row['菜品编码']),
            dish_name:    dishName,
            spec:         str(row['规格']),
            method:       str(row['做法']),
            topping:      str(row['加料']),
            quantity:     parseInt(row['销售数量'] || 0) || 0,
            unit:         str(row['单位']),
            amount:       num(row['金额合计（元）']),
            discount:     num(row['菜品优惠（元）']),
            income:       num(row['菜品收入（元）']),
            remark:       str(row['备注'])
        });
    }

    log(`   菜品解析: ${dishes.length} 条，跳过 ${skipped} 条`);
    return dishes;
}

// 支付明细列名：门店, 机构编码, 订单编号, 支付方式, 支付金额（元）, 支付优惠（元）,
//               收入（元）, 支付时间, 是否退款, 状态, 操作人, 支付商户号, 流水号
function parsePayments(rows, log = console.log) {
    const payments = [];
    let skipped = 0;

    for (const row of rows) {
        const orderId = str(row['订单编号']);
        const storeId = str(row['机构编码']);

        if (!orderId || storeId === '--') { skipped++; continue; }

        payments.push({
            order_id:         orderId,
            store_id:         storeId,
            store_name:       str(row['门店']),
            payment_method:   str(row['支付方式']),
            payment_amount:   num(row['支付金额（元）']),
            payment_discount: num(row['支付优惠（元）']),
            income:           num(row['收入（元）']),
            payment_time:     str(row['支付时间']),
            is_refund:        str(row['是否退款']),
            status:           str(row['状态']),
            operator:         str(row['操作人']),
            merchant_no:      str(row['支付商户号']),
            flow_no:          str(row['流水号'])
        });
    }

    log(`   支付解析: ${payments.length} 条，跳过 ${skipped} 条`);
    return payments;
}

// ── 保存到数据库 ──────────────────────────────────────────────────────────────

async function saveToDatabase(orders, dishes, payments, log = console.log) {
    const result = { insertedOrders: 0, insertedDishes: 0, insertedPayments: 0, duplicateOrders: 0, errors: 0 };

    log(`💾 保存到数据库...`);

    await db.transaction(async () => {
        // 1. 订单 — 记录新插入的 order_id，用于过滤菜品/支付
        const newOrderIds = new Set();
        for (const o of orders) {
            try {
                const r = await db.run(
                    `INSERT OR IGNORE INTO orders
                    (order_id,store_id,store_name,business_date,order_month,
                     order_mode,order_source,dining_type,order_time,checkout_time,
                     refund_time,meal_number,table_number,channel_flow_no,table_area,
                     guest_count,order_amount,customer_payable,payment_total,
                     order_discount,order_income,checkout_method,order_status,
                     refund_flag,dish_income,reserved_time,member,remark)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                    [
                        o.order_id, o.store_id, o.store_name, o.business_date, o.order_month,
                        o.order_mode, o.order_source, o.dining_type, o.order_time, o.checkout_time,
                        o.refund_time, o.meal_number, o.table_number, o.channel_flow_no, o.table_area,
                        o.guest_count, o.order_amount, o.customer_payable, o.payment_total,
                        o.order_discount, o.order_income, o.checkout_method, o.order_status,
                        o.refund_flag, o.dish_income, o.reserved_time, o.member, o.remark
                    ]
                );
                if (r.changes > 0) {
                    result.insertedOrders++;
                    newOrderIds.add(o.order_id);
                } else {
                    result.duplicateOrders++;
                }
            } catch (e) {
                result.errors++;
                log(`⚠️  订单存储失败 [${o.order_id}]: ${e.message}`);
            }
        }

        // 2. 菜品 — 只插入新订单的菜品
        for (const d of dishes) {
            if (!newOrderIds.has(d.order_id)) continue;
            try {
                await db.run(
                    `INSERT INTO order_dishes
                    (order_id,store_id,store_name,meal_number,table_number,
                     dish_code,dish_name,spec,method,topping,quantity,unit,amount,discount,income,remark)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                    [
                        d.order_id, d.store_id, d.store_name, d.meal_number, d.table_number,
                        d.dish_code, d.dish_name, d.spec, d.method, d.topping,
                        d.quantity, d.unit, d.amount, d.discount, d.income, d.remark
                    ]
                );
                result.insertedDishes++;
            } catch (_) { result.errors++; }
        }

        // 3. 支付 — 只插入新订单的支付记录
        for (const p of payments) {
            if (!newOrderIds.has(p.order_id)) continue;
            try {
                await db.run(
                    `INSERT INTO order_payments
                    (order_id,store_id,store_name,payment_method,payment_amount,
                     payment_discount,income,payment_time,is_refund,status,operator,merchant_no,flow_no)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                    [
                        p.order_id, p.store_id, p.store_name, p.payment_method, p.payment_amount,
                        p.payment_discount, p.income, p.payment_time, p.is_refund, p.status,
                        p.operator, p.merchant_no, p.flow_no
                    ]
                );
                result.insertedPayments++;
            } catch (_) { result.errors++; }
        }
    });

    log(`✅ 保存完成：订单 ${result.insertedOrders}（重复 ${result.duplicateOrders}），菜品 ${result.insertedDishes}，支付 ${result.insertedPayments}，错误 ${result.errors}`);
    return result;
}

// ── 统计计算 ──────────────────────────────────────────────────────────────────

async function calculateDailySales(storeId, date) {
    const r = await db.queryOne(
        `SELECT SUM(order_amount) AS total_revenue, SUM(payment_total) AS total_sales,
                SUM(order_discount) AS total_discount, COUNT(*) AS order_count,
                AVG(payment_total) AS avg_order_amount
         FROM orders WHERE store_id = ? AND business_date = ?`,
        [storeId, date]
    );
    if (!r || !r.order_count) return null;
    const rev = r.total_revenue || 0, dis = r.total_discount || 0;
    return {
        id: uuidv4(), store_id: storeId, date,
        total_revenue:    +rev.toFixed(2),
        total_sales:      +((r.total_sales || 0).toFixed(2)),
        total_discount:   +dis.toFixed(2),
        discount_ratio:   rev > 0 ? +(dis / rev * 100).toFixed(2) : 0,
        order_count:      r.order_count,
        avg_order_amount: +((r.avg_order_amount || 0).toFixed(2))
    };
}

async function calculateMonthlySales(storeId, month) {
    const r = await db.queryOne(
        `SELECT SUM(order_amount) AS total_revenue, SUM(payment_total) AS total_sales,
                SUM(order_discount) AS total_discount, COUNT(*) AS order_count,
                AVG(payment_total) AS avg_order_amount
         FROM orders WHERE store_id = ? AND order_month = ?`,
        [storeId, month]
    );
    if (!r || !r.order_count) return null;
    const rev = r.total_revenue || 0, dis = r.total_discount || 0;
    return {
        id: uuidv4(), store_id: storeId, month,
        total_revenue:    +rev.toFixed(2),
        total_sales:      +((r.total_sales || 0).toFixed(2)),
        total_discount:   +dis.toFixed(2),
        discount_ratio:   rev > 0 ? +(dis / rev * 100).toFixed(2) : 0,
        order_count:      r.order_count,
        avg_order_amount: +((r.avg_order_amount || 0).toFixed(2))
    };
}

async function calculateItemSales(storeId, date) {
    const items = await db.query(
        `SELECT od.dish_code AS item_id, od.dish_name AS item_name, '其他' AS category,
                SUM(od.quantity) AS total_quantity, SUM(od.amount) AS total_amount,
                COUNT(DISTINCT od.order_id) AS order_count
         FROM order_dishes od
         INNER JOIN orders o ON od.order_id = o.order_id
         WHERE o.store_id = ? AND o.business_date = ?
         GROUP BY od.dish_code, od.dish_name ORDER BY total_amount DESC`,
        [storeId, date]
    );
    const totRow = await db.queryOne(
        `SELECT SUM(od.amount) AS total FROM order_dishes od
         INNER JOIN orders o ON od.order_id = o.order_id
         WHERE o.store_id = ? AND o.business_date = ?`,
        [storeId, date]
    );
    const totalSales = totRow?.total || 0;

    return items.map(item => ({
        id: uuidv4(), store_id: storeId,
        item_id: item.item_id, item_name: item.item_name, category: item.category,
        date,
        total_quantity: item.total_quantity,
        total_amount:   +((item.total_amount || 0).toFixed(2)),
        order_count:    item.order_count,
        contribution_ratio: totalSales > 0 ? +(item.total_amount / totalSales * 100).toFixed(2) : 0
    }));
}

// ── 工具 ──────────────────────────────────────────────────────────────────────

function str(v) { return v !== null && v !== undefined ? String(v).trim() : ''; }
function num(v) { return parseFloat(v) || 0; }
function extractDate(s) {
    if (!s) return '';
    try {
        const d = new Date(String(s).replace(/\//g, '-'));
        return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
    } catch { return ''; }
}

module.exports = {
    readExcelFile,
    parseAllData,
    saveToDatabase,
    calculateDailySales,
    calculateMonthlySales,
    calculateItemSales
};
