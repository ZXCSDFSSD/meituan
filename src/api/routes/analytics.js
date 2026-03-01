/**
 * Analytics API 路由
 *
 * ════════════════════════════════════════════
 * 【Express 路由是什么？】
 *   Express 是 Node.js 最流行的 Web 框架。
 *   路由（Route）就是"URL 路径 → 处理函数"的映射规则。
 *   例如：router.get('/overview', handler) 表示：
 *     当收到 GET /api/analytics/overview 请求时，执行 handler 函数。
 *
 * 【async/await 是什么？】
 *   JavaScript 处理异步操作（如数据库查询）的现代语法。
 *   async function → 声明异步函数
 *   await xxx()   → 等待异步操作完成，期间不阻塞其他代码
 *   类比：await 就像"挂单等候"，你下单（发起查询）后先去做别的，
 *         数据库准备好了再通知你（回调），而不是一直站在那儿等。
 *
 * 【req / res 是什么？】
 *   每个路由处理函数都接收 (req, res) 两个参数：
 *   req（Request）  → 客户端发来的请求对象（包含 URL 参数、请求体等）
 *   res（Response） → 服务端的响应对象（用于发送数据回给客户端）
 *   res.json(data)  → 把 data 对象序列化为 JSON 字符串发送给前端
 *
 * 【SQL 基础语法（在这个文件里大量使用）】
 *   SELECT 字段1, 字段2      → 查询哪些列
 *   FROM 表名                → 从哪张表查
 *   WHERE 条件               → 过滤行（只返回满足条件的行）
 *   GROUP BY 字段            → 按某字段分组（配合 SUM/COUNT 等聚合函数使用）
 *   ORDER BY 字段 DESC/ASC   → 排序（DESC 降序，ASC 升序）
 *   LIMIT 数量               → 只返回前 N 行
 *   LEFT JOIN 表 ON 条件     → 左连接（保留左表所有行，右表没匹配的填 NULL）
 *   COALESCE(a, b)           → 返回第一个非 NULL 的值（a 不为 NULL 则返回 a，否则返回 b）
 *   CASE WHEN ... THEN ... ELSE ... END → SQL 中的 if-else 逻辑
 *
 * 【参数化查询（防 SQL 注入）】
 *   db.query('SELECT * FROM table WHERE id = ?', [storeId])
 *   用 ? 占位符，把用户输入的值通过数组传入（而不是拼接字符串）。
 *   这样可以防止 SQL 注入攻击（用户输入 " OR 1=1 " 不会破坏查询）。
 * ════════════════════════════════════════════
 *
 * 9个数据分析端点：
 *  GET /api/analytics/overview          # 总览：8店汇总数据
 *  GET /api/analytics/trend             # 月度趋势（含同比/环比）
 *  GET /api/analytics/channel-breakdown # 渠道分解（堂食/美团/饿了么/京东）
 *  GET /api/analytics/category-sales    # 部类销售分析
 *  GET /api/analytics/timeslot          # 24小时时段分析
 *  GET /api/analytics/store-rank        # 门店营业额排名
 *  GET /api/analytics/monthly-compare   # 月度同比环比对比
 *  GET /api/analytics/store-detail/:id  # 单店详情
 *  GET /api/analytics/products          # 品项销量分析（Top N）
 *
 * 通用查询参数：
 *   month      YYYY-MM        月份过滤（默认当前最新月）
 *   start_month YYYY-MM       起始月份（trend/monthly-compare）
 *   end_month   YYYY-MM       结束月份
 *   store_id   MD00001...     门店过滤（不传=全部门店汇总）
 *   channel    all|堂食|外卖|美团外卖|饿了么|京东秒送  渠道过滤（默认 all）
 *   limit      int            Top N 条数（默认 20）
 */

'use strict';

const express = require('express');
const db      = require('../../storage/database');

const router = express.Router();

// ── 工具函数 ──────────────────────────────────────────────────────────────────

/**
 * getLatestMonth — 获取数据库中最新的月份
 *
 * 【SQL 解释】
 *   SELECT month          → 只查询 month 这一列
 *   FROM monthly_summary  → 从月度汇总表中查
 *   ORDER BY month DESC   → 按月份降序排列（最新月份在第一行）
 *   LIMIT 1               → 只取第一行（即最新月）
 *
 * 返回：如 '2025-12'，或 null（如果表中没有任何数据）
 * 用途：当前端没有传 month 参数时，默认显示最新有数据的月份
 */
async function getLatestMonth() {
    const row = await db.queryOne(
        `SELECT month FROM monthly_summary ORDER BY month DESC LIMIT 1`
    );
    return row ? row.month : null;
}

/**
 * sendError — 统一错误响应格式
 *
 * res.status(status) → 设置 HTTP 状态码（500=服务器错误，404=未找到，400=请求错误）
 * .json({ error: msg }) → 发送 JSON 格式错误信息给前端
 * 前端的 Axios 拦截器会捕获非 2xx 状态码，提取 error 字段显示给用户
 */
function sendError(res, msg, status = 500) {
    return res.status(status).json({ error: msg });
}

