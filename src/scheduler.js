'use strict';
/**
 * scheduler.js —— 定时任务：每天北京时间 05:00 自动更新
 */
const cron = require('node-cron');
const CONFIG = require('./config');
const { runUpdate } = require('./updater');
const { beijingTime } = require('./updater');

let running = false;
let lastRun = null;
let lastResult = null;
let lastError = null;

async function trigger(reason) {
  if (running) {
    console.log(`[scheduler] 已有更新任务在执行，跳过本次触发（${reason}）`);
    return { skipped: true };
  }
  running = true;
  lastError = null;
  console.log(`[scheduler] 开始更新（触发来源：${reason}，北京时间 ${beijingTime()}）`);
  try {
    lastResult = await runUpdate();
    lastRun = new Date().toISOString();
    return lastResult;
  } catch (e) {
    lastError = String(e.message || e);
    console.error('[scheduler] 更新失败：', e);
    return { error: lastError };
  } finally {
    running = false;
  }
}

function start() {
  const expr = CONFIG.cronExpression;         // '0 5 * * *'
  const tz = CONFIG.cronTimeZone;             // 'Asia/Shanghai'
  if (!cron.validate(expr)) {
    throw new Error('无效的 cron 表达式: ' + expr);
  }
  cron.schedule(expr, () => trigger('定时任务'), { timeZone: tz });
  console.log(`[scheduler] 定时任务已启动：每天 ${expr.split(' ')[1]}:00 (${tz}) 自动更新`);
}

function status() {
  return { running, lastRun, lastError, lastResult: lastResult ? lastResult.stats : null };
}

module.exports = { start, trigger, status };
