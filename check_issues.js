'use strict';
const { initDatabase, db } = require('./src/storage/index');
const parser = require('./src/storage/parser');

(async () => {
    await initDatabase();

    console.log('\n══════════════════════════════════════════════════');
    console.log('  存储模块问题检查报告');
    console.log('══════════════════════════════════════════════════');

    // ── 问题1：detectFileType 能否识别"品项销售明细"文件名？
    console.log('\n【检查1】detectFileType 文件名识别');
    const testNames = [
        '菜品销售明细_2026-02-25_2026-02-27.xlsx',     // 重命名后
        '常青麦香园_品项销售明细_20260301_1000_xxx.xlsx', // 美团原始名
        '全渠道订单明细_2026-02-25_2026-02-27.xlsx',
        '收款明细_2026-02-25_2026-02-27.xlsx',
    ];
    for (const name of testNames) {
        const t = parser.detectFileType(name);
        const ok = t !== 'unknown';
        console.log(`  ${ok ? '✅' : '❌'} [${t.padEnd(15)}] ${name}`);
    }

    // ── 问题2：dish_category 为"--"的数量
    console.log('\n【检查2】dish_category 异常值统计');
    const catAbnormal = await db.query(
        "SELECT dish_category, COUNT(*) cnt, SUM(amount) amt FROM order_dishes WHERE business_date LIKE '2026-02%' GROUP BY dish_category ORDER BY cnt DESC LIMIT 30"
    );
    const totalDishes = catAbnormal.reduce((s, r) => s + r.cnt, 0);
    for (const r of catAbnormal) {
        const pct = (r.cnt / totalDishes * 100).toFixed(1);
        const flag = (!r.dish_category || r.dish_category === '--' || r.dish_category === '其他') ? '⚠️ ' : '  ';
        console.log(`  ${flag}[${(r.dish_category || '(空)').padEnd(16)}] ${String(r.cnt).padStart(5)}条 / ${pct}% / ${r.amt.toFixed(0)}元`);
    }

    // ── 问题3：timeslot_summary 中 hour=null 的情况
    console.log('\n【检查3】时段统计完整性（应有 7店×3天×24h = 504行）');
    const tsCount = await db.queryOne(
        "SELECT COUNT(*) cnt FROM timeslot_summary WHERE month='2026-02' AND channel='all'"
    );
    const tsExpected = 7 * 3 * 24; // 7 stores × 3 days × 24 hours (maximal)
    console.log(`  实际行数: ${tsCount.cnt}（最多可能${tsExpected}，无客流时段不写入）`);

    // 检查是否有 hour 超出范围
    const hourRange = await db.query(
        "SELECT MIN(hour) min_h, MAX(hour) max_h FROM timeslot_summary WHERE month='2026-02'"
    );
    console.log(`  hour 范围: ${hourRange[0].min_h} ~ ${hourRange[0].max_h}（应为 0-23）`);

    // 检查品项中有多少 hour=null
    const nullHour = await db.queryOne(
        "SELECT COUNT(*) cnt FROM order_dishes WHERE business_date LIKE '2026-02%' AND dish_ordered_time IS NOT NULL AND dish_ordered_time != '' AND (CAST(substr(dish_ordered_time,12,2) AS INTEGER) IS NULL OR dish_ordered_time NOT LIKE '% %')"
    );
    console.log(`  点菜时间格式异常（无空格分隔）: ${nullHour.cnt} 条`);

    // ── 问题4：渠道'外卖'（catch-all）是否存在
    console.log('\n【检查4】渠道值完整性');
    const channels = await db.query(
        "SELECT channel, COUNT(*) cnt FROM orders WHERE order_month='2026-02' GROUP BY channel ORDER BY cnt DESC"
    );
    for (const r of channels) {
        const ok = ['堂食','美团外卖','饿了么','京东秒送'].includes(r.channel);
        console.log(`  ${ok ? '✅' : '⚠️ '} ${(r.channel || '(空)').padEnd(10)} ${r.cnt}单`);
    }

    // ── 问题5：order_dishes 重复检查（同一 order_id + dish_name 出现多少次）
    console.log('\n【检查5】order_dishes 重复行检查（同订单同品项）');
    const dupDishes = await db.queryOne(
        "SELECT COUNT(*) cnt FROM (SELECT order_id, dish_name, COUNT(*) c FROM order_dishes WHERE business_date LIKE '2026-02%' GROUP BY order_id, dish_name HAVING c > 1)"
    );
    console.log(`  同订单同品项出现多次的组合数: ${dupDishes.cnt}（正常现象，如一单点多份不同规格）`);

    // ── 问题6：stores 表 MD00017 的字段完整性
    console.log('\n【检查6】门店表字段完整性');
    const stores = await db.query(
        "SELECT store_id, store_name, city, province, location_type, has_partner FROM stores ORDER BY store_id"
    );
    console.log('  store_id  | store_name          | city  | location_type | has_partner');
    for (const s of stores) {
        const flag = (!s.location_type) ? '⚠️ ' : '  ';
        console.log(`  ${flag}${s.store_id} | ${(s.store_name.replace('常青麦香园', '')).padEnd(16)} | ${(s.city||'?').padEnd(4)} | ${(s.location_type||'未设置').padEnd(13)} | ${s.has_partner}`);
    }

    // ── 问题7：收款明细 store_id 映射成功率
    console.log('\n【检查7】收款明细 store_id 映射');
    const payStores = await db.query(
        "SELECT store_name, store_id, COUNT(*) cnt FROM payment_method_summary WHERE month='2026-02' GROUP BY store_name ORDER BY store_name"
    );
    for (const r of payStores) {
        const ok = r.store_id;
        console.log(`  ${ok ? '✅' : '❌'} ${r.store_name.padEnd(16)} → store_id: ${r.store_id || '(null)'}`);
    }

    // ── 问题8：item_sales_summary 中 category 品类名标准化程度
    console.log('\n【检查8】item_sales_summary 品类名列表（需标准化的）');
    const catList = await db.query(
        "SELECT DISTINCT category FROM item_sales_summary WHERE month='2026-02' ORDER BY category"
    );
    console.log(`  共 ${catList.length} 种品类名：`);
    for (const r of catList) {
        console.log(`    "${r.category}"`);
    }

    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