// ── 1. 总览 /overview ────────────────────────────────────────────────────────
/**
 * 返回指定月份（或年份）所有门店的汇总指标：
 *   营业额、客流量(TC)、客单价(AC)、优惠金额、订单数
 *   按渠道拆分：堂食 / 外卖小计 / 美团外卖 / 饿了么 / 京东秒送
 */
router.get('/overview', async (req, res) => {
    try {
        const month   = req.query.month   || await getLatestMonth();
        const storeId = req.query.store_id;

        if (!month) return sendError(res, '暂无数据', 404);

        // ── 月度营业额汇总（按渠道）────────────────────────────────────
        /**
         * 动态构建 WHERE 子句（条件查询）
         *
         * 【为什么用数组而不是字符串拼接？】
         *   如果 storeId 存在，需要追加额外的 WHERE 条件。
         *   用数组收集条件，最后 .join(' AND ') 合并，比字符串拼接更清晰安全。
         *   params 数组与 ? 占位符一一对应（顺序必须一致）。
         *
         * 示例（storeId='MD00001'）：
         *   whereClauses = ['m.month = ?', 'm.store_id = ?']
         *   params       = ['2025-12', 'MD00001']
         *   生成 SQL：WHERE m.month = '2025-12' AND m.store_id = 'MD00001'
         */
        let whereClauses = ['m.month = ?'];
        const params = [month];
        if (storeId) { whereClauses.push('m.store_id = ?'); params.push(storeId); }

        /**
         * 按渠道汇总查询
         *
         * 【SQL 聚合函数】
         *   SUM(字段) → 求和（所有行的值加总）
         *   COUNT(*)  → 计数
         *   ROUND(值, 小数位) → 四舍五入
         *
         * 【CASE WHEN ... END — SQL 条件表达式】
         *   类似编程语言的三元运算符：条件 ? 真值 : 假值
         *   这里：如果 order_count > 0，就计算 AC（客单价）；否则返回 0（防止除以零）
         *
         * 【GROUP BY m.channel】
         *   monthly_summary 表中每个门店的每个渠道都有单独一行。
         *   GROUP BY 把相同 channel 的行合并成一行，配合 SUM 求该渠道所有门店的总和。
         *   结果：每个 channel 值（all/堂食/美团外卖/饿了么/京东秒送）各一行。
         *
         * 【AS 别名】
         *   SUM(m.total_amount) AS total_amount → 查询结果的列名叫 total_amount
         *   这样 JS 代码里 row.total_amount 才能取到值
         */
        const summaryRows = await db.query(
            `SELECT m.channel,
                    SUM(m.total_amount)   AS total_amount,
                    SUM(m.total_income)   AS total_income,
                    SUM(m.total_discount) AS total_discount,
                    SUM(m.order_count)    AS order_count,
                    CASE WHEN SUM(m.order_count) > 0
                         THEN ROUND(SUM(m.total_amount) / SUM(m.order_count), 2)
                         ELSE 0 END       AS avg_ac
             FROM monthly_summary m
             WHERE ${whereClauses.join(' AND ')}
             GROUP BY m.channel`,
            params
        );

        // ── 门店数量（本月有数据）
        const storeCountRow = await db.queryOne(
            `SELECT COUNT(DISTINCT store_id) AS cnt
             FROM monthly_summary
             WHERE month = ? AND channel = 'all'` + (storeId ? ' AND store_id = ?' : ''),
            storeId ? [month, storeId] : [month]
        );

        // ── 收款方式汇总（本月）
        const paymentRows = await db.query(
            `SELECT payment_method,
                    SUM(total_amount)   AS total_amount,
                    SUM(total_income)   AS total_income,
                    SUM(handling_fee)   AS handling_fee,
                    SUM(payment_count)  AS payment_count
             FROM payment_method_summary
             WHERE month = ?` + (storeId ? ' AND store_id = ?' : '') +
            ` GROUP BY payment_method
              ORDER BY total_amount DESC`,
            storeId ? [month, storeId] : [month]
        );

        // ── 整理输出
        const channelMap = {};
        for (const r of summaryRows) {
            channelMap[r.channel] = r;
        }

        const allRow    = channelMap['all']    || {};
        const dineRow   = channelMap['堂食']   || {};
        const mtRow     = channelMap['美团外卖'] || {};
        const eleRow    = channelMap['饿了么']  || {};
        const jdRow     = channelMap['京东秒送'] || {};

        // 外卖小计 = 美团 + 饿了么 + 京东
        const deliveryAmount = (mtRow.total_amount || 0) + (eleRow.total_amount || 0) + (jdRow.total_amount || 0);
        const deliveryCount  = (mtRow.order_count  || 0) + (eleRow.order_count  || 0) + (jdRow.order_count  || 0);
        const deliveryAC     = deliveryCount > 0 ? Math.round(deliveryAmount / deliveryCount * 100) / 100 : 0;

        res.json({
            month,
            store_count: storeCountRow?.cnt || 0,
            summary: {
                total_amount:   allRow.total_amount   || 0,
                total_income:   allRow.total_income   || 0,
                total_discount: allRow.total_discount || 0,
                order_count:    allRow.order_count    || 0,
                avg_ac:         allRow.avg_ac         || 0,
            },
            channels: {
                dine_in:  { amount: dineRow.total_amount || 0, order_count: dineRow.order_count || 0, ac: dineRow.avg_ac || 0 },
                delivery: { amount: deliveryAmount,           order_count: deliveryCount,           ac: deliveryAC },
                meituan:  { amount: mtRow.total_amount  || 0, order_count: mtRow.order_count  || 0, ac: mtRow.avg_ac  || 0 },
                eleme:    { amount: eleRow.total_amount || 0, order_count: eleRow.order_count || 0, ac: eleRow.avg_ac || 0 },
                jd:       { amount: jdRow.total_amount  || 0, order_count: jdRow.order_count  || 0, ac: jdRow.avg_ac  || 0 },
            },
            channel_ratio: {
                dine_in:  allRow.total_amount > 0 ? Math.round((dineRow.total_amount || 0) / allRow.total_amount * 1000) / 10 : 0,
                delivery: allRow.total_amount > 0 ? Math.round(deliveryAmount / allRow.total_amount * 1000) / 10 : 0,
                meituan:  allRow.total_amount > 0 ? Math.round((mtRow.total_amount  || 0) / allRow.total_amount * 1000) / 10 : 0,
                eleme:    allRow.total_amount > 0 ? Math.round((eleRow.total_amount || 0) / allRow.total_amount * 1000) / 10 : 0,
                jd:       allRow.total_amount > 0 ? Math.round((jdRow.total_amount  || 0) / allRow.total_amount * 1000) / 10 : 0,
            },
            payment_methods: paymentRows,
        });
    } catch (e) {
        console.error('[analytics/overview]', e);
        sendError(res, e.message);
    }
});

