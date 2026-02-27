'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const TARGET_URL = 'https://pos.meituan.com/web/report/orderList?_fe_report_use_storage_query=true#/rms-report/orderList';
const COOKIE_FILE = path.join(__dirname, '..', 'meituan_cookies.json');

(async () => {
    console.log('🚀 启动浏览器...');

    const browser = await puppeteer.launch({
        headless: false,
        args: ['--start-maximized', '--no-sandbox'],
        defaultViewport: null,   // 跟随窗口大小
    });

    const page = await browser.newPage();

    // 关闭初始空白页
    const pages = await browser.pages();
    if (pages.length > 1) await pages[0].close();

    // 加载 Cookie（如果有）
    if (fs.existsSync(COOKIE_FILE)) {
        const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
        await page.setCookie(...cookies);
        console.log('✅ 已加载已保存的 Cookie');
    } else {
        console.log('⚠️  未找到 Cookie 文件，需要手动登录');
    }

    console.log(`📍 正在打开: ${TARGET_URL}`);
    await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('✅ 页面已打开，请在浏览器中查看');
    console.log('💡 如需登录，请在浏览器中完成后浏览器将保持打开状态');

    // 保持进程运行，不自动关闭
    process.stdin.resume();
    process.on('SIGINT', async () => {
        console.log('\n⛔ 正在关闭浏览器...');
        await browser.close();
        process.exit(0);
    });
})();
