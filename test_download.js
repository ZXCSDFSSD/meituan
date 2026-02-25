/**
 * 下载模块测试
 * 打开浏览器，下载昨天的数据
 *
 * 运行：node test_download.js
 */

'use strict';

const downloader = require('./src/downloader');
const { createLogger } = require('./src/common/logger');
const config = require('./src/common/config');

const { log } = createLogger(config.logDir, '[测试下载] ');

async function main() {
    console.log('='.repeat(60));
    console.log('📥 测试：下载昨天的数据');
    console.log('   浏览器将会弹出，请观察操作过程');
    console.log('='.repeat(60));

    const ok = await downloader.exportDailyData();

    if (ok) {
        console.log('\n✅ 下载成功，文件已保存到 downloads/ 目录');
    } else {
        console.log('\n❌ 下载失败，请查看 logs/ 日志');
    }

    process.exit(ok ? 0 : 1);
}

main().catch(e => {
    console.error('❌ 异常:', e.message);
    process.exit(1);
});