// ── 2. 月度趋势 /trend ────────────────────────────────────────────────────────
/**
 * 返回连续多月的营业额趋势（含环比 MoM）
 *   - 可按门店过滤（不传=全区域汇总）
 *   - 可按渠道过滤
 */
router.get('/trend', async (req, res) => {
    try {
        const channel     = req.query.channel      || 'all';
        const storeId     = req.query.store_id;
        const startMonth  = req.query.start_month;
        const endMonth    = req.query.end_month     || await getLatestMonth();
        const limit       = Math.min(parseInt(req.query.limit || '24', 10), 60);

        if (!endMonth) return sendError(res, '暂无数据', 404);

        let where = ['channel = ?'];
        const params = [channel];

        if (storeId)    { where.push('store_id = ?');     params.push(storeId); }
        if (startMonth) { where.push('month >= ?');       params.push(startMonth); }
        if (endMonth)   { where.push('month <= ?');       params.push(endMonth); }

        const rows = await db.query(
            `SELECT month,
                    SUM(total_amount)   AS total_amount,
                    SUM(total_income)   AS total_income,
                    SUM(total_discount) AS total_discount,
                    SUM(order_count)    AS order_count,
                    CASE WHEN SUM(order_count) > 0
                         THEN ROUND(SUM(total_amount)/SUM(order_count),2)
                         ELSE 0 END AS avg_ac
             FROM monthly_summary
             WHERE ${where.join(' AND ')}
             GROUP BY month
             ORDER BY month ASC
             LIMIT ?`,
            [...params, limit]
        );

        /**
         * 计算环比 MoM（Month-on-Month，相邻月之间的变化率）
         *
         * 【Array.map 遍历】
         *   rows.map((r, i) => ...) — 遍历数组，r 是当前行，i 是下标（0-based）
         *
         * 【环比公式】
         *   MoM% = (本月 - 上月) / 上月 × 100%
         *   这里 * 1000 / 10 等效于 * 100，但保留1位小数（Math.round 后除10）
         *
         * 【展开运算符 ...r】
         *   { ...r, mom_pct: mom } — 把 r 的所有字段展开，再添加 mom_pct 字段
         *   等价于 Object.assign({}, r, { mom_pct: mom })
         */
        const result = rows.map((r, i) => {
            const prev = rows[i - 1];
            const mom  = prev && prev.total_amount > 0
                ? Math.round((r.total_amount - prev.total_amount) / prev.total_amount * 1000) / 10
                : null;
            return { ...r, mom_pct: mom };
        });

        res.json({ channel, store_id: storeId || 'all', data: result });
    } catch (e) {
        console.error('[analytics/trend]', e);
        sendError(res, e.message);
    }
});

// ── 3. 渠道分解 /channel-breakdown ──────────────────────────────────────────
/**
 * 指定月份，按门店×渠道展开的详细数据
 *   对应 Sheet4 / Sheet5 结构
 *   每家门店：堂食 / 外卖 / 美团 / 饿了么 / 京东 各维度的 营业额/TC/AC/优惠
 */
