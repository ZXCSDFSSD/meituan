/**
 * 浏览器管理模块
 * 启动/关闭 Puppeteer 浏览器
 */

'use strict';

const puppeteer = require('puppeteer');

async function launchBrowser(config) {
    const browser = await puppeteer.launch({
        headless: config.headless,
        args: [
            '--start-maximized',
            '--force-device-scale-factor=1',
            '--high-dpi-support=1',
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ],
        defaultViewport: { width: 1920, height: 1080 }
    });

    const page = await browser.newPage();

    // 关闭初始空白页
    const pages = await browser.pages();
    if (pages.length > 1) await pages[0].close();

    // 设置下载目录
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: config.downloadDir
    });

    return { browser, page };
}

async function closeBrowser(browser) {
    if (browser) await browser.close();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { launchBrowser, closeBrowser, sleep };
