/**
 * 数据解析模块 v2
 *
 * 美团下载的三种 Excel 报表格式：
 *   - 前 2 行是报表标题和筛选条件，第 3 行（range:2）才是真正表头
 *   - 末尾有"合计"汇总行，解析时过滤
 *
 * 三种报表及实际 Sheet 名称：
 *   全渠道订单明细  → Sheet "全渠道订单明细"（1 个 Sheet，无菜品/支付子表）
 *   菜品销售明细    → Sheet "品项销售明细"
 *   收款明细        → Sheet "收款明细"
 *
 * 注意：全渠道订单明细没有"机构编码"列，store_id 需通过 stores 表按名称查找。
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
    // 兼容两种名称：重命名后"菜品销售明细" 和 美团原始"品项销售明细"
    if (filename.includes('菜品销售明细') || filename.includes('品项销售明细')) return 'dish_sales';
    if (filename.includes('收款明细'))       return 'payments';
    return 'unknown';
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function str(v) { return v !== null && v !== undefined ? String(v).trim() : ''; }
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

function extractDate(s) {
    if (!s) return '';
    try {
        const d = new Date(String(s).replace(/\//g, '-'));
        return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
    } catch { return ''; }
}

/** 将订单来源/用餐方式映射为标准渠道名
 *  注：饿了么与淘宝闪购是同一平台（阿里旗下），统一归为"饿了么"
 */
function resolveChannel(orderSource, diningType) {
    const src = str(orderSource);
    if (src.includes('美团')) return '美团外卖';
    if (src.includes('饿了么') || src.includes('淘宝') || src.includes('闪购')) return '饿了么';
    if (src.includes('京东')) return '京东秒送';
    // 业务小类也可能包含渠道信息
    const dining = str(diningType);
    if (dining.includes('京东')) return '京东秒送';
    if (dining.includes('淘宝') || dining.includes('闪购') || dining.includes('饿了么')) return '饿了么';
    if (dining.includes('美团')) return '美团外卖';
    // 收银POS / 店内 → 按用餐方式区分
    if (dining === '外卖' || dining === '外带') return '外卖';
    return '堂食';
}

// ── 读取 Excel ─────────────────────────────────────────────────────────────────

/**
 * 读取"全渠道订单明细"Excel（仅 1 个 Sheet：全渠道订单明细）
 */
async function readChannelOrdersFile(filePath, log = console.log) {
    log(`📖 读取全渠道订单明细: ${filePath}`);
    const wb = XLSX.readFile(filePath);
    const sheetName = wb.SheetNames.find(n => n.includes('订单明细')) || wb.SheetNames[0];
    const opts = { range: 2, defval: '' };
    const orderData = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], opts);
    log(`✅ 读取完成（Sheet: ${sheetName}）：${orderData.length} 行`);
    return { orderData };
}

/**
 * 读取"菜品销售明细"Excel（Sheet：品项销售明细）
 */
async function readDishSalesFile(filePath, log = console.log) {
    log(`📖 读取菜品销售明细: ${filePath}`);
    const wb = XLSX.readFile(filePath);
    const sheetName = wb.SheetNames.find(n => n.includes('品项') || n.includes('菜品') || n.includes('销售'))
                   || wb.SheetNames[0];
    const opts = { range: 2, defval: '' };
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], opts);
    log(`✅ 读取完成（Sheet: ${sheetName}）：${rows.length} 行`);
    return rows;
}

/**
 * 读取"收款明细"Excel（Sheet：收款明细）
 */
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

/**
 * 解析"全渠道订单明细"Sheet 行数据。
 *
 * 实际列名（Row2）：
 *   省份, 城市, 门店名称, 营业日期, 餐段, 订单号, 原单号, 外卖订单号,
 *   全渠道流水号, 取餐号, 桌牌号, 桌台区域,
 *   订单金额, 顾客实付, 订单收入, 订单优惠,
 *   订单来源, 订单子来源, 经营模式, 用餐方式, 宴会类型,
 *   订单状态, 退单标识, 下单员, 收银员, 销售员,
 *   创建时间, 完成时间, 接单时间, 下单制作时间, 预定用餐时间,
 *   订单备注, 桌台备注, 用餐人数, 席数,
 *   是否会员, 会员姓名, 会员卡号, 会员手机号, 发票,
 *   菜品金额, 菜品收入, 退单时间, 取消时间, 外卖订单已退金额, 敏感操作, 结账方式
 */