router.get('/channel-breakdown', async (req, res) => {
    try {
        const month   = req.query.month || await getLatestMonth();
        const storeId = req.query.store_id;

        if (!month) return sendError(res, '暂无数据', 404);

        let where = ['month = ?'];
        const params = [month];
        if (storeId) { where.push('store_id = ?'); params.push(storeId); }

        const rows = await db.query(
            `SELECT store_id, store_name, channel,
                    SUM(total_amount)   AS total_amount,
                    SUM(total_income)   AS total_income,
                    SUM(total_discount) AS total_discount,
                    SUM(order_count)    AS order_count,
                    CASE WHEN SUM(order_count)>0
                         THEN ROUND(SUM(total_amount)/SUM(order_count),2)
                         ELSE 0 END AS avg_ac
             FROM monthly_summary
             WHERE ${where.join(' AND ')}
             GROUP BY store_id, store_name, channel
             ORDER BY store_id, channel`,
            params
        );

        /**
         * 整理为 { store_id → { store_name, channels: {all,堂食,美团外卖,饿了么,京东秒送} } }
         *
         * 【Map 数据结构】
         *   new Map() — 键值对集合，类似对象 {} 但键可以是任意类型（而不只是字符串）
         *   storeMap.has(key)       → 判断键是否存在
         *   storeMap.set(key, val) → 设置键值对
         *   storeMap.get(key)      → 获取值
         *
         * 【为什么用 Map 而不是普通对象？】
         *   可以用 for...of 方便地遍历，且键的插入顺序有保证
         */
        const storeMap = new Map();
        for (const r of rows) {
            if (!storeMap.has(r.store_id)) {
                storeMap.set(r.store_id, { store_id: r.store_id, store_name: r.store_name, channels: {} });
            }
            storeMap.get(r.store_id).channels[r.channel] = {
                total_amount:   r.total_amount,
                total_income:   r.total_income,
                total_discount: r.total_discount,
                order_count:    r.order_count,
                avg_ac:         r.avg_ac,
            };
        }

        // 追加外卖小计
        const stores = [];
        for (const [, s] of storeMap) {
            const mt  = s.channels['美团外卖'] || {};
            const ele = s.channels['饿了么']   || {};
            const jd  = s.channels['京东秒送'] || {};
            const deliveryAmount = (mt.total_amount || 0) + (ele.total_amount || 0) + (jd.total_amount || 0);
            const deliveryCount  = (mt.order_count  || 0) + (ele.order_count  || 0) + (jd.order_count  || 0);
            s.channels['外卖'] = {
                total_amount:   deliveryAmount,
                total_income:   (mt.total_income || 0) + (ele.total_income || 0) + (jd.total_income || 0),
                total_discount: (mt.total_discount || 0) + (ele.total_discount || 0) + (jd.total_discount || 0),
                order_count:    deliveryCount,
                avg_ac:         deliveryCount > 0 ? Math.round(deliveryAmount / deliveryCount * 100) / 100 : 0,
            };
            stores.push(s);
        }

        res.json({ month, stores });
    } catch (e) {
        console.error('[analytics/channel-breakdown]', e);
        sendError(res, e.message);
    }
});

// ── 4. 部类销售 /category-sales ───────────────────────────────────────────────
/**
 * 指定月份的品类销售汇总（对应 Sheet6/Sheet7/Sheet8）
 *   支持按门店、渠道过滤
 *   返回：品类名、销售数量、销售金额、占比
 */
router.get('/category-sales', async (req, res) => {
    try {
        const month   = req.query.month   || await getLatestMonth();
        const storeId = req.query.store_id;
        const channel = req.query.channel;
        const limit   = Math.min(parseInt(req.query.limit || '60', 10), 200);

        if (!month) return sendError(res, '暂无数据', 404);

        let where = ['iss.month = ?'];
        const params = [month];
        if (storeId) { where.push('iss.store_id = ?'); params.push(storeId); }
        if (channel) { where.push('od.channel = ?');   params.push(channel); }

        /**
         * 品类销售查询有两条路径（根据是否有渠道过滤）：
         *
         * 路径1（有渠道过滤）：从 order_dishes 聚合
         *   item_sales_summary 表没有 channel 列（导入时未记录渠道），
         *   所以渠道过滤必须回到原始 order_dishes 表查询（速度慢但准确）。
         *   business_date LIKE month+'%' — 用日期前缀匹配月份内所有日期
         *
         * 路径2（无渠道过滤）：从 item_sales_summary 聚合
         *   item_sales_summary 是已经聚合好的月度品类汇总，查询速度快。
         *
         * 【COALESCE(a, b) 函数】
         *   返回第一个非 NULL 的参数。
         *   COALESCE(cm.standard_name, od.dish_category) 意思是：
         *   如果 category_mapping 中有这个品类的标准名就用标准名，
         *   否则用原始品类名（各门店品类名可能不统一，映射表做标准化）。
         *
         * 【LEFT JOIN ... ON 条件】
         *   LEFT JOIN 保留左表（order_dishes）的所有行，
         *   右表（category_mapping）没有匹配时对应列填 NULL，
         *   这正好配合 COALESCE 实现"有映射用映射名，无映射用原始名"。
         */
        let sql, queryParams;
        if (channel) {
            // 渠道过滤：从 order_dishes 聚合，JOIN category_mapping 标准化
            sql = `SELECT COALESCE(cm.standard_name, od.dish_category) AS category,
                          SUM(od.quantity)  AS total_quantity,
                          SUM(od.amount)    AS total_amount,
                          SUM(od.income)    AS total_income,
                          SUM(od.discount)  AS total_discount,
                          COUNT(DISTINCT od.order_id) AS order_count
                   FROM order_dishes od
                   LEFT JOIN category_mapping cm
                     ON cm.raw_name = od.dish_category AND cm.store_id IS NULL
                   WHERE od.business_date LIKE ?
                     ${storeId ? 'AND od.store_id = ?' : ''}
                     AND od.channel = ?
                     AND od.dish_category IS NOT NULL
                     AND od.dish_category != ''
                   GROUP BY COALESCE(cm.standard_name, od.dish_category)
                   ORDER BY total_amount DESC
                   LIMIT ?`;
            queryParams = storeId
                ? [month + '%', storeId, channel, limit]
                : [month + '%', channel, limit];
        } else {
            sql = `SELECT COALESCE(cm.standard_name, iss.category) AS category,
                          SUM(iss.total_quantity) AS total_quantity,
                          SUM(iss.total_amount)   AS total_amount,
                          SUM(iss.total_income)   AS total_income,
                          SUM(iss.total_discount) AS total_discount,
                          SUM(iss.order_count)    AS order_count
                   FROM item_sales_summary iss
                   LEFT JOIN category_mapping cm
                     ON cm.raw_name = iss.category AND cm.store_id IS NULL
                   WHERE ${where.join(' AND ')}
                     AND iss.category IS NOT NULL AND iss.category != ''
                   GROUP BY COALESCE(cm.standard_name, iss.category)
                   ORDER BY total_amount DESC
                   LIMIT ?`;
            queryParams = [...params, limit];
        }

        const rows = await db.query(sql, queryParams);

        // 计算总金额，追加占比
        const totalAmount = rows.reduce((s, r) => s + (r.total_amount || 0), 0);
        const result = rows.map(r => ({
            ...r,
            amount_ratio: totalAmount > 0
                ? Math.round((r.total_amount || 0) / totalAmount * 1000) / 10
                : 0,
        }));

        res.json({
            month,
            store_id: storeId || 'all',
            channel:  channel  || 'all',
            total_amount: totalAmount,
            categories: result,
        });
    } catch (e) {
        console.error('[analytics/category-sales]', e);
        sendError(res, e.message);
    }
});

