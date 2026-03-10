// src/utils/db.js
// ─────────────────────────────────────────────────────────────────────────────
// طبقة قاعدة البيانات — كل شيء يُخزَّن في JSON مقسّم لكل سيرفر
// data/{guildId}/filename.json
// ─────────────────────────────────────────────────────────────────────────────

import fs   from "fs";
import path from "path";

const DATA_DIR = "./data";

// ─────────────────────────────────────────────────────────────────────────────
// أدوات مساعدة داخلية
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُرجع مسار مجلد السيرفر ويُنشئه إن لم يكن موجوداً
 */
function guildDir(guildId) {
  const dir = path.join(DATA_DIR, guildId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * يقرأ ملف JSON ويُرجع محتواه أو القيمة الافتراضية عند الخطأ
 */
function readJSON(filePath, defaultValue = {}) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    // الملف تالف أو فارغ → ارجع بالقيمة الافتراضية
    return defaultValue;
  }
}

/**
 * يكتب بيانات كـ JSON منسّق في الملف
 */
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

/**
 * مسار ملف معين داخل مجلد السيرفر
 */
function guildFile(guildId, filename) {
  return path.join(guildDir(guildId), filename);
}

// ─────────────────────────────────────────────────────────────────────────────
// ─── Config ──────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

/**
 * القيم الافتراضية لإعدادات أي سيرفر جديد
 */
const DEFAULT_CONFIG = {
  modRoles:   [],           // رتب المشرفين — يكسبون XP ونقاط موديريشن
  adminRoles: [],           // رتب الإدارة  — يستخدمون /add /remove /reset
  appealRole: null,         // رتبة مراجعة الاستئناف الثاني (النهائي)
  reviewChannel: null,      // قناة تصلها بطاقات المراجعة
  xp: {
    minXp:      5,          // أقل XP ممكن لكل رسالة
    maxXp:      35,         // أعلى XP ممكن لكل رسالة
    cooldown:   60,         // ثواني الانتظار بين كل رسالة ورسالة
    dailyLimit: 500,        // أقصى XP يُكسب يومياً
  },
  modPoints: {
    warn:           10,     // نقاط التحذير عند القبول
    timeoutBase:    5,      // نقاط التايم أوت الأساسية
    timeoutPerHour: 3,      // نقاط إضافية لكل ساعة توقيف
  },
  limits: {
    maxAdd:        500,     // أقصى نقاط تُضاف في عملية واحدة
    maxRemove:     500,     // أقصى نقاط تُخصم في عملية واحدة
    maxMembers:    10,      // أقصى عدد أعضاء في عملية /add أو /remove
    abuseCooldown: 30,      // ثواني الانتظار بين استخدامات /add أو /remove
  },
  milestones: [],           // [{ points: 500, roleId: "111..." }, ...]
  logChannels: {
    all:        null,       // يستقبل كل الأحداث
    points:     null,       // /add /remove /reset
    moderation: null,       // /warn /timeout
    reviews:    null,       // قبول/رفض المراجعات
    appeals:    null,       // الاستئنافات
    tasks:      null,       // إكمال المهام
    rewards:    null,       // الترقيات والمكافآت
    settings:   null,       // تغييرات /setup
  },
  promotionAnnouncementChannel: null,  // قناة إعلانات الترقيات
};

/**
 * يُرجع إعدادات السيرفر مع دمج القيم الافتراضية للحقول الناقصة
 */
export function getConfig(guildId) {
  const file = guildFile(guildId, "config.json");
  const saved = readJSON(file, {});

  // دمج عميق — نضمن وجود كل الحقول الفرعية
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    xp:         { ...DEFAULT_CONFIG.xp,         ...(saved.xp         || {}) },
    modPoints:  { ...DEFAULT_CONFIG.modPoints,   ...(saved.modPoints  || {}) },
    limits:     { ...DEFAULT_CONFIG.limits,      ...(saved.limits     || {}) },
    logChannels:{ ...DEFAULT_CONFIG.logChannels, ...(saved.logChannels|| {}) },
  };
}

/**
 * يحفظ إعدادات السيرفر
 */
export function saveConfig(guildId, config) {
  const file = guildFile(guildId, "config.json");
  writeJSON(file, config);
}

// ─────────────────────────────────────────────────────────────────────────────
// ─── Points ──────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُرجع كل نقاط السيرفر
 * الشكل: { userId: { total, manual, xp, moderation, history[] } }
 */
export function getPoints(guildId) {
  const file = guildFile(guildId, "points.json");
  return readJSON(file, {});
}

/**
 * يحفظ كل نقاط السيرفر
 */
export function savePoints(guildId, data) {
  const file = guildFile(guildId, "points.json");
  writeJSON(file, data);
}