function parseOrders(rows, log = console.log) {
    const orders = [];
    let skipped = 0;

    for (const row of rows) {
        const orderId   = str(row['订单号']);
        const storeName = str(row['门店名称']);

        // 过滤：无订单号、合计行、退单行
        if (!orderId || storeName === '合计' || storeName === '--' || !storeName) { skipped++; continue; }
        if (str(row['退单标识']) === '是') { skipped++; continue; }

        const businessDate = extractDate(str(row['营业日期']));
        const orderSource  = str(row['订单来源']);
        const diningType   = str(row['用餐方式']);

        orders.push({
            order_id:          orderId,
            store_name:        storeName,
            store_id:          null,         // 全渠道订单明细无机构编码，由 pipeline 查表填入
            business_date:     businessDate,
            order_month:       businessDate ? businessDate.substring(0, 7) : '',
            meal_period:       str(row['餐段']),
            orig_order_no:     str(row['原单号']),
            delivery_order_no: str(row['外卖订单号']),
            flow_no:           str(row['全渠道流水号']),
            meal_number:       str(row['取餐号']),
            table_number:      str(row['桌牌号']),
            table_area:        str(row['桌台区域']),
            order_amount:      num(row['订单金额']),
            customer_paid:     num(row['顾客实付']),
            order_income:      num(row['订单收入']),
            order_discount:    num(row['订单优惠']),
            channel:           resolveChannel(orderSource, diningType),
            sub_channel:       str(row['订单子来源']),
            business_mode:     str(row['经营模式']),
            dining_type:       diningType,
            order_status:      str(row['订单状态']) || '已完成',
            is_refund:         str(row['退单标识']),
            guest_count:       parseInt(str(row['用餐人数'])) || 0,
            is_member:         str(row['是否会员']),
            dish_amount:       num(row['菜品金额']),
            dish_income:       num(row['菜品收入']),
            created_time:      str(row['创建时间']),
            completed_time:    str(row['完成时间']),
            reserved_time:     str(row['预定用餐时间']),
            checkout_method:   str(row['结账方式']),
            remark:            str(row['订单备注']),
        });
    }

    log(`   订单解析: ${orders.length} 条，跳过 ${skipped} 条`);
    return orders;
}

// ── 菜品销售明细：解析 ────────────────────────────────────────────────────────

/**
 * 从"菜品销售明细"文件中提取 stores 映射（机构编码 + 门店名称 + 城市）
 * 作为 stores 表的数据来源（唯一含机构编码的文件）
 */
function extractStoresFromDishSales(rows) {
    const storeMap = new Map();
    for (const row of rows) {
        const storeId   = str(row['机构编码']);
        const storeName = str(row['门店名称']);
        if (!storeId || storeId === '--' || !storeName || storeName === '合计') continue;
        if (!storeMap.has(storeId)) {
            storeMap.set(storeId, {
                store_id:   storeId,
                store_name: storeName,
                city:       str(row['城市']),
                province:   '',
            });
        }
    }
    return Array.from(storeMap.values());
}

/**
 * 解析"菜品销售明细"行数据（Sheet "品项销售明细"）。
 *
 * 实际列名（Row2）：
 *   城市, 机构编码, 门店名称, 营业日期, 下单时间所属餐段,
 *   出品部门, 菜品大类, 菜品小类, 菜品编码, 品项名称,
 *   关联菜品名称, 商品别名, 品项类型, 菜品类型, 菜品标签,
 *   规格, 单位, 关联做法, 关联加料, 关联餐盒,
 *   销售方式, 订单号,
 *   销售数量, 赠送数量, 销售金额(元), 赠送金额(元), 优惠金额(元), 品项收入(元),
 *   点菜时间, 下单时间, 接单/结账/退菜时间, 收银员, 点菜员, 下单人,
 *   订单分类, 订单来源, 新订单来源, 订单子来源,
 *   桌台区域, 取餐号, 桌牌号,
 *   订单金额(元), 营业额(元), 订单优惠(元), 订单收入(元),
 *   标记, 退菜数量, 退菜金额(元), 敏感操作类型, 单品备注
 */
