/**
 * 美团 BI - 订单报表控制台测试脚本
 * 目标页面: https://pos.meituan.com/web/report/orderList?_fe_report_use_storage_query=true#/rms-report/orderList
 *
 * 使用方法：F12 → Console → 粘贴整段 → 回车
 * 步骤：设置日期 → 选择门店（高级弹窗）→ 查询 → 导出
 */
(async () => {

    // ── 配置区（按需修改）────────────────────────────────────────────────────
    const START_DATE = '2026/01/01';
    const END_DATE   = '2026/01/31';

    const POI_IDS = [
        '601681205',
        '601678716',
        '601655756',
        '601680763',
        '601705000',
        '601826340',
        '601861703',
        '601919555',
    ];
    // ─────────────────────────────────────────────────────────────────────────

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const log  = (...a) => console.log('[测试脚本]', ...a);
    const warn = (...a) => console.warn('[测试脚本]', ...a);
    const err  = (...a) => console.error('[测试脚本]', ...a);

    // ── 工具：找到美团业务 iframe ─────────────────────────────────────────────
    function getFrame() {
        const frame = Array.from(document.querySelectorAll('iframe')).find(f =>
            (f.src && f.src.includes('pos.meituan.com')) ||
            (f.name && f.name.includes('dpaas'))
        );
        if (!frame) return null;
        return {
            fDoc: frame.contentDocument || frame.contentWindow.document,
            fWin: frame.contentWindow,
        };
    }

    // ── STEP 1：静默设置日期（native setter，不弹日历面板）────────────────────
    log(`📅 STEP 1 - 设置日期: ${START_DATE} 至 ${END_DATE}`);

    function setDateInput(input, value) {
        if (!input) return;
        // 绕过 React/Vue 拦截器，直接写入原生 value
        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        ).set;
        nativeSetter.call(input, value);
        input.dispatchEvent(new Event('input',  { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, keyCode: 13 }));
    }

    // 优先在 iframe 内查找，找不到则用主页面
    const { fDoc } = getFrame() || { fDoc: document };
    const dateInputs = fDoc.querySelectorAll('input[placeholder="请选择日期"]');

    if (dateInputs.length >= 2) {
        setDateInput(dateInputs[0], START_DATE);
        await sleep(200);
        setDateInput(dateInputs[1], END_DATE);
        log('✅ 日期已静默设置（未触发弹窗）');
    } else {
        warn(`⚠️  日期输入框数量不足（当前: ${dateInputs.length}），跳过日期设置`);
    }

    await sleep(500);

    // ── STEP 2：点击"高级"按钮，打开门店选择弹窗 ─────────────────────────────
    log('🏪 STEP 2 - 点击"高级"按钮...');

    const advBtn = fDoc.querySelector('.advanced-btn') ||
        [...fDoc.querySelectorAll('button')].find(b =>
            b.textContent.replace(/\s+/g, '') === '高级'
        );

    if (!advBtn) {
        err('❌ 未找到"高级"按钮，请确认报表已完整加载后再执行');
        return;
    }
    advBtn.click();
    log('✅ 已点击"高级"，等待弹窗加载...');
    await sleep(2000);

    // ── STEP 3：等待门店列表出现 ──────────────────────────────────────────────
    log('⏳ STEP 3 - 等待门店列表...');
    let scroller = null;
    for (let i = 0; i < 20; i++) {
        scroller = fDoc.querySelector('.sun-table-body');
        if (scroller) break;
        await sleep(500);
    }
    if (!scroller) {
        err('❌ 门店列表超时未出现，请手动打开弹窗后重试');
        return;
    }
    log('✅ 门店弹窗已加载');

    // ── STEP 4：逐个勾选门店 ──────────────────────────────────────────────────
    log(`🔖 STEP 4 - 开始勾选 ${POI_IDS.length} 个门店...`);

    const selected = [], failed = [];

    for (const id of POI_IDS) {
        let found = false;
        scroller.scrollTop = 0;
        await sleep(200);

        for (let i = 0; i < 40; i++) {
            const row = fDoc.querySelector(`tr[data-row-key="${id}"]`);
            if (row) {
                const alreadySelected =
                    row.classList.contains('sun-table-row-selected') ||
                    !!row.querySelector('.sun-checkbox-checked');
                if (!alreadySelected) {
                    row.scrollIntoView({ block: 'center' });
                    await sleep(100);
                    const cb = row.querySelector('.sun-checkbox-input');
                    if (cb) cb.click(); else row.click();
                    log(`  ✅ 已勾选: ${id}`);
                } else {
                    log(`  ℹ️  ${id} 已处于选中状态`);
                }
                found = true;
                break;
            }
            scroller.scrollTop += 100;
            await sleep(100);
        }

        if (!found) {
            warn(`  ⚠️  未找到门店: ${id}`);
            failed.push(id);
        } else {
            selected.push(id);
        }
    }

    log(`\n📊 勾选结果: 成功 ${selected.length} / 总计 ${POI_IDS.length}`);
    if (failed.length > 0) warn(`  未找到: ${failed.join(', ')}`);

    // ── STEP 5：点击确定，关闭弹窗 ───────────────────────────────────────────
    if (selected.length > 0) {
        log('✅ STEP 5 - 点击确定...');
        await sleep(300);
        const confirmBtn = fDoc.querySelector('.sun-btn-primary');
        if (confirmBtn) {
            confirmBtn.click();
            log('✅ 已点击确定，弹窗已关闭');
        } else {
            warn('⚠️  未找到确定按钮，请手动点击');
        }
    }

    await sleep(1500);

    // ── STEP 6：点击查询 ──────────────────────────────────────────────────────
    log('🔍 STEP 6 - 点击查询...');
    const queryBtn = [...fDoc.querySelectorAll('button')]
        .find(b => b.textContent.trim() === '查询');
    if (queryBtn) {
        queryBtn.click();
        log('✅ 已点击查询，等待数据加载...');
    } else {
        warn('⚠️  未找到查询按钮，请手动点击');
    }

    await sleep(5000);

    // ── STEP 7：点击导出 ──────────────────────────────────────────────────────
    log('📤 STEP 7 - 点击导出...');
    const exportBtn = [...fDoc.querySelectorAll('button')]
        .find(b => !b.disabled && b.textContent.trim() === '导出');
    if (exportBtn) {
        exportBtn.click();
        log('✅ 已点击导出');
    } else {
        warn('⚠️  未找到导出按钮（数据可能还在加载，稍后手动点击）');
    }

    log('\n🎉 测试脚本执行完毕！');

})();
