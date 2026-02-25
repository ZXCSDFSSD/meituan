/**
 * 系统接口路由
 * GET /api/health
 * GET /api/status
 */

'use strict';

const express    = require('express');
const router     = express.Router();
const storage    = require('../../storage');
const downloader = require('../../downloader');

// 健康检查
router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 系统状态（导出状态 + 数据库统计）
router.get('/status', async (req, res) => {
    try {
        const [exportStatus, dbStats] = await Promise.all([
            Promise.resolve(downloader.getExportStatus()),
            storage.getDatabaseStats()
        ]);
        res.json({
            success: true,
            data: { exportStatus, database: dbStats, timestamp: new Date().toISOString() }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
