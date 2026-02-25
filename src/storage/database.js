/**
 * 数据库模块
 * SQLite 连接、建表、增删查改
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

            db = new sqlite3.Database(DB_PATH, (err) => {
                if (err) { log(`❌ 数据库连接失败: ${err.message}`); return reject(err); }
                log(`✅ 数据库连接成功: ${DB_PATH}`);
                createTables(log).then(resolve).catch(reject);
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
            // 订单明细
            `CREATE TABLE IF NOT EXISTS orders (
                order_id        TEXT PRIMARY KEY,
                store_id        TEXT NOT NULL,
                store_name      TEXT NOT NULL,
                business_date   TEXT,
                order_month     TEXT,
                order_mode      TEXT,
                order_source    TEXT,
                dining_type     TEXT,
                order_time      TEXT,
                checkout_time   TEXT,
                refund_time     TEXT,
                meal_number     TEXT,
                table_number    TEXT,
                channel_flow_no TEXT,
                table_area      TEXT,
                guest_count     INTEGER DEFAULT 0,
                order_amount    REAL    DEFAULT 0,
                customer_payable REAL   DEFAULT 0,
                payment_total   REAL    DEFAULT 0,
                order_discount  REAL    DEFAULT 0,
                order_income    REAL    DEFAULT 0,
                checkout_method TEXT,
                order_status    TEXT,
                refund_flag     TEXT,
                dish_income     REAL    DEFAULT 0,
                reserved_time   TEXT,
                member          TEXT,
                remark          TEXT,
                created_at      TEXT DEFAULT CURRENT_TIMESTAMP
            )`,

            // 菜品明细
            `CREATE TABLE IF NOT EXISTS order_dishes (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id     TEXT NOT NULL,
                store_id     TEXT NOT NULL,
                store_name   TEXT NOT NULL,
                meal_number  TEXT,
                table_number TEXT,
                dish_code    TEXT,
                dish_name    TEXT NOT NULL,
                spec         TEXT,
                method       TEXT,
                topping      TEXT,
                quantity     INTEGER DEFAULT 0,
                unit         TEXT,
                amount       REAL    DEFAULT 0,
                discount     REAL    DEFAULT 0,
                income       REAL    DEFAULT 0,
                remark       TEXT,
                FOREIGN KEY (order_id) REFERENCES orders(order_id)
            )`,

            // 支付明细
            `CREATE TABLE IF NOT EXISTS order_payments (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id         TEXT NOT NULL,
                store_id         TEXT NOT NULL,
                store_name       TEXT NOT NULL,
                payment_method   TEXT,
                payment_amount   REAL DEFAULT 0,
                payment_discount REAL DEFAULT 0,
                income           REAL DEFAULT 0,
                payment_time     TEXT,
                is_refund        TEXT,
                status           TEXT,
                operator         TEXT,
                merchant_no      TEXT,
                flow_no          TEXT,
                FOREIGN KEY (order_id) REFERENCES orders(order_id)
            )`,

            // 日度营业统计
            `CREATE TABLE IF NOT EXISTS sales_summary (
                id               TEXT PRIMARY KEY,
                store_id         TEXT NOT NULL,
                store_name       TEXT NOT NULL,
                date             TEXT NOT NULL,
                month            TEXT NOT NULL,
                total_revenue    REAL DEFAULT 0,
                total_sales      REAL DEFAULT 0,
                total_discount   REAL DEFAULT 0,
                discount_ratio   REAL DEFAULT 0,
                order_count      INTEGER DEFAULT 0,
                avg_order_amount REAL DEFAULT 0,
                created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at       TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(store_id, date)
            )`,

            // 菜品销售统计
            `CREATE TABLE IF NOT EXISTS item_sales_summary (
                id                 TEXT PRIMARY KEY,
                store_id           TEXT NOT NULL,
                store_name         TEXT NOT NULL,
                item_id            TEXT NOT NULL,
                item_name          TEXT NOT NULL,
                category           TEXT,
                date               TEXT NOT NULL,
                month              TEXT NOT NULL,
                total_quantity     INTEGER DEFAULT 0,
                total_amount       REAL DEFAULT 0,
                total_discount     REAL DEFAULT 0,
                order_count        INTEGER DEFAULT 0,
                contribution_ratio REAL DEFAULT 0,
                created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at         TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(store_id, item_id, date)
            )`,

            // 月度统计
            `CREATE TABLE IF NOT EXISTS monthly_summary (
                id               TEXT PRIMARY KEY,
                store_id         TEXT NOT NULL,
                store_name       TEXT NOT NULL,
                month            TEXT NOT NULL,
                total_revenue    REAL DEFAULT 0,
                total_sales      REAL DEFAULT 0,
                total_discount   REAL DEFAULT 0,
                discount_ratio   REAL DEFAULT 0,
                order_count      INTEGER DEFAULT 0,
                avg_order_amount REAL DEFAULT 0,
                created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at       TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(store_id, month)
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

module.exports = { initializeDatabase, createTables, query, queryOne, run, transaction, closeDatabase };
