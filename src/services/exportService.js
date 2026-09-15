'use strict';

/**
 * 导出服务（FR10 / 第 8 章）。
 *   - Excel：日报列表（日期、品名"编码 名称"、批号、产量），支持日期区间
 *   - PDF：单日日报 A4 纵向版式，超限行红色标注并显示【超限】原因
 *   - 保存位置：优先调用系统"另存为"对话框，取消失败则落到 data/exports/
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFileSync } = require('child_process');

const { PATHS, APP, USE_SAVE_DIALOG } = require('../config');
const { LIMITS } = require('../constants');
const { BizError } = require('../utils/error');
const num = require('../utils/number');
const logger = require('../utils/logger');

/* ---------------------------- 保存路径选择 ---------------------------- */

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * 通过 PowerShell 调用 System.Windows.Forms.SaveFileDialog。
 * @returns {string|null} 选定路径；取消或不可用时返回 null
 */
function chooseSavePath(defaultName, filter) {
  if (!USE_SAVE_DIALOG || process.platform !== 'win32') return null;
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.SaveFileDialog',
    `$dialog.FileName = ${psQuote(defaultName)}`,
    `$dialog.InitialDirectory = ${psQuote(path.resolve(PATHS.exports))}`,
    `$dialog.Filter = ${psQuote(filter)}`,
    '$dialog.OverwritePrompt = $true',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) }',
  ].join('; ');

  try {
    const stdout = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-STA', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 5 * 60 * 1000, windowsHide: true },
    );
    const picked = String(stdout || '').trim();
    return picked || null;
  } catch (err) {
    logger.warn('"另存为"对话框不可用，回退到默认导出目录：', err.message);
    return null;
  }
}

/** 解析最终写入路径 */
async function resolveTarget(defaultName, filter) {
  const picked = chooseSavePath(defaultName, filter);
  if (picked) {
    await fsp.mkdir(path.dirname(picked), { recursive: true });
    return picked;
  }
  await fsp.mkdir(PATHS.exports, { recursive: true });
  return path.join(PATHS.exports, defaultName);
}

/* ------------------------------- Excel ------------------------------- */

function loadExcelJS() {
  try {
    // eslint-disable-next-line global-require
    return require('exceljs');
  } catch (_) {
    throw new BizError(500, '缺少 exceljs 依赖，无法导出 Excel');
  }
}

/**
 * 导出日报列表为 .xlsx。
 * @param {{from?:string, to?:string}} params 日期区间，均可省略
 * @param {object} user
 * @param {Array<{date:string, product_code:string, product_name:string, batch_no:string, output_weight:string}>} summaries
 */
async function exportExcel(params, user, summaries) {
  const from = num.toText(params.from);
  const to = num.toText(params.to);
  if (from && !LIMITS.DATE_RE.test(from)) throw BizError.badRequest('起始日期格式非法');
  if (to && !LIMITS.DATE_RE.test(to)) throw BizError.badRequest('截止日期格式非法');
  if (from && to && from > to) throw BizError.badRequest('起始日期不能晚于截止日期');

  const rows = summaries
    .filter((item) => (!from || item.date >= from) && (!to || item.date <= to))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const ExcelJS = loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = APP.NAME;
  const sheet = workbook.addWorksheet('日报列表');
  sheet.columns = [
    { header: '日期', key: 'date', width: 14 },
    { header: '品名', key: 'product', width: 30 },
    { header: '批号', key: 'batch_no', width: 20 },
    { header: '产量(kg)', key: 'output_weight', width: 14 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const item of rows) {
    const product = [item.product_code, item.product_name].filter(Boolean).join(' ');
    sheet.addRow({
      date: item.date,
      product: product || '未填品名',
      batch_no: item.batch_no || '',
      output_weight: num.toText(item.output_weight) === '' ? '' : Number(item.output_weight),
    });
  }

  const defaultName = `生产日报列表_${from || '起始'}_${to || '截止'}.xlsx`;
  const target = await resolveTarget(defaultName, 'Excel 工作簿 (*.xlsx)|*.xlsx');
  await workbook.xlsx.writeFile(target);
  logger.info('Excel 导出完成：', target, '共', rows.length, '条');
  return { path: target, count: rows.length };
}

/* -------------------------------- PDF -------------------------------- */

function loadPdfKit() {
  try {
    // eslint-disable-next-line global-require
    return require('pdfkit');
  } catch (_) {
    throw new BizError(500, '缺少 pdfkit 依赖，无法导出 PDF');
  }
}

/** 中文字体解析：环境变量 → 内置字体 → 系统字体 */
function resolveChineseFont() {
  const candidates = [];
  if (process.env.PDR_FONT) candidates.push(process.env.PDR_FONT);
  candidates.push(path.join(PATHS.assets, 'fonts', 'NotoSansSC-Regular.ttf'));
  candidates.push('C:\\Windows\\Fonts\\msyh.ttf');
  candidates.push('C:\\Windows\\Fonts\\msyh.ttc');
  candidates.push('C:\\Windows\\Fonts\\simhei.ttf');
  candidates.push('C:\\Windows\\Fonts\\simsun.ttc');
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (_) {
      /* 忽略并继续尝试 */
    }
  }
  return null;
}