function parseDishSalesData(rows, log = console.log) {
    const items = [];
    let skipped = 0;

    for (const row of rows) {
        const storeId  = str(row['机构编码']);
        const dishName = str(row['品项名称']);
        const dateStr  = str(row['营业日期']);
        const orderId  = str(row['订单号']);

        if (!dishName || storeId === '--' || storeId === '' || !dateStr || !orderId) { skipped++; continue; }
        if (dishName === '合计') { skipped++; continue; }

        const date = extractDate(dateStr);
        if (!date) { skipped++; continue; }

        const orderedTime = str(row['点菜时间']);   // e.g. "2026/02/26 20:04:33"
        const orderSource = str(row['订单来源']);
        const orderClass  = str(row['订单分类']);

        items.push({
            order_id:           orderId,
            store_id:           storeId,
            store_name:         str(row['门店名称']),
            business_date:      date,
            dish_code:          str(row['菜品编码']),
            dish_name:          dishName,
            dish_category:      str(row['菜品大类']).replace(/^-+$/, '') || '未分类',
            dish_sub_category:  str(row['菜品小类']),
            dish_type:          str(row['品项类型']),
            spec:               str(row['规格']),
            unit:               str(row['单位']),
            sale_type:          str(row['销售方式']),
            quantity:           num(row['销售数量']),
            gift_quantity:      num(row['赠送数量']),
            amount:             num(row['销售金额(元)']),
            gift_amount:        num(row['赠送金额(元)']),
            discount:           num(row['优惠金额(元)']),
            income:             num(row['品项收入(元)']),
            dish_ordered_time:  orderedTime,
            meal_period:        str(row['下单时间所属餐段']),
            order_source:       orderSource,
            channel:            resolveChannel(orderSource, orderClass),
            month:              date.substring(0, 7),
            // 提前解析小时，供 timeslot_summary 使用
            hour:               extractHour(orderedTime),
        });
    }

    log(`   菜品销售解析: ${items.length} 条，跳过 ${skipped} 条`);
    return items;
}

/** 从日期时间字符串提取小时（0-23），支持 "2026/02/26 20:04:33" 和 ISO 格式 */
function extractHour(datetimeStr) {
    if (!datetimeStr) return null;
    // 匹配 "YYYY/MM/DD HH:mm:ss" 或 "YYYY-MM-DD HH:mm:ss"
    const m = String(datetimeStr).match(/\s(\d{1,2}):/);
    if (m) return parseInt(m[1], 10);
    return null;
}

// ── 收款明细：解析 ────────────────────────────────────────────────────────────

/**
 * 解析"收款明细"报表行，按门店+日期+结账方式+业务子类聚合。
 *
 * 实际列名（Row2）：
 *   门店, 营业日期, 业务大类, 业务小类, 结账方式,
 *   支付状态, 支付时间, 支付日(账单日),
 *   支付金额(抵扣金额), 支付优惠, 收款金额,
 *   结算状态, 结算日期, 手续费(服务费), 商家活动支出, 其他支出, 到账金额,
 *   订单号, 订单状态, 收银员
 */
