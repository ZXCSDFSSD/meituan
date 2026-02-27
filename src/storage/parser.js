/**
 * 数据解析模块
 *
 * 美团下载的三种 Excel 报表，统一格式：
 *   - 前2行为报表标题和筛选条件，第3行（range:2）才是真正表头
 *   - 末尾有"合计"汇总行（store_id='--'），解析时过滤
 *
 * 三种报表及对应处理逻辑：
 *   全渠道订单明细  → orders + order_dishes + order_payments + 日/月度汇总
 *   菜品销售明细    → item_sales_summary（直接写入，无需经过 orders）
 *   收款明细        → payment_method_summary（按门店/日期/收款方式聚合）
 */

'use strict';

const XLSX        = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const db          = require('./database');

// ── 文件类型检测 ──────────────────────────────────────────────────────────────

/**
 * 从文件名识别报表类型
 * @returns {'channel_orders'|'dish_sales'|'payments'|'unknown'}
 */
function detectFileType(filename) {
    if (filename.includes('全渠道订单明细')) return 'channel_orders';
    if (filename.includes('菜品销售明细'))   return 'dish_sales';
    if (filename.includes('收款明细'))       return 'payments';
    // 兼容旧格式（店内订单明细）
    if (filename.includes('订单明细'))       return 'channel_orders';
    return 'unknown';
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function str(v) { return v !== null && v !== undefined ? String(v).trim() : ''; }
function num(v) { return parseFloat(v) || 0; }

function extractDate(s) {
    if (!s) return '';
    try {
        const d = new Date(String(s).replace(/\//g, '-'));
        return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
    } catch { return ''; }
}

/** 从多个候选列名中取第一个有值的 */
function pick(row, ...keys) {
    for (const k of keys) {
        const v = str(row[k]);
        if (v) return v;
    }
    return '';
}

function pickNum(row, ...keys) {
    for (const k of keys) {
        const v = num(row[k]);
        if (v !== 0) return v;
    }
    return 0;
}

// ── 全渠道订单明细：读取 Excel ─────────────────────────────────────────────────

async function readChannelOrdersFile(filePath, log = console.log) {
    log(`📖 读取全渠道订单明细: ${filePath}`);

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

// ── 菜品销售明细：读取 Excel ───────────────────────────────────────────────────

async function readDishSalesFile(filePath, log = console.log) {
    log(`📖 读取菜品销售明细: ${filePath}`);

    const wb = XLSX.readFile(filePath);
    // 取第一个含"菜品"的 Sheet，找不到就用第一个 Sheet
    const sheetName = wb.SheetNames.find(n => n.includes('菜品') || n.includes('销售'))
                   || wb.SheetNames[0];

    const opts = { range: 2, defval: '' };
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], opts);
    log(`✅ 读取完成（Sheet: ${sheetName}）：${rows.length} 行`);
    return rows;
}

// ── 收款明细：读取 Excel ──────────────────────────────────────────────────────

async function readPaymentsDetailFile(filePath, log = console.log) {
    log(`📖 读取收款明细: ${filePath}`);

    const wb = XLSX.readFile(filePath);
    const sheetName = wb.SheetNames.find(n => n.includes('收款') || n.includes('支付'))
                   || wb.SheetNames[0];

    const opts = { range: 2, defval: '' };
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], opts);
    log(`✅ 读取完成（Sheet: ${sheetName}）：${rows.length} 行`);
    return rows;
}

// ── 全渠道订单明细：解析 ──────────────────────────────────────────────────────

function parseAllData(orderData, dishData, paymentData, log = console.log) {
    const orders   = parseOrders(orderData, log);
    const dishes   = parseDishes(dishData, log);
    const payments = parsePayments(paymentData, log);
    return { orders, dishes, payments };
}

// 订单明细列：门店, 机构编码, 营业日期, 订单号, 经营模式, 订单来源, 用餐方式,
//             下单时间, 结账时间, 退单时间, 取餐号, 桌牌号, 全渠道流水号, 桌台区域,
//             用餐人数, 订单金额（元）, 顾客应付（元）, 支付合计（元）, 订单优惠（元）,
//             订单收入（元）, 结账方式, 订单状态, 退单标识, 菜品收入（元）...
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