// ── 5. 时段分析 /timeslot ─────────────────────────────────────────────────────
/**
 * 24小时时段分析（对应 Sheet10 / Sheet11）
 *   返回每小时的 TC、营业额
 *   支持按月份、门店、渠道过滤
 */
router.get('/timeslot', async (req, res) => {
    try {
        const month   = req.query.month   || await getLatestMonth();
        const storeId = req.query.store_id;
        const channel = req.query.channel || 'all';

        if (!month) return sendError(res, '暂无数据', 404);

        let where = ['month = ?', 'channel = ?'];
        const params = [month, channel];
        if (storeId) { where.push('store_id = ?'); params.push(storeId); }

        const rows = await db.query(
            `SELECT hour,
                    SUM(tc)           AS tc,
                    SUM(total_amount) AS total_amount,
                    SUM(total_income) AS total_income
             FROM timeslot_summary
             WHERE ${where.join(' AND ')}
             GROUP BY hour
             ORDER BY hour ASC`,
            params
        );

        /**
         * 补全 0-23 全部时段（无数据的小时填 0）
         *
         * 【为什么需要补全？】
         *   timeslot_summary 只有"有订单"的小时才有记录（凌晨通常没数据）。
         *   如果直接返回 DB 结果，前端图表的 X 轴会不连续（缺失某些小时）。
         *   补全后保证 24 个小时都有数据点，图表 X 轴完整。
         *
         * 【new Map(rows.map(r => [r.hour, r]))】
         *   rows.map(r => [r.hour, r]) → 把每行转成 [key, value] 对 → [[11, {...}], [12, {...}]]
         *   new Map([...]) → 从键值对数组创建 Map
         *   这样可以用 hourMap.get(h) 快速查某小时的数据（O(1) 时间复杂度）
         *
         * 【hourMap.get(h)?.tc || 0】
         *   可选链 ?. ：如果 hourMap.get(h) 返回 undefined（该小时无数据），
         *   ?.tc 不报错，直接返回 undefined；|| 0 表示 undefined 时用 0 代替
         */
        const hourMap = new Map(rows.map(r => [r.hour, r]));
        const hours = Array.from({ length: 24 }, (_, h) => ({
            hour:         h,
            label:        `${String(h).padStart(2,'0')}:00`,
            tc:           hourMap.get(h)?.tc           || 0,
            total_amount: hourMap.get(h)?.total_amount || 0,
            total_income: hourMap.get(h)?.total_income || 0,
        }));

        // 高峰时段：TC 最高的前 3 个小时
        const sorted = [...hours].sort((a, b) => b.tc - a.tc);
        const peakHours = sorted.slice(0, 3).map(h => h.hour);

        res.json({
            month,
            store_id:   storeId || 'all',
            channel,
            peak_hours: peakHours,
            hours,
        });
    } catch (e) {
        console.error('[analytics/timeslot]', e);
        sendError(res, e.message);
    }
});

