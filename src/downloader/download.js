/**
 * 下载管理模块
 * 等待下载、文件重命名、下载清单 UI 点击
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { sleep } = require('./browser');

// ── 等待文件出现在下载目录 ─────────────────────────────────────────────────────

async function waitForDownload(directory, timeout, log = console.log) {
    const startTime = Date.now();
    const initialFiles = {};

    if (fs.existsSync(directory)) {
        fs.readdirSync(directory).forEach(file => {
            try { initialFiles[file] = fs.statSync(path.join(directory, file)).mtimeMs; } catch (_) {}
        });
    }

    log(`   - 监控下载目录: ${directory}`);
    log(`   - 初始文件数: ${Object.keys(initialFiles).length}`);

    while (Date.now() - startTime < timeout) {
        try {
            if (!fs.existsSync(directory)) { await sleep(1000); continue; }

            for (const file of fs.readdirSync(directory)) {
                if (file.endsWith('.crdownload') || file.endsWith('.tmp') || file.startsWith('.')) continue;

                const filePath = path.join(directory, file);
                try {
                    const stat = fs.statSync(filePath);
                    const isNew      = !Object.prototype.hasOwnProperty.call(initialFiles, file);
                    const isModified = initialFiles[file] && stat.mtimeMs > initialFiles[file];

                    if ((isNew || isModified) && stat.size > 1000) {
                        log(`   - 检测到新文件: ${file} (${(stat.size / 1024).toFixed(2)} KB)`);
                        await sleep(1000);
                        const newStat = fs.statSync(filePath);
                        if (newStat.size === stat.size) { log(`   - 文件写入完成`); return file; }
                        log(`   - 文件仍在写入中...`);
                        initialFiles[file] = newStat.mtimeMs;
                    }
                } catch (_) {}
            }
        } catch (e) { log(`   - 目录访问错误: ${e.message}`); }
        await sleep(1000);
    }
    throw new Error(`在 ${timeout / 1000} 秒内未检测到新下载的文件。`);
}

// ── 下载清单：等待任务完成并点击"下载"按钮 ───────────────────────────────────

/**
 * 在下载清单页面等待最新导出任务完成，点击顶部"下载"按钮触发下载
 */
async function waitAndDownloadFromPromiseList(page, log = console.log) {
    log('⏳ 等待下载清单中最新任务完成...');
    try {
        // 等待清单表格出现
        await page.waitForFunction(() =>
            document.querySelector('tr.ant-table-row') !== null ||
            document.querySelector('[class*="table-row"]') !== null,
            { timeout: 30000 }
        );
        log('   📋 下载清单已加载，等待顶部任务完成...');

        // 轮询最多 5 分钟（60 次 × 5 秒），直到第一行出现"下载"按钮
        for (let i = 0; i < 60; i++) {
            const result = await page.evaluate(() => {
                const row = document.querySelector('tr.ant-table-row') ||
                            document.querySelector('[class*="table-row"]');
                if (!row) return { found: false };

                for (const el of row.querySelectorAll('a, button, span')) {
                    const text = el.innerText?.trim();
                    if (text === '下载' || text === '点击下载') {
                        const rect = el.getBoundingClientRect();
                        if (rect.width === 0) continue;
                        // 如果是 <a> 且有真实 href，返回 URL 让 Puppeteer 导航
                        if (el.tagName === 'A' && el.href && !el.href.startsWith('javascript')) {
                            return { found: true, url: el.href };
                        }
                        el.click();
                        return { found: true, clicked: true };
                    }
                }
                return { found: false };
            });

            if (result.found) {
                if (result.url) {
                    log(`⬇️ 跳转下载: ${result.url.slice(0, 80)}...`);
                    await page.goto(result.url);
                    await sleep(2000);
                } else {
                    log('⬇️ 已点击下载按钮');
                    await sleep(2000);
                }
                return true;
            }

            log(`   ⏳ 导出处理中... (${i + 1}/60)`);
            await sleep(5000);
            await page.reload({ waitUntil: 'networkidle2' }).catch(() => {});
        }

        throw new Error('超时：5 分钟内未找到可点击的下载按钮');
    } catch (e) {
        log(`❌ 下载清单处理失败: ${e.message}`);
        return false;
    }
}

