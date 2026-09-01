// src/utils/cooldown.js
// ─────────────────────────────────────────────────────────────────────────────
// نظام Cooldown مشترك ومُوفّر للذاكرة
//
// لماذا ملف مستقل؟
//   كان كل من add.js و remove.js يحتفظ بـ Map خاص به، وهذا يعني أن
//   استخدام /add ثم /remove مباشرةً كان يتجاوز الحماية تماماً
//   (anti-abuse cooldown لا يعمل).
//   الآن كل الأوامر تتشارك نفس المخزن عبر namespace.
//
// مميزات:
//   ✅ namespace لكل نوع عملية (مثلاً "abuse" أو "xp")
//   ✅ تنظيف تلقائي للمدخلات المنتهية (لا تسريب ذاكرة)
//   ✅ لا يعتمد على إعادة تشغيل البوت
// ─────────────────────────────────────────────────────────────────────────────

// المخزن الرئيسي: Map<namespace, Map<key, expiryTimestamp>>
const stores = new Map();

// آخر مرة تم فيها التنظيف الكامل
let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;   // كل 5 دقائق

/**
 * يُرجع (أو يُنشئ) مخزن namespace معين
 *
 * @param {string} namespace
 * @returns {Map<string, number>}
 */
function getStore(namespace) {
  let store = stores.get(namespace);
  if (!store) {
    store = new Map();
    stores.set(namespace, store);
  }
  return store;
}

/**
 * يُزيل كل المدخلات المنتهية من كل المخازن
 * يُستدعى تلقائياً كل 5 دقائق — ويمنع تسريب الذاكرة في السيرفرات الكبيرة
 */
export function sweepExpired() {
  const now = Date.now();

  for (const [namespace, store] of stores) {
    for (const [key, expiry] of store) {
      if (expiry <= now) store.delete(key);
    }
    // احذف الـ namespace إذا صار فارغاً
    if (store.size === 0) stores.delete(namespace);
  }

  lastSweep = now;
}

/**
 * هل المفتاح ما زال تحت الـ cooldown؟
 *
 * @param {string} namespace  - مثل "abuse" أو "report"
 * @param {string} key        - عادةً `${guildId}:${userId}`
 * @returns {boolean}         - true = ممنوع الآن (ما زال في فترة الانتظار)
 */
export function isOnCooldown(namespace, key) {
  maybeSweep();

  const store  = getStore(namespace);
  const expiry = store.get(key);

  if (expiry == null) return false;
  if (expiry <= Date.now()) {
    store.delete(key);          // انتهت المدة — نظّفه
    return false;
  }
  return true;
}

/**
 * يُرجع الثواني المتبقية على الـ cooldown (0 إذا انتهى)
 *
 * @param {string} namespace
 * @param {string} key
 * @returns {number}
 */
export function getCooldownLeft(namespace, key) {
  maybeSweep();

  const store  = getStore(namespace);
  const expiry = store.get(key);

  if (expiry == null) return 0;

  const remaining = expiry - Date.now();
  if (remaining <= 0) {
    store.delete(key);
    return 0;
  }
  return Math.ceil(remaining / 1000);
}

/**
 * يُسجّل استخداماً جديداً — يبدأ الـ cooldown من الآن
 *
 * @param {string} namespace
 * @param {string} key
 * @param {number} durationMs - مدة الانتظار بالميلي ثانية
 */
export function setCooldown(namespace, key, durationMs) {
  if (durationMs <= 0) return;
  getStore(namespace).set(key, Date.now() + durationMs);
}

/**
 * يُلغي cooldown مفتاح معين (مثلاً بعد إلغاء العملية)
 *
 * @param {string} namespace
 * @param {string} key
 */
export function clearCooldown(namespace, key) {
  getStore(namespace).delete(key);
}

/**
 * يُنظّف المخازن إذا مرّ وقت كافٍ منذ آخر تنظيف
 */
function maybeSweep() {
  if (Date.now() - lastSweep >= SWEEP_INTERVAL_MS) {
    sweepExpired();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال مختصرة للاستخدام الشائع
// ─────────────────────────────────────────────────────────────────────────────

/**
 * فحص + تسجيل في خطوة واحدة
 *
 * @example
 * const left = checkAndSet("abuse", key, 30_000);
 * if (left > 0) return reply(`انتظر ${left} ثانية`);
 *
 * @param {string} namespace
 * @param {string} key
 * @param {number} durationMs
 * @returns {number} - الثواني المتبقية (0 = مسموح، وتم التسجيل)
 */
export function checkAndSet(namespace, key, durationMs) {
  const left = getCooldownLeft(namespace, key);
  if (left > 0) return left;

  setCooldown(namespace, key, durationMs);
  return 0;
}

/**
 * عدد المفاتيح النشطة — مفيد للتشخيص
 *
 * @param {string} [namespace]
 * @returns {number}
 */
export function size(namespace) {
  if (namespace) return getStore(namespace).size;
  let total = 0;
  for (const store of stores.values()) total += store.size;
  return total;
}
