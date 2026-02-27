const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function changeDateRange(page, startDate, endDate, log = console.log) {
    log(`📅 设置日期范围: ${startDate} 至 ${endDate}`);

    try {
        await page.waitForSelector('input[placeholder="请选择日期"]', { timeout: 10000 });

        await page.evaluate((startDate, endDate) => {
            const setDate = (input, value) => {
                input.focus();
                input.value = value;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.blur();
            };
            const dateInputs = document.querySelectorAll('input[placeholder="请选择日期"]');
            if (dateInputs.length >= 2) {
                setDate(dateInputs[0], startDate);
                setDate(dateInputs[1], endDate);
            }
        }, startDate, endDate);

        log('✅ 日期已设置');
        await sleep(500);
        return true;

    } catch (e) {
        log(`❌ 设置日期失败: ${e.message}`);
        return false;
    }
}

(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized'],
    });

    try {
        const page = await browser.newPage();

        // 1. 加载 Cookies
        const cookiesPath = path.resolve(__dirname, 'meituan_cookies.json');
        if (fs.existsSync(cookiesPath)) {
            const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf-8'));
            await page.setCookie(...cookies);
            console.log('✅ Cookies 已加载');
        }

        // 2. 进入报表页面
        await page.goto('https://pos.meituan.com/web/report/orderList?_fe_report_use_storage_query=true#/rms-report/orderList', {
            waitUntil: 'networkidle2'
        });

        console.log('⏳ 等待页面加载...');
        await sleep(3000);

        // 3. 设置日期范围
        const startDate = '2026/02/01';
        const endDate = '2026/02/01';
        await changeDateRange(page, startDate, endDate);

    } catch (err) {
        console.error('❌ 运行出错:', err.message);
    }

    // console.log('✅ 执行完毕');
    // await browser.close();
})();
