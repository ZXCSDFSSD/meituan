/**
 * 统一配置模块
 * 所有模块共享的配置，统一在此管理
 */

'use strict';

const path = require('path');

// 项目根目录（src/common/ 的上两级）
const ROOT = path.join(__dirname, '..', '..');

const config = {
    // 美团门店 POI ID 列表
    poiIds: [
        '601681205',
        '601678716',
        '601655756',
        '601680763',
        '601705000',
        '601826340',
        '601861703',
        '601919555',
    ],

    // 路径配置
    downloadDir: path.join(ROOT, 'downloads'),
    cookieFile:  path.join(ROOT, 'meituan_cookies.json'),
    statusFile:  path.join(ROOT, '.meituan_status.json'),
    logDir:      path.join(ROOT, 'logs'),
    dbPath:      path.join(ROOT, 'data', 'meituan.db'),

    // Puppeteer 配置
    headless: false,
    timeout:  50000,

    // API 端口
    port: 3000,

    // 报表下载类型（每次导出依次下载这3个报表）
    reportTypes: [
        {
            id:           'channel_orders',
            name:         '全渠道订单明细',
            url:          'https://pos.meituan.com/web/report/dpaas-report-channelOrderListV2#/rms-report/dpaas-report-channelOrderListV2',
            filePrefix:   '全渠道订单明细',
            dateMethod:   'picker',   // 模拟点击 UI 选择器
            historyStart: { year: 2026, month: 1 },
        },
        {
            id:           'dish_sales',
            name:         '菜品销售明细',
            url:          'https://pos.meituan.com/web/report/dishSaleDetail#/rms-report/dishSaleDetail',
            filePrefix:   '菜品销售明细',
            dateMethod:   'picker',   // saas 日历控件（同全渠道订单明细）
            historyStart: { year: 2026, month: 1 },
        },
        {
            id:           'payments',
            name:         '收款明细',
            url:          'https://pos.meituan.com/web/report/payment-new?_fe_report_use_storage_query=true#/rms-report/payment-new',
            filePrefix:   '收款明细',
            dateMethod:   'direct',   // 直接赋值（已验证）
            historyStart: { year: 2026, month: 1 },
        },
    ],
};

module.exports = config;
