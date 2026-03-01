/**
 * 下载管理模块
 * 等待下载、文件重命名、下载清单 UI 点击
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { sleep } = require('./browser');

// ── 等待文件出现在下载目录 ─────────────────────────────────────────────────────

async function waitForDownload(directory, timeout, log = console.log, initialSnapshot = null) {
    const startTime = Date.now();
    // 若外部已提前拍过快照则直接用，否则现在拍（防止直接下载时文件在快照前已落盘）
    const initialFiles = initialSnapshot || {};
    if (!initialSnapshot && fs.existsSync(directory)) {
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

// 下载清单页面固定 URL
const PROMISE_DOWNLOAD_URL = 'https://pos.meituan.com/web/fe.rms-portal/rms-report.html#/rms-report/promiseDownload';

// ── 下载清单：等待任务完成并点击"下载"按钮 ───────────────────────────────────

/**
 * 导航到下载清单页，等待表格出现（10秒内没出现则强制重跳，最多重试3次）
 *
 * @param {boolean} alreadyJumped - 若已通过按钮自然跳转到该页，先在当前页等 10 秒
 *                                   10 秒内出现表格则直接返回，否则再强制重导航
 */
async function navigateToPromiseList(page, log, alreadyJumped = false) {
    // 已自然跳转：先在当前页等 10 秒，看数据是否自动加载
    if (alreadyJumped) {
        log('   ⏳ 已跳转到下载清单，等待 10 秒让页面更新...');
        for (let t = 0; t < 10; t++) {
            const hasTable = await page.evaluate(() =>
                document.querySelector('tr.ant-table-row') !== null ||
                document.querySelector('[class*="table-row"]') !== null
            ).catch(() => false);
            if (hasTable) {
                log('   ✅ 下载清单表格已加载（自然跳转）');
                return true;
            }
            await sleep(1000);
        }
        log('   ⚠️  10 秒内页面未更新，强制重新跳转...');
    }

    // 强制导航（最多重试 3 次）
    for (let attempt = 1; attempt <= 3; attempt++) {
        log(`   🔄 跳转下载清单页（第 ${attempt} 次）...`);
        await page.goto(PROMISE_DOWNLOAD_URL, { waitUntil: 'networkidle2' }).catch(() => {});
        await sleep(2000);

        // 等待最多 10 秒看表格是否出现
        for (let t = 0; t < 10; t++) {
            const hasTable = await page.evaluate(() =>
                document.querySelector('tr.ant-table-row') !== null ||
                document.querySelector('[class*="table-row"]') !== null
            ).catch(() => false);
            if (hasTable) {
                log(`   ✅ 下载清单表格已加载`);
                return true;
            }
            await sleep(1000);
        }
        log(`   ⚠️  10 秒内未出现表格，强制重新跳转 (${attempt}/3)...`);
    }
    return false;
}

/**
 * 在下载清单页执行一次检查：找到关键字匹配且更新时间最新的行，若状态完成则点击下载
 *
 * 表格列顺序（实际 HTML）：
 *   序号[0] 业务模块[1] 申请内容[2] 申请人[3] 申请时间[4] 更新时间[5] 状态[6] 操作[7]
 */
async function checkAndClickInPromiseList(page, expectedKeyword) {
    return await page.evaluate((keyword) => {
        const allRows = [...document.querySelectorAll('tr.ant-table-row, [class*="table-row"]')];
        if (allRows.length === 0) return { found: false, status: 'no-row' };

        // 按关键字过滤申请内容（cells[2]）
        const rows = keyword
            ? allRows.filter(row => (row.querySelectorAll('td')[2]?.innerText || '').includes(keyword))
            : allRows;

        if (rows.length === 0) return { found: false, status: `未找到包含"${keyword}"的任务行` };

        // 按更新时间（cells[5]）找最新任务行
        let latestRow = null, latestTime = 0;
        for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 7) continue;
            const t = new Date((cells[5]?.innerText?.trim() || '').replace(/\//g, '-')).getTime();
            if (!isNaN(t) && t > latestTime) { latestTime = t; latestRow = row; }
        }
        if (!latestRow) latestRow = rows[0];

        const cells      = latestRow.querySelectorAll('td');
        const content    = cells[2]?.innerText?.trim() || '';
        const updateTime = cells[5]?.innerText?.trim() || '';
        const statusText = cells[6]?.innerText?.trim() || '';

        if (statusText !== '导出完成' && statusText !== '可以导出') {
            return { found: false, status: statusText, content, updateTime };
        }

        // 操作列（index=7）中找"下载"按钮
        const opCell = cells[7] || cells[cells.length - 1];
        if (!opCell) return { found: false, status: '找不到操作列', content, updateTime };

        for (const el of opCell.querySelectorAll('a, button, span')) {
            const text = el.innerText?.trim();
            if (text !== '下载' && text !== '点击下载') continue;
            if (el.getBoundingClientRect().width === 0) continue;

            if (el.tagName === 'A' && el.href && !el.href.startsWith('javascript') && el.href !== location.href) {
                return { found: true, url: el.href, content, updateTime };
            }
            ['mousedown', 'mouseup', 'click'].forEach(name =>
                el.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true }))
            );
            return { found: true, clicked: true, content, updateTime };
        }
        return { found: false, status: `${statusText}-未找到下载链接`, content, updateTime };
    }, expectedKeyword).catch(() => ({ found: false, status: 'evaluate-error' }));
}

