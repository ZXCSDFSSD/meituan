/**
 * 日志工具模块
 */

'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * 创建日志函数对
 * @param {string} logDir  - 日志目录
 * @param {string} prefix  - 日志前缀（可选）
 * @returns {{ log, logError }}
 */
function createLogger(logDir, prefix = '') {
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    function getLogFile() {
        const dateStr = new Date().toISOString().split('T')[0];
        return path.join(logDir, `app_${dateStr}.log`);
    }

    function log(message) {
        const line = `[${new Date().toISOString()}] ${prefix}${message}`;
        console.log(line);
        try { fs.appendFileSync(getLogFile(), line + '\n'); } catch (_) {}
    }

    function logError(message) {
        const line = `[${new Date().toISOString()}] ${prefix}❌ ERROR: ${message}`;
        console.error(line);
        try { fs.appendFileSync(getLogFile(), line + '\n'); } catch (_) {}
    }

    return { log, logError };
}

module.exports = { createLogger };
