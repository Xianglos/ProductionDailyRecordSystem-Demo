'use strict';

/**
 * 首次启动初始化（《开发详细设计书》11.4）。
 *   - 创建 data/ 下各基础 CSV 文件（含表头）
 *   - 写入默认账号（admin/leader/qa/operator，初始密码 123456）
 *   - 写入字典与品名/模板基础数据
 *   - 可选：生成演示用历史日报（PDR_SEED_DEMO=0 关闭），便于统计看板与追溯演示
 */

const { AUTH, SEED_DEMO } = require('./config');
const { ROLE } = require('./constants');
const { newId } = require('./utils/id');
const { nowText, today, formatDate } = require('./utils/time');
const { hashPassword } = require('./utils/crypto');
const logger = require('./utils/logger');

const userStore = require('./store/userStore');
const productStore = require('./store/productStore');
const templateStore = require('./store/templateStore');
const operationTypeStore = require('./store/operationTypeStore');
const auditStore = require('./store/auditStore');
const reportStore = require('./store/reportStore');

const DEFAULT_USERS = [
  { account: 'admin', name: '张伟', role: ROLE.ADMIN, phone: '13800000001' },
  { account: 'leader', name: '李强', role: ROLE.LEADER, phone: '13800000002' },
  { account: 'qa', name: '王敏', role: ROLE.QA, phone: '13800000003' },
  { account: 'operator', name: '赵磊', role: ROLE.OPERATOR, phone: '13800000004' },
  { account: 'operator2', name: '陈晨', role: ROLE.OPERATOR, phone: '13800000005' },
  { account: 'operator3', name: '刘洋', role: ROLE.OPERATOR, phone: '13800000006' },
];

const DEFAULT_PRODUCTS = [
  { code: 'HEC-01', name: '羟乙基纤维素', unit: 'kg' },
  { code: 'OEP-10', name: '烷基酚聚氧乙烯醚', unit: 'kg' },
  { code: 'PEG-400', name: '聚乙二醇400', unit: 'kg' },
  { code: 'SUR-25', name: '脂肪醇聚氧乙烯醚', unit: 'kg' },
];

const DEFAULT_TEMPLATES = [
  { product_code: 'HEC-01', top_min: '180.00', top_max: '200.00', bottom_min: '150.00', bottom_max: '170.00', pressure_min: '0.10', pressure_max: '0.35' },
  { product_code: 'OEP-10', top_min: '165.00', top_max: '185.00', bottom_min: '140.00', bottom_max: '160.00', pressure_min: '0.05', pressure_max: '0.30' },
  { product_code: 'PEG-400', top_min: '150.00', top_max: '170.00', bottom_min: '130.00', bottom_max: '155.00', pressure_min: '0.02', pressure_max: '0.25' },
  { product_code: 'SUR-25', top_min: '175.00', top_max: '195.00', bottom_min: '145.00', bottom_max: '165.00', pressure_min: '0.08', pressure_max: '0.32' },
];

const DEFAULT_OPERATION_TYPES = [
  { code: 'FEED', name: '投料', sort: '10' },
  { code: 'HEAT', name: '升温', sort: '20' },
  { code: 'DROP', name: '滴加', sort: '30' },
  { code: 'REACT', name: '保温反应', sort: '40' },
  { code: 'SAMPLE', name: '取样检测', sort: '50' },
  { code: 'OUTPUT', name: '出料', sort: '60' },
  { code: 'CLEAN', name: '设备清洗', sort: '70' },
  { code: 'PATROL', name: '巡检', sort: '80' },
];

async function ensureInitialized() {
  await Promise.all([
    userStore.ensure(),
    productStore.ensure(),
    templateStore.ensure(),
    operationTypeStore.ensure(),
    auditStore.ensure(),
  ]);

  await bootstrapUsers();
  await bootstrapProducts();
  await bootstrapTemplates();
  await bootstrapOperationTypes();
  if (SEED_DEMO) await bootstrapDemoReports();
}

async function bootstrapUsers() {
  if ((await userStore.all()).length > 0) return;
  const now = nowText();
  const rows = DEFAULT_USERS.map((item) => ({
    id: newId(),
    account: item.account,
    name: item.name,
    password_hash: hashPassword(AUTH.DEFAULT_PASSWORD),
    role: item.role,
    phone: item.phone,
    status: '1',
    deleted: '0',
    created_at: now,
    updated_at: now,
  }));
  await userStore.replaceAll(rows);
  logger.info(`已初始化 ${rows.length} 个默认账号，初始密码 ${AUTH.DEFAULT_PASSWORD}`);
}

async function bootstrapProducts() {
  if ((await productStore.all()).length > 0) return;
  const now = nowText();
  await productStore.replaceAll(
    DEFAULT_PRODUCTS.map((item) => ({
      id: newId(),
      code: item.code,
      name: item.name,
      unit: item.unit,
      status: '1',
      created_at: now,
      updated_at: now,
    })),
  );
  logger.info(`已初始化 ${DEFAULT_PRODUCTS.length} 个品名`);
}

async function bootstrapTemplates() {
  if ((await templateStore.all()).length > 0) return;
  const now = nowText();
  await templateStore.replaceAll(
    DEFAULT_TEMPLATES.map((item) => ({
      id: newId(),
      product_code: item.product_code,
      top_min: item.top_min,
      top_max: item.top_max,
      bottom_min: item.bottom_min,
      bottom_max: item.bottom_max,
      pressure_min: item.pressure_min,
      pressure_max: item.pressure_max,
      valid_from: '',
      valid_to: '',
      created_at: now,
      updated_at: now,
    })),
  );
  logger.info(`已初始化 ${DEFAULT_TEMPLATES.length} 份工艺模板`);
}

