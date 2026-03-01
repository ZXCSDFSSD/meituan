/**
 * 数据库模块
 * SQLite 连接、建表、增删查改
 *
 * 表结构版本 v3（2026-02）：
 *   v2: stores / orders / order_dishes / order_payments / sales_summary /
 *       monthly_summary / item_sales_summary / payment_method_summary
 *   v3 新增/变更：
 *     - stores 新增 location_type / has_partner 字段
 *     - order_dishes 新增 dish_ordered_time / dish_sub_category / meal_period / order_source 字段
 *     - 新增 timeslot_summary 表（24小时时段维度）
 *     - 新增 category_mapping 表（品类名称标准化映射）
 */

'use strict';

const sqlite3 = require('sqlite3').verbose();
const path    = require('path');
const fs      = require('fs');
const config  = require('../common/config');

const DB_PATH = config.dbPath;
let db = null;

// ── 初始化 ────────────────────────────────────────────────────────────────────

async function initializeDatabase(log = console.log) {
    return new Promise((resolve, reject) => {
        try {
            const dataDir = path.dirname(DB_PATH);
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

            db = new sqlite3.Database(DB_PATH, async (err) => {
                if (err) { log(`❌ 数据库连接失败: ${err.message}`); return reject(err); }
                log(`✅ 数据库连接成功: ${DB_PATH}`);
                try {
                    await createTables(log);
                    await migrateDatabase(log);
                    await seedStores(log);
                    // 延迟加载避免循环依赖
                    const { seedCategoryMapping } = require('./category_seed');
                    await seedCategoryMapping(log);
                    resolve();
                } catch (e) { reject(e); }
            });
        } catch (e) {
            log(`❌ 初始化数据库失败: ${e.message}`);
            reject(e);
        }
    });
}

// ── 建表 ──────────────────────────────────────────────────────────────────────