// ── 智能下载处理 ──────────────────────────────────────────────────────────────

/**
 * 点击导出后：
 * - 若出现"前往下载清单"按钮（在 iframe 或主页面）→ 点击 → 进清单页 → 点顶部下载按钮
 * - 否则（直接下载模式）→ 直接等文件出现
 * 两种情况最终都等待文件落盘
 *
 * @param {Page}        page   - 主 Puppeteer page（用于导航和文件检测）
 * @param {Page|Frame}  frame  - 报表 iframe（下载对话框可能在这里）
 * @param {object}      config
 */
async function handleDownload(page, frame, config, log = console.log) {
    log('🤔 检测下载模式...');
    try {
        // 检测"前往下载清单"按钮：先查 frame，再查主页面
        const findDownloadListBtn = async (ctx) => {
            try {
                const el = await ctx.waitForSelector('button.ant-btn-primary', { timeout: 3000, visible: true });
                if (!el) return false;
                const text = await ctx.evaluate(e => e.textContent, el);
                return text.trim() === '前往下载清单';
            } catch (_) { return false; }
        };

        const isPromiseListMode = await findDownloadListBtn(frame) || await findDownloadListBtn(page);

        if (isPromiseListMode) {
            log('📦 异步导出模式 → 进入下载清单');
            // 在 frame 或主页面点击"前往下载清单"
            const clicked = await frame.evaluate(() => {
                const btn = [...document.querySelectorAll('button.ant-btn-primary')]
                    .find(el => el.textContent.includes('前往下载清单'));
                if (btn) { btn.click(); return true; }
                return false;
            });
            if (!clicked) {
                await page.evaluate(() => {
                    const btn = [...document.querySelectorAll('button.ant-btn-primary')]
                        .find(el => el.textContent.includes('前往下载清单'));
                    if (btn) btn.click();
                });
            }
            await sleep(3000);
            // 在下载清单页等待并点击顶部下载按钮
            const ok = await waitAndDownloadFromPromiseList(page, log);
            if (!ok) return false;
        } else {
            log('⚡ 直接下载模式，等待文件出现...');
        }

        // 无论哪种模式，等待文件落盘（最长 3 分钟）
        log('⏳ 等待文件下载完成...');
        const downloadedFile = await waitForDownload(config.downloadDir, 180000, log);
        log(`✅ 文件已下载: ${downloadedFile}`);
        return true;
    } catch (e) {
        log(`❌ 下载处理失败: ${e.message}`);
        return false;
    }
}

// ── 文件重命名 ────────────────────────────────────────────────────────────────

async function renameFile(directory, oldName, newName, log = console.log) {
    const oldPath = path.join(directory, oldName);
    const newPath = path.join(directory, newName);

    if (!fs.existsSync(oldPath)) throw new Error(`文件不存在: ${oldPath}`);
    if (fs.existsSync(newPath)) { log(`⚠️  目标文件已存在，将被覆盖: ${newName}`); fs.unlinkSync(newPath); }

    fs.renameSync(oldPath, newPath);
    log(`✅ 文件已重命名: ${oldName} → ${newName}`);
    return newName;
}

function getLatestDownloadedFile(directory, excludeFiles = []) {
    try {
        const files = fs.readdirSync(directory)
            .filter(f => !f.endsWith('.crdownload') && !excludeFiles.includes(f) &&
                fs.statSync(path.join(directory, f)).isFile())
            .sort((a, b) =>
                fs.statSync(path.join(directory, b)).mtime - fs.statSync(path.join(directory, a)).mtime
            );
        return files.length > 0 ? files[0] : null;
    } catch (_) { return null; }
}

module.exports = {
    waitForDownload,
    waitAndDownloadFromPromiseList,
    handleDownload,
    renameFile,
    renameDownloadedFile: renameFile,   // 兼容别名
    getLatestDownloadedFile
};