/**
 * يُرجع بيانات مشرف واحد مع القيم الافتراضية
 */
export function getUserPoints(guildId, userId) {
  const data = getPoints(guildId);
  return data[userId] ?? {
    total:      0,
    manual:     0,   // نقاط يدوية من /add و /remove
    xp:         0,   // نقاط رسائل
    moderation: 0,   // نقاط عقوبات مقبولة
    task:       0,   // نقاط مهام مكتملة
    history:    [],  // آخر 100 تغيير
  };
}

/**
 * يحفظ بيانات مشرف واحد
 */
export function saveUserPoints(guildId, userId, userData) {
  const data     = getPoints(guildId);
  data[userId]   = userData;
  savePoints(guildId, data);
}

/**
 * يُضيف أو يخصم نقاط من مشرف ويُعيد بياناته المحدّثة
 *
 * @param {string} guildId    - ID السيرفر
 * @param {string} userId     - ID المشرف
 * @param {number} amount     - القيمة (موجبة أو سالبة)
 * @param {string} source     - "manual" | "xp" | "moderation" | "task"
 * @param {string} reason     - سبب التغيير (يُسجَّل في التاريخ)
 * @param {string|null} executorId - من نفّذ الأمر (null للتلقائي)
 * @returns {object} - بيانات المشرف بعد التحديث
 */
export function addPointsToUser(guildId, userId, amount, source, reason, executorId) {
  const userData = getUserPoints(guildId, userId);

  // تحديث الإجمالي — منع الهبوط تحت الصفر
  userData.total = Math.max(0, (userData.total || 0) + amount);

  // تحديث المصدر المناسب
  switch (source) {
    case "manual":
      userData.manual     = (userData.manual     || 0) + amount;
      // منع المصادر من الهبوط تحت الصفر
      userData.manual     = Math.max(0, userData.manual);
      break;
    case "xp":
      userData.xp         = Math.max(0, (userData.xp         || 0) + amount);
      break;
    case "moderation":
      userData.moderation = Math.max(0, (userData.moderation || 0) + amount);
      break;
    case "task":
      userData.task       = Math.max(0, (userData.task       || 0) + amount);
      break;
  }

  // إضافة للتاريخ
  if (!userData.history) userData.history = [];
  userData.history.unshift({
    amount,
    source,
    reason:     reason    || "بدون سبب",
    executorId: executorId || null,
    timestamp:  Date.now(),
  });

  // احتفظ بآخر 100 سجل فقط
  if (userData.history.length > 100) {
    userData.history = userData.history.slice(0, 100);
  }

  saveUserPoints(guildId, userId, userData);
  return userData;
}

// ─────────────────────────────────────────────────────────────────────────────
// ─── XP State ────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// يتتبع: آخر وقت كسب XP + مجموع XP اليوم + وقت بداية اليوم

/**
 * يُرجع حالة XP لكل مشرفي السيرفر
 * الشكل: { userId: { lastXp, dailyXp, dayStart } }
 */
export function getXpState(guildId) {
  const file = guildFile(guildId, "xp_state.json");
  return readJSON(file, {});
}

/**
 * يحفظ حالة XP
 */
export function saveXpState(guildId, data) {
  const file = guildFile(guildId, "xp_state.json");
  writeJSON(file, data);
}

// ─────────────────────────────────────────────────────────────────────────────
// ─── Reviews ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُرجع كل بطاقات المراجعة في السيرفر
 * الشكل: { reviewId: { id, type, executorId, targetId, ... } }
 */
export function getReviews(guildId) {
  const file = guildFile(guildId, "reviews.json");
  return readJSON(file, {});
}

/**
 * يحفظ بطاقات المراجعة
 */
export function saveReviews(guildId, data) {
  const file = guildFile(guildId, "reviews.json");
  writeJSON(file, data);
}

// ─────────────────────────────────────────────────────────────────────────────
// ─── Member Log ──────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// سجل العقوبات لكل عضو في السيرفر (لأمر /memberlog)

/**
 * يُرجع كل سجلات العقوبات
 * الشكل: { memberId: [ { type, duration, reason, executorId, result, ... } ] }
 */
export function getMemberLog(guildId) {
  const file = guildFile(guildId, "member_log.json");
  return readJSON(file, {});
}

/**
 * يحفظ سجلات العقوبات
 */
export function saveMemberLog(guildId, data) {
  const file = guildFile(guildId, "member_log.json");
  writeJSON(file, data);
}

/**
 * يُضيف سجل عقوبة لعضو
 *
 * @param {string} guildId  - ID السيرفر
 * @param {string} targetId - ID العضو المعاقب
 * @param {object} entry    - تفاصيل العقوبة
 */