/**
 * 在下载清单页面按"更新时间"找最新任务，等待完成后点击下载
 *
 * 三段式流程：
 *   阶段1：进入页面后每 1 秒检查一次，最多等 10 秒
 *   阶段2：10 秒内状态未变 → 强制刷新页面一次
 *   阶段3：主轮询（每 5 秒刷新一次，最多 15 分钟）
 *
 * @param {string} expectedKeyword - 报表名称关键字，用于过滤匹配行
 */
async function waitAndDownloadFromPromiseList(page, log = console.log, expectedKeyword = '', alreadyJumped = false) {
    log(`⏳ 等待下载清单中最新任务完成${expectedKeyword ? `（匹配关键字: ${expectedKeyword}）` : ''}...`);
    try {
        const tableReady = await navigateToPromiseList(page, log, alreadyJumped);
        if (!tableReady) throw new Error('3 次重试后仍无法加载下载清单表格');

        // 辅助：处理找到结果后的下载动作
        const handleFound = async (result) => {
            log(`   ✅ 验证 申请内容: ${result.content}`);
            log(`   ✅ 验证 更新时间: ${result.updateTime}`);
            if (result.url) {
                log(`⬇️  跳转下载: ${result.url.slice(0, 80)}...`);
                await page.goto(result.url);
            } else {
                log('⬇️  已点击下载按钮');
            }
            await sleep(2000);
            return true;
        };

        // ── 阶段 1：进入页面后每 1 秒检查，最多等 10 秒 ──────────────────────────
        log('   ⏱️  阶段1：检查任务状态（每 1 秒，最多 10 秒）...');
        for (let t = 1; t <= 10; t++) {
            const result = await checkAndClickInPromiseList(page, expectedKeyword);
            if (result.found) return await handleFound(result);
            log(`   ⏳ [${t}/10] 状态: [${result.status || '加载中'}]${result.content ? ` | ${result.content.slice(0, 35)}` : ''}`);
            await sleep(1000);
        }

        // ── 阶段 2：10 秒内状态未变 → 浏览器原生重新加载一次 ──────────────────
        log('   ⚠️  10 秒内状态未更新，触发浏览器重新加载...');
        await page.reload({ waitUntil: 'networkidle2' }).catch(() => {});
        await sleep(2000);
        {
            const result = await checkAndClickInPromiseList(page, expectedKeyword);
            if (result.found) return await handleFound(result);
            log(`   ⏳ 刷新后状态: [${result.status || '处理中'}]${result.content ? ` | ${result.content.slice(0, 35)}` : ''}`);
        }

        // ── 阶段 3：主轮询（每 5 秒浏览器重新加载，最多 15 分钟）────────────
        // 阶段1(10s) + 阶段2(~4s) 已用约 14 秒，剩余 180-3=177 次
        for (let i = 1; i <= 177; i++) {
            await sleep(5000);
            await page.reload({ waitUntil: 'networkidle2' }).catch(() => {});
            await sleep(1000);

            const result = await checkAndClickInPromiseList(page, expectedKeyword);
            if (result.found) return await handleFound(result);

            const elapsed = Math.floor(i * 5 / 60);
            const contentInfo = result.content ? ` | ${result.content.slice(0, 35)}` : '';
            log(`   ⏳ 状态: [${result.status || '处理中'}]${contentInfo}  (${i}/177，约 ${elapsed} 分钟)`);
        }

        throw new Error('超时：15 分钟内未找到可点击的下载按钮');
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
async function handleDownload(page, frame, config, log = console.log, expectedKeyword = '') {
    const downloadStartTime = Date.now();   // 记录本次下载开始时间，用于后续文件验证

    // 在 8 秒等待弹窗循环开始前先拍快照，防止直接下载模式文件已落盘才开始监控
    const initialSnapshot = {};
    if (config.downloadDir && fs.existsSync(config.downloadDir)) {
        fs.readdirSync(config.downloadDir).forEach(file => {
            try { initialSnapshot[file] = fs.statSync(path.join(config.downloadDir, file)).mtimeMs; } catch (_) {}
        });
    }

    log('🤔 检测下载模式...');

    // 在给定上下文（page 或 frame）里搜索并点击"前往下载清单"按钮
    // 使用命名函数递归（与浏览器控制台验证一致），穿透 Shadow DOM + 同源 iframe
    async function tryClick(ctx) {
        const result = await ctx.evaluate(() => {
            function findButtonEverywhere(root, text) {
                const btns = Array.from(root.querySelectorAll('button'));
                const target = btns.find(b => b.textContent.includes(text));
                if (target) return target;
                for (const el of root.querySelectorAll('*')) {
                    if (el.shadowRoot) {
                        const found = findButtonEverywhere(el.shadowRoot, text);
                        if (found) return found;
                    }
                }
                for (const iframe of root.querySelectorAll('iframe')) {
                    try {
                        const found = findButtonEverywhere(iframe.contentDocument, text);
                        if (found) return found;
                    } catch (e) {}
                }
                return null;
            }
            const btn = findButtonEverywhere(document, '前往下载清单');
            if (!btn) return { found: false };
            const r = btn.getBoundingClientRect();
            btn.click();
            return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }).catch(() => ({ found: false }));

        if (result.found && result.x && result.y) {
            await page.mouse.click(result.x, result.y).catch(() => {});
        }
        return result.found;
    }

    try {
        const findAndClickDownloadListBtn = async () => {
            // ① 优先在报表 iframe 的 Frame 上下文里找（弹窗由 iframe 渲染）
            if (frame && frame !== page.mainFrame()) {
                const found = await tryClick(frame).catch(() => false);
                if (found) { log('   (按钮在 iframe 上下文中找到)'); return true; }
            }
            // ② 回退到主页面上下文（兼容直接在主页面弹窗的情况）
            return await tryClick(page).catch(() => false);
        };

        // 等待弹窗出现（最多 8 秒），然后点击"前往下载清单"
        let isPromiseListMode = false;
        for (let i = 0; i < 8; i++) {
            isPromiseListMode = await findAndClickDownloadListBtn();
            if (isPromiseListMode) { log(`   🖱️  已点击「前往下载清单」按钮`); break; }
            await sleep(1000);
        }

        if (isPromiseListMode) {
            log('📦 异步导出模式 → 检测跳转目标...');
            // 等 3 秒让按钮触发的跳转（新标签页或当前页导航）完成
            await sleep(3000);

            // 优先查找新标签页（按钮通常会 window.open 打开新 tab）
            const allPages = await page.browser().pages();
            let targetPage = allPages.find(p => p !== page && p.url().includes('promiseDownload'));

            if (targetPage) {
                log(`   ✅ 检测到新标签页已打开下载清单，切换过去`);
                await targetPage.bringToFront();
                // 新标签页继承不到原页面的 CDP 下载目录设置，需单独配置
                try {
                    const cdp = await targetPage.target().createCDPSession();
                    await cdp.send('Page.setDownloadBehavior', {
                        behavior:     'allow',
                        downloadPath: config.downloadDir,
                    });
                } catch (_) {}
            } else if (page.url().includes('promiseDownload')) {
                log('   ✅ 当前页面已跳转到下载清单');
                targetPage = page;
            } else {
                log('   ⚠️  未检测到跳转，强制导航到下载清单...');
                await page.goto(PROMISE_DOWNLOAD_URL, { waitUntil: 'networkidle2' });
                targetPage = page;
            }

            // 在目标页面刷新并等待下载任务完成（最多 15 分钟）
            const ok = await waitAndDownloadFromPromiseList(targetPage, log, expectedKeyword, true);

            // 如果用的是新标签页，下载触发后关掉它，避免后续报表检测到残留标签页
            if (targetPage !== page) {
                await targetPage.close().catch(() => {});
                log('   🗂️  下载清单标签页已关闭');
                await page.bringToFront();
            }

            if (!ok) return false;
        } else {
            log('⚡ 直接下载模式，等待文件出现...');
        }

        // 等待文件落盘（最长 5 分钟），传入函数开头预先拍的快照
        log('⏳ 等待文件写入磁盘...');
        const downloadedFile = await waitForDownload(config.downloadDir, 300000, log, initialSnapshot);

        // 验证：文件修改时间 ≥ 本次下载开始时间（确认是本次会话下载的文件）
        const fp    = path.join(config.downloadDir, downloadedFile);
        const mtime = fs.statSync(fp).mtimeMs;
        if (mtime >= downloadStartTime) {
            log(`✅ 文件验证通过（下载时间 ${new Date(mtime).toTimeString().slice(0, 8)}）: ${downloadedFile}`);
            return true;
        } else {
            log(`❌ 文件时间异常（${new Date(mtime).toLocaleString('zh-CN')}），早于本次下载开始时间，跳过此报表`);
            return false;
        }
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