// ── 6. 门店排名 /store-rank ───────────────────────────────────────────────────
/**
 * 指定月份门店营业额排名
 *   返回：营业额、TC、AC、环比（与上月比）
 *   支持渠道过滤
 */
router.get('/store-rank', async (req, res) => {
    try {
        const month   = req.query.month   || await getLatestMonth();
        const channel = req.query.channel || 'all';

        if (!month) return sendError(res, '暂无数据', 404);

        // 当月数据
        const current = await db.query(
            `SELECT m.store_id, m.store_name,
                    m.total_amount, m.total_income, m.total_discount,
                    m.order_count, m.avg_order_amount,
                    s.location_type, s.has_partner
             FROM monthly_summary m
             LEFT JOIN stores s ON m.store_id = s.store_id
             WHERE m.month = ? AND m.channel = ?
             ORDER BY m.total_amount DESC`,
            [month, channel]
        );

        /**
         * 计算上月月份字符串（用于环比查询）
         *
         * month.split('-') → '2025-12' 变成 ['2025', '12']
         * .map(Number)     → 把字符串数组转为数字数组 [2025, 12]
         * const [year, mon] = ... → 解构赋值，year=2025，mon=12
         *
         * 跨年处理：mon===1 时（一月的上月是去年十二月），需要年份减1
         * String(mon - 1).padStart(2, '0') → 月份不足两位时补零（'9' → '09'）
         */
        const [year, mon] = month.split('-').map(Number);
        const prevMonth = mon === 1
            ? `${year - 1}-12`
            : `${year}-${String(mon - 1).padStart(2, '0')}`;

        const prevMap = new Map();
        const prevRows = await db.query(
            `SELECT store_id, total_amount, order_count
             FROM monthly_summary
             WHERE month = ? AND channel = ?`,
            [prevMonth, channel]
        );
        for (const r of prevRows) prevMap.set(r.store_id, r);

        const result = current.map((r, i) => {
            const prev = prevMap.get(r.store_id);
            const mom  = prev && prev.total_amount > 0
                ? Math.round((r.total_amount - prev.total_amount) / prev.total_amount * 1000) / 10
                : null;
            return {
                rank:           i + 1,
                store_id:       r.store_id,
                store_name:     r.store_name,
                location_type:  r.location_type,
                has_partner:    r.has_partner === 1,
                total_amount:   r.total_amount,
                total_income:   r.total_income,
                total_discount: r.total_discount,
                order_count:    r.order_count,
                avg_ac:         r.avg_order_amount,
                prev_amount:    prev?.total_amount  || null,
                mom_pct:        mom,
            };
        });

        res.json({ month, channel, stores: result });
    } catch (e) {
        console.error('[analytics/store-rank]', e);
        sendError(res, e.message);
    }
});

// ── 7. 月度同比环比 /monthly-compare ─────────────────────────────────────────
/**
 * 对应 Sheet1 / Sheet2 结构：
 *   - 按门店逐月的营业额、TC、AC
 *   - 同比（YoY）= 与去年同期比
 *   - 环比（MoM）= 与上月比
 */
