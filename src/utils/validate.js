// src/utils/validate.js
// ─────────────────────────────────────────────────────────────────────────────
// أدوات التحقق من المدخلات
//
// المشكلة التي يحلّها هذا الملف:
//   الكود كان يستخدم `parseInt(raw)` ثم `isNaN(amount)` للتحقق.
//   لكن parseInt متساهلة جداً:
//     parseInt("100abc") → 100   ✅ يمرّ (وهو مدخل خاطئ)
//     parseInt("12.9")   → 12    ✅ يمرّ (بصمت، بدون تنبيه)
//     parseInt("1e3")    → 1     ✅ يمرّ (نتيجة مفاجئة تماماً)
//     parseInt("")       → NaN   ❌ يُرفض (صحيح)
//   والفحص `Number.isInteger(amount)` بعد parseInt لا فائدة منه أبداً
//   لأن parseInt تُرجع دائماً عدداً صحيحاً أو NaN.
//
// الحل: regex صارم يقبل الأرقام فقط.
// ─────────────────────────────────────────────────────────────────────────────

// أرقام عربية/لاتينية فقط، بدون إشارات أو مسافات أو فواصل عشرية
const UNSIGNED_INT_RE = /^[0-9\u0660-\u0669]+$/;

/**
 * يُحوّل نصاً إلى عدد صحيح موجب، أو null إذا لم يكن صالحاً
 *
 * يقبل: "100", "٠١٢٣" (أرقام عربية)
 * يرفض: "100abc", "-5", "12.5", "1e3", "", "   ", "NaN", "Infinity"
 *
 * @param {string} raw      - النص الخام من المستخدم
 * @param {object} [opts]   - { max, min }
 * @returns {number|null}
 */
export function parsePositiveInt(raw, opts = {}) {
  if (raw == null) return null;

  // طبّع الأرقام العربية إلى لاتينية أولاً
  const normalized = normalizeDigits(String(raw).trim());

  if (!UNSIGNED_INT_RE.test(normalized)) return null;

  const value = Number(normalized);

  if (!Number.isSafeInteger(value)) return null;

  const min = opts.min ?? 1;
  const max = opts.max ?? Number.MAX_SAFE_INTEGER;

  if (value < min) return null;
  if (value > max) return null;

  return value;
}

/**
 * يُحوّل الأرقام العربية (٠-٩) إلى لاتينية (0-9)
 * المستخدمون العرب يكتبون الأرقام العربية غالباً
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeDigits(text) {
  return text.replace(/[\u0660-\u0669]/g, (d) =>
    String(d.charCodeAt(0) - 0x0660)
  );
}

/**
 * يتحقق أن النص معرف ديسكورد (snowflake) صالح
 * 17 إلى 20 رقماً
 *
 * @param {string} raw
 * @returns {boolean}
 */
export function isValidSnowflake(raw) {
  if (!raw) return false;

  const normalized = normalizeDigits(String(raw).trim());
  return /^\d{17,20}$/.test(normalized);
}

/**
 * يقصّر نصاً ويضمن أنه ليس فارغاً (Discord يرفض الحقول الفارغة)
 *
 * @param {string} text
 * @param {number} maxLength
 * @param {string} [fallback]
 * @returns {string}
 */
export function safeText(text, maxLength = 1024, fallback = "—") {
  if (text == null) return fallback;

  const str = String(text);
  if (str.trim() === "") return fallback;
  if (str.length <= maxLength) return str;

  return str.slice(0, Math.max(0, maxLength - 1)) + "…";
}
