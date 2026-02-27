// test_download.js - 顺序测试三个报表页面：日期设置 + 查询 + 导出

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { setDateRangeViaPicker, changeDateRange, clickAdvancedStoreSelect, clickQuery, clickExport } = require('./src/downloader/page_actions');
const config = require('./src/common/config');

// ── 统一日期配置 ──────────────────────────────────────────────────────────────
const START_DATE = '2026/01/01';
const END_DATE   = '2026/02/01';

// ── 测试页面列表 ──────────────────────────────────────────────────────────────
const REPORT_PAGES = [
    {
        name:        '全渠道订单明细',
        url:         'https://pos.meituan.com/web/report/dpaas-report-channelOrderListV2#/rms-report/dpaas-report-channelOrderListV2',
        dateMethod:  'picker',
        storeSelect: true,
    },
    {
        name:        '菜品销售明细',
        url:         'https://pos.meituan.com/web/report/dishSaleDetail#/rms-report/dishSaleDetail',
        dateMethod:  'picker',
        storeSelect: true,
        queryWait:   10000,  // 数据量大，查询后额外等待
    },
    {
        name:        '收款明细',
        url:         'https://pos.meituan.com/web/report/payment-new?_fe_report_use_storage_query=true#/rms-report/payment-new',
        dateMethod:  'direct',
        storeSelect: true,
    },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 单个报表测试 ───────────────────────────────────────────────────────────────
async function testReport(report) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`📋 开始测试: ${report.name}`);
    console.log('='.repeat(50));

    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized'],
    });

    try {
        const page = await browser.newPage();

        // 1. 加载 Cookies
        const cookiesPath = path.resolve(__dirname, 'meituan_cookies.json');
        if (fs.existsSync(cookiesPath)) {
            const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf-8'));
            await page.setCookie(...cookies);
            console.log('✅ Cookies 已加载');
        } else {
            console.log('⚠️  cookies 文件不存在');
        }

        // 2. 打开报表页面
        await page.goto(report.url, { waitUntil: 'networkidle2' });
        console.log('⏳ 等待页面加载...');
        await sleep(3000);

        // 3. 找 iframe（有则用 iframe，否则用主页面）
        let frame = page.mainFrame();
        for (let i = 0; i < 30; i++) {
            const found = page.frames().find(f => f.url().includes('rms-report'));
            if (found) { frame = found; break; }
            await sleep(500);
        }
        console.log(`📌 使用上下文: ${frame === page.mainFrame() ? '主页面' : 'iframe'}`);

        // 4. 设置日期
        const dateOk = report.dateMethod === 'direct'
            ? await changeDateRange(frame, START_DATE, END_DATE)
            : await setDateRangeViaPicker(frame, START_DATE, END_DATE);
        if (!dateOk) { console.error('❌ 日期设置失败'); return false; }

        // 5. 选择门店（仅全渠道订单明细有"高级"弹窗）
        if (report.storeSelect) {
            await clickAdvancedStoreSelect(frame, config.poiIds);
        }

        // 6. 点击查询
        await clickQuery(frame);
        if (report.queryWait) {
            console.log(`⏳ 等待数据加载 ${report.queryWait / 1000}s...`);
            await sleep(report.queryWait);
        }

        // 7. 点击导出
        const exported = await clickExport(frame);
        if (!exported) { console.error('❌ 导出失败'); return false; }

        console.log('✅ 导出已触发，等待下载...');
        await sleep(10000);

        console.log(`✅ ${report.name} 测试完成`);
        return true;

    } catch (err) {
        console.error(`❌ 运行出错: ${err.message}`);
        return false;
    } finally {
        await browser.close();
        console.log('🔒 浏览器已关闭');
    }
}

// ── 顺序测试所有页面 ───────────────────────────────────────────────────────────
(async () => {
    console.log(`📅 测试日期: ${START_DATE} → ${END_DATE}`);

    for (const report of REPORT_PAGES) {
        await testReport(report);
        await sleep(2000);
    }

    console.log('\n🏁 全部测试完成');
})();
