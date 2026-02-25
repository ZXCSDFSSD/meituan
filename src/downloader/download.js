/**
 * 下载管理模块
 * 等待下载、文件重命名、智能下载模式判断
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { sleep } = require('./browser');

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

async function waitAndDownloadFromPromiseList(page, log = console.log) {
    log('⏳ 监听接口，等待导出完成...');
    try {
        await page.waitForSelector('tr.ant-table-row', { timeout: 20000 });

        for (let i = 0; i < 60; i++) {
            const response = await page.waitForResponse(
                res => res.url().includes('promiseDownload') && res.request().method() === 'GET',
                { timeout: 15000 }
            );
            const data = await response.json();
            if (data?.data?.length) {
                const first = data.data[0];
                if (first.status === 'FINISHED' || first.statusName === '导出完成') {
                    log('✅ 接口返回：导出完成');
                    break;
                }
            }
            log('⏳ 仍在导出中...');
            await page.waitForTimeout(5000);
            await page.reload({ waitUntil: 'networkidle2' });
        }

        log('⬇️ 点击下载按钮...');
        const clicked = await page.evaluate(() => {
            const firstRow = document.querySelector('tr.ant-table-row');
            if (!firstRow) return false;
            const cells = firstRow.querySelectorAll('td');
            if (!cells.length) return false;
            const lastCell = cells[cells.length - 1];
            const btn = [...lastCell.querySelectorAll('a, button')].find(el => el.textContent.includes('下载'));
            if (!btn) return false;
            btn.click();
            return true;
        });

        if (!clicked) throw new Error('未找到第一行下载按钮');
        log('✅ 下载已触发');
        await page.waitForTimeout(5000);
        return true;
    } catch (e) {
        log(`❌ 下载清单处理失败: ${e.message}`);
        return false;
    }
}

async function handleDownload(page, config, log = console.log) {
    log('🤔 智能判断下载模式...');
    try {
        const isPromiseListMode = await page.waitForSelector('button.ant-btn-primary', { timeout: 5000, visible: true })
            .then(async el => {
                const text = await page.evaluate(e => e.textContent, el);
                return text.trim() === '前往下载清单';
            })
            .catch(() => false);

        if (isPromiseListMode) {
            log('📦 检测到"下载清单"模式');
            await page.evaluate(() => {
                const btn = [...document.querySelectorAll('button.ant-btn-primary')]
                    .find(el => el.textContent.includes('前往下载清单'));
                if (btn) btn.click();
            });
            await sleep(3000);
            await waitAndDownloadFromPromiseList(page, log);
        } else {
            log('⚡ 检测到"直接下载"模式');
            log('⏳ 等待下载完成... (最长 2 分钟)');
            const downloadedFile = await waitForDownload(config.downloadDir, 120000, log);
            log(`✅ 文件已下载: ${downloadedFile}`);
        }
        return true;
    } catch (e) {
        log(`❌ 下载处理失败: ${e.message}`);
        return false;
    }
}

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