const PDF_COLUMNS = [
  { key: 'record_time', title: '记录时间', width: 78 },
  { key: 'operator_name', title: '操作员', width: 52 },
  { key: 'operation_name', title: '操作类型', width: 68 },
  { key: 'top_temp', title: '顶温', width: 44 },
  { key: 'bottom_temp', title: '底温', width: 44 },
  { key: 'pressure', title: '压力', width: 44 },
  { key: 'eo_cum', title: 'EO累计', width: 50 },
  { key: 'remark', title: '备注', width: 135 },
];

/**
 * 导出单日日报为 PDF。
 * @param {string} date
 * @param {object} user
 * @param {object} report reportService.getByDate 的返回值
 */
async function exportPdf(date, user, report) {
  const PDFDocument = loadPdfKit();
  const header = report.header || {};
  const details = report.details || [];

  const defaultName = `生产日报_${date}.pdf`;
  const target = await resolveTarget(defaultName, 'PDF 文档 (*.pdf)|*.pdf');

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'portrait',
    margins: { top: 40, bottom: 48, left: 40, right: 40 },
    info: { Title: `${APP.NAME} ${date}`, Author: APP.NAME },
  });

  const fontPath = resolveChineseFont();
  if (fontPath) {
    doc.registerFont('cn', fontPath);
    doc.font('cn');
  } else {
    logger.warn('未找到可用中文字体，PDF 中文可能无法正常显示；可通过环境变量 PDR_FONT 指定字体文件。');
  }

  const stream = fs.createWriteStream(target);
  doc.pipe(stream);

  const left = doc.page.margins.left;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottomLimit = doc.page.height - doc.page.margins.bottom;

  // 标题与报告日期
  doc.fontSize(16).text(`${APP.NAME}（${APP.TAG}）`, left, doc.y, { width: contentWidth, align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(11).text(`报告日期：${date}`, { width: contentWidth, align: 'center' });
  doc.moveDown(0.8);

  // 头部信息栏
  const headerPairs = [
    ['品名', header.product_code ? `${header.product_code} ${header.product_name}`.trim() : '未填品名'],
    ['批号', header.batch_no || '—'],
    ['原料净重(kg)', header.raw_weight || '—'],
    ['EO净重(kg)', header.eo_weight || '—'],
    ['产量(kg)', header.output_weight || '—'],
    ['KOH用量(kg)', header.koh || '—'],
    ['乳酸用量(kg)', header.lactic_acid || '—'],
  ];
  doc.fontSize(10);
  const colWidth = contentWidth / 2;
  for (let i = 0; i < headerPairs.length; i += 2) {
    const y = doc.y;
    doc.text(`${headerPairs[i][0]}：${headerPairs[i][1]}`, left, y, { width: colWidth - 6 });
    if (headerPairs[i + 1]) {
      doc.text(`${headerPairs[i + 1][0]}：${headerPairs[i + 1][1]}`, left + colWidth, y, { width: colWidth - 6 });
    }
    doc.y = y + 18;
  }
  doc.moveDown(0.4);

  // 工作小结
  doc.fontSize(11).text('工作小结', left, doc.y);
  doc.fontSize(10).text(header.summary ? header.summary : '（无）', left, doc.y + 4, { width: contentWidth });

  // 明细表
  doc.moveDown(1);
  let y = doc.y;
  const rowHeight = 20;
  const headHeight = 22;

  function drawTableHead() {
    doc.rect(left, y, contentWidth, headHeight).fill('#eef2f7');
    doc.fillColor('#1f2937').fontSize(9);
    let x = left;
    for (const column of PDF_COLUMNS) {
      doc.text(column.title, x + 3, y + 6, { width: column.width - 6, align: 'center' });
      x += column.width;
    }
    y += headHeight;
  }

  function ensureSpace() {
    if (y + rowHeight > bottomLimit) {
      doc.addPage();
      y = doc.page.margins.top;
      drawTableHead();
    }
  }

  doc.fontSize(11).text('生产记录', left, y);
  y = doc.y + 4;
  drawTableHead();

  if (details.length === 0) {
    doc.fillColor('#6b7280').fontSize(9).text('（本次日报无生产记录）', left + 4, y + 6, { width: contentWidth });
    y += rowHeight;
  }

  for (const row of details) {
    ensureSpace();
    const isWarn = Number(row.warn) === 1;
    if (isWarn) {
      doc.rect(left, y, contentWidth, rowHeight).fill('#fdecec');
    } else {
      doc.rect(left, y, contentWidth, rowHeight).fill('#ffffff');
    }
    doc.fillColor(isWarn ? '#c0392b' : '#1f2937').fontSize(8.5);
    let x = left;
    for (const column of PDF_COLUMNS) {
      const raw = row[column.key];
      const text = raw === undefined || raw === null || raw === '' ? '' : String(raw);
      doc.text(text, x + 3, y + 6, { width: column.width - 6, align: column.key === 'remark' ? 'left' : 'center', ellipsis: true, height: rowHeight - 8 });
      x += column.width;
    }
    doc.strokeColor('#d5dbe3').lineWidth(0.5).rect(left, y, contentWidth, rowHeight).stroke();
    y += rowHeight;

    if (isWarn) {
      ensureSpace();
      doc.rect(left, y, contentWidth, rowHeight).fill('#fdecec');
      doc.fillColor('#c0392b').fontSize(8.5);
      doc.text(`【超限】${row.warn_reason || '未填写原因'}`, left + 6, y + 6, { width: contentWidth - 12 });
      y += rowHeight;
    }
  }

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  logger.info('PDF 导出完成：', target);
  return { path: target, count: details.length };
}

module.exports = { exportExcel, exportPdf, resolveChineseFont, chooseSavePath };
