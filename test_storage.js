/**
 * 存储模块测试 - 验证数据库数据是否正常
 *
 * 运行：node test_storage.js
 *
 * 检查项：
 *  1. 各表数据量
 *  2. 月份 / 门店分布
 *  3. 随机抽查订单
 *  4. 随机抽查菜品（验证关联正常）
 *  5. 随机抽查支付（验证关联正常）
 *  6. 日统计表
 *  7. 月统计表
 *  8. 菜品销售统计表
 */

'use strict';

const db = require('./src/storage/database');

// 打印分隔线 + 标题
function section(title) {
    console.log('\n' + '='.repeat(60));
    console.log(`  ${title}`);
    console.log('='.repeat(60));
}

// 打印表格（数组对象）
function table(rows) {
    if (!rows || rows.length === 0) {
        console.log('  （无数据）');
        return;
    }
    console.table(rows);
}

async function run() {
    await db.initializeDatabase();
    console.log('✅ 数据库连接成功\n');

    // ── 1. 各表数据量 ────────────────────────────────────────────────────────
    section('1. 各表数据量');
    const counts = await db.query(`
        SELECT '订单'         AS 表名, COUNT(*) AS 行数 FROM orders
        UNION ALL
        SELECT '菜品明细',     COUNT(*) FROM order_dishes
        UNION ALL
        SELECT '支付明细',     COUNT(*) FROM order_payments
        UNION ALL
        SELECT '日统计',       COUNT(*) FROM sales_summary
        UNION ALL
        SELECT '月统计',       COUNT(*) FROM monthly_summary
        UNION ALL
        SELECT '菜品销售统计', COUNT(*) FROM item_sales_summary
    `);
    table(counts);

    // ── 2. 月份分布 ──────────────────────────────────────────────────────────
    section('2. 订单月份分布');
    const months = await db.query(`
        SELECT order_month AS 月份, COUNT(*) AS 订单数
        FROM orders GROUP BY order_month ORDER BY order_month
    `);
    table(months);

    // ── 3. 门店分布 ──────────────────────────────────────────────────────────
    section('3. 门店订单分布');
    const stores = await db.query(`
        SELECT store_id AS 机构编码, store_name AS 门店名称, COUNT(*) AS 订单数,
               ROUND(SUM(payment_total), 2) AS 实收总额
        FROM orders GROUP BY store_id ORDER BY 订单数 DESC
    `);
    table(stores);

    // ── 4. 随机抽查 5 条订单 ─────────────────────────────────────────────────
    section('4. 随机抽查 5 条订单');
    const sampleOrders = await db.query(`
        SELECT order_id AS 订单号, store_name AS 门店, business_date AS 营业日期,
               order_amount AS 订单金额, payment_total AS 实收, order_status AS 状态
        FROM orders ORDER BY RANDOM() LIMIT 5
    `);
    table(sampleOrders);

    // ── 5. 随机抽查订单的菜品关联 ────────────────────────────────────────────
    section('5. 随机 1 条订单的菜品明细（验证 order_id 关联）');
    const refOrder = await db.queryOne(`
        SELECT order_id FROM orders ORDER BY RANDOM() LIMIT 1
    `);
    if (refOrder) {
        console.log(`  订单号: ${refOrder.order_id}`);
        const dishes = await db.query(`
            SELECT dish_name AS 菜品, quantity AS 数量, amount AS 金额, income AS 收入
            FROM order_dishes WHERE order_id = ?
        `, [refOrder.order_id]);
        table(dishes);

        const payments = await db.query(`
            SELECT payment_method AS 支付方式, payment_amount AS 支付金额, status AS 状态
            FROM order_payments WHERE order_id = ?
        `, [refOrder.order_id]);
        console.log('  支付明细:');
        table(payments);
    }

    // ── 6. 日统计表抽查 ──────────────────────────────────────────────────────
    section('6. 日统计表（sales_summary）随机 5 条');
    const dailySamples = await db.query(`
        SELECT store_id AS 门店, date AS 日期, order_count AS 订单数,
               total_revenue AS 营业额, total_discount AS 优惠, avg_order_amount AS 客单价
        FROM sales_summary ORDER BY RANDOM() LIMIT 5
    `);
    table(dailySamples);

    // ── 7. 月统计表抽查 ──────────────────────────────────────────────────────
    section('7. 月统计表（monthly_summary）全量');
    const monthly = await db.query(`
        SELECT store_id AS 门店, month AS 月份, order_count AS 订单数,
               total_revenue AS 营业额, total_discount AS 优惠, avg_order_amount AS 客单价
        FROM monthly_summary ORDER BY month, store_id
    `);
    table(monthly);

    // ── 8. 菜品销售统计 TOP10 ────────────────────────────────────────────────
    section('8. 菜品销售统计 TOP 10（按销售额）');
    const topItems = await db.query(`
        SELECT item_name AS 菜品, SUM(total_quantity) AS 总销量,
               ROUND(SUM(total_amount), 2) AS 总销售额
        FROM item_sales_summary
        GROUP BY item_name ORDER BY 总销售额 DESC LIMIT 10
    `);
    table(topItems);

    // ── 9. 数据一致性校验 ────────────────────────────────────────────────────
    section('9. 数据一致性校验');

    // 有菜品但无主订单的孤立菜品
    const orphanDishes = await db.queryOne(`
        SELECT COUNT(*) AS cnt FROM order_dishes od
        WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_id = od.order_id)
    `);
    console.log(`  孤立菜品（无主订单）: ${orphanDishes.cnt} 条${orphanDishes.cnt > 0 ? ' ⚠️' : ' ✅'}`);

    // 有支付但无主订单的孤立支付
    const orphanPayments = await db.queryOne(`
        SELECT COUNT(*) AS cnt FROM order_payments op
        WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_id = op.order_id)
    `);
    console.log(`  孤立支付（无主订单）: ${orphanPayments.cnt} 条${orphanPayments.cnt > 0 ? ' ⚠️' : ' ✅'}`);

    // 有订单但无菜品的订单（正常情况下应该很少）
    const ordersWithoutDishes = await db.queryOne(`
        SELECT COUNT(*) AS cnt FROM orders o
        WHERE NOT EXISTS (SELECT 1 FROM order_dishes od WHERE od.order_id = o.order_id)
    `);
    console.log(`  无菜品记录的订单: ${ordersWithoutDishes.cnt} 条`);

    // 有订单但无支付的订单
    const ordersWithoutPayments = await db.queryOne(`
        SELECT COUNT(*) AS cnt FROM orders o
        WHERE NOT EXISTS (SELECT 1 FROM order_payments op WHERE op.order_id = o.order_id)
    `);
    console.log(`  无支付记录的订单: ${ordersWithoutPayments.cnt} 条`);

    await db.closeDatabase();
    console.log('\n✅ 测试完成');
}

run().catch(e => {
    console.error('❌ 测试异常:', e.message);
    console.error(e);
    process.exit(1);
});
