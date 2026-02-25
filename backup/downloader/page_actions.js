/**
 * 页面操作模块
 * 日期设置、门店选择、查询、导出等页面交互
 */

'use strict';

const { sleep } = require('./browser');

async function changeDateRange(page, startDate, endDate, log = console.log) {
    log(`📅 设置日期范围: ${startDate} 至 ${endDate}`);
    try {
        await page.waitForSelector('input[placeholder="请选择日期"]', { timeout: 10000 });
        await page.evaluate((s, e) => {
            const setDate = (input, value) => {
                input.focus();
                input.value = value;
                input.dispatchEvent(new Event('input',  { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.blur();
            };
            const inputs = document.querySelectorAll('input[placeholder="请选择日期"]');
            if (inputs.length >= 2) { setDate(inputs[0], s); setDate(inputs[1], e); }
        }, startDate, endDate);
        log('✅ 日期已设置');
        await sleep(500);
        return true;
    } catch (e) {
        log(`❌ 设置日期失败: ${e.message}`);
        return false;
    }
}

async function selectStores(page, poiIds, log = console.log) {
    log('🏐 选择门店（高级弹窗勾选）...');
    log(`📄 要选择的门店 poiId: ${poiIds.join(', ')}\n`);

    try {
        log('1️⃣ 点击"高 级"按钮...');
        const advClicked = await page.evaluate(() => {
            // 优先按 CSS class（店内订单明细页面）
            let btn = document.querySelector('.advanced-btn');
            if (btn) { btn.click(); return true; }
            // 按文字内容兜底（其他页面，"高 级"中间有空格）
            btn = [...document.querySelectorAll('button, a, span')]
                .find(el => el.textContent.replace(/\s+/g, '') === '高级');
            if (btn) { btn.click(); return true; }
            return false;
        });
        if (!advClicked) { log('❌ 未找到"高 级"按钮'); return false; }
        log('✅ 已点击"高级"按钮');
        await sleep(2000);

        log('2️⃣ 等待门店表格加载...');
        try {
            await page.waitForSelector('.sun-table-row[data-row-key]', { timeout: 10000 });
            log('✅ 门店表格已加载\n');
        } catch (_) { log('❌ 门店表格未加载'); return false; }

        log('3️⃣ 开始勾选门店...');
        const selectedIds = [], failedIds = [];

        for (const poiId of poiIds) {
            log(`\n   🔍 查找门店 ${poiId}...`);
            let found = await tryClickCheckbox(page, poiId);
            if (!found) {
                log(`   ⏬ 当前可见区域未找到，尝试滑动查找...`);
                found = await scrollAndFind(page, poiId, log);
            }
            if (found) { selectedIds.push(poiId); log(`   ✅ 门店 ${poiId} 已勾选`); }
            else        { failedIds.push(poiId);  log(`   ⚠️  门店 ${poiId} 未找到`); }
            await sleep(300);
        }

        log(`\n📋 勾选结果: 成功 ${selectedIds.length} 个, 失败 ${failedIds.length} 个`);
        if (failedIds.length > 0) log(`   未找到: ${failedIds.join(', ')}`);

        log('\n4️⃣ 点击确认按钮...');
        await sleep(500);
        const confirmed = await page.evaluate(() => {
            const btn = document.querySelector('.sun-btn-primary');
            if (btn) { btn.click(); return '确定'; }
            return null;
        });
        if (confirmed) log(`✅ 已点击"${confirmed}"按钮\n`);
        else { log('⚠️  未找到确认按钮，按 Enter...'); await page.keyboard.press('Enter'); }

        await sleep(1000);
        return selectedIds.length > 0;
    } catch (e) {
        log(`❌ 选择门店失败: ${e.message}`);
        return false;
    }
}

async function tryClickCheckbox(page, poiId) {
    return await page.evaluate((targetId) => {
        const row = document.querySelector(`.sun-table-row[data-row-key="${targetId}"]`);
        if (!row) return false;
        if (row.classList.contains('sun-table-row-selected')) return true;
        const checkbox = row.querySelector('.sun-checkbox-input');
        if (checkbox) { checkbox.click(); return true; }
        row.click();
        return true;
    }, poiId);
}

async function scrollAndFind(page, poiId, log = console.log) {
    const MAX = 50;
    await page.evaluate(() => {
        const h = document.querySelector('.sun-table-tbody-virtual-holder');
        if (h) h.scrollTop = 0;
    });
    await sleep(500);

    for (let i = 0; i < MAX; i++) {
        if (await tryClickCheckbox(page, poiId)) return true;
        const bottom = await page.evaluate(() => {
            const h = document.querySelector('.sun-table-tbody-virtual-holder');
            if (!h) return true;
            const old = h.scrollTop;
            h.scrollTop += h.clientHeight / 2;
            return h.scrollTop === old;
        });
        await sleep(300);
        if (bottom) break;
    }

    for (let i = 0; i < MAX; i++) {
        if (await tryClickCheckbox(page, poiId)) return true;
        const top = await page.evaluate(() => {
            const h = document.querySelector('.sun-table-tbody-virtual-holder');
            if (!h) return true;
            const old = h.scrollTop;
            h.scrollTop -= h.clientHeight / 2;
            return h.scrollTop === old;
        });
        await sleep(300);
        if (top) break;
    }

    return false;
}

async function clickQuery(page, log = console.log) {
    log('🔍 点击查询...');
    try {
        const clicked = await page.evaluate(() => {
            for (const btn of document.querySelectorAll('button')) {
                if (btn.textContent.trim() === '查询') { btn.click(); return true; }
            }
            return false;
        });
        log(clicked ? '✅ 已点击查询' : '⚠️  未找到查询按钮');
        await sleep(3000);
        return clicked;
    } catch (e) { log(`❌ 点击查询失败: ${e.message}`); return false; }
}

async function clickExport(page, log = console.log) {
    log('📤 点击导出...');
    try {
        const clicked = await page.evaluate(() => {
            for (const btn of document.querySelectorAll('button')) {
                if (btn.textContent.trim() === '导出') { btn.click(); return true; }
            }
            return false;
        });
        log(clicked ? '✅ 已点击导出' : '⚠️  未找到导出按钮');
        await sleep(1000);
        return clicked;
    } catch (e) { log(`❌ 点击导出失败: ${e.message}`); return false; }
}

// async function selectAllAndConfirm(page, log = console.log) {
//     log('✅ 勾选全部并确认...');
//     try {
//         await page.waitForSelector('.ant-modal-content', { timeout: 10000 });
//         await page.evaluate(() => {
//             for (const label of document.querySelectorAll('label.ant-checkbox-wrapper')) {
//                 if (label.textContent.trim().includes('全部')) {
//                     if (!label.querySelector('input[type="checkbox"]').checked) label.click();
//                     break;
//                 }
//             }
//         });
//         log('✅ 已勾选"全部"');
//         await sleep(500);

//         const clicked = await page.evaluate(() => {
//             const footer = document.querySelector('.ant-modal-footer');
//             if (footer) {
//                 const btn = footer.querySelector('.ant-btn-primary');
//                 if (btn) { btn.click(); return true; }
//             }
//             return false;
//         });
//         log(clicked ? '✅ 已点击确定' : '⚠️  未找到确定按钮');
//         await sleep(2000);
//         return true;
//     } catch (e) { log(`❌ 勾选或确认失败: ${e.message}`); return false; }
// }

async function goToDownloadList(page, log = console.log) {
    log('📋 进入下载清单...');
    try {
        const clicked = await page.evaluate(() => {
            for (const btn of document.querySelectorAll('button.ant-btn-primary')) {
                if (btn.textContent.trim() === '前往下载清单') { btn.click(); return true; }
            }
            return false;
        });
        if (clicked) { log('✅ 已进入下载清单'); await sleep(2000); return true; }
        log('⚠️  未找到下载清单链接');
        return false;
    } catch (e) { log(`❌ 进入下载清单失败: ${e.message}`); return false; }
}

module.exports = {
    changeDateRange,
    selectStores,
    tryClickCheckbox,
    scrollAndFind,
    clickQuery,
    clickExport,
    goToDownloadList
};
