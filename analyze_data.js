'use strict';
const { initDatabase, db } = require('./src/storage/index');

(async () => {
    await initDatabase();

    // ── 1. 总体概况
    const total = await db.queryOne(
        "SELECT COUNT(*) cnt, SUM(order_amount) amt, SUM(order_discount) disc, ROUND(AVG(order_amount),2) ac FROM orders WHERE order_month='2026-02'"
    );
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  2026-02-25~27 原始数据分析报告（7家门店，3天）');
    console.log('═══════════════════════════════════════════════════');
    console.log('\n【总体概况】');
    console.log('  订单数 :', total.cnt);
    console.log('  总营业额:', total.amt.toFixed(0), '元');
    console.log('  总优惠  :', total.disc.toFixed(0), '元');
    console.log('  综合 AC :', total.ac, '元');
    console.log('  日均订单:', Math.round(total.cnt / 3), '单/天');
    console.log('  日均营业:', Math.round(total.amt / 3), '元/天');

    // ── 2. 渠道分布
    const channels = await db.query(
        "SELECT channel, COUNT(*) cnt, SUM(order_amount) total, ROUND(AVG(order_amount),2) ac FROM orders WHERE order_month='2026-02' GROUP BY channel ORDER BY total DESC"
    );
    const grandTotal = channels.reduce((s, r) => s + r.total, 0);
    console.log('\n【渠道分布】');
    for (const r of channels) {
        const pct = (r.total / grandTotal * 100).toFixed(1);
        console.log('  ' + (r.channel || '未知').padEnd(10) + '| ' +
            String(r.cnt).padStart(5) + ' 单 | ' +
            r.total.toFixed(0).padStart(8) + ' 元 | ' +
            pct.padStart(5) + '% | AC ' + r.ac);
    }

    // ── 3. 门店 × 渠道汇总
    const storeChannel = await db.query(
        "SELECT store_name, channel, SUM(order_amount) amt, COUNT(*) cnt FROM orders WHERE order_month='2026-02' GROUP BY store_name, channel ORDER BY store_name, channel"
    );
    console.log('\n【各门店渠道分布】');
    let lastStore = '';
    for (const r of storeChannel) {
        if (r.store_name !== lastStore) {
            console.log('  ▸ ' + r.store_name.replace('常青麦香园', ''));
            lastStore = r.store_name;
        }
        console.log('    ' + (r.channel || '?').padEnd(8) + ' ' + r.cnt + '单 / ' + r.amt.toFixed(0) + '元');
    }

    // ── 4. 品类 Top 20
    const cats = await db.query(
        "SELECT dish_category, SUM(quantity) qty, SUM(amount) amt FROM order_dishes WHERE business_date LIKE '2026-02%' GROUP BY dish_category ORDER BY amt DESC LIMIT 20"
    );
    const catTotal = cats.reduce((s, r) => s + r.amt, 0);
    console.log('\n【品类 Top20（按营业额）】');
    for (const r of cats) {
        const pct = (r.amt / catTotal * 100).toFixed(1);
        console.log('  ' + (r.dish_category || '未知').padEnd(14) +
            '| ' + String(Math.round(r.qty)).padStart(6) + ' 份 | ' +
            r.amt.toFixed(0).padStart(8) + ' 元 | ' + pct + '%');
    }

    // ── 5. 品类数量（各门店）
    const catCount = await db.query(
        "SELECT store_name, COUNT(DISTINCT dish_category) cnt FROM order_dishes WHERE business_date LIKE '2026-02%' GROUP BY store_name ORDER BY store_name"
    );
    console.log('\n【各门店品类数（菜品销售明细）】');
    for (const r of catCount) {
        console.log('  ' + r.store_name.replace('常青麦香园', '').padEnd(14) + ': ' + r.cnt + ' 种大类');
    }

    // ── 6. 时段高峰（全天）
    const hours = await db.query(
        "SELECT hour, SUM(tc) tc, SUM(total_amount) amt FROM timeslot_summary WHERE month='2026-02' AND channel='all' GROUP BY hour ORDER BY hour"
    );
    console.log('\n【24小时时段分布（TC客流，所有门店合计）】');
    const maxTc = Math.max(...hours.map(r => r.tc));
    for (const r of hours) {
        const bar = '█'.repeat(Math.round(r.tc / maxTc * 20));
        console.log('  ' + String(r.hour).padStart(2) + ':00 | TC' +
            String(r.tc).padStart(5) + ' | ' + r.amt.toFixed(0).padStart(7) + '元 |' + bar);
    }

    // ── 7. 收款方式
    const pays = await db.query(
        "SELECT payment_method, biz_sub_type, SUM(total_amount) amt, SUM(payment_count) cnt FROM payment_method_summary WHERE month='2026-02' GROUP BY payment_method, biz_sub_type ORDER BY amt DESC"
    );
    const payTotal = pays.reduce((s, r) => s + r.amt, 0);
    console.log('\n【收款方式分布】');
    for (const r of pays) {
        const pct = (r.amt / payTotal * 100).toFixed(1);
        console.log('  ' + (r.payment_method || '?').padEnd(12) +
            '[' + (r.biz_sub_type || '').padEnd(4) + '] | ' +
            r.amt.toFixed(0).padStart(8) + ' 元 | ' + pct + '% | ' + r.cnt + '笔');
    }

    // ── 8. Top 品项
    const dishes = await db.query(
        "SELECT item_name, category, SUM(total_quantity) qty, SUM(total_amount) amt FROM item_sales_summary WHERE month='2026-02' GROUP BY item_name ORDER BY qty DESC LIMIT 20"
    );
    console.log('\n【品项 Top20（按销量）】');
    for (const r of dishes) {
        console.log('  ' + (r.item_name || '?').padEnd(16) +
            '| [' + (r.category || '?').padEnd(6) + '] ' +
            String(Math.round(r.qty)).padStart(5) + ' 份 | ' +
            r.amt.toFixed(0) + ' 元');
    }

    // ── 9. 异常检查
    const noStore = await db.queryOne(
        "SELECT COUNT(*) cnt FROM orders WHERE order_month='2026-02' AND (store_id IS NULL OR store_id='')"
    );
    const noChannel = await db.queryOne(
        "SELECT COUNT(*) cnt FROM orders WHERE order_month='2026-02' AND (channel IS NULL OR channel='')"
    );
    console.log('\n【数据质量检查】');
    console.log('  无store_id订单 :', noStore.cnt);
    console.log('  无channel订单  :', noChannel.cnt);

    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
