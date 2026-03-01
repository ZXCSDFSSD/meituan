/**
 * 数据探索性分析脚本（EDA）
 * 支持：.xlsx Excel 文件、.db SQLite 数据库
 *
 * 用法：
 *   node scripts/analyze_data.js <文件路径|表名>
 *   node scripts/analyze_data.js downloads/菜品销售明细/菜品销售明细_2025-01-01_2025-01-02.xlsx
 *   node scripts/analyze_data.js data/meituan.db
 *   node scripts/analyze_data.js data/meituan.db orders
 *   node scripts/analyze_data.js --all          # 分析全库所有表
 */

'use strict';

const fs      = require('fs');
const path    = require('path');
const XLSX    = require('xlsx');
const sqlite3 = require('sqlite3').verbose();

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function fmt(n) {
    if (n === null || n === undefined) return 'N/A';
    if (typeof n === 'number') return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    return String(n);
}

function humanSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function padR(s, n) { return String(s).padEnd(n); }
function padL(s, n) { return String(s).padStart(n); }

function printHeader(title) {
    const line = '═'.repeat(60);
    console.log(`\n${line}`);
    console.log(`  ${title}`);
    console.log(line);
}

function printSection(title) {
    console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}`);
}

// ── 数值统计 ──────────────────────────────────────────────────────────────────

function numStats(values) {
    const nums = values.filter(v => v !== null && v !== undefined && v !== '' && !isNaN(Number(v))).map(Number);
    if (nums.length === 0) return null;
    nums.sort((a, b) => a - b);
    const sum = nums.reduce((s, v) => s + v, 0);
    const mean = sum / nums.length;
    const mid = Math.floor(nums.length / 2);
    const median = nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
    const variance = nums.reduce((s, v) => s + (v - mean) ** 2, 0) / nums.length;
    const q1 = nums[Math.floor(nums.length * 0.25)];
    const q3 = nums[Math.floor(nums.length * 0.75)];
    return {
        count: nums.length,
        min:   nums[0],
        max:   nums[nums.length - 1],
        mean:  +mean.toFixed(4),
        median,
        std:   +Math.sqrt(variance).toFixed(4),
        q1, q3,
        sum:   +sum.toFixed(2),
    };
}

function catStats(values, topN = 8) {
    const freq = {};
    let nullCount = 0;
    for (const v of values) {
        if (v === null || v === undefined || v === '') { nullCount++; continue; }
        const k = String(v);
        freq[k] = (freq[k] || 0) + 1;
    }
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    return {
        uniqueCount: sorted.length,
        nullCount,
        top: sorted.slice(0, topN).map(([v, c]) => ({ value: v, count: c, pct: +(c / values.length * 100).toFixed(1) })),
    };
}

function detectColType(values) {
    const sample = values.filter(v => v !== null && v !== undefined && v !== '').slice(0, 100);
    if (sample.length === 0) return 'empty';
    const numCount = sample.filter(v => !isNaN(Number(v))).length;
    if (numCount / sample.length > 0.8) return 'numeric';
    const datePattern = /^\d{4}[-/]\d{2}[-/]\d{2}/;
    const dateCount = sample.filter(v => datePattern.test(String(v))).length;
    if (dateCount / sample.length > 0.7) return 'datetime';
    return 'categorical';
}

// ── Excel 分析 ────────────────────────────────────────────────────────────────

function analyzeExcel(filePath) {
    const stat = fs.statSync(filePath);
    const wb   = XLSX.readFile(filePath);
    const ts   = new Date().toLocaleString('zh-CN');

    printHeader(`EDA 报告：${path.basename(filePath)}`);
    console.log(`生成时间  : ${ts}`);
    console.log(`完整路径  : ${path.resolve(filePath)}`);
    console.log(`文件大小  : ${humanSize(stat.size)} (${stat.size.toLocaleString()} bytes)`);
    console.log(`最后修改  : ${stat.mtime.toLocaleString('zh-CN')}`);
    console.log(`Sheet 数量: ${wb.SheetNames.length}`);
    console.log(`Sheet 列表: ${wb.SheetNames.join(' / ')}`);

    for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        // 美团 Excel：前2行为标题/筛选，row3起是数据
        const raw   = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
        const isMetuan = raw.length > 2 && raw[2] && typeof raw[2][0] === 'string' && raw[2].length > 3;
        const startRow = isMetuan ? 2 : 0;
        const rows = XLSX.utils.sheet_to_json(ws, { range: startRow, defval: null });

        printSection(`Sheet: ${sheetName}`);
        console.log(`  总行数（含标题外）: ${fmt(raw.length - startRow - 1)} 行数据`);

        if (rows.length === 0) { console.log('  ⚠️  无有效数据'); continue; }

        const cols = Object.keys(rows[0]);
        console.log(`  列数: ${cols.length}`);

        // 过滤合计行
        const dataRows = rows.filter(r => {
            const first = String(r[cols[0]] || '');
            return first !== '合计' && first !== '--';
        });
        const skipped = rows.length - dataRows.length;
        if (skipped > 0) console.log(`  过滤合计/空行: ${skipped} 行，有效数据: ${dataRows.length} 行`);

        // 样本数据
        printSection('  前3行样本');
        dataRows.slice(0, 3).forEach((row, i) => {
            const preview = cols.slice(0, 6).map(c => `${c}=${row[c]}`).join(' | ');
            console.log(`  行${i+1}: ${preview}${cols.length > 6 ? ' ...' : ''}`);
        });

        // 列类型检测
        printSection('  字段分析');
        const colTypes = {};
        for (const col of cols) {
            const vals = dataRows.map(r => r[col]);
            const type = detectColType(vals);
            colTypes[col] = type;
        }

        // 数值列统计
        const numCols = cols.filter(c => colTypes[c] === 'numeric');
        if (numCols.length > 0) {
            printSection('  数值字段统计');
            console.log(`  ${padR('字段', 22)} ${padL('行数', 7)} ${padL('最小值', 12)} ${padL('最大值', 12)} ${padL('均值', 12)} ${padL('合计', 14)}`);
            console.log('  ' + '-'.repeat(85));
            for (const col of numCols) {
                const vals = dataRows.map(r => r[col]);
                const s = numStats(vals);
                if (!s) continue;
                console.log(`  ${padR(col.substring(0, 20), 22)} ${padL(fmt(s.count), 7)} ${padL(fmt(s.min), 12)} ${padL(fmt(s.max), 12)} ${padL(fmt(s.mean), 12)} ${padL(fmt(s.sum), 14)}`);
            }
        }

        // 分类列统计（Top 值）
        const catCols = cols.filter(c => colTypes[c] === 'categorical');
        if (catCols.length > 0) {
            printSection('  分类字段 Top 值');
            for (const col of catCols.slice(0, 8)) {
                const vals = dataRows.map(r => r[col]);
                const s = catStats(vals, 5);
                const topStr = s.top.map(t => `${t.value}(${t.count})`).join(' | ');
                console.log(`  ${padR(col.substring(0, 18), 20)} 唯一值:${padL(s.uniqueCount, 5)}  Top: ${topStr}`);
            }
        }

        // 日期列
        const dateCols = cols.filter(c => colTypes[c] === 'datetime');
        if (dateCols.length > 0) {
            printSection('  日期字段范围');
            for (const col of dateCols) {
                const vals = dataRows.map(r => r[col]).filter(v => v).map(String).sort();
                if (vals.length > 0)
                    console.log(`  ${padR(col, 20)} ${vals[0]} → ${vals[vals.length - 1]}（${vals.length} 条）`);
            }
        }

        // 缺失值统计
        const missCols = cols.map(c => {
            const nullCnt = dataRows.filter(r => r[c] === null || r[c] === undefined || r[c] === '').length;
            return { col: c, nullCnt, pct: +(nullCnt / dataRows.length * 100).toFixed(1) };
        }).filter(x => x.nullCnt > 0).sort((a, b) => b.nullCnt - a.nullCnt);

        if (missCols.length > 0) {
            printSection('  缺失值');
            missCols.slice(0, 8).forEach(({ col, nullCnt, pct }) => {
                console.log(`  ${padR(col.substring(0, 20), 22)} ${padL(nullCnt, 7)} 条  (${pct}%)`);
            });
        } else {
            console.log('\n  ✅ 无缺失值');
        }
    }

    printSection('关键发现 & 建议');
    console.log('  1. 前2行为美团报表标题/筛选条件，解析时使用 range:2 跳过');
    console.log('  2. 末尾"合计"行需过滤，避免重复统计');
    console.log('  3. 数值列无"元"后缀（如"订单金额"非"订单金额（元）"）');
    console.log('  4. 建议将数据导入 SQLite 后通过 API 查询分析');
}

// ── SQLite 分析 ───────────────────────────────────────────────────────────────

async function dbQuery(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
}

async function analyzeDB(dbPath, targetTable = null) {
    const stat = fs.statSync(dbPath);
    const db   = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
    const ts   = new Date().toLocaleString('zh-CN');

    printHeader(`EDA 报告：${path.basename(dbPath)}`);
    console.log(`生成时间  : ${ts}`);
    console.log(`完整路径  : ${path.resolve(dbPath)}`);
    console.log(`文件大小  : ${humanSize(stat.size)} (${stat.size.toLocaleString()} bytes)`);
    console.log(`最后修改  : ${stat.mtime.toLocaleString('zh-CN')}`);

    // 获取所有表
    const tables = await dbQuery(db, `SELECT name, type FROM sqlite_master WHERE type='table' ORDER BY name`);
    console.log(`\n表数量    : ${tables.length}`);

    const targetTables = targetTable
        ? tables.filter(t => t.name === targetTable)
        : tables;

    if (targetTable && targetTables.length === 0) {
        console.log(`\n❌ 表 "${targetTable}" 不存在。可用表：${tables.map(t => t.name).join(', ')}`);
        db.close();
        return;
    }

    // 各表行数概览
    printSection('表概览');
    for (const t of tables) {
        const r = await dbQuery(db, `SELECT COUNT(*) AS cnt FROM "${t.name}"`);
        const cnt = r[0]?.cnt || 0;
        const marker = targetTable === t.name ? ' ◀ 当前分析' : '';
        console.log(`  ${padR(t.name, 28)} ${padL(fmt(cnt), 10)} 行${marker}`);
    }

    // 逐表分析
    for (const t of targetTables) {
        printHeader(`表分析：${t.name}`);

        // Schema
        const cols = await dbQuery(db, `PRAGMA table_info("${t.name}")`);
        printSection('字段结构');
        console.log(`  ${padR('字段名', 28)} ${padR('类型', 12)} ${padR('NotNull', 8)} ${padR('默认值', 12)}`);
        console.log('  ' + '-'.repeat(65));
        cols.forEach(c => {
            console.log(`  ${padR(c.name, 28)} ${padR(c.type || '', 12)} ${padR(c.notnull ? 'YES' : 'NO', 8)} ${padR(String(c.dflt_value ?? ''), 12)}`);
        });

        // 行数
        const totalR = await dbQuery(db, `SELECT COUNT(*) AS cnt FROM "${t.name}"`);
        const total = totalR[0]?.cnt || 0;
        console.log(`\n  总行数: ${fmt(total)}`);

        if (total === 0) { console.log('  ⚠️  空表，无数据'); continue; }

        // 样本数据
        const sample = await dbQuery(db, `SELECT * FROM "${t.name}" LIMIT 3`);
        printSection('前3行样本');
        sample.forEach((row, i) => {
            const preview = Object.entries(row).slice(0, 5).map(([k, v]) => `${k}=${v}`).join(' | ');
            console.log(`  行${i + 1}: ${preview}${Object.keys(row).length > 5 ? ' ...' : ''}`);
        });

        // 数值列统计（自动检测 REAL/INTEGER）
        const numColNames = cols.filter(c => /REAL|INT|FLOAT|NUM|DEC/i.test(c.type)).map(c => c.name);
        if (numColNames.length > 0) {
            printSection('数值字段统计');
            console.log(`  ${padR('字段', 22)} ${padL('行数', 7)} ${padL('最小值', 12)} ${padL('最大值', 12)} ${padL('均值', 12)} ${padL('合计', 14)}`);
            console.log('  ' + '-'.repeat(85));
            for (const col of numColNames) {
                const r = await dbQuery(db,
                    `SELECT COUNT("${col}") AS cnt, MIN("${col}") AS min, MAX("${col}") AS max,
                            AVG("${col}") AS avg, SUM("${col}") AS sum
                     FROM "${t.name}" WHERE "${col}" IS NOT NULL`
                );
                const s = r[0];
                if (!s || !s.cnt) continue;
                console.log(`  ${padR(col.substring(0, 20), 22)} ${padL(fmt(s.cnt), 7)} ${padL(fmt(s.min), 12)} ${padL(fmt(s.max), 12)} ${padL(fmt(+(s.avg || 0).toFixed(2)), 12)} ${padL(fmt(+(s.sum || 0).toFixed(2)), 14)}`);
            }
        }

        // 分类列 Top 值（TEXT 类型，低唯一值）
        const textColNames = cols.filter(c => /TEXT|CHAR|CLOB/i.test(c.type)).map(c => c.name);
        const catPrintCols = [];
        for (const col of textColNames.slice(0, 12)) {
            const r = await dbQuery(db, `SELECT COUNT(DISTINCT "${col}") AS uniq FROM "${t.name}"`);
            const uniq = r[0]?.uniq || 0;
            if (uniq > 0 && uniq <= 30) catPrintCols.push({ col, uniq });
        }
        if (catPrintCols.length > 0) {
            printSection('分类字段 Top 值');
            for (const { col, uniq } of catPrintCols.slice(0, 8)) {
                const topRows = await dbQuery(db,
                    `SELECT "${col}" AS val, COUNT(*) AS cnt FROM "${t.name}"
                     WHERE "${col}" IS NOT NULL GROUP BY "${col}" ORDER BY cnt DESC LIMIT 5`
                );
                const topStr = topRows.map(r => `${r.val}(${r.cnt})`).join(' | ');
                console.log(`  ${padR(col.substring(0, 20), 22)} 唯一值:${padL(uniq, 4)}  ${topStr}`);
            }
        }

        // 日期范围（含"date"/"month"/"time"的列）
        const dateCols = cols.filter(c => /date|month|time|日期|月份/i.test(c.name)).map(c => c.name);
        if (dateCols.length > 0) {
            printSection('日期/时间范围');
            for (const col of dateCols) {
                const r = await dbQuery(db,
                    `SELECT MIN("${col}") AS min, MAX("${col}") AS max, COUNT(DISTINCT "${col}") AS uniq
                     FROM "${t.name}" WHERE "${col}" IS NOT NULL AND "${col}" != ''`
                );
                const s = r[0];
                if (s && s.min) {
                    console.log(`  ${padR(col, 22)} ${s.min} → ${s.max}（${s.uniq} 个唯一值）`);
                }
            }
        }

        // 缺失值
        const nullStats = [];
        for (const c of cols) {
            const r = await dbQuery(db,
                `SELECT COUNT(*) AS null_cnt FROM "${t.name}"
                 WHERE "${c.name}" IS NULL OR "${c.name}" = ''`
            );
            const cnt = r[0]?.null_cnt || 0;
            if (cnt > 0) nullStats.push({ col: c.name, cnt, pct: +(cnt / total * 100).toFixed(1) });
        }
        if (nullStats.length > 0) {
            printSection('缺失值');
            nullStats.sort((a, b) => b.cnt - a.cnt).slice(0, 10).forEach(({ col, cnt, pct }) => {
                console.log(`  ${padR(col.substring(0, 22), 24)} ${padL(fmt(cnt), 8)} 条  (${pct}%)`);
            });
        } else {
            console.log('\n  ✅ 无缺失值');
        }
    }

    // 全库关键指标（仅全库分析时）
    if (!targetTable && tables.some(t => t.name === 'orders')) {
        printSection('业务关键指标');
        try {
            const kpi = await dbQuery(db, `
                SELECT COUNT(DISTINCT store_id) AS stores,
                       COUNT(*) AS orders,
                       COUNT(DISTINCT business_date) AS days,
                       COUNT(DISTINCT order_month) AS months,
                       ROUND(SUM(order_amount), 2) AS total_amount,
                       ROUND(AVG(order_amount), 2) AS avg_order,
                       ROUND(SUM(order_discount), 2) AS total_discount
                FROM orders`);
            const k = kpi[0];
            if (k) {
                console.log(`  门店数: ${k.stores}   |  订单数: ${fmt(k.orders)}   |  覆盖天数: ${k.days}   |  覆盖月份: ${k.months}`);
                console.log(`  总营业额: ¥${fmt(k.total_amount)}   |  客单价: ¥${fmt(k.avg_order)}   |  总优惠额: ¥${fmt(k.total_discount)}`);
            }
            const channels = await dbQuery(db,
                `SELECT channel, COUNT(*) AS cnt, ROUND(SUM(order_amount),2) AS amt
                 FROM orders GROUP BY channel ORDER BY amt DESC`);
            if (channels.length > 0) {
                console.log('\n  渠道分布：');
                channels.forEach(r => console.log(`    ${padR(r.channel || '(空)', 15)} ${padL(fmt(r.cnt), 8)} 单 / ¥${fmt(r.amt)}`));
            }
            const stores = await dbQuery(db,
                `SELECT s.store_name, ROUND(SUM(o.order_amount),2) AS amt
                 FROM orders o JOIN stores s ON o.store_id = s.store_id
                 GROUP BY o.store_id ORDER BY amt DESC`);
            if (stores.length > 0) {
                console.log('\n  门店营业额排名：');
                stores.forEach((r, i) => console.log(`    ${i+1}. ${padR(r.store_name, 22)} ¥${fmt(r.amt)}`));
            }
        } catch (e) { /* 跳过 */ }
    }

    db.close();
    console.log('\n' + '═'.repeat(60));
    console.log('  ✅ 分析报告生成完成');
    console.log('═'.repeat(60));
}

// ── 主入口 ────────────────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args[0] === '--help') {
        console.log('用法:');
        console.log('  node scripts/analyze_data.js <Excel文件路径>');
        console.log('  node scripts/analyze_data.js <SQLite数据库路径>');
        console.log('  node scripts/analyze_data.js <SQLite数据库路径> <表名>');
        console.log('  node scripts/analyze_data.js --all   (分析 data/meituan.db 全库)');
        console.log('\n示例:');
        console.log('  node scripts/analyze_data.js downloads/菜品销售明细/菜品销售明细_2025-01-01_2025-01-02.xlsx');
        console.log('  node scripts/analyze_data.js data/meituan.db');
        console.log('  node scripts/analyze_data.js data/meituan.db orders');
        process.exit(0);
    }

    let filePath = args[0];
    const tableArg = args[1] || null;

    // --all 快捷方式
    if (filePath === '--all') {
        filePath = 'data/meituan.db';
    }

    if (!fs.existsSync(filePath)) {
        console.error(`❌ 文件不存在: ${filePath}`);
        process.exit(1);
    }

    const ext = path.extname(filePath).toLowerCase();

    try {
        if (ext === '.xlsx' || ext === '.xls') {
            analyzeExcel(filePath);
        } else if (ext === '.db' || ext === '.sqlite' || ext === '.sqlite3') {
            await analyzeDB(filePath, tableArg);
        } else {
            console.error(`❌ 不支持的文件格式: ${ext}（支持 .xlsx / .db）`);
            process.exit(1);
        }
    } catch (e) {
        console.error(`❌ 分析失败: ${e.message}`);
        process.exit(1);
    }
}

main();