async function bootstrapOperationTypes() {
  if ((await operationTypeStore.all()).length > 0) return;
  const now = nowText();
  await operationTypeStore.replaceAll(
    DEFAULT_OPERATION_TYPES.map((item) => ({
      id: newId(),
      code: item.code,
      name: item.name,
      sort: item.sort,
      status: '1',
      created_at: now,
      updated_at: now,
    })),
  );
  logger.info(`已初始化 ${DEFAULT_OPERATION_TYPES.length} 个操作类型`);
}

/* --------------------------- 演示历史日报 --------------------------- */

const DEMO_DAYS = 25;
const DEMO_TIMES = ['08:30', '10:20', '13:45', '16:10', '21:00'];

/** 线性同余伪随机，保证同一日期生成结果稳定可复现 */
function seededRandom(seed) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

async function bootstrapDemoReports() {
  const existing = await reportStore.listDates();
  if (existing.length > 0) return;

  const operators = (await userStore.listActive()).filter((u) => u.role === ROLE.OPERATOR);
  const products = await productStore.listActive();
  const operationTypes = await operationTypeStore.listActiveSorted();
  const templates = await templateStore.all();
  if (!operators.length || !products.length || !operationTypes.length) return;

  const todayText = today();
  let created = 0;

  for (let offset = DEMO_DAYS; offset >= 1; offset -= 1) {
    const date = formatDate(new Date(Date.now() - offset * 24 * 60 * 60 * 1000));
    if (date === todayText) continue;
    // 每 7 天留空一天，模拟未填报
    if (offset % 7 === 0) continue;

    const product = products[offset % products.length];
    const template = templates.find((t) => String(t.product_code).toLowerCase() === String(product.code).toLowerCase()) || null;
    const random = seededRandom(offset * 7919 + 13);

    const rowCount = 3 + Math.floor(random() * 3); // 3–5 行
    const eoWeight = Number((1200 + Math.floor(random() * 600)).toFixed(2));
    const dayWarn = offset % 5 === 0; // 约 1/5 的日报产生一条超限记录

    const details = [];
    let eoCum = 0;
    for (let i = 0; i < rowCount; i += 1) {
      const operator = operators[(offset + i) % operators.length];
      const operationType = operationTypes[i % operationTypes.length];
      const baseTop = template ? Number(template.top_min) : 170;
      const baseBottom = template ? Number(template.bottom_min) : 140;
      const pressureMin = template ? Number(template.pressure_min) : 0.05;
      const pressureMax = template ? Number(template.pressure_max) : 0.3;

      let topTemp = baseTop + Number((random() * 8).toFixed(2));
      const bottomTemp = baseBottom + Number((random() * 8).toFixed(2));
      const pressure = Number((pressureMin + (pressureMax - pressureMin) * random()).toFixed(2));
      let warn = 0;
      let warnReason = '';

      if (dayWarn && i === 1 && template) {
        topTemp = Number((Number(template.top_max) + 2.5).toFixed(2));
        warn = 1;
        warnReason = '反应放热导致顶温短时超上限，已加大冷却水流量并持续观察';
      }

      eoCum = Math.min(eoWeight, Number((eoCum + eoWeight / rowCount).toFixed(2)));

      details.push({
        id: newId(),
        report_date: date,
        operator_id: operator.id,
        operator_name: operator.name,
        record_time: `${date} ${DEMO_TIMES[i % DEMO_TIMES.length]}`,
        operation_code: operationType.code,
        operation_name: operationType.name,
        top_temp: topTemp.toFixed(2),
        bottom_temp: bottomTemp.toFixed(2),
        pressure: pressure.toFixed(2),
        eo_cum: eoCum.toFixed(2),
        warn: String(warn),
        warn_reason: warnReason,
        remark: i === rowCount - 1 ? '当班生产正常，交接下一班' : '',
        recorder_id: operator.id,
        recorder_name: operator.name,
        created_at: `${date} ${DEMO_TIMES[i % DEMO_TIMES.length]}:00`,
        updated_at: `${date} ${DEMO_TIMES[i % DEMO_TIMES.length]}:00`,
      });
    }

    // 保证记录时间单调、EO 累计量有序
    details.sort((a, b) => (a.record_time < b.record_time ? -1 : 1));

    const rawWeight = Number((3000 + Math.floor(random() * 800)).toFixed(2));
    const outputWeight = Number((rawWeight * (0.9 + random() * 0.06)).toFixed(2));
    const header = {
      report_date: date,
      product_code: product.code,
      product_name: product.name,
      batch_no: `B${date.replace(/-/g, '')}`,
      raw_weight: rawWeight.toFixed(2),
      eo_weight: eoWeight.toFixed(2),
      output_weight: outputWeight.toFixed(2),
      koh: Number((38 + random() * 20).toFixed(2)).toFixed(2),
      lactic_acid: Number((9 + random() * 8).toFixed(2)).toFixed(2),
      summary: `${date} ${product.name}生产，投料 ${rawWeight.toFixed(2)} kg，出料 ${outputWeight.toFixed(2)} kg，反应平稳，现场清理完毕并完成交接班。`,
      created_at: `${date} 08:00:00`,
      updated_at: `${date} 21:30:00`,
    };

    await reportStore.writeHeader(header);
    await reportStore.writeDetails(date, details);
    created += 1;
  }

  if (created > 0) logger.info(`已生成 ${created} 份演示历史日报（可通过 PDR_SEED_DEMO=0 关闭）`);
}

module.exports = { ensureInitialized };
