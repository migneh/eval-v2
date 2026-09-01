// src/utils/config-loader.js
// ─────────────────────────────────────────────────────────────────────────────
// تحميل إعدادات البوت بشكل موحّد
//
// كان index.js و deploy.js يكرّران نفس كود التحقق حرفياً،
// فأي تعديل على طريقة التحقق كان يحتاج تحديث ملفين.
//
// مصادر الإعدادات (بترتيب الأولوية):
//   1. متغيّرات البيئة  DISCORD_TOKEN / DISCORD_CLIENT_ID  ← للاستضافة السحابية
//   2. ملف config.js في جذر المشروع                        ← للتطوير المحلي
//
// لماذا متغيّرات البيئة؟
//   كثير من منصات الاستضافة لا تسمح بكتابة ملفات، وتدعم فقط الـ env vars.
//   وأيضاً أكثر أماناً: لا يُحفظ التوكن داخل المستودع بالخطأ.
// ─────────────────────────────────────────────────────────────────────────────

// القيم الوهمية الموجودة في config.example.js — تُرفض دائماً
const PLACEHOLDERS = new Set([
  "ضع_توكن_البوت_هنا",
  "ضع_client_id_هنا",
  "توكن_البوت",
  "Application_ID",
  "",
]);

/**
 * هل القيمة فارغة أو ما زالت القيمة الوهمية؟
 *
 * @param {string} value
 * @returns {boolean}
 */
function isPlaceholder(value) {
  if (value == null) return true;
  return PLACEHOLDERS.has(String(value).trim());
}

/**
 * يُرجع مثالاً جاهزاً للمستخدم عند الخطأ
 */
function printHelpAndExit(reason) {
  console.error("─────────────────────────────────────────");
  console.error(`❌ خطأ في الإعدادات: ${reason}`);
  console.error("─────────────────────────────────────────");
  console.error("📋 الحل — اختر إحدى الطريقتين:");
  console.error("");
  console.error("   الطريقة 1 (محلي):");
  console.error("     cp config.example.js config.js");
  console.error("     ثم عدّل القيم داخل الملف");
  console.error("");
  console.error("   الطريقة 2 (استضافة سحابية):");
  console.error("     export DISCORD_TOKEN='توكن_البوت'");
  console.error("     export DISCORD_CLIENT_ID='Application_ID'");
  console.error("─────────────────────────────────────────");
  process.exit(1);
}

/**
 * يحمّل إعدادات البوت
 *
 * يُوقف العملية برسالة واضحة إذا كانت الإعدادات ناقصة.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.requireClientId=true] - deploy.js يحتاجه، index.js لا
 * @returns {{ token: string, clientId: string|null, source: string }}
 */
export async function loadConfig(opts = {}) {
  const requireClientId = opts.requireClientId ?? true;

  // ─── 1. متغيّرات البيئة ────────────────────────────────────────────────────
  let token    = process.env.DISCORD_TOKEN    || null;
  let clientId = process.env.DISCORD_CLIENT_ID || null;
  let source   = "متغيّرات البيئة";

  // ─── 2. ملف config.js ──────────────────────────────────────────────────────
  if (isPlaceholder(token) || (requireClientId && isPlaceholder(clientId))) {
    try {
      const cfg = await import("../../config.js");

      if (isPlaceholder(token) && !isPlaceholder(cfg.default?.token)) {
        token = cfg.default.token;
        source = "config.js";
      }
      if (isPlaceholder(clientId) && !isPlaceholder(cfg.default?.clientId)) {
        clientId = cfg.default.clientId;
        source = "config.js";
      }
    } catch {
      // config.js غير موجود — سنبلغ المستخدم أدناه
    }
  }

  // ─── 3. التحقق النهائي ─────────────────────────────────────────────────────
  if (isPlaceholder(token)) {
    printHelpAndExit("التوكن غير صالح أو غير موجود");
  }

  if (requireClientId && isPlaceholder(clientId)) {
    printHelpAndExit("معرّف التطبيق (clientId) غير صالح أو غير موجود");
  }

  return { token, clientId, source };
}

/**
 * نسخة متزامنة للحالات التي لا تقبل await (نادراً ما تُحتاج)
 * تعتمد على وجود config.js فقط
 *
 * @returns {{ token: string, clientId: string|null, source: string }}
 */
export function loadConfigSync() {
  let token    = process.env.DISCORD_TOKEN     || null;
  let clientId = process.env.DISCORD_CLIENT_ID || null;

  return { token, clientId, source: "متغيّرات البيئة" };
}
