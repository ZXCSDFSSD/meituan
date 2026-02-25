/**
 * 导出编排模块
 * 一次登录，顺序下载 config.reportTypes 中的所有报表
 */

'use strict';

const fs   = require('fs');

const { launchBrowser, closeBrowser, sleep } = require('./browser');
const { ensureLogin }                         = require('./login');
const {
    changeDateRange, selectStores, clickQuery, clickExport
}                                             = require('./page_actions');
const {
    handleDownload, renameDownloadedFile, getLatestDownloadedFile
}                                             = require('./download');

const config                                  = require('../common/config');
const { createLogger }                        = require('../common/logger');
const {
    getHistoricalMonths, getPreviousDayRange,
    generateMonthlyFileName, generateDailyFileName,
    markHistoryExported
}                                             = require('../common/utils');

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
        // 1. 导航到报表页面
        await page.goto(reportType.url, { waitUntil: 'networkidle2', timeout: config.timeout });
        await sleep(2000);

        // 2. 设置日期范围
        await changeDateRange(page, dateInfo.startDate, dateInfo.endDate, log);

        // 3. 选择门店（点"高 级"按钮，勾选 poiIds 对应门店）
        await selectStores(page, config.poiIds, log);

        // 4. 查询
        await clickQuery(page, log);

        // 5. 导出
        await clickExport(page, log);

        // // 6. 勾选全部字段并确认（部分页面有此弹窗，失败则忽略）
        // try {
        //     await selectAllAndConfirm(page, log);
        // } catch (_) {
        //     log('   ℹ️  无导出字段选择弹窗，跳过');
        // }

        // 7. 等待下载完成
        const filesBefore = new Set(
            fs.existsSync(config.downloadDir) ? fs.readdirSync(config.downloadDir) : []
        );
        const downloaded = await handleDownload(page, config, log);
        if (!downloaded) {
            log(`   ⚠️  ${reportType.name} 下载失败，跳过`);
            return false;
        }
        await sleep(2000);

        // 8. 重命名文件
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
        // 登录后直接跳到第一个报表页面
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

    // 取所有报表中最早的起始年月
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
                // 跳过此报表起始月份之前的数据
                const { year: sy, month: sm } = reportType.historyStart || { year: 2026, month: 1 };
                const startTs = new Date(sy, sm - 1, 1).getTime();
                const curTs   = new Date(monthInfo.year, monthInfo.month - 1, 1).getTime();
                if (curTs < startTs) {
                    log(`   ⏭️  ${reportType.name} 跳过（早于起始月 ${sy}-${String(sm).padStart(2,'0')}）`);
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
            if (browser) await closeBrowser(browser).catch(() => {});
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