router.get('/monthly-compare', async (req, res) => {
    try {
        const year    = parseInt(req.query.year || new Date().getFullYear().toString(), 10);
        const storeId = req.query.store_id;
        const channel = req.query.channel || 'all';
        const metric  = req.query.metric  || 'amount'; // amount | tc | ac

        /**
         * 构造当年和去年的月份数组（各12个）
         *
         * Array.from({length:12}, (_, i) => ...)
         *   创建长度为12的数组，_ 是忽略的元素值，i 是下标(0-11)
         *   i+1 就是月份(1-12)，padStart(2,'0') 补零
         *   生成如：['2025-01', '2025-02', ..., '2025-12']
         *
         * allMonths = [...lastYearMonths, ...thisYearMonths]
         *   把两个数组合并（共24个月份），用于一次性 WHERE month IN (...) 查询
         *
         * 【WHERE ... IN (?, ?, ...)】
         *   一次查询24个月的数据（比发24次请求效率高100倍）
         *   .map(() => '?').join(',') → 生成 "?,?,?..." 占位符串
         */
        const thisYearMonths  = Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`);
        const lastYearMonths  = Array.from({length:12},(_,i)=>`${year-1}-${String(i+1).padStart(2,'0')}`);
        const allMonths       = [...lastYearMonths, ...thisYearMonths];

        let where = ['channel = ?', `month IN (${allMonths.map(() => '?').join(',')})`];
        const params = [channel, ...allMonths];
        if (storeId) { where.push('store_id = ?'); params.push(storeId); }

        const rows = await db.query(
            `SELECT store_id, store_name, month,
                    SUM(total_amount)  AS total_amount,
                    SUM(order_count)   AS order_count,
                    CASE WHEN SUM(order_count)>0
                         THEN ROUND(SUM(total_amount)/SUM(order_count),2)
                         ELSE 0 END AS avg_ac
             FROM monthly_summary
             WHERE ${where.join(' AND ')}
             GROUP BY store_id, store_name, month
             ORDER BY store_id, month`,
            params
        );

        /**
         * 整理数据：把扁平的查询结果按"门店→月份"的嵌套结构组织
         *
         * 查询结果是扁平的（每行代表一个门店+月份组合）：
         *   [{ store_id: 'MD00001', month: '2025-01', total_amount: 8000 },
         *    { store_id: 'MD00001', month: '2025-02', total_amount: 9000 },
         *    { store_id: 'MD00005', month: '2025-01', total_amount: 7000 }, ...]
         *
         * 我们需要变成嵌套结构：
         *   { MD00001: { monthly: { '2025-01': {...}, '2025-02': {...} } },
         *     MD00005: { monthly: { '2025-01': {...} } } }
         *
         * for...of 遍历数组：for (const item of array) { ... }
         *   比 forEach 更现代，也支持 break/continue
         */
        const storeMap = new Map();
        for (const r of rows) {
            if (!storeMap.has(r.store_id)) {
                storeMap.set(r.store_id, { store_id: r.store_id, store_name: r.store_name, monthly: {} });
            }
            storeMap.get(r.store_id).monthly[r.month] = r;
        }

        /**
         * 对每个门店计算同比（YoY）和环比（MoM）
         *
         * 同比 YoY（Year-on-Year）= (今年同期 - 去年同期) / 去年同期 × 100%
         * 环比 MoM（Month-on-Month）= (本月 - 上月) / 上月 × 100%
         *
         * thisYearMonths[i] → 今年第 i 个月（如 '2025-03'）
         * lastYearMonths[i] → 去年第 i 个月（如 '2024-03'）
         * thisYearMonths[i-1] → 上个月（如 '2025-02'）
         *
         * 三元运算符（metric决定取哪个指标）：
         *   metric === 'tc' ? cur.order_count : metric === 'ac' ? cur.avg_ac : cur.total_amount
         *   嵌套三元，按指标类型取对应字段值
         */
        const result = [];
        for (const [sid, s] of storeMap) {
            const months = thisYearMonths.map((m, i) => {
                const cur  = s.monthly[m];
                const prev = s.monthly[lastYearMonths[i]];
                const prevMon = i > 0 ? s.monthly[thisYearMonths[i-1]] : null;

                const curVal  = cur
                    ? (metric === 'tc' ? cur.order_count : metric === 'ac' ? cur.avg_ac : cur.total_amount)
                    : null;
                const prevVal = prev
                    ? (metric === 'tc' ? prev.order_count : metric === 'ac' ? prev.avg_ac : prev.total_amount)
                    : null;
                const momVal  = prevMon
                    ? (metric === 'tc' ? prevMon.order_count : metric === 'ac' ? prevMon.avg_ac : prevMon.total_amount)
                    : null;

                return {
                    month:    m,
                    value:    curVal,
                    yoy_pct:  (curVal !== null && prevVal > 0)
                        ? Math.round((curVal - prevVal) / prevVal * 1000) / 10 : null,
                    mom_pct:  (curVal !== null && momVal > 0)
                        ? Math.round((curVal - momVal) / momVal * 1000) / 10 : null,
                    last_year_value: prevVal,
                };
            });

            result.push({
                store_id:   sid,
                store_name: s.store_name,
                metric,
                months,
                year_total: months.reduce((sum, m) => sum + (m.value || 0), 0),
            });
        }

        res.json({ year, channel, metric, stores: result });
    } catch (e) {
        console.error('[analytics/monthly-compare]', e);
        sendError(res, e.message);
    }
});

// ── 8. 单店详情 /store-detail/:id ────────────────────────────────────────────
/**
 * 指定门店的完整分析：
 *   - 门店基础信息
 *   - 最近12月趋势（营业额、TC、AC）
 *   - 当月渠道分解
 *   - 当月品类 Top 10
 *   - 当月时段分布（24h）
 *   - 当月收款方式
 */
router.get('/store-detail/:id', async (req, res) => {
    try {
        const storeId = req.params.id;
        const month   = req.query.month || await getLatestMonth();
        const channel = req.query.channel || 'all';

        if (!month) return sendError(res, '暂无数据', 404);

        // 门店基础信息
        const store = await db.queryOne(
            `SELECT * FROM stores WHERE store_id = ?`, [storeId]
        );
        if (!store) return sendError(res, `门店不存在: ${storeId}`, 404);

        /**
         * 最近12月趋势
         *
         * ORDER BY month DESC LIMIT 12 → 取最近12个月（降序，最新的在前）
         * 注意：查出来是降序，后面会 .reverse() 变成升序（图表从左到右时间递增）
         *
         * channel 参数：存储时 monthly_summary 有 channel='all' 的汇总行，
         * 这里取 'all' 就能得到不分渠道的总趋势，
         * 取 '堂食' 就只显示堂食渠道的趋势。
         */
        const trend = await db.query(
            `SELECT month, total_amount, total_income, total_discount, order_count, avg_order_amount
             FROM monthly_summary
             WHERE store_id = ? AND channel = ?
             ORDER BY month DESC LIMIT 12`,
            [storeId, channel]
        );

        // 当月渠道分解
        const channels = await db.query(
            `SELECT channel, total_amount, total_income, total_discount, order_count, avg_order_amount
             FROM monthly_summary
             WHERE store_id = ? AND month = ?
             ORDER BY channel`,
            [storeId, month]
        );

        /**
         * 当月品类 Top 10
         *
         * 【WHERE category IS NOT NULL AND category != ''】
         *   双重过滤：排除 NULL 值（未分类）和空字符串''
         *   IS NOT NULL 是 SQL 专用语法（不能用 != NULL，因为 NULL != NULL 恒为 NULL）
         *
         * GROUP BY category → 把相同品类的明细行合并，SUM 求总数量和总金额
         * ORDER BY total_amount DESC → 按销售额从高到低排，用于品类 Top 图表
         * LIMIT 10 → 只取前10个品类
         */
        const categories = await db.query(
            `SELECT category,
                    SUM(total_quantity) AS total_quantity,
                    SUM(total_amount)   AS total_amount,
                    SUM(order_count)    AS order_count
             FROM item_sales_summary
             WHERE store_id = ? AND month = ?
               AND category IS NOT NULL AND category != ''
             GROUP BY category
             ORDER BY total_amount DESC
             LIMIT 10`,
            [storeId, month]
        );

        // 当月时段分布
        const timeslots = await db.query(
            `SELECT hour, SUM(tc) AS tc, SUM(total_amount) AS total_amount
             FROM timeslot_summary
             WHERE store_id = ? AND month = ? AND channel = ?
             GROUP BY hour ORDER BY hour`,
            [storeId, month, channel]
        );

        // 补全 0-23
        const hourMap = new Map(timeslots.map(r => [r.hour, r]));
        const hours = Array.from({length:24},(_,h) => ({
            hour: h,
            label: `${String(h).padStart(2,'0')}:00`,
            tc:           hourMap.get(h)?.tc           || 0,
            total_amount: hourMap.get(h)?.total_amount || 0,
        }));

        // 当月收款方式
        const payments = await db.query(
            `SELECT payment_method, biz_sub_type,
                    SUM(total_amount)  AS total_amount,
                    SUM(total_income)  AS total_income,
                    SUM(handling_fee)  AS handling_fee,
                    SUM(payment_count) AS payment_count
             FROM payment_method_summary
             WHERE store_id = ? AND month = ?
             GROUP BY payment_method, biz_sub_type
             ORDER BY total_amount DESC`,
            [storeId, month]
        );

        res.json({
            store,
            month,
            channel,
            trend:      trend.reverse(),   // 升序
            channels,
            categories,
            hours,
            payments,
        });
    } catch (e) {
        console.error('[analytics/store-detail]', e);
        sendError(res, e.message);
    }
});

// ── 9. 品项分析 /products ─────────────────────────────────────────────────────
/**
 * 品项销量 Top N 分析
 *   支持按月份、门店、品类过滤
 *   返回：品项名、销量、销售额、收入、占比
 */
router.get('/products', async (req, res) => {
    try {
        const month    = req.query.month    || await getLatestMonth();
        const storeId  = req.query.store_id;
        const category = req.query.category;
        const limit    = Math.min(parseInt(req.query.limit || '20', 10), 100);

        if (!month) return sendError(res, '暂无数据', 404);

        let where = ['month = ?'];
        const params = [month];
        if (storeId)  { where.push('store_id = ?');  params.push(storeId); }
        if (category) { where.push('category = ?');  params.push(category); }

        const rows = await db.query(
            `SELECT item_id, item_name, category,
                    SUM(total_quantity) AS total_quantity,
                    SUM(total_amount)   AS total_amount,
                    SUM(total_income)   AS total_income,
                    SUM(total_discount) AS total_discount,
                    SUM(order_count)    AS order_count
             FROM item_sales_summary
             WHERE ${where.join(' AND ')}
               AND item_name IS NOT NULL AND item_name != ''
             GROUP BY item_id, item_name, category
             ORDER BY total_quantity DESC
             LIMIT ?`,
            [...params, limit]
        );

        const totalQty    = rows.reduce((s, r) => s + (r.total_quantity || 0), 0);
        const totalAmount = rows.reduce((s, r) => s + (r.total_amount   || 0), 0);

        const result = rows.map((r, i) => ({
            rank:           i + 1,
            ...r,
            qty_ratio:    totalQty > 0    ? Math.round((r.total_quantity||0)/totalQty*1000)/10 : 0,
            amount_ratio: totalAmount > 0 ? Math.round((r.total_amount  ||0)/totalAmount*1000)/10 : 0,
        }));

        res.json({
            month,
            store_id:     storeId  || 'all',
            category:     category || 'all',
            total_items:  result.length,
            total_qty:    totalQty,
            total_amount: totalAmount,
            products:     result,
        });
    } catch (e) {
        console.error('[analytics/products]', e);
        sendError(res, e.message);
    }
});

// ── 10. 门店列表 /stores ──────────────────────────────────────────────────────
/**
 * 返回所有门店列表（用于前端下拉筛选）
 */
router.get('/stores', async (req, res) => {
    try {
        const rows = await db.query(
            `SELECT store_id, store_name, location_type, has_partner
             FROM stores
             ORDER BY store_name`
        );
        res.json(rows);
    } catch (e) {
        console.error('[analytics/stores]', e);
        sendError(res, e.message);
    }
});

module.exports = router;
