/**
 * 页面操作模块
 * 注意：美团 BI 报表内容在 iframe 中，所有 UI 操作需传入 frame（而非主 page）
 * - setDateRange(context, startDate, endDate, log)   ← 统一入口，自动适配两种控件
 *   - changeDateRange     直接赋值（input[placeholder="请选择日期"]，收款明细等页面）
 *   - setDateRangeViaPicker  模拟点击（input[placeholder="开始日期"]，全渠道订单明细等）
 * - clickAdvancedStoreSelect(context, poiIds, log)
 * - clickQuery / clickExport / goToDownloadList
 * context 可以是 Puppeteer Page 或 Frame，两者 API 相同
 */

'use strict';

const { sleep } = require('./browser');

// ── 拦截器（已停用，保留代码备用）─────────────────────────────────────────────
//
// const { dateToTs, buildPoiIdsStr, buildStoreConditions } = require('./api_client');
//
// async function interceptExportRequest(page, startDate, endDate, poiIds, log = console.log) {
//     ...（完整代码略，已注释停用）
// }

// ── 方式一：直接赋值（适用于 placeholder="请选择日期" 的页面）──────────────────

/**
 * 直接向输入框赋值设置日期范围
 * 适用页面：收款明细等带有 ?_fe_report_use_storage_query=true 参数的页面
 * @returns {boolean} true=成功, false=页面无此控件或赋值失败
 */
