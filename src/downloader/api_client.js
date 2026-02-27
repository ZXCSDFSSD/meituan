/**
 * 美团 BI 查询 API 客户端
 * 通过 Puppeteer page.evaluate + fetch 发请求（自动携带浏览器 Cookie，无需手动处理鉴权）
 */

'use strict';

const QUERY_URL = 'https://pos.meituan.com/web/api/v2/bi/runtime/query/graph?yodaReady=h5&csecplatform=4&csecversion=4.2.0';

// poiId → orgId 映射（从 Network 请求中采集到，固定不变）
const POI_ORG_MAP = {
    '601678716': '2817462',
    '601655756': '2795567',
    '601681205': '2731863',
    '601680763': '2778652',
    '601705000': '2853220',
    '601826340': '2970743',
    '601861703': '3635243',
    '601919555': '3732494',
};

// ── 工具函数 ────────────────────────────────────────────────────────────────

/** 日期字符串 → Unix 秒（CST） */
function dateToTs(dateStr, isEnd = false) {
    const d = dateStr.replace(/\//g, '-');
    const suffix = isEnd ? 'T23:59:59+08:00' : 'T00:00:00+08:00';
    return Math.floor(new Date(d + suffix).getTime() / 1000);
}

/** 构建 poiIds 字符串，orgId 和 id 交替排列 */
function buildPoiIdsStr(poiIds) {
    const parts = [];
    for (const id of poiIds) {
        if (POI_ORG_MAP[id]) parts.push(`"${POI_ORG_MAP[id]}"`);
        parts.push(`"${id}"`);
    }
    return `[${parts.join(',')}]`;
}

/** 构建 hs7j 门店条件列表 */
function buildStoreConditions(poiIds) {
    const list = [];
    for (const id of poiIds) {
        if (POI_ORG_MAP[id]) list.push({ type: 'orgId', id: POI_ORG_MAP[id] });
        list.push({ type: 'id', id });
    }
    return list;
}

// ── Payload 构建器（全渠道订单明细）────────────────────────────────────────

function buildChannelOrderPayload(startDate, endDate, poiIds, pageNo = 1, pageSize = 2000) {
    const startTs = dateToTs(startDate, false);
    const endTs   = dateToTs(endDate,   true);
    const poiIdsStr      = buildPoiIdsStr(poiIds);
    const storeConditions = buildStoreConditions(poiIds);

    return {
        modelName: 'queryBizRptTradeOrdDetail',
        modelVersion: 106,
        graphConfig: {
            type: 'simple-table',
            filter: {
                type: 'and',
                filterList: [{
                    type: 'and',
                    isVariable: true,
                    filterList: [{ showName: 'ordType', fieldName: 'ordType', type: 'equals', value: '1' }]
                }]
            },
            dimensionList: [
                { showName: '门店名称',   type: 'simple-dimension', oriFieldName: 'poiName_1721698721375',         fieldName: 'poiName',             sourceFieldName: 'poiName',             originShowName: 'poiName',             extend: null, extendStr: null },
                { showName: '营业日期',   type: 'simple-dimension', oriFieldName: 'stlmntDatekey_1721698733925',    fieldName: 'stlmntDatekey',        sourceFieldName: 'stlmntDatekey',        originShowName: 'stlmntDatekey',        extend: null, extendStr: null },
                { showName: '订单号',     type: 'simple-dimension', oriFieldName: 'orderNo_1721698745832',          fieldName: 'orderNo',              sourceFieldName: 'orderNo',              originShowName: 'orderNo',              extend: null, extendStr: null },
                { showName: '订单金额',   type: 'simple-metric',    oriFieldName: 'orderAmt_1721699131921',         fieldName: 'orderAmt',             sourceFieldName: 'orderAmt',             originShowName: 'orderAmt',             extend: null, extendStr: null, showPattern: '{"type":3,"unit":"","separator":true,"precision":2,"measurement":"individual","sign":false,"isRemoveEndZero":false}' },
                { showName: '顾客实付',   type: 'simple-metric',    oriFieldName: 'payAmt_1722308897994',           fieldName: 'payAmt',               sourceFieldName: 'payAmt',               originShowName: 'payAmt',               extend: null, extendStr: null, showPattern: '{"type":3,"unit":"","separator":true,"precision":2,"measurement":"individual","sign":false,"isRemoveEndZero":false}' },
                { showName: '订单收入',   type: 'simple-metric',    oriFieldName: 'incomeAmt_1721699141248',        fieldName: 'incomeAmt',            sourceFieldName: 'incomeAmt',            originShowName: 'incomeAmt',            extend: null, extendStr: null, showPattern: '{"type":3,"unit":"","separator":true,"precision":2,"measurement":"individual","sign":false,"isRemoveEndZero":false}' },
                { showName: '订单优惠',   type: 'simple-metric',    oriFieldName: 'discountAmt_1722308904218',      fieldName: 'discountAmt',          sourceFieldName: 'discountAmt',          originShowName: 'discountAmt',          extend: null, extendStr: null, showPattern: '{"type":3,"unit":"","separator":true,"precision":2,"measurement":"individual","sign":false,"isRemoveEndZero":false}' },
                { showName: '订单来源',   type: 'simple-dimension', oriFieldName: 'orderSourceName_1721698873040',  fieldName: 'orderSourceName',      sourceFieldName: 'orderSourceName',      originShowName: 'orderSourceName',      extend: null, extendStr: null },
                { showName: '订单状态',   type: 'simple-dimension', oriFieldName: 'orderStatusName_1722410466873',  fieldName: 'orderStatusName',      sourceFieldName: 'orderStatusName',      originShowName: 'orderStatusName',      extend: null, extendStr: null },
                { showName: '退单标识',   type: 'simple-dimension', oriFieldName: 'showStatus_1721698975331',       fieldName: 'showStatus',           sourceFieldName: 'showStatus',           originShowName: 'showStatus',           extend: null, extendStr: null },
                { showName: '用餐人数',   type: 'simple-metric',    oriFieldName: 'customerCount_1721699051678',    fieldName: 'customerCount',        sourceFieldName: 'customerCount',        originShowName: 'customerCount',        extend: null, extendStr: null, showPattern: '{"type":1,"unit":"","separator":true,"precision":2,"measurement":"","sign":false,"isRemoveEndZero":true}' },
                { showName: '菜品金额',   type: 'simple-metric',    oriFieldName: 'skuTotalAmt_1721699104146',      fieldName: 'skuTotalAmt',          sourceFieldName: 'skuTotalAmt',          originShowName: 'skuTotalAmt',          extend: null, extendStr: null, showPattern: '{"type":3,"unit":"","separator":true,"precision":2,"measurement":"individual","sign":false,"isRemoveEndZero":false}' },
                { showName: '菜品收入',   type: 'simple-metric',    oriFieldName: 'skuIncomeAmt_1721699114388',     fieldName: 'skuIncomeAmt',         sourceFieldName: 'skuIncomeAmt',         originShowName: 'skuIncomeAmt',         extend: null, extendStr: null, showPattern: '{"type":3,"unit":"","separator":true,"precision":2,"measurement":"individual","sign":false,"isRemoveEndZero":false}' },
                { showName: '订单Id',     type: 'simple-dimension', oriFieldName: 'orderId_1724033515024',          fieldName: 'orderId',              sourceFieldName: 'orderId',              originShowName: 'orderId',              extend: null, extendStr: null },
            ],
            compareList: [], metricList: [], numericSumDims: [],
            statisticsColumnList: [
                { fieldName: 'skuTotalAmt', type: 1 }, { fieldName: 'skuIncomeAmt', type: 1 },
                { fieldName: 'orderAmt',    type: 1 }, { fieldName: 'incomeAmt',    type: 1 },
                { fieldName: 'payAmt',      type: 1 }, { fieldName: 'discountAmt',  type: 1 },
                { fieldName: 'customerCount', type: 1 },
            ],
            columnGroupDims: [],
            internalFieldList: ['orderId'],
            headerConfig: [],
            sortList: [
                { orderBy: 'stlmntDatekey',    columnType: 'dimension', sortType: 'desc' },
                { orderBy: 'orderTimeForShow', columnType: 'dimension', sortType: 'desc' },
                { orderBy: 'orderNo',          columnType: 'dimension', sortType: 'asc'  },
            ],
            showParentMetric: true, isShowMetric: false, subTotalInfos: [], subtotalDims: [],
            paginateByFirstDim: true, hiddenNullTotalMetrics: [], mergeCell: true,
            needCompareSamePeriod: false,
        },
        globalFilterList: [
            {
                type: 'date',
                fieldName: 'stlmntDatekeyOrigin',
                value: JSON.stringify({ startDate: startTs, endDate: endTs }),
            },
            {
                type: 'in',
                fieldName: 'orderStatusFlag',
                value: '["3","4","5","6","7","8","10"]',
            },
        ],
        variables: [
            { type: 'in', fieldName: 'poiIds', value: poiIdsStr },
        ],
        havingList: [],
        pageNo,
        pageSize,
        maxColumn: 200,
        needTranspose: false,
        metricNullValue: '--',
        dimensionNullValue: '--',
        feQueryTaskConfig: {
            queryConditions: {
                g109: '8dd9f384-2718-4b20-8816-c6415d5c220f',
                '8dd9f384-2718-4b20-8816-c6415d5c220f': { startDate: startTs, endDate: endTs },
                hs7j: storeConditions,
                a2y5: ['3','4','5','6','7','8','10'],
                h40f: 'fbzw',
                fhqd: 'd0f1d9ca-3f02-4621-882a-d58c8a125572',
                '5wv3': '6vjd',
                i5gg: 'e631bc76-0bf1-4f26-bca5-c46e52b429cb',
                queryfromName: 'QueryForm_2',
                tableName: 'DPaasCard_2',
            },
            applyContent: `营业日期【${startDate}-${endDate}】；门店【已选${poiIds.length}个】`,
            reportName: '全渠道订单明细（新版）',
            reportModel: 5,
            targetUrl: 'https://pos.meituan.com/web/report/dpaas-report-channelOrderListV2#/rms-report/dpaas-report-channelOrderListV2',
        },
        supportsAsyncQuery: true,
        appSource: 'standardReport2.0',
    };
}

// ── 核心查询函数 ─────────────────────────────────────────────────────────────

/**
 * 通过 Puppeteer page 发送 API 请求（自动携带 Cookie）
 */
async function fetchPage(page, payload) {
    return await page.evaluate(async (url, body) => {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    }, QUERY_URL, payload);
}

/**
 * 分页拉取全渠道订单明细的所有数据
 * @returns {Array} 所有行数据
 */
async function fetchAllChannelOrders(page, startDate, endDate, poiIds, log = console.log) {
    log(`📡 查询全渠道订单明细: ${startDate} ~ ${endDate}`);

    const PAGE_SIZE = 2000;
    let pageNo = 1;
    let allRows = [];
    let total = null;

    while (true) {
        const payload = buildChannelOrderPayload(startDate, endDate, poiIds, pageNo, PAGE_SIZE);
        log(`   第 ${pageNo} 页请求中...`);

        let resp;
        try {
            resp = await fetchPage(page, payload);
        } catch (e) {
            log(`   ❌ 请求失败: ${e.message}`);
            break;
        }

        // 解析响应（打印结构便于调试）
        if (pageNo === 1) {
            log(`   响应顶层 keys: ${Object.keys(resp).join(', ')}`);
            log(`   原始响应（前500字）: ${JSON.stringify(resp).slice(0, 500)}`);
        }

        // 尝试常见响应结构
        const data = resp?.data ?? resp?.result ?? resp;
        const rows = data?.rows ?? data?.list ?? data?.records ?? data?.data ?? [];
        if (total === null) total = data?.total ?? data?.totalCount ?? data?.count ?? rows.length;

        if (!Array.isArray(rows) || rows.length === 0) {
            log(`   第 ${pageNo} 页无数据，停止`);
            log(`   data keys: ${data && typeof data === 'object' ? Object.keys(data).join(', ') : String(data)}`);
            break;
        }

        allRows = allRows.concat(rows);
        log(`   第 ${pageNo} 页: ${rows.length} 条，累计 ${allRows.length}/${total}`);

        if (allRows.length >= total || rows.length < PAGE_SIZE) break;
        pageNo++;
    }

    log(`✅ 共获取 ${allRows.length} 条记录`);
    return allRows;
}

module.exports = {
    dateToTs,
    buildPoiIdsStr,
    buildStoreConditions,
    buildChannelOrderPayload,
    fetchAllChannelOrders,
    POI_ORG_MAP,
    QUERY_URL,
};