async function createTables(log = console.log) {
    return new Promise((resolve, reject) => {
        db.run('PRAGMA foreign_keys = ON');

        const tables = [

            // ── 门店基础信息
            `CREATE TABLE IF NOT EXISTS stores (
                store_id      TEXT PRIMARY KEY,
                store_name    TEXT NOT NULL UNIQUE,
                city          TEXT,
                province      TEXT,
                location_type TEXT,
                has_partner   INTEGER DEFAULT 0,
                created_at    TEXT DEFAULT CURRENT_TIMESTAMP
            )`,

            // ── 全渠道订单明细
            `CREATE TABLE IF NOT EXISTS orders (
                order_id          TEXT PRIMARY KEY,
                store_name        TEXT NOT NULL,
                store_id          TEXT,
                business_date     TEXT,
                order_month       TEXT,
                meal_period       TEXT,
                orig_order_no     TEXT,
                delivery_order_no TEXT,
                flow_no           TEXT,
                meal_number       TEXT,
                table_number      TEXT,
                table_area        TEXT,
                order_amount      REAL    DEFAULT 0,
                customer_paid     REAL    DEFAULT 0,
                order_income      REAL    DEFAULT 0,
                order_discount    REAL    DEFAULT 0,
                channel           TEXT,
                sub_channel       TEXT,
                business_mode     TEXT,
                dining_type       TEXT,
                order_status      TEXT,
                is_refund         TEXT,
                guest_count       INTEGER DEFAULT 0,
                is_member         TEXT,
                dish_amount       REAL    DEFAULT 0,
                dish_income       REAL    DEFAULT 0,
                created_time      TEXT,
                completed_time    TEXT,
                reserved_time     TEXT,
                checkout_method   TEXT,
                remark            TEXT,
                created_at        TEXT DEFAULT CURRENT_TIMESTAMP
            )`,

            // ── 菜品销售明细（品项级别，来自"菜品销售明细"报表）
            `CREATE TABLE IF NOT EXISTS order_dishes (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id            TEXT NOT NULL,
                store_id            TEXT,
                store_name          TEXT NOT NULL,
                business_date       TEXT,
                dish_code           TEXT,
                dish_name           TEXT NOT NULL,
                dish_category       TEXT,
                dish_sub_category   TEXT,
                dish_type           TEXT,
                spec                TEXT,
                unit                TEXT,
                sale_type           TEXT,
                quantity            REAL    DEFAULT 0,
                gift_quantity       REAL    DEFAULT 0,
                amount              REAL    DEFAULT 0,
                gift_amount         REAL    DEFAULT 0,
                discount            REAL    DEFAULT 0,
                income              REAL    DEFAULT 0,
                dish_ordered_time   TEXT,
                meal_period         TEXT,
                order_source        TEXT,
                channel             TEXT
            )`,

            // ── 收款明细
            `CREATE TABLE IF NOT EXISTS order_payments (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id         TEXT,
                store_name       TEXT NOT NULL,
                store_id         TEXT,
                business_date    TEXT,
                biz_type         TEXT,
                biz_sub_type     TEXT,
                payment_method   TEXT,
                payment_status   TEXT,
                payment_time     TEXT,
                payment_date     TEXT,
                payment_amount   REAL DEFAULT 0,
                payment_discount REAL DEFAULT 0,
                received_amount  REAL DEFAULT 0,
                handling_fee     REAL DEFAULT 0,
                promo_cost       REAL DEFAULT 0,
                net_amount       REAL DEFAULT 0,
                order_status     TEXT,
                cashier          TEXT
            )`,

            // ── 日度营业统计
            `CREATE TABLE IF NOT EXISTS sales_summary (
                id               TEXT PRIMARY KEY,
                store_id         TEXT NOT NULL,
                store_name       TEXT NOT NULL,
                date             TEXT NOT NULL,
                month            TEXT NOT NULL,
                channel          TEXT NOT NULL DEFAULT 'all',
                total_amount     REAL    DEFAULT 0,
                total_income     REAL    DEFAULT 0,
                total_discount   REAL    DEFAULT 0,
                discount_ratio   REAL    DEFAULT 0,
                order_count      INTEGER DEFAULT 0,
                avg_order_amount REAL    DEFAULT 0,
                created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at       TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(store_id, date, channel)
            )`,

            // ── 月度营业统计
            `CREATE TABLE IF NOT EXISTS monthly_summary (
                id               TEXT PRIMARY KEY,
                store_id         TEXT NOT NULL,
                store_name       TEXT NOT NULL,
                month            TEXT NOT NULL,
                channel          TEXT NOT NULL DEFAULT 'all',
                total_amount     REAL    DEFAULT 0,
                total_income     REAL    DEFAULT 0,
                total_discount   REAL    DEFAULT 0,
                discount_ratio   REAL    DEFAULT 0,
                order_count      INTEGER DEFAULT 0,
                avg_order_amount REAL    DEFAULT 0,
                created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at       TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(store_id, month, channel)
            )`,

            // ── 菜品销售统计
            `CREATE TABLE IF NOT EXISTS item_sales_summary (
                id                 TEXT PRIMARY KEY,
                store_id           TEXT NOT NULL,
                store_name         TEXT NOT NULL,
                item_id            TEXT NOT NULL,
                item_name          TEXT NOT NULL,
                category           TEXT,
                date               TEXT NOT NULL,
                month              TEXT NOT NULL,
                total_quantity     REAL    DEFAULT 0,
                total_amount       REAL    DEFAULT 0,
                total_discount     REAL    DEFAULT 0,
                total_income       REAL    DEFAULT 0,
                order_count        INTEGER DEFAULT 0,
                contribution_ratio REAL    DEFAULT 0,
                created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at         TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(store_id, item_id, date)
            )`,

            // ── 收款方式汇总
            `CREATE TABLE IF NOT EXISTS payment_method_summary (
                id              TEXT PRIMARY KEY,
                store_name      TEXT NOT NULL,
                store_id        TEXT,
                date            TEXT NOT NULL,
                month           TEXT NOT NULL,
                biz_sub_type    TEXT,
                payment_method  TEXT NOT NULL,
                total_amount    REAL    DEFAULT 0,
                total_discount  REAL    DEFAULT 0,
                total_income    REAL    DEFAULT 0,
                handling_fee    REAL    DEFAULT 0,
                payment_count   INTEGER DEFAULT 0,
                created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at      TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(store_name, date, payment_method, biz_sub_type)
            )`,

            // ── 时段营业统计（按门店+日期+小时+渠道聚合，来自品项明细点菜时间）
            //    hour: 0~23（24个时段，每小时一段）
            `CREATE TABLE IF NOT EXISTS timeslot_summary (
                id           TEXT PRIMARY KEY,
                store_id     TEXT NOT NULL,
                store_name   TEXT NOT NULL,
                date         TEXT NOT NULL,
                month        TEXT NOT NULL,
                hour         INTEGER NOT NULL,
                channel      TEXT NOT NULL DEFAULT 'all',
                tc           INTEGER DEFAULT 0,
                total_amount REAL    DEFAULT 0,
                total_income REAL    DEFAULT 0,
                created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at   TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(store_id, date, hour, channel)
            )`,

            // ── 品类名称标准化映射
            //    raw_name:      Excel 中各门店的原始品类名（可能不统一）
            //    standard_name: 标准化后的统一名称
            //    store_id:      NULL = 全局映射；非NULL = 特定门店覆盖
            `CREATE TABLE IF NOT EXISTS category_mapping (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                raw_name      TEXT NOT NULL,
                standard_name TEXT NOT NULL,
                store_id      TEXT,
                created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(raw_name, store_id)
            )`
        ];

        let done = 0;
        tables.forEach(sql => {
            db.run(sql, (err) => {
                if (err) log(`⚠️  建表失败: ${err.message}`);
                if (++done === tables.length) {
                    log('✅ 数据表创建完成');
                    resolve();
                }
            });
        });
    });
}

