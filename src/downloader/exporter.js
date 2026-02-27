/**
 * 导出编排模块
 * 纯 UI 自动化：日期选择 → 门店选择 → 查询 → 导出 → 下载
 */

'use strict';

const fs = require('fs');

const { launchBrowser, closeBrowser, sleep } = require('./browser');
const { ensureLogin } = require('./login');
const {
    changeDateRange, setDateRangeViaPicker, clickAdvancedStoreSelect, clickQuery, clickExport
} = require('./page_actions');
const {
    handleDownload, renameDownloadedFile, getLatestDownloadedFile
} = require('./download');

const config = require('../common/config');
const { createLogger } = require('../common/logger');
const {
    getHistoricalMonths, getPreviousDayRange,
    generateMonthlyFileName, generateDailyFileName,
    markHistoryExported
} = require('../common/utils');

const { log, logError } = createLogger(config.logDir);

// ── 初始化目录 ────────────────────────────────────────────────────────────────

async function initialize() {
    [config.downloadDir, config.logDir].forEach(dir => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
    log('✅ 导出模块初始化完成');
}

// ── 在已登录的 page 中下载单个报表 ──────────────────────────────────────────

/**
 * @param {object} page        - Puppeteer page
 * @param {object} reportType  - config.reportTypes 中的一项
 * @param {object} dateInfo    - { startDate, endDate, label, year?, month?, type: 'monthly'|'daily' }
 */
async function exportReportInSession(page, reportType, dateInfo) {
    log(`\n  📋 报表: ${reportType.name}`);

    try {
        const filesBefore = new Set(
            fs.existsSync(config.downloadDir) ? fs.readdirSync(config.downloadDir) : []
        );

        // 1. 导航到报表页面，等页面完成初始加载
        await page.goto(reportType.url, { waitUntil: 'networkidle2', timeout: config.timeout });
        await sleep(2000);

        // 2. 找报表 iframe（美团 BI 将报表 UI 放在 iframe 中）
        //    frame URL 包含 'rms-report'，找不到则降级用主页面
        const frame = page.frames().find(f => f.url().includes('rms-report')) || page.mainFrame();
        log(`   📌 使用上下文: ${frame === page.mainFrame() ? '主页面' : `iframe (${frame.url().split('/').pop()})`}`);

        // 3. 设置日期范围（按 reportType.dateMethod 决定方式）
        const dateSet = reportType.dateMethod === 'direct'
            ? await changeDateRange(frame, dateInfo.startDate, dateInfo.endDate, log)
            : await setDateRangeViaPicker(frame, dateInfo.startDate, dateInfo.endDate, log);
        if (!dateSet) {
            log(`   ⚠️  日期设置失败，跳过`);
            return false;
        }
        await sleep(1000);

        // 4. 打开高级门店选择 → 按 poiId 逐个勾选 → 确定（在 iframe 内执行）
        await clickAdvancedStoreSelect(frame, config.poiIds, log);

        // 5. 等待自动查询；若有查询按钮则点击（5s 超时，失败不中断）
        await page.waitForNetworkIdle({ timeout: 15000 }).catch(() => {});
        await clickQuery(frame, log);
        await page.waitForNetworkIdle({ timeout: 30000 }).catch(() => {});

        // 6. 点击导出按钮（在 iframe 内等待，最多 90 秒）
        const exported = await clickExport(frame, log);
        if (!exported) {
            log(`   ⚠️  ${reportType.name} 导出失败，跳过`);
            return false;
        }

        // 7. 处理下载：直接下载 OR 跳转下载清单点击下载按钮
        //    下载对话框可能在 iframe 内或主页面，两处都尝试
        const downloaded = await handleDownload(page, frame, config, log);
        if (!downloaded) {
            log(`   ⚠️  ${reportType.name} 下载失败，跳过`);
            return false;
        }
        await sleep(2000);

        // 7. 重命名文件
        const latestFile = getLatestDownloadedFile(config.downloadDir, Array.from(filesBefore));
        if (latestFile) {
            let newFileName;
            if (dateInfo.type === 'monthly') {
                newFileName = generateMonthlyFileName(reportType.filePrefix, dateInfo.year, dateInfo.month);
            } else {
                const parts = dateInfo.label.split('-');  // ["2026","02","24"]
                newFileName = generateDailyFileName(
                    reportType.filePrefix,
                    parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2])
                );
            }
            await renameDownloadedFile(config.downloadDir, latestFile, newFileName, log);
        } else {
            log(`   ⚠️  未找到下载的文件`);
        }

        log(`   ✅ ${reportType.name} 下载完成`);
        return true;
    } catch (e) {
        logError(`   ❌ ${reportType.name} 下载失败: ${e.message}`);
        return false;
    }
}