// 菜品明细列（来自全渠道订单明细 Sheet）：
// 门店, 机构编码, 订单编号, 取餐号, 桌牌号, 菜品编码, 菜品名称,
// 规格, 做法, 加料, 销售数量, 单位, 金额合计（元）, 菜品优惠（元）, 菜品收入（元）, 备注
function parseDishes(rows, log = console.log) {
    const dishes = [];
    let skipped = 0;

    for (const row of rows) {
        const orderId  = str(row['订单编号']);   // 菜品用"订单编号"，不是"订单号"
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

// 支付明细列（来自全渠道订单明细 Sheet）：
// 门店, 机构编码, 订单编号, 支付方式, 支付金额（元）, 支付优惠（元）,
// 收入（元）, 支付时间, 是否退款, 状态, 操作人, 支付商户号, 流水号
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

// ── 菜品销售明细：解析 ────────────────────────────────────────────────────────

/**
 * 解析"菜品销售明细"报表 Excel 行
 * 列名兼容多种可能（Meituan 不同版本可能有差异）：
 *   营业日期 / 日期
 *   门店 / 门店名称
 *   菜品编码 / 品号
 *   菜品名称 / 品名
 *   菜品分类 / 分类 / 大类
 *   销售数量 / 数量
 *   销售金额（元）/ 金额合计（元）/ 销售额
 *   优惠金额（元）/ 菜品优惠（元）/ 折扣金额
 *   实收金额（元）/ 菜品收入（元）/ 收入
 */
function parseDishSalesData(rows, log = console.log) {
    const items = [];
    let skipped = 0;

    for (const row of rows) {
        const storeId  = str(row['机构编码']);
        const dishName = pick(row, '菜品名称', '品名', '名称');
        const dateStr  = pick(row, '营业日期', '日期', '销售日期');

        if (!dishName || storeId === '--' || !dateStr) { skipped++; continue; }
        // 过滤合计行
        if (dishName === '合计' || storeId === '' && !dateStr) { skipped++; continue; }

        const date = extractDate(dateStr);
        if (!date) { skipped++; continue; }

        items.push({
            store_id:   storeId,
            store_name: pick(row, '门店', '门店名称', '机构名称'),
            item_code:  pick(row, '菜品编码', '品号', '编码'),
            item_name:  dishName,
            category:   pick(row, '菜品分类', '分类', '大类') || '其他',
            date,
            month:      date.substring(0, 7),
            quantity:   parseInt(pickNum(row, '销售数量', '数量')) || 0,
            unit:       pick(row, '单位'),
            amount:     pickNum(row, '销售金额（元）', '金额合计（元）', '销售额', '原价金额（元）'),
            discount:   pickNum(row, '优惠金额（元）', '菜品优惠（元）', '折扣金额（元）'),
            income:     pickNum(row, '实收金额（元）', '菜品收入（元）', '收入（元）'),
        });
    }

    log(`   菜品销售解析: ${items.length} 条，跳过 ${skipped} 条`);
    return items;
}

// ── 收款明细：解析 ────────────────────────────────────────────────────────────

/**
 * 解析"收款明细"报表 Excel 行，按门店/日期/收款方式聚合
 * 列名兼容：
 *   营业日期 / 日期 / 收款日期
 *   门店 / 门店名称
 *   收款方式 / 支付方式 / 付款方式
 *   收款金额（元）/ 支付金额（元）/ 金额
 *   优惠金额（元）/ 支付优惠（元）/ 折扣金额
 *   实收金额（元）/ 收入（元）/ 到账金额
 */
function parsePaymentRecords(rows, log = console.log) {
    // 先按 store_id + date + payment_method 聚合
    const map = new Map();
    let skipped = 0;

    for (const row of rows) {
        const storeId = str(row['机构编码']);
        const method  = pick(row, '收款方式', '支付方式', '付款方式');
        const dateStr = pick(row, '营业日期', '收款日期', '日期', '支付日期');

        if (!method || storeId === '--' || !dateStr) { skipped++; continue; }

        const date = extractDate(dateStr);
        if (!date) { skipped++; continue; }

        const key = `${storeId}__${date}__${method}`;
        if (!map.has(key)) {
            map.set(key, {
                store_id:       storeId,
                store_name:     pick(row, '门店', '门店名称', '机构名称'),
                date,
                month:          date.substring(0, 7),
                payment_method: method,
                total_amount:   0,
                total_discount: 0,
                total_income:   0,
                payment_count:  0,
            });
        }
        const rec = map.get(key);
        rec.total_amount   += pickNum(row, '收款金额（元）', '支付金额（元）', '金额（元）');
        rec.total_discount += pickNum(row, '优惠金额（元）', '支付优惠（元）', '折扣金额（元）');
        rec.total_income   += pickNum(row, '实收金额（元）', '收入（元）', '到账金额（元）');
        rec.payment_count  += 1;
    }

    const records = Array.from(map.values()).map(r => ({
        ...r,
        total_amount:   +r.total_amount.toFixed(2),
        total_discount: +r.total_discount.toFixed(2),
        total_income:   +r.total_income.toFixed(2),
    }));

    log(`   收款解析: ${records.length} 条（聚合后），原始 ${map.size} 条，跳过 ${skipped} 条`);
    return records;
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

// ── 保存菜品销售明细到 item_sales_summary ─────────────────────────────────────

async function saveDishSalesToDB(items, log = console.log) {
    log(`💾 写入 item_sales_summary（来自菜品销售明细）...`);

    // 按 store_id+date 分组，计算贡献率
    const storeDate = new Map();
    for (const item of items) {
        const k = `${item.store_id}__${item.date}`;
        storeDate.set(k, (storeDate.get(k) || 0) + item.amount);
    }

    let inserted = 0, errors = 0;
    await db.transaction(async () => {
        for (const item of items) {
            try {
                const dayTotal = storeDate.get(`${item.store_id}__${item.date}`) || 0;
                const contribution = dayTotal > 0 ? +(item.amount / dayTotal * 100).toFixed(2) : 0;

                await db.run(
                    `INSERT OR REPLACE INTO item_sales_summary
                    (id,store_id,store_name,item_id,item_name,category,date,month,
                     total_quantity,total_amount,total_discount,order_count,contribution_ratio,
                     updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
                    [
                        uuidv4(),
                        item.store_id, item.store_name,
                        item.item_code || item.item_name,  // 无编码时用名称作为 id
                        item.item_name, item.category,
                        item.date, item.month,
                        item.quantity, item.amount, item.discount,
                        0,               // order_count 在菜品销售明细中无法获取
                        contribution
                    ]
                );
                inserted++;
            } catch (e) {
                errors++;
                log(`⚠️  写入失败 [${item.item_name}]: ${e.message}`);
            }
        }
    });

    log(`✅ 菜品销售写入完成：${inserted} 条，错误 ${errors}`);
    return { inserted, errors };
}

// ── 保存收款明细到 payment_method_summary ─────────────────────────────────────

async function savePaymentMethodSummary(records, log = console.log) {
    log(`💾 写入 payment_method_summary（来自收款明细）...`);

    let inserted = 0, errors = 0;
    await db.transaction(async () => {
        for (const r of records) {
            try {
                await db.run(
                    `INSERT OR REPLACE INTO payment_method_summary
                    (id,store_id,store_name,date,month,payment_method,
                     total_amount,total_discount,total_income,payment_count,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
                    [
                        uuidv4(),
                        r.store_id, r.store_name, r.date, r.month, r.payment_method,
                        r.total_amount, r.total_discount, r.total_income, r.payment_count
                    ]
                );
                inserted++;
            } catch (e) {
                errors++;
                log(`⚠️  写入失败 [${r.store_id} ${r.date} ${r.payment_method}]: ${e.message}`);
            }
        }
    });

    log(`✅ 收款汇总写入完成：${inserted} 条，错误 ${errors}`);
    return { inserted, errors };
}

// ── 统计计算（从 orders 表聚合）────────────────────────────────────────────────

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

module.exports = {
    detectFileType,
    // 全渠道订单明细
    readChannelOrdersFile,
    parseAllData,
    saveToDatabase,
    // 菜品销售明细
    readDishSalesFile,
    parseDishSalesData,
    saveDishSalesToDB,
    // 收款明细
    readPaymentsDetailFile,
    parsePaymentRecords,
    savePaymentMethodSummary,
    // 统计计算
    calculateDailySales,
    calculateMonthlySales,
    calculateItemSales,
    // 旧接口兼容
    readExcelFile: readChannelOrdersFile,
};