function parsePaymentRecords(rows, log = console.log) {
    const map = new Map();
    let skipped = 0;

    for (const row of rows) {
        const storeName    = str(row['门店']);
        const method       = str(row['结账方式']);
        const bizSubType   = str(row['业务小类']);
        const dateStr      = str(row['营业日期']) || str(row['支付日(账单日)']);
        const payStatus    = str(row['支付状态']);

        if (!storeName || storeName === '合计' || !method || !dateStr) { skipped++; continue; }
        // 过滤未支付
        if (payStatus && payStatus !== '支付成功' && payStatus !== '-') { skipped++; continue; }

        const date = extractDate(dateStr);
        if (!date) { skipped++; continue; }

        const key = `${storeName}__${date}__${method}__${bizSubType}`;
        if (!map.has(key)) {
            map.set(key, {
                store_name:      storeName,
                store_id:        null,   // 收款明细无机构编码，由 pipeline 查表填入
                date,
                month:           date.substring(0, 7),
                biz_sub_type:    bizSubType,
                payment_method:  method,
                total_amount:    0,
                total_discount:  0,
                total_income:    0,
                handling_fee:    0,
                payment_count:   0,
            });
        }
        const rec = map.get(key);
        rec.total_amount   += num(row['收款金额']);
        rec.total_discount += num(row['支付优惠']);
        rec.total_income   += num(row['到账金额']);
        rec.handling_fee   += num(row['手续费(服务费)']);
        rec.payment_count  += 1;
    }

    const records = Array.from(map.values()).map(r => ({
        ...r,
        total_amount:   +r.total_amount.toFixed(2),
        total_discount: +r.total_discount.toFixed(2),
        total_income:   +r.total_income.toFixed(2),
        handling_fee:   +r.handling_fee.toFixed(2),
    }));

    log(`   收款解析: ${records.length} 条（聚合后），跳过 ${skipped} 条`);
    return records;
}

// ── 保存 stores 到数据库 ──────────────────────────────────────────────────────

async function saveStoresToDB(stores, log = console.log) {
    let inserted = 0;
    for (const s of stores) {
        try {
            const r = await db.run(
                `INSERT OR IGNORE INTO stores (store_id, store_name, city, province)
                 VALUES (?, ?, ?, ?)`,
                [s.store_id, s.store_name, s.city, s.province]
            );
            if (r.changes > 0) inserted++;
        } catch (e) {
            log(`⚠️  stores 写入失败 [${s.store_id}]: ${e.message}`);
        }
    }
    if (inserted > 0) log(`   stores: 新增 ${inserted} 家门店`);
    return inserted;
}

/** 从 stores 表构建 storeName → storeId 映射 */
async function buildStoreNameMap() {
    const rows = await db.query('SELECT store_id, store_name FROM stores');
    const map = new Map();
    for (const r of rows) map.set(r.store_name, r.store_id);
    return map;
}

// ── 保存订单到数据库 ──────────────────────────────────────────────────────────

async function saveOrdersToDB(orders, storeNameMap, log = console.log) {
    const result = { inserted: 0, duplicate: 0, errors: 0 };

    await db.transaction(async () => {
        for (const o of orders) {
            // 通过门店名查 store_id
            const storeId = storeNameMap.get(o.store_name) || null;
            try {
                const r = await db.run(
                    `INSERT OR IGNORE INTO orders
                    (order_id, store_name, store_id, business_date, order_month,
                     meal_period, orig_order_no, delivery_order_no, flow_no,
                     meal_number, table_number, table_area,
                     order_amount, customer_paid, order_income, order_discount,
                     channel, sub_channel, business_mode, dining_type,
                     order_status, is_refund, guest_count, is_member,
                     dish_amount, dish_income,
                     created_time, completed_time, reserved_time,
                     checkout_method, remark)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                    [
                        o.order_id, o.store_name, storeId, o.business_date, o.order_month,
                        o.meal_period, o.orig_order_no, o.delivery_order_no, o.flow_no,
                        o.meal_number, o.table_number, o.table_area,
                        o.order_amount, o.customer_paid, o.order_income, o.order_discount,
                        o.channel, o.sub_channel, o.business_mode, o.dining_type,
                        o.order_status, o.is_refund, o.guest_count, o.is_member,
                        o.dish_amount, o.dish_income,
                        o.created_time, o.completed_time, o.reserved_time,
                        o.checkout_method, o.remark
                    ]
                );
                r.changes > 0 ? result.inserted++ : result.duplicate++;
            } catch (e) {
                result.errors++;
                log(`⚠️  订单存储失败 [${o.order_id}]: ${e.message}`);
            }
        }
    });

    log(`   订单写入: 新增 ${result.inserted}，重复 ${result.duplicate}，错误 ${result.errors}`);
    return result;
}

// ── 保存菜品明细到数据库 ──────────────────────────────────────────────────────

async function saveDishesToDB(dishes, log = console.log) {
    let inserted = 0, errors = 0;

    await db.transaction(async () => {
        for (const d of dishes) {
            try {
                await db.run(
                    `INSERT INTO order_dishes
                    (order_id, store_id, store_name, business_date,
                     dish_code, dish_name, dish_category, dish_sub_category, dish_type,
                     spec, unit, sale_type,
                     quantity, gift_quantity, amount, gift_amount, discount, income,
                     dish_ordered_time, meal_period, order_source, channel)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                    [
                        d.order_id, d.store_id, d.store_name, d.business_date,
                        d.dish_code, d.dish_name, d.dish_category, d.dish_sub_category, d.dish_type,
                        d.spec, d.unit, d.sale_type,
                        d.quantity, d.gift_quantity, d.amount, d.gift_amount, d.discount, d.income,
                        d.dish_ordered_time, d.meal_period, d.order_source, d.channel
                    ]
                );
                inserted++;
            } catch (e) {
                errors++;
                if (errors <= 3) log(`⚠️  菜品写入失败 [${d.dish_name}]: ${e.message}`);
            }
        }
    });

    log(`   菜品写入: ${inserted} 条，错误 ${errors}`);
    return { inserted, errors };
}