export function addMemberLogEntry(guildId, targetId, entry) {
  const data = getMemberLog(guildId);

  if (!data[targetId]) data[targetId] = [];

  data[targetId].unshift({
    ...entry,
    timestamp: Date.now(),
  });

  // احتفظ بآخر 200 عقوبة لكل عضو
  if (data[targetId].length > 200) {
    data[targetId] = data[targetId].slice(0, 200);
  }

  saveMemberLog(guildId, data);
}

// ─────────────────────────────────────────────────────────────────────────────
// ─── Promotions History ──────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// تاريخ الترقيات لكل مشرف (يُعرض في /rank)

/**
 * يُرجع تاريخ ترقيات كل المشرفين
 * الشكل: { userId: [ { type, fromRole, toRole, points, executorId, reason, timestamp } ] }
 */
export function getPromotions(guildId) {
  const file = guildFile(guildId, "promotions.json");
  return readJSON(file, {});
}

/**
 * يحفظ تاريخ الترقيات
 */
export function savePromotions(guildId, data) {
  const file = guildFile(guildId, "promotions.json");
  writeJSON(file, data);
}

/**
 * يُضيف سجل ترقية لمشرف
 *
 * @param {string} guildId - ID السيرفر
 * @param {string} userId  - ID المشرف
 * @param {object} entry   - { type, fromRole, toRole, points, executorId, reason }
 */
export function addPromotionEntry(guildId, userId, entry) {
  const data = getPromotions(guildId);

  if (!data[userId]) data[userId] = [];

  data[userId].unshift({
    ...entry,
    timestamp: Date.now(),
  });

  // احتفظ بآخر 50 ترقية للمشرف الواحد
  if (data[userId].length > 50) {
    data[userId] = data[userId].slice(0, 50);
  }

  savePromotions(guildId, data);
}

// ─────────────────────────────────────────────────────────────────────────────
// ─── Tasks ───────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُرجع إعدادات المهام
 * الشكل: { roleId: { type, goal, period, points } }
 *   type   → "messages" | "moderation" | "voice"
 *   period → "daily" | "2days" | "weekly"
 */
export function getTaskConfig(guildId) {
  const file = guildFile(guildId, "tasks.json");
  return readJSON(file, {});
}

/**
 * يحفظ إعدادات المهام
 */
export function saveTaskConfig(guildId, data) {
  const file = guildFile(guildId, "tasks.json");
  writeJSON(file, data);
}

/**
 * يُرجع تقدم المشرفين في المهام
 * الشكل:
 * {
 *   userId: {
 *     roleId: { current, lastReset, completed, lastWarned }
 *   }
 * }
 */
export function getTaskProgress(guildId) {
  const file = guildFile(guildId, "task_progress.json");
  return readJSON(file, {});
}

/**
 * يحفظ تقدم المشرفين في المهام
 */
export function saveTaskProgress(guildId, data) {
  const file = guildFile(guildId, "task_progress.json");
  writeJSON(file, data);
}

// ─────────────────────────────────────────────────────────────────────────────
// ─── Utility Helpers ─────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُرجع قائمة مرتبة تنازلياً لكل المشرفين حسب النقاط
 * يُستخدم في /top
 *
 * @param {string} guildId
 * @returns {Array<{ userId, total, manual, xp, moderation, task }>}
 */
export function getSortedLeaderboard(guildId) {
  const data = getPoints(guildId);

  return Object.entries(data)
    .map(([userId, d]) => ({
      userId,
      total:      d.total      || 0,
      manual:     d.manual     || 0,
      xp:         d.xp         || 0,
      moderation: d.moderation || 0,
      task:       d.task       || 0,
    }))
    .filter((e) => e.total > 0)
    .sort((a, b) => b.total - a.total);
}

/**
 * يُرجع إجمالي نقاط السيرفر كله
 * مفيد لإحصائيات /setup
 *
 * @param {string} guildId
 * @returns {number}
 */
export function getTotalGuildPoints(guildId) {
  const data = getPoints(guildId);
  return Object.values(data).reduce((sum, u) => sum + (u.total || 0), 0);
}

/**
 * يتحقق هل المشرف موجود في قاعدة البيانات
 *
 * @param {string} guildId
 * @param {string} userId
 * @returns {boolean}
 */
export function userExists(guildId, userId) {
  const data = getPoints(guildId);
  return userId in data;
}

/**
 * يحذف مشرف من قاعدة البيانات نهائياً
 * (لا يُستخدم حالياً — متاح للمستقبل)
 *
 * @param {string} guildId
 * @param {string} userId
 */
export function deleteUser(guildId, userId) {
  const data = getPoints(guildId);
  delete data[userId];
  savePoints(guildId, data);
}
