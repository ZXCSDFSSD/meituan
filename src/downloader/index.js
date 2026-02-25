/**
 * 下载模块入口
 * 对外暴露高层接口
 */

'use strict';

const fs = require('fs');
const { initialize, exportMonthData, exportHistoryData, exportDailyData } = require('./exporter');
const config = require('../common/config');

function getExportStatus() {
    if (!fs.existsSync(config.statusFile)) {
        return { historyExported: false, lastExportTime: null };
    }
    try {
        return JSON.parse(fs.readFileSync(config.statusFile, 'utf8'));
    } catch (e) {
        return { error: e.message };
    }
}

module.exports = {
    initialize,
    exportMonthData,
    exportHistoryData,
    exportDailyData,
    getExportStatus
};
