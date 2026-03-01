// test_download.js - 下载指定月份数据，三个报表分别存入各自子文件夹

'use strict';

const puppeteer = require('puppeteer');
const fs        = require('fs');
const path      = require('path');

const {
    setDateRangeViaPicker,
    changeDateRange,
    clickAdvancedStoreSelect,
    clickQuery,
    clickExport,
} = require('./src/downloader/page_actions');

const {
    handleDownload,
    getLatestDownloadedFile,
    renameFile,
} = require('./src/downloader/download');

const config = require('./src/common/config');

// ── 下载月份配置 ──────────────────────────────────────────────────────────────
const START_DATE  = '2026/02/25';
const END_DATE    = '2026/02/27';
const MONTH_LABEL = '2026-02';       // 用于文件名后缀

// ── 报表列表 ──────────────────────────────────────────────────────────────────
const REPORT_PAGES = [
    {
        name:       '全渠道订单明细',
        url:        'https://pos.meituan.com/web/report/dpaas-report-channelOrderListV2#/rms-report/dpaas-report-channelOrderListV2',
        dateMethod: 'picker',
        queryWait:  10000,   // 查询后等待（ms）
    },
    {
        name:            '菜品销售明细',
        downloadKeyword: '品项销售明细',   // 下载清单中实际显示的名称
        url:             'https://pos.meituan.com/web/report/dishSaleDetail#/rms-report/dishSaleDetail',
        dateMethod:      'picker',
        queryWait:       15000,
    },
    {
        name:       '收款明细',
        url:        'https://pos.meituan.com/web/report/payment-new?_fe_report_use_storage_query=true#/rms-report/payment-new',
        dateMethod: 'direct',
        queryWait:  5000,
    },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 单个报表下载 ───────────────────────────────────────────────────────────────
async function downloadReport(page, cdpClient, report) {
    console.log(`\n${'='.repeat(55)}`);
    console.log(`📋 ${report.name}  [${START_DATE} → ${END_DATE}]`);
    console.log('='.repeat(55));

    // 1. 创建该报表专属子目录
    const reportDir = path.join(config.downloadDir, report.name);
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });

    // 2. 将浏览器下载目录切换到该报表的子文件夹
    await cdpClient.send('Page.setDownloadBehavior', {
        behavior:     'allow',
        downloadPath: reportDir,
    });
    console.log(`📁 下载目录: downloads/${report.name}/`);

    // 3. 打开报表页面
    await page.goto(report.url, { waitUntil: 'networkidle2' });
    await sleep(2000);

    // 4. 找报表 iframe（美团 BI 将内容放在 iframe 中）
    let frame = page.mainFrame();
    for (let i = 0; i < 30; i++) {
        const found = page.frames().find(f => f.url().includes('rms-report'));
        if (found) { frame = found; break; }
        await sleep(500);
    }
    console.log(`📌 上下文: ${frame === page.mainFrame() ? '主页面' : 'iframe'}`);

    // 5. 设置日期
    const dateOk = report.dateMethod === 'direct'
        ? await changeDateRange(frame, START_DATE, END_DATE)
        : await setDateRangeViaPicker(frame, START_DATE, END_DATE);
    if (!dateOk) { console.error('❌ 日期设置失败'); return false; }
    await sleep(1000);

    // 6. 门店选择
    await clickAdvancedStoreSelect(frame, config.poiIds);
    await sleep(1000);

    // 7. 查询 + 等待数据加载
    await clickQuery(frame);
    console.log(`⏳ 等待查询完成 ${report.queryWait / 300}s...`);
    await sleep(report.queryWait);

    // 8. 导出
    const exported = await clickExport(frame);
    if (!exported) { console.error('❌ 导出按钮未找到'); return false; }

    // 9. 等待下载完成（自动处理"下载清单"模式 or 直接下载模式）
    console.log('⬇️  等待文件下载...');
    const downloaded = await handleDownload(page, frame, { downloadDir: reportDir }, console.log, report.downloadKeyword || report.name);
    if (!downloaded) { console.error('❌ 下载失败'); return false; }

    // 10. 重命名：使用查询日期区间
    await sleep(1000);
    const latestFile = getLatestDownloadedFile(reportDir);
    if (latestFile) {
        const ext        = path.extname(latestFile);
        const startLabel = START_DATE.replace(/\//g, '-');   // '2025-01-01'
        const endLabel   = END_DATE.replace(/\//g, '-');     // '2025-01-02'
        const newName    = `${report.name}_${startLabel}_${endLabel}${ext}`;
        await renameFile(reportDir, latestFile, newName, console.log);
        console.log(`✅ 保存完成: downloads/${report.name}/${newName}`);
    } else {
        console.warn('⚠️  未找到下载文件，跳过重命名');
    }

    return true;
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
(async () => {
    console.log(`📅 下载月份: ${MONTH_LABEL}  (${START_DATE} → ${END_DATE})`);
    console.log(`📂 根目录: ${config.downloadDir}\n`);

    const browser = await puppeteer.launch({
        headless:        false,
        defaultViewport: null,
        args:            ['--start-maximized'],
    });

    // 复用初始页，避免多出 about:blank 标签页
    const pages = await browser.pages();
    const page = pages[0];

    // 加载 Cookies
    const cookiesPath = path.resolve(__dirname, 'meituan_cookies.json');
    if (fs.existsSync(cookiesPath)) {
        const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf-8'));
        await page.setCookie(...cookies);
        console.log('✅ Cookies 已加载');
    } else {
        console.warn('⚠️  未找到 meituan_cookies.json，需要手动登录');
    }

    // CDP session：用于动态切换每个报表的下载目录
    const cdpClient = await page.target().createCDPSession();

    for (const report of REPORT_PAGES) {
        try {
            await downloadReport(page, cdpClient, report);
        } catch (err) {
            console.error(`❌ ${report.name} 出错: ${err.message}`);
        }
        await sleep(3000);
    }

    console.log('\n🏁 全部完成，浏览器保持打开状态');
    console.log('   手动关闭浏览器窗口即可退出');
    process.stdin.resume();
})();
