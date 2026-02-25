/**
 * 存储模块路由（含测试接口）
 *
 * GET  /api/storage/stats              数据库统计（各表行数、月份、门店）
 * GET  /api/storage/files              downloads/ 文件列表（+ 是否已导入）
 * POST /api/storage/test/import        导入指定文件 { filename }（同步）
 * POST /api/storage/test/import-all   导入所有未处理文件（异步）
 * POST /api/storage/test/recalculate  重新计算统计 { storeId, date }（同步）
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const fs       = require('fs');
const path     = require('path');

const storage  = require('../../storage');
const config   = require('../../common/config');
const { createLogger }           = require('../../common/logger');
const { extractMonthFromFilename } = require('../../common/utils');

// 数据库统计
router.get('/stats', async (req, res) => {
    try {
        const stats = await storage.getDatabaseStats();
        res.json({ success: true, data: stats });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// downloads/ 文件列表（标注是否已导入）
router.get('/files', async (req, res) => {
    try {
        if (!fs.existsSync(config.downloadDir)) {
            return res.json({ success: true, data: [], total: 0 });
        }

        const files = fs.readdirSync(config.downloadDir)
            .filter(f => f.endsWith('.xlsx'))
            .sort();

        const result = [];
        for (const file of files) {
            const month    = extractMonthFromFilename(file);
            const imported = month ? await storage.pipeline.isMonthDataExists(month) : false;
            const stat     = fs.statSync(path.join(config.downloadDir, file));
            result.push({
                filename: file,
                month,
                imported,
                sizeMB:   +(stat.size / 1024 / 1024).toFixed(2),
                modified: stat.mtime.toISOString()
            });
        }

        res.json({ success: true, data: result, total: result.length });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 导入指定文件（同步，适合测试单个文件）
// Body: { filename: "2025.01月店内订单明细.xlsx" }
router.post('/test/import', async (req, res) => {
    const { filename } = req.body || {};
    if (!filename) {
        return res.status(400).json({ success: false, error: '请提供 filename 参数' });
    }

    const { log, logError } = createLogger(config.logDir, '[导入] ');
    try {
        log(`开始导入: ${filename}`);
        const result = await storage.importFile(filename, log);
        res.json({ success: true, data: result });
    } catch (e) {
        logError(`导入失败: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 导入所有未处理文件（异步，立即返回）
router.post('/test/import-all', (req, res) => {
    const { log, logError } = createLogger(config.logDir, '[导入全部] ');
    log('收到请求，开始导入所有 Excel...');
    res.json({ success: true, message: '导入任务已启动，请查看日志' });

    storage.importAll(log)
        .then(results => {
            const s = results.filter(r => r.status === 'success').length;
            const k = results.filter(r => r.status === 'skipped').length;
            const f = results.filter(r => r.status === 'failed').length;
            log(`✅ 全部导入完成：成功 ${s}，跳过 ${k}，失败 ${f}`);
        })
        .catch(e => logError(`导入失败: ${e.message}`));
});

// 重新计算统计（同步）
// Body: { storeId: "601681205", date: "2025-01-15" }
router.post('/test/recalculate', async (req, res) => {
    const { storeId, date } = req.body || {};
    const { log } = createLogger(config.logDir, '[重算] ');
    try {
        const result = await storage.recalculate(storeId, date, log);
        res.json({ success: true, data: result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
