/**
 * 登录管理模块
 * 保存/加载 Cookie、手动登录、登录状态检查
 */

'use strict';

const fs = require('fs');

async function saveCookies(page, cookieFile, log = console.log) {
    try {
        const cookies = await page.cookies();
        fs.writeFileSync(cookieFile, JSON.stringify(cookies, null, 2));
        log('✅ Cookie 已保存');
    } catch (e) {
        log(`⚠️  保存 Cookie 失败: ${e.message}`);
    }
}

async function loadCookies(page, cookieFile, log = console.log) {
    try {
        if (fs.existsSync(cookieFile)) {
            const cookies = JSON.parse(fs.readFileSync(cookieFile, 'utf8'));
            await page.setCookie(...cookies);
            log('✅ 已加载保存的 Cookie');
            return true;
        }
    } catch (e) {
        log(`⚠️  加载 Cookie 失败: ${e.message}`);
    }
    return false;
}

async function handleManualLogin(page, timeout, log = console.log) {
    log('📍 访问美团登录页面...');
    await page.goto('https://pos.meituan.com/', { waitUntil: 'networkidle2', timeout });
    log('✅ 登录页面已加载');
    log('💡 请在浏览器中完成登录（包括输入手机号和验证码），最长等待 5 分钟...');

    try {
        await page.waitForFunction(() =>
            document.body.innerText.includes('报表中心') ||
            document.body.innerText.includes('订单'),
            { timeout: 300000 }
        );
        log('✅ 登录成功！');
        return true;
    } catch (_) {
        log('❌ 登录超时（5分钟内未完成登录）');
        throw new Error('登录超时');
    }
}

/**
 * 确保已登录，登录验证完成后直接跳转到 targetUrl
 * @param {string} targetUrl - 登录后要打开的报表页面 URL
 */
async function ensureLogin(page, config, log = console.log, targetUrl = null) {
    log('🔐 检查登录状态...');

    // 用于验证 Cookie 是否有效的页面（主页）
    const checkUrl = 'https://pos.meituan.com/web/report/main#/rms-report/home';

    const cookiesLoaded = await loadCookies(page, config.cookieFile, log);

    if (cookiesLoaded) {
        log('📍 使用已保存的 Cookie 验证登录状态...');
        await page.goto(checkUrl, { waitUntil: 'networkidle2', timeout: config.timeout });

        const url = page.url();
        if (url.includes('login') || url.includes('rms-account')) {
            log('⚠️  Cookie 已过期，需要重新登录');
            await handleManualLogin(page, config.timeout, log);
        } else {
            log('✅ Cookie 有效，已登录');
        }
    } else {
        await handleManualLogin(page, config.timeout, log);
    }

    await saveCookies(page, config.cookieFile, log);

    // 跳转到目标报表页面（不再强制停留在 orderList）
    const finalUrl = targetUrl || checkUrl;
    log(`📍 跳转到目标页面...`);
    await page.goto(finalUrl, { waitUntil: 'networkidle2', timeout: config.timeout });
    log('✅ 页面加载完成');
}

module.exports = { saveCookies, loadCookies, handleManualLogin, ensureLogin };