async function changeDateRange(context, startDate, endDate, log = console.log) {
    log(`📅 尝试直接赋值日期: ${startDate} 至 ${endDate}`);
    try {
        // 快速探测：3 秒内找不到就认为此页面不支持直接赋值
        await context.waitForSelector('input[placeholder="请选择日期"]', { timeout: 3000 });

        await context.evaluate((s, e) => {
            const setDate = (input, value) => {
                input.focus();
                input.value = value;
                input.dispatchEvent(new Event('input',  { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.blur();
            };
            const inputs = document.querySelectorAll('input[placeholder="请选择日期"]');
            if (inputs.length >= 2) {
                setDate(inputs[0], s);
                setDate(inputs[1], e);
                return true;
            }
            return false;
        }, startDate, endDate);

        log('✅ 日期已设置（直接赋值）');
        await sleep(500);
        return true;
    } catch (e) {
        log(`⚠️  直接赋值不可用（${e.message.split('\n')[0]}），切换至 UI 选择器`);
        return false;
    }
}

// ── 方式二：UI 日期选择器 ──────────────────────────────────────────────────────

/**
 * 通过 UI 日期选择器设置日期范围（在 iframe frame 中执行）
 * 流程：打开 picker → 点年标题 → 点目标年 → 点目标月 → 点开始日 → 点结束日
 *
 * @param {Page|Frame} context  - Puppeteer Page 或 Frame（报表在 iframe 内时传 frame）
 * @param {string} startDate    - "YYYY/MM/DD" 或 "YYYY-MM-DD"
 * @param {string} endDate      - "YYYY/MM/DD" 或 "YYYY-MM-DD"
 */
async function setDateRangeViaPicker(context, startDate, endDate, log = console.log) {
    const [sy, sm, sd] = startDate.replace(/\//g, '-').split('-').map(Number);
    const [ey, em, ed] = endDate.replace(/\//g, '-').split('-').map(Number);
    log(`📅 UI 设置日期: ${startDate} → ${endDate}`);

    const result = await context.evaluate(async (sy, sm, sd, ey, em, ed) => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));

        // 深度穿透：锁定含"开始日期"输入框的容器，确定正确的 document
        function findAnchorEverywhere(doc) {
            const containers = Array.from(doc.querySelectorAll('.saas-form-item-control-wrapper'));
            const target = containers.find(c => c.querySelector('input[placeholder="开始日期"]'));
            if (target) return { container: target, doc };
            const iframes = doc.querySelectorAll('iframe');
            for (let f of iframes) {
                try {
                    const res = findAnchorEverywhere(f.contentDocument || f.contentWindow.document);
                    if (res) return res;
                } catch (e) {}
            }
            return null;
        }

        // 模拟真实点击（mousedown + mouseup + click + focus）
        const simulateClick = (el) => {
            ['mousedown', 'mouseup', 'click', 'focus'].forEach(name =>
                el.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true, view: window }))
            );
        };

        // 通过 title 属性点击日期格（补零 / 不补零 两种格式兼容）
        const clickDayByTitle = (targetDoc, year, month, day) => {
            const mPad = String(month).padStart(2, '0');
            const dPad = String(day).padStart(2, '0');
            const titles = [
                `${year}-${mPad}-${dPad}`,
                `${year}-${month}-${day}`,
            ];
            for (const t of titles) {
                const cell = targetDoc.querySelector(`td[title="${t}"] .saas-picker-cell-inner`);
                if (cell) { simulateClick(cell); return true; }
            }
            return false;
        };

        // 轮询等待日期格出现并点击（picker 渲染需要时间）
        const waitAndClickDay = async (targetDoc, year, month, day, timeout = 3000) => {
            const start = Date.now();
            while (Date.now() - start < timeout) {
                if (clickDayByTitle(targetDoc, year, month, day)) return true;
                await sleep(150);
            }
            return false;
        };

        // ── 1. 找到正确的 document 和输入框 ──
        const anchorInfo = findAnchorEverywhere(document);
        if (!anchorInfo) return { ok: false, step: '找不到输入框容器 (.saas-form-item-control-wrapper)' };
        const { container, doc: targetDoc } = anchorInfo;
        const input = container.querySelector('input[placeholder="开始日期"]');

        // ── 2. 激活日期选择器面板 ──
        simulateClick(input);
        await sleep(800);

        // ── 3. 切换年份（当前年份不是目标年才进入年份网格）──
        const yearBtn = targetDoc.querySelector('.saas-picker-year-btn');
        if (!yearBtn) return { ok: false, step: '找不到年份标题按钮 (.saas-picker-year-btn)' };
        if (!yearBtn.innerText.includes(String(sy))) {
            yearBtn.click();
            await sleep(500);
            const yearCell = targetDoc.querySelector(`td[title="${sy}"] .saas-picker-cell-inner`);
            if (!yearCell) return { ok: false, step: `年份网格找不到: ${sy}` };
            yearCell.click();
            await sleep(500);
        }
        // ── 4. 切换月份（当前月份不是目标月才进入月份网格）──
        const monthBtn = targetDoc.querySelector('.saas-picker-month-btn');
        if (!monthBtn) return { ok: false, step: '找不到月份标题按钮 (.saas-picker-month-btn)' };
        if (!monthBtn.innerText.includes(`${sm}月`)) {
            monthBtn.click();
            await sleep(500);
            const monthTitle = `${sy}-${String(sm).padStart(2, '0')}`;
            const monthCell = targetDoc.querySelector(`td[title="${monthTitle}"] .saas-picker-cell-inner`) ||
                              Array.from(targetDoc.querySelectorAll('.saas-picker-cell-inner'))
                                  .find(el => el.innerText.trim() === `${sm}月`);
            if (!monthCell) return { ok: false, step: `月份网格找不到: ${sm}月` };
            monthCell.click();
            await sleep(600);
        }
        
        // ── 5. 点击开始日 ──
        const startOk = await waitAndClickDay(targetDoc, sy, sm, sd);
        if (!startOk) return { ok: false, step: `找不到开始日: ${sy}-${sm}-${sd}` };
        await sleep(800);

        // ── 6. 点击结束日（picker 渲染后轮询查找）──
        const endOk = await waitAndClickDay(targetDoc, ey, em, ed);
        if (!endOk) return { ok: false, step: `找不到结束日: ${ey}-${em}-${ed}` };
        await sleep(300);

        return { ok: true };
    }, sy, sm, sd, ey, em, ed);

    if (result.ok) {
        log(`   ✅ 日期设置成功`);
    } else {
        log(`   ❌ 日期设置失败: ${result.step}`);
    }
    return result.ok;
}

// ── 高级门店选择器 ────────────────────────────────────────────────────────────