// ── 数据库升级（已存在的旧库执行 ALTER TABLE）────────────────────────────────

async function migrateDatabase(log = console.log) {
    // 每条 ALTER 语句：失败时忽略（列已存在则 SQLite 返回 error，直接跳过）
    const alterMigrations = [
        // stores v3 新字段
        `ALTER TABLE stores ADD COLUMN location_type TEXT`,
        `ALTER TABLE stores ADD COLUMN has_partner   INTEGER DEFAULT 0`,
        // stores v4 新字段（店型 + 开业日期）
        `ALTER TABLE stores ADD COLUMN store_type TEXT`,
        `ALTER TABLE stores ADD COLUMN open_date  TEXT`,
        // order_dishes v3 新字段
        `ALTER TABLE order_dishes ADD COLUMN dish_sub_category TEXT`,
        `ALTER TABLE order_dishes ADD COLUMN dish_ordered_time TEXT`,
        `ALTER TABLE order_dishes ADD COLUMN meal_period        TEXT`,
        `ALTER TABLE order_dishes ADD COLUMN order_source       TEXT`,
    ];

    for (const sql of alterMigrations) {
        try { await run(sql); } catch (_) { /* 列已存在，跳过 */ }
    }

    // ── 性能索引（幂等）
    const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_monthly_month_channel
         ON monthly_summary(month, channel)`,
        `CREATE INDEX IF NOT EXISTS idx_item_sales_month_store
         ON item_sales_summary(month, store_id)`,
        `CREATE INDEX IF NOT EXISTS idx_timeslot_month_store_channel
         ON timeslot_summary(month, store_id, channel)`,
        `CREATE INDEX IF NOT EXISTS idx_order_dishes_date_store
         ON order_dishes(business_date, store_id)`,
    ];

    for (const sql of indexes) {
        try { await run(sql); } catch (e) { log(`⚠️  创建索引失败: ${e.message}`); }
    }

    // ── 分析视图（DROP + CREATE，保证结构最新）
    const views = [
        // 年度营业额同比视图（对应 Sheet1/Sheet2）
        {
            drop:   `DROP VIEW IF EXISTS v_annual_yoy`,
            create: `CREATE VIEW v_annual_yoy AS
                     SELECT
                         cur.store_id,
                         cur.store_name,
                         cur.channel,
                         substr(cur.month, 1, 4)          AS year,
                         cast(substr(cur.month, 6, 2) AS INTEGER) AS mon,
                         cur.month,
                         cur.total_amount,
                         cur.order_count,
                         cur.avg_order_amount,
                         prev.total_amount                AS prev_year_amount,
                         prev.order_count                 AS prev_year_tc,
                         prev.avg_order_amount            AS prev_year_ac,
                         CASE WHEN prev.total_amount > 0
                              THEN ROUND((cur.total_amount - prev.total_amount)
                                         / prev.total_amount * 100, 1)
                              ELSE NULL END                AS yoy_pct
                     FROM monthly_summary cur
                     LEFT JOIN monthly_summary prev
                         ON  prev.store_id = cur.store_id
                         AND prev.channel  = cur.channel
                         AND prev.month    = (substr(cur.month,1,4) - 1)
                                             || substr(cur.month,5)`,
        },
        // 品类月度透视视图（对应 Sheet6）
        {
            drop:   `DROP VIEW IF EXISTS v_category_monthly`,
            create: `CREATE VIEW v_category_monthly AS
                     SELECT
                         iss.store_id,
                         iss.store_name,
                         iss.month,
                         COALESCE(cm.standard_name, iss.category) AS category,
                         SUM(iss.total_quantity) AS total_quantity,
                         SUM(iss.total_amount)   AS total_amount,
                         SUM(iss.total_income)   AS total_income,
                         SUM(iss.order_count)    AS order_count
                     FROM item_sales_summary iss
                     LEFT JOIN category_mapping cm
                         ON cm.raw_name = iss.category
                        AND cm.store_id IS NULL
                     WHERE iss.category IS NOT NULL
                       AND iss.category != ''
                     GROUP BY iss.store_id, iss.store_name, iss.month,
                              COALESCE(cm.standard_name, iss.category)`,
        },
    ];

    for (const { drop, create } of views) {
        try { await run(drop); await run(create); } catch (e) { log(`⚠️  创建视图失败: ${e.message}`); }
    }

    log('✅ 数据库迁移完成（索引 + 视图 + 字段）');
}

// ── 预置门店数据（idempotent）────────────────────────────────────────────────

// store_id 以 Excel 实际导入数据为准（菜品销售明细的机构编码字段）
// 已知的 6 家老店 ID 来自实际样本数据，新店 ID 待首次导入后自动写入
const STORE_SEED = [
    { store_id: 'MD00001', store_name: '常青麦香园常青十一小区店', city: '武汉市', province: '湖北省', location_type: '社区',   has_partner: 0, store_type: '老店', open_date: null },
    { store_id: 'MD00005', store_name: '常青麦香园步行街店',       city: '武汉市', province: '湖北省', location_type: '商圈',   has_partner: 0, store_type: '老店', open_date: null },
    { store_id: 'MD00006', store_name: '常青麦香园工厂店',         city: '武汉市', province: '湖北省', location_type: '写字楼', has_partner: 0, store_type: '老店', open_date: null },
    { store_id: 'MD00007', store_name: '常青麦香园新华路店',       city: '武汉市', province: '湖北省', location_type: '社区',   has_partner: 1, store_type: '老店', open_date: null },
    { store_id: 'MD00008', store_name: '常青麦香园光谷华科店',     city: '武汉市', province: '湖北省', location_type: '商圈',   has_partner: 1, store_type: '老店', open_date: null },
    { store_id: 'MD00012', store_name: '常青麦香园蔡甸中百店',     city: '武汉市', province: '湖北省', location_type: '商圈',   has_partner: 1, store_type: '新店', open_date: '2025-01' },
    { store_id: 'MD00017', store_name: '常青麦香园铁机盛世家园店', city: '武汉市', province: '湖北省', location_type: '社区',   has_partner: 0, store_type: '新店', open_date: '2025-02' },
    // 东辉花园 的 store_id 待实际导入后自动写入
];

async function seedStores(log = console.log) {
    for (const s of STORE_SEED) {
        await run(
            `INSERT INTO stores (store_id, store_name, city, province, location_type, has_partner, store_type, open_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(store_id) DO UPDATE SET
               location_type = excluded.location_type,
               has_partner   = excluded.has_partner,
               store_type    = excluded.store_type,
               open_date     = excluded.open_date`,
            [s.store_id, s.store_name, s.city, s.province, s.location_type, s.has_partner, s.store_type, s.open_date]
        );
    }
    log(`✅ 门店预置数据写入完成（${STORE_SEED.length} 家）`);
}

// ── 操作接口 ──────────────────────────────────────────────────────────────────

function query(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
}

function queryOne(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null));
    });
}

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

async function transaction(callback) {
    try {
        await run('BEGIN TRANSACTION');
        await callback();
        await run('COMMIT');
    } catch (e) {
        await run('ROLLBACK');
        throw e;
    }
}

function closeDatabase() {
    return new Promise((resolve, reject) => {
        if (db) {
            db.close(err => err ? reject(err) : resolve());
        } else {
            resolve();
        }
    });
}

module.exports = {
    initializeDatabase, createTables, migrateDatabase, seedStores,
    query, queryOne, run, transaction, closeDatabase
};