// ── 保存菜品销售汇总到 item_sales_summary ─────────────────────────────────────

async function saveDishSalesToDB(items, log = console.log) {
    log(`💾 写入 item_sales_summary...`);

    // 按 store_id+date 计算总销售额（用于贡献率）
    const storeDate = new Map();
    for (const item of items) {
        const k = `${item.store_id}__${item.business_date}`;
        storeDate.set(k, (storeDate.get(k) || 0) + item.amount);
    }

    // 按 store_id+business_date+dish_code 聚合（一个品项一天可能有多行）
    const aggMap = new Map();
    for (const item of items) {
        const key = `${item.store_id}__${item.business_date}__${item.dish_code || item.dish_name}`;
        if (!aggMap.has(key)) {
            aggMap.set(key, {
                store_id:      item.store_id,
                store_name:    item.store_name,
                item_id:       item.dish_code || item.dish_name,
                item_name:     item.dish_name,
                category:      item.dish_category || '未分类',
                date:          item.business_date,
                month:         item.month,
                total_quantity: 0,
                total_amount:   0,
                total_discount: 0,
                total_income:   0,
                order_count:    0,
            });
        }
        const agg = aggMap.get(key);
        agg.total_quantity += item.quantity;
        agg.total_amount   += item.amount;
        agg.total_discount += item.discount;
        agg.total_income   += item.income;
        agg.order_count    += 1;
    }

    let inserted = 0, errors = 0;
    await db.transaction(async () => {
        for (const agg of aggMap.values()) {
            try {
                const dayTotal = storeDate.get(`${agg.store_id}__${agg.date}`) || 0;
                const contribution = dayTotal > 0 ? +(agg.total_amount / dayTotal * 100).toFixed(2) : 0;

                await db.run(
                    `INSERT OR REPLACE INTO item_sales_summary
                    (id, store_id, store_name, item_id, item_name, category, date, month,
                     total_quantity, total_amount, total_discount, total_income,
                     order_count, contribution_ratio, updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
                    [
                        uuidv4(),
                        agg.store_id, agg.store_name,
                        agg.item_id, agg.item_name, agg.category,
                        agg.date, agg.month,
                        +agg.total_quantity.toFixed(2),
                        +agg.total_amount.toFixed(2),
                        +agg.total_discount.toFixed(2),
                        +agg.total_income.toFixed(2),
                        agg.order_count,
                        contribution,
                    ]
                );
                inserted++;
            } catch (e) {
                errors++;
                log(`⚠️  item_sales_summary 写入失败 [${agg.item_name}]: ${e.message}`);
            }
        }
    });

    log(`✅ 菜品销售汇总写入完成: ${inserted} 条，错误 ${errors}`);
    return { inserted, errors };
}

// ── 保存收款明细到数据库 ──────────────────────────────────────────────────────

async function savePaymentsToDB(records, storeNameMap, log = console.log) {
    let inserted = 0, errors = 0;

    await db.transaction(async () => {
        for (const r of records) {
            const storeId = storeNameMap.get(r.store_name) || null;
            try {
                await db.run(
                    `INSERT OR REPLACE INTO payment_method_summary
                    (id, store_name, store_id, date, month,
                     biz_sub_type, payment_method,
                     total_amount, total_discount, total_income, handling_fee,
                     payment_count, updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
                    [
                        uuidv4(),
                        r.store_name, storeId, r.date, r.month,
                        r.biz_sub_type, r.payment_method,
                        r.total_amount, r.total_discount, r.total_income, r.handling_fee,
                        r.payment_count,
                    ]
                );
                inserted++;
            } catch (e) {
                errors++;
                log(`⚠️  收款汇总写入失败 [${r.store_name} ${r.date} ${r.payment_method}]: ${e.message}`);
            }
        }
    });

    log(`   收款汇总写入: ${inserted} 条，错误 ${errors}`);
    return { inserted, errors };
}

// ── 统计聚合：从 orders 表计算 sales_summary / monthly_summary ─────────────────

/**
 * 计算指定门店+日期的各渠道日度统计
 * 返回多条记录：'all' + 每个出现的渠道
 */
async function calculateDailySales(storeId, date) {
    // 'all' — 合计
    const total = await db.queryOne(
        `SELECT SUM(order_amount) AS amount, SUM(order_income) AS income,
                SUM(order_discount) AS discount, COUNT(*) AS cnt,
                AVG(order_amount) AS avg_amt
         FROM orders WHERE store_id = ? AND business_date = ?`,
        [storeId, date]
    );
    if (!total || !total.cnt) return [];

    const results = [buildSummaryRow(storeId, date, 'all', total)];

    // 按渠道分组
    const byChannel = await db.query(
        `SELECT channel,
                SUM(order_amount) AS amount, SUM(order_income) AS income,
                SUM(order_discount) AS discount, COUNT(*) AS cnt,
                AVG(order_amount) AS avg_amt
         FROM orders WHERE store_id = ? AND business_date = ?
         GROUP BY channel`,
        [storeId, date]
    );
    for (const row of byChannel) {
        if (row.channel) results.push(buildSummaryRow(storeId, date, row.channel, row));
    }
    return results;
}

async function calculateMonthlySales(storeId, month) {
    const total = await db.queryOne(
        `SELECT SUM(order_amount) AS amount, SUM(order_income) AS income,
                SUM(order_discount) AS discount, COUNT(*) AS cnt,
                AVG(order_amount) AS avg_amt
         FROM orders WHERE store_id = ? AND order_month = ?`,
        [storeId, month]
    );
    if (!total || !total.cnt) return [];

    const results = [buildMonthlySummaryRow(storeId, month, 'all', total)];

    const byChannel = await db.query(
        `SELECT channel,
                SUM(order_amount) AS amount, SUM(order_income) AS income,
                SUM(order_discount) AS discount, COUNT(*) AS cnt,
                AVG(order_amount) AS avg_amt
         FROM orders WHERE store_id = ? AND order_month = ?
         GROUP BY channel`,
        [storeId, month]
    );
    for (const row of byChannel) {
        if (row.channel) results.push(buildMonthlySummaryRow(storeId, month, row.channel, row));
    }
    return results;
}

function buildSummaryRow(storeId, date, channel, r) {
    const amount   = r.amount   || 0;
    const discount = r.discount || 0;
    return {
        id: uuidv4(), store_id: storeId, date, month: date.substring(0, 7), channel,
        total_amount:     +amount.toFixed(2),
        total_income:     +((r.income || 0).toFixed(2)),
        total_discount:   +discount.toFixed(2),
        discount_ratio:   amount > 0 ? +(discount / amount * 100).toFixed(2) : 0,
        order_count:      r.cnt || 0,
        avg_order_amount: +((r.avg_amt || 0).toFixed(2)),
    };
}

function buildMonthlySummaryRow(storeId, month, channel, r) {
    const amount   = r.amount   || 0;
    const discount = r.discount || 0;
    return {
        id: uuidv4(), store_id: storeId, month, channel,
        total_amount:     +amount.toFixed(2),
        total_income:     +((r.income || 0).toFixed(2)),
        total_discount:   +discount.toFixed(2),
        discount_ratio:   amount > 0 ? +(discount / amount * 100).toFixed(2) : 0,
        order_count:      r.cnt || 0,
        avg_order_amount: +((r.avg_amt || 0).toFixed(2)),
    };
}

// ── 时段统计聚合：从已解析的 items 计算 timeslot_summary ─────────────────────

/**
 * 根据 parseDishSalesData 返回的 items 数组，
 * 按 store_id + date + hour + channel 聚合，生成 timeslot_summary 记录。
 * 同时生成 channel='all' 的汇总行。
 */
function calculateTimeslotFromItems(items) {
    // 先按 (store_id, date, hour, channel) 聚合
    const byChannel = new Map();
    const byAll     = new Map();

    for (const item of items) {
        const hour = item.hour;
        if (hour === null || hour === undefined) continue;

        // channel 维度
        const ck = `${item.store_id}__${item.business_date}__${hour}__${item.channel}`;
        if (!byChannel.has(ck)) {
            byChannel.set(ck, {
                store_id: item.store_id, store_name: item.store_name,
                date: item.business_date, month: item.month,
                hour, channel: item.channel,
                orders: new Set(), total_amount: 0, total_income: 0,
            });
        }
        const c = byChannel.get(ck);
        c.orders.add(item.order_id);
        c.total_amount += item.amount;
        c.total_income += item.income;

        // all 维度
        const ak = `${item.store_id}__${item.business_date}__${hour}`;
        if (!byAll.has(ak)) {
            byAll.set(ak, {
                store_id: item.store_id, store_name: item.store_name,
                date: item.business_date, month: item.month,
                hour, channel: 'all',
                orders: new Set(), total_amount: 0, total_income: 0,
            });
        }
        const a = byAll.get(ak);
        a.orders.add(item.order_id);
        a.total_amount += item.amount;
        a.total_income += item.income;
    }

    const toRow = (r) => ({
        store_id:     r.store_id,
        store_name:   r.store_name,
        date:         r.date,
        month:        r.month,
        hour:         r.hour,
        channel:      r.channel,
        tc:           r.orders.size,
        total_amount: +r.total_amount.toFixed(2),
        total_income: +r.total_income.toFixed(2),
    });

    return [
        ...Array.from(byAll.values()).map(toRow),
        ...Array.from(byChannel.values()).map(toRow),
    ];
}

async function saveTimeslotsToDB(rows, log = console.log) {
    let inserted = 0, errors = 0;

    await db.transaction(async () => {
        for (const r of rows) {
            try {
                await db.run(
                    `INSERT OR REPLACE INTO timeslot_summary
                    (id, store_id, store_name, date, month, hour, channel,
                     tc, total_amount, total_income, updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
                    [
                        uuidv4(),
                        r.store_id, r.store_name, r.date, r.month,
                        r.hour, r.channel,
                        r.tc, r.total_amount, r.total_income,
                    ]
                );
                inserted++;
            } catch (e) {
                errors++;
                if (errors <= 3) log(`⚠️  timeslot写入失败 [${r.store_id} ${r.date} H${r.hour}]: ${e.message}`);
            }
        }
    });

    log(`   时段汇总写入: ${inserted} 条，错误 ${errors}`);
    return { inserted, errors };
}

module.exports = {
    detectFileType,
    // 读取
    readChannelOrdersFile,
    readDishSalesFile,
    readPaymentsDetailFile,
    // 解析
    parseOrders,
    parseDishSalesData,
    extractStoresFromDishSales,
    parsePaymentRecords,
    // 写入
    saveStoresToDB,
    buildStoreNameMap,
    saveOrdersToDB,
    saveDishesToDB,
    saveDishSalesToDB,
    savePaymentsToDB,
    // 聚合计算
    calculateDailySales,
    calculateMonthlySales,
    calculateTimeslotFromItems,
    saveTimeslotsToDB,
    // 向下兼容旧接口名
    readExcelFile: readChannelOrdersFile,
};