/**
 * 点击"高级"门店选择按钮 → 等弹窗加载 → 按 poiId 勾选 → 点确定
 * 自动适配容器：优先 .sun-table-body（[01][02]），回退 .sun-table-tbody-virtual-holder（[03]）
 * 内部自行遍历 iframe，无需外部传入正确的 frame 上下文
 * @param {Page|Frame} context  - 可传主页面或任意 frame
 * @param {string[]} poiIds     - 要选择的门店 POI ID 数组
 */
async function clickAdvancedStoreSelect(context, poiIds, log = console.log) {
    log('🏪 选择门店（高级弹窗勾选）...');
    log(`📄 要选择的门店 poiId: ${poiIds.join(', ')}`);

    try {
        // 全流程在单个 evaluate 内完成，内部遍历 iframe 找到正确的 document
        const result = await context.evaluate(async (poiIds) => {
            const sleep = ms => new Promise(r => setTimeout(r, ms));

            // 遍历所有 iframe，找到含 .advanced-btn 的 document
            function findDocWithAdvBtn(doc) {
                if (doc.querySelector('.advanced-btn')) return doc;
                const byText = [...doc.querySelectorAll('button')].find(
                    el => el.textContent.replace(/\s+/g, '') === '高级'
                );
                if (byText) return doc;
                for (const f of doc.querySelectorAll('iframe')) {
                    try {
                        const fd = f.contentDocument || f.contentWindow.document;
                        const res = findDocWithAdvBtn(fd);
                        if (res) return res;
                    } catch (e) {}
                }
                return null;
            }

            // ── 1. 找到目标 document ──
            const targetDoc = findDocWithAdvBtn(document);
            if (!targetDoc) return { ok: false, step: '找不到含"高级"按钮的 document' };

            // ── 2. 点击"高级"按钮 ──
            let advBtn = targetDoc.querySelector('.advanced-btn');
            if (!advBtn) {
                advBtn = [...targetDoc.querySelectorAll('button')].find(
                    el => el.textContent.replace(/\s+/g, '') === '高级'
                );
            }
            if (!advBtn) return { ok: false, step: '找不到"高级"按钮元素' };
            advBtn.click();
            await sleep(2000);

            // ── 3. 等待门店表格加载（轮询最多 10 秒）──
            let tableFound = false;
            for (let i = 0; i < 20; i++) {
                if (targetDoc.querySelector('tr[data-row-key], .sun-table-row[data-row-key]')) {
                    tableFound = true;
                    break;
                }
                await sleep(500);
            }
            if (!tableFound) return { ok: false, step: '门店表格未加载' };

            // ── 4. 扫描勾选：while 滚动 + Set 去重 ──
            const targetSet = new Set(poiIds.map(String));
            const foundIds = [], failedIds = [];

            const scroller = targetDoc.querySelector('.sun-table-body') ||
                             targetDoc.querySelector('.sun-table-tbody-virtual-holder');
            if (!scroller) return { ok: false, step: '找不到滚动容器' };

            scroller.scrollTop = 0;
            await sleep(300);

            let lastScrollTop = -1;
            while (targetSet.size > 0 && scroller.scrollTop !== lastScrollTop) {
                lastScrollTop = scroller.scrollTop;
                targetDoc.querySelectorAll('tr[data-row-key], .sun-table-row[data-row-key]').forEach(row => {
                    const id = row.getAttribute('data-row-key');
                    if (!targetSet.has(id)) return;
                    const isSelected = row.classList.contains('sun-table-row-selected') ||
                                       row.querySelector('.sun-checkbox-checked');
                    if (!isSelected) {
                        const cb = row.querySelector('.sun-checkbox-input');
                        if (cb) {
                            cb.click();
                            cb.dispatchEvent(new Event('input',  { bubbles: true }));
                            cb.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                    targetSet.delete(id);
                    foundIds.push(id);
                });
                scroller.scrollTop += 150;
                await sleep(150);
            }
            // 到达底部后再扫一次最后几行
            targetDoc.querySelectorAll('tr[data-row-key], .sun-table-row[data-row-key]').forEach(row => {
                const id = row.getAttribute('data-row-key');
                if (!targetSet.has(id)) return;
                const cb = row.querySelector('.sun-checkbox-input');
                if (cb) { cb.click(); cb.dispatchEvent(new Event('change', { bubbles: true })); }
                targetSet.delete(id);
                foundIds.push(id);
            });
            for (const id of targetSet) failedIds.push(id);

            // ── 5. 点击确认 ──
            await sleep(500);
            const confirmBtn = targetDoc.querySelector('.sun-btn-primary');
            if (confirmBtn) {
                confirmBtn.click();
                return { ok: true, found: foundIds, failed: failedIds, confirmed: true };
            }
            return { ok: true, found: foundIds, failed: failedIds, confirmed: false };

        }, poiIds);

        if (!result.ok) {
            log(`⚠️  门店选择失败: ${result.step}`);
            return false;
        }
        log(`📋 勾选结果: 成功 ${result.found.length} 个, 失败 ${result.failed.length} 个`);
        if (result.failed.length > 0) log(`   未找到: ${result.failed.join(', ')}`);
        if (!result.confirmed) {
            log('⚠️  未找到确认按钮，按 Enter...');
            const page = typeof context.page === 'function' ? context.page() : context;
            await page.keyboard.press('Enter');
        } else {
            log('✅ 已点击确认按钮');
        }

        await sleep(1000);
        return result.found.length > 0;
    } catch (e) {
        log(`❌ 高级门店选择失败: ${e.message}`);
        return false;
    }
}

// ── 查询按钮 ─────────────────────────────────────────────────────────────────

async function clickQuery(context, log = console.log) {
    log('🔍 点击查询按钮...');
    try {
        const clicked = await context.evaluate(() => {
            function findAndClick(doc, text) {
                for (const btn of doc.querySelectorAll('button')) {
                    if (btn.textContent.trim() === text) { btn.click(); return true; }
                }
                for (const f of doc.querySelectorAll('iframe')) {
                    try {
                        const fd = f.contentDocument || f.contentWindow.document;
                        if (findAndClick(fd, text)) return true;
                    } catch (e) {}
                }
                return false;
            }
            return findAndClick(document, '查询');
        });
        log(clicked ? '✅ 已点击查询' : '⚠️  未找到查询按钮');
        await sleep(3000);
        return clicked;
    } catch (e) { log(`   （查询按钮处理失败: ${e.message}）`); return false; }
}

// ── 导出按钮 ─────────────────────────────────────────────────────────────────

async function clickExport(context, log = console.log) {
    log('📤 点击导出按钮...');
    try {
        const clicked = await context.evaluate(() => {
            function findAndClick(doc, text) {
                for (const btn of doc.querySelectorAll('button')) {
                    if (!btn.disabled && btn.textContent.trim() === text) {
                        btn.click(); return btn.textContent.trim();
                    }
                }
                for (const f of doc.querySelectorAll('iframe')) {
                    try {
                        const fd = f.contentDocument || f.contentWindow.document;
                        const r = findAndClick(fd, text);
                        if (r) return r;
                    } catch (e) {}
                }
                return null;
            }
            return findAndClick(document, '导出');
        });
        log(clicked ? `✅ 已点击导出按钮` : '⚠️  未找到导出按钮');
        await sleep(1000);
        return !!clicked;
    } catch (e) { log(`❌ 点击导出失败: ${e.message}`); return false; }
}

// ── 前往下载清单 ──────────────────────────────────────────────────────────────

async function goToDownloadList(context, log = console.log) {
    log('📋 进入下载清单...');
    try {
        const clicked = await context.evaluate(() => {
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

// ── 统一日期设置入口 ──────────────────────────────────────────────────────────

/**
 * 自动适配两种日期控件：
 * 1. 先尝试直接赋值（input[placeholder="请选择日期"]）
 * 2. 失败则回退到 UI 选择器点击（input[placeholder="开始日期"]）
 */
async function setDateRange(context, startDate, endDate, log = console.log) {
    const direct = await changeDateRange(context, startDate, endDate, log);
    if (direct) return true;
    return setDateRangeViaPicker(context, startDate, endDate, log);
}

module.exports = {
    setDateRange,
    changeDateRange,
    setDateRangeViaPicker,
    clickAdvancedStoreSelect,
    clickQuery,
    clickExport,
    goToDownloadList,
};


