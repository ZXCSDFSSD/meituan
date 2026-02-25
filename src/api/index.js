/**
 * API 模块入口
 * 创建 Express 应用，注册所有路由
 */

'use strict';

const express    = require('express');
const cors       = require('cors');
const config     = require('../common/config');

const systemRoutes  = require('./routes/system');
const storageRoutes = require('./routes/storage');

const app = express();

app.use(cors());
app.use(express.json());

// ── 路由注册 ──────────────────────────────────────────────────────────────────

app.use('/api',         systemRoutes);   // /api/health  /api/status
app.use('/api/storage', storageRoutes);  // /api/storage/*

// 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not Found', path: req.path });
});

// ── 启动服务 ──────────────────────────────────────────────────────────────────

function startServer(log = console.log) {
    const port = config.port;
    app.listen(port, () => {
        log(`✅ API 服务启动: http://localhost:${port}`);
        log(`   系统接口:`);
        log(`     GET  /api/health`);
        log(`     GET  /api/status`);
        log(`   存储测试接口:`);
        log(`     GET  /api/storage/stats`);
        log(`     GET  /api/storage/files`);
        log(`     POST /api/storage/test/import        { filename }`);
        log(`     POST /api/storage/test/import-all`);
        log(`     POST /api/storage/test/recalculate   { storeId, date }`);
    });
    return app;
}

module.exports = { app, startServer };
