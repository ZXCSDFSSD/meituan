/**
 * 工具函数模块
 * 纯工具函数，不依赖其他自定义模块
 */

'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * 获取从指定月份到当前月份的所有月份列表
 * @param {number} startYear  - 起始年，默认 2026
 * @param {number} startMonth - 起始月，默认 1
 */
function getHistoricalMonths(startYear = 2026, startMonth = 1) {
    const months = [];
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    for (let year = startYear; year <= currentYear; year++) {
        const endMonth  = (year === currentYear) ? currentMonth : 12;
        const fromMonth = (year === startYear)   ? startMonth   : 1;

        for (let month = fromMonth; month <= endMonth; month++) {
            const mm      = String(month).padStart(2, '0');
            const lastDay = new Date(year, month, 0).getDate();
            months.push({
                year, month,
                startDate: `${year}/${mm}/01`,
                endDate:   `${year}/${mm}/${lastDay}`,
                label:     `${year}-${mm}`
            });
        }
    }
    return months;
}

/**
 * 获取前一天的日期范围
 */
function getPreviousDayRange() {
    const yesterday = new Date(Date.now() - 86400000);
    const year  = yesterday.getFullYear();
    const month = String(yesterday.getMonth() + 1).padStart(2, '0');
    const day   = String(yesterday.getDate()).padStart(2, '0');
    const dateStr = `${year}/${month}/${day}`;
    return { startDate: dateStr, endDate: dateStr, label: `${year}-${month}-${day}` };
}

/**
 * 生成月度导出文件名
 * generateMonthlyFileName('全渠道订单明细', 2025, 1) → "2025.01月全渠道订单明细.xlsx"
 */
function generateMonthlyFileName(prefix, year, month) {
    return `${year}.${String(month).padStart(2, '0')}月${prefix}.xlsx`;
}

/**
 * 生成每日导出文件名
 * generateDailyFileName('全渠道订单明细', 2026, 2, 24) → "2026.02.24日全渠道订单明细.xlsx"
 */
function generateDailyFileName(prefix, year, month, day) {
    return `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}日${prefix}.xlsx`;
}

// 兼容旧调用（保留，避免其他地方引用报错）
function generateExportFileName(year, month) {
    return generateMonthlyFileName('店内订单明细', year, month);
}

/**
 * 从文件名提取月份（兼容多种命名格式）
 * "2025.01月全渠道订单明细.xlsx"          → "2025-01"
 * "2026.02.24日菜品销售明细.xlsx"         → "2026-02"
 * "全渠道订单明细_2025-01-01_2025-01-02.xlsx" → "2025-01"
 * "菜品销售明细_2025-01-01_2025-01-02.xlsx"   → "2025-01"
 */
function extractMonthFromFilename(filename) {
    // 格式一：2025.01月xxx.xlsx
    const monthly = filename.match(/(\d{4})\.(\d{2})月/);
    if (monthly) return `${monthly[1]}-${monthly[2]}`;
    // 格式二：2026.02.24日xxx.xlsx
    const daily = filename.match(/(\d{4})\.(\d{2})\.\d{2}日/);
    if (daily) return `${daily[1]}-${daily[2]}`;
    // 格式三：xxx_2025-01-01_2025-01-02.xlsx（取起始日期的年月）
    const dashDate = filename.match(/_(\d{4})-(\d{2})-\d{2}/);
    if (dashDate) return `${dashDate[1]}-${dashDate[2]}`;
    return null;
}

/**
 * 从文件名提取报表类型前缀
 * "2025.01月全渠道订单明细.xlsx"  → "全渠道订单明细"
 * "2026.02.24日菜品销售明细.xlsx" → "菜品销售明细"
 * "2025.01月店内订单明细.xlsx"    → "店内订单明细"（旧格式兼容）
 */
function extractReportTypeFromFilename(filename) {
    const monthly = filename.match(/\d{4}\.\d{2}月(.+)\.xlsx$/);
    if (monthly) return monthly[1];
    const daily = filename.match(/\d{4}\.\d{2}\.\d{2}日(.+)\.xlsx$/);
    if (daily) return daily[1];
    return null;
}

/**
 * 检查是否需要导出历史数据
 */
function shouldExportHistory(statusFile) {
    if (!fs.existsSync(statusFile)) return true;
    try {
        const s = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
        return !s.historyExported;
    } catch (_) { return true; }
}

/**
 * 标记历史数据导出完成
 */
function markHistoryExported(statusFile) {
    const dir = path.dirname(statusFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(statusFile, JSON.stringify({
        historyExported: true,
        lastExportTime: new Date().toISOString(),
        version: '1.0'
    }, null, 2));
}

/**
 * 延迟
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    getHistoricalMonths,
    getPreviousDayRange,
    generateMonthlyFileName,
    generateDailyFileName,
    generateExportFileName,
    extractMonthFromFilename,
    extractReportTypeFromFilename,
    shouldExportHistory,
    markHistoryExported,
    sleep
};
