/**
 * 美团餐饮数据系统 - 统一入口
 *
 * 启动流程：
 * 1. 初始化数据库
 * 2. 启动 Express API server（端口 3000）
 * 3. 若历史数据从未下载过，后台启动 Puppeteer 下载 2025-01 至今所有月份
 *    下载完成后自动导入
 * 4. 注册每日 00:05 定时任务（Puppeteer 下载前一天数据 → 导入）
 *
 * 使用：
 *   node main.js              # 完整启动（不自动导入，仅启动 API）
 *   node main.js --import     # 仅导入 downloads/ 已有 Excel，不启动服务
 */

'use strict';

const schedule = require('node-schedule');

const storage    = require('./src/storage');
const downloader = require('./src/downloader');
const { startServer } = require('./src/api');
const { createLogger }  = require('./src/common/logger');
const { shouldExportHistory } = require('./src/common/utils');
const config     = require('./src/common/config');

const { log } = createLogger(config.logDir);

// ── 批量导入 downloads/ 下的 Excel ───────────────────────────────────────────

async function importAllExcelFiles(taskLog = log) {
    taskLog(`\n📂 扫描 downloads/ 目录...`);
    try {
        const results = await storage.importAll(taskLog);
        const s = results.filter(r => r.status === 'success').length;
        const k = results.filter(r => r.status === 'skipped').length;
        const f = results.filter(r => r.status === 'failed').length;
        taskLog(`\n📊 导入完成：成功 ${s}，跳过 ${k}，失败 ${f}`);
    } catch (e) {
        taskLog(`⚠️  导入异常: ${e.message}`);
    }
}

// ── 历史数据下载（后台执行，不阻塞启动）────────────────────────────────────────

function startHistoryDownloadInBackground() {
    const { log: dlLog } = createLogger(config.logDir, '[历史下载] ');
    dlLog(`\n🕐 首次运行，开始后台下载历史数据 (2025-01 至今)...`);

    downloader.exportHistoryData()
        .then(() => {
            dlLog(`✅ 历史数据下载完成，开始导入...`);
            return importAllExcelFiles(dlLog);
        })
        .then(() => dlLog(`✅ 历史数据导入完成`))
        .catch(e => dlLog(`❌ 历史数据下载/导入失败: ${e.message}`));
}

// ── 定时任务：每日 00:05 ──────────────────────────────────────────────────────

function registerDailyTask() {
    schedule.scheduleJob('5 0 * * *', async () => {
        const { log: taskLog } = createLogger(config.logDir, '[定时任务] ');
        taskLog(`\n⏰ 每日定时任务开始执行`);
        try {
            taskLog(`📤 正在下载前一天数据...`);
            await downloader.exportDailyData();

            taskLog(`📥 正在导入新数据...`);
            await importAllExcelFiles(taskLog);

            taskLog(`✅ 每日定时任务完成`);
        } catch (e) {
            taskLog(`❌ 每日定时任务失败: ${e.message}`);
        }
    });
    log(`⏰ 每日定时任务已注册（每天 00:05 执行）`);
}

// ── 主函数 ────────────────────────────────────────────────────────────────────

async function main() {
    const importOnly = process.argv.includes('--import');

    log(`\n${'='.repeat(60)}`);
    log(`🚀 美团餐饮数据系统启动`);
    log(`   模式: ${importOnly ? '仅导入' : '完整启动（不自动导入）'}`);
    log(`${'='.repeat(60)}\n`);

    try {
        // 1. 初始化数据库
        log(`🗄️  初始化数据库...`);
        await storage.initDatabase(log);
        log(`✅ 数据库初始化完成`);

        // --import 模式：仅导入 Excel，导完退出
        if (importOnly) {
            await importAllExcelFiles();
            log(`\n✅ 导入完成，程序退出`);
            await storage.db.closeDatabase();
            process.exit(0);
        }

        // 2. 启动 API Server（不导入，直接启动）
        startServer(log);
        
        // 3. 若历史数据从未下载，后台启动下载（不阻塞服务）
        if (shouldExportHistory(config.statusFile)) {
            startHistoryDownloadInBackground();

        } else {
            log(`✅ 历史数据已下载完成，跳过`);
        }

        // 4. 注册每日定时任务
        registerDailyTask();

        log(`\n✅ 系统启动完成，等待请求...`);
        log(`   API: http://localhost:${config.port}`);
        log(`   数据库: ${config.dbPath}`);
        log(`   提示: 导入 Excel 请运行 node main.js --import`);

    } catch (e) {
        log(`\n❌ 系统启动失败: ${e.message}`);
        console.error(e);
        process.exit(1);
    }
}

// ── 优雅退出 ──────────────────────────────────────────────────────────────────

process.on('SIGINT', async () => {
    log(`\n🛑 收到退出信号，正在关闭...`);
    await storage.db.closeDatabase();
    process.exit(0);
});

process.on('uncaughtException',  (e) => { log(`❌ 未捕获异常: ${e.message}`);       console.error(e); });
process.on('unhandledRejection', (r) => { log(`❌ 未处理的 Promise 拒绝: ${r}`); });

main();