// ── 导出单个月份（所有报表类型）────────────────────────────────────────────

async function exportMonthData(monthInfo) {
    let browser;
    try {
        log(`\n${'─'.repeat(60)}`);
        log(`📅 导出月份: ${monthInfo.label}（共 ${config.reportTypes.length} 个报表）`);
        log('─'.repeat(60));

        const { browser: b, page } = await launchBrowser(config);
        browser = b;
        await ensureLogin(page, config, log, config.reportTypes[0].url);

        for (const reportType of config.reportTypes) {
            await exportReportInSession(page, reportType, { ...monthInfo, type: 'monthly' });
            await sleep(3000);
        }

        log(`\n✅ ${monthInfo.label} 全部报表导出完成`);
        await closeBrowser(browser);
        return true;
    } catch (e) {
        logError(`导出 ${monthInfo?.label} 失败: ${e.message}`);
        if (browser) await closeBrowser(browser);
        return false;
    }
}

// ── 导出历史数据 ──────────────────────────────────────────────────────────────

async function exportHistoryData() {
    log('\n' + '='.repeat(60));
    log('🔄 开始导出历史数据');

    let minYear = 9999, minMonth = 12;
    for (const rt of config.reportTypes) {
        const { year, month } = rt.historyStart || { year: 2026, month: 1 };
        if (year < minYear || (year === minYear && month < minMonth)) {
            minYear = year; minMonth = month;
        }
    }
    const allMonths = getHistoricalMonths(minYear, minMonth);
    log(`📊 总月份数: ${allMonths.length}，每月下载 ${config.reportTypes.length} 个报表`);
    log('='.repeat(60));

    let successCount = 0, totalCount = 0;

    for (const monthInfo of allMonths) {
        let browser;
        try {
            log(`\n${'─'.repeat(60)}`);
            log(`📅 月份: ${monthInfo.label}`);
            log('─'.repeat(60));

            const { browser: b, page } = await launchBrowser(config);
            browser = b;
            await ensureLogin(page, config, log, config.reportTypes[0].url);

            for (const reportType of config.reportTypes) {
                const { year: sy, month: sm } = reportType.historyStart || { year: 2026, month: 1 };
                const startTs = new Date(sy, sm - 1, 1).getTime();
                const curTs = new Date(monthInfo.year, monthInfo.month - 1, 1).getTime();
                if (curTs < startTs) {
                    log(`   ⏭️  ${reportType.name} 跳过（早于起始月 ${sy}-${String(sm).padStart(2, '0')}）`);
                    continue;
                }

                totalCount++;
                const ok = await exportReportInSession(page, reportType, { ...monthInfo, type: 'monthly' });
                if (ok) successCount++;
                await sleep(3000);
            }

            await closeBrowser(browser);
        } catch (e) {
            logError(`月份 ${monthInfo.label} 处理失败: ${e.message}`);
            if (browser) await closeBrowser(browser).catch(() => { });
        }

        await sleep(5000);
    }

    log('\n' + '='.repeat(60));
    log(`✅ 历史数据导出完成！成功: ${successCount}/${totalCount}`);
    log('='.repeat(60));

    markHistoryExported(config.statusFile);
}

// ── 导出每日数据（所有报表类型）────────────────────────────────────────────

async function exportDailyData() {
    let browser;
    try {
        const dateRange = getPreviousDayRange();
        const label = `昨日数据 (${dateRange.label})`;

        log(`\n${'='.repeat(60)}`);
        log(`📊 导出: ${label}（共 ${config.reportTypes.length} 个报表）`);
        log('='.repeat(60));

        const { browser: b, page } = await launchBrowser(config);
        browser = b;
        await ensureLogin(page, config, log, config.reportTypes[0].url);

        for (const reportType of config.reportTypes) {
            await exportReportInSession(page, reportType, { ...dateRange, type: 'daily' });
            await sleep(3000);
        }

        log(`\n✅ ${label} 全部报表导出完成`);
        await closeBrowser(browser);
        return true;
    } catch (e) {
        logError(`每日导出失败: ${e.message}`);
        if (browser) await closeBrowser(browser);
        return false;
    }
}

module.exports = { initialize, exportMonthData, exportHistoryData, exportDailyData };
