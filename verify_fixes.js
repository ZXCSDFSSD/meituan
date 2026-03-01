'use strict';
const { initDatabase, db } = require('./src/storage/index');
const parser = require('./src/storage/parser');

(async () => {
    await initDatabase();
    console.log('\n=== 四项修复验证 ===\n');

    // ── Fix 1: detectFileType 识别 品项销售明细
    const t1 = parser.detectFileType('常青麦香园_品项销售明细_20260301_1000_xxx.xlsx');
    const t2 = parser.detectFileType('菜品销售明细_2026-02-25_2026-02-27.xlsx');
    console.log('Fix1 detectFileType:');
    console.log('  品项销售明细(原始) ->', t1, t1 === 'dish_sales' ? '✅' : '❌');
    console.log('  菜品销售明细(重命名) ->', t2, t2 === 'dish_sales' ? '✅' : '❌');

    // ── Fix 2: dish_category -- 已规范化（新数据会用 未分类，旧数据存量仍是 --）
    // 旧数据已写入，只能验证代码层面；下次导入会生效
    console.log('\nFix2 dish_category 规范化: 代码已修改，下次导入生效');
    const dashCnt = await db.queryOne(
        "SELECT COUNT(*) cnt FROM order_dishes WHERE dish_category='--' AND business_date LIKE '2026-02%'"
    );
    console.log('  当前 -- 记录数:', dashCnt.cnt, '（历史数据，下次重新导入后变为 未分类）');

    // ── Fix 3: payment_method_summary store_id 全部填充
    const nullPay = await db.queryOne(
        "SELECT COUNT(*) cnt FROM payment_method_summary WHERE store_id IS NULL AND month='2026-02'"
    );
    console.log('\nFix3 payment store_id null 数:', nullPay.cnt, nullPay.cnt === 0 ? '✅' : '❌');

    // ── Fix 4: category_mapping 种子已写入 + 标准品类聚合
    const mapCount = await db.queryOne('SELECT COUNT(*) cnt FROM category_mapping');
    console.log('\nFix4 category_mapping 映射条数:', mapCount.cnt, mapCount.cnt >= 80 ? '✅' : '❌ 不足80条');

    const stdCats = await db.query(
        "SELECT COALESCE(cm.standard_name, iss.category) AS std_cat, " +
        "SUM(iss.total_amount) amt " +
        "FROM item_sales_summary iss " +
        "LEFT JOIN category_mapping cm ON cm.raw_name=iss.category AND cm.store_id IS NULL " +
        "WHERE iss.month='2026-02' " +
        "GROUP BY COALESCE(cm.standard_name, iss.category) " +
        "ORDER BY amt DESC LIMIT 15"
    );
    console.log('\n  标准品类聚合（前15）:');
    const total = stdCats.reduce((s, r) => s + r.amt, 0);
    for (const r of stdCats) {
        const pct = (r.amt / total * 100).toFixed(1);
        console.log('   ', (r.std_cat || '?').padEnd(10), r.amt.toFixed(0).padStart(7), '元', pct + '%');
    }
    console.log('  映射后品类总数:', stdCats.length);

    // 检查未映射的品类（没有 standard_name 的原始品类）
    const unmapped = await db.query(
        "SELECT iss.category, SUM(iss.total_amount) amt " +
        "FROM item_sales_summary iss " +
        "LEFT JOIN category_mapping cm ON cm.raw_name=iss.category AND cm.store_id IS NULL " +
        "WHERE iss.month='2026-02' AND cm.standard_name IS NULL " +
        "AND iss.category IS NOT NULL AND iss.category != '' " +
        "GROUP BY iss.category ORDER BY amt DESC"
    );
    if (unmapped.length > 0) {
        console.log('\n  ⚠️  仍有未映射品类 (' + unmapped.length + ' 个):');
        for (const r of unmapped) {
            console.log('    "' + r.category + '" ->', r.amt.toFixed(0) + '元');
        }
    } else {
        console.log('\n  ✅ 所有品类已完整映射');
    }

    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
