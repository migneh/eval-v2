// src/utils/logger.js
// ─────────────────────────────────────────────────────────────────────────────
// نظام السجلات الموجّهة (Log Router)
//
// كل حدث في البوت يحمل LogType، وكل LogType يُوجَّه إلى قناة (أو أكثر)
// من القنوات الثمانية في config.logChannels:
//
//   all        → تستقبل كل الأحداث دائماً (بغض النظر عن الباقي)
//   points     → /add  /remove  /reset
//   moderation → /warn  /timeout
//   reviews    → قبول/رفض العقوبات
//   appeals    → الاستئنافات
//   tasks      → إكمال المهام
//   rewards    → الترقيات والمراحل
//   settings   → تغييرات /setup
//
// قواعد التصميم:
//   ✅ log() لا يرمي أبداً — فشل التسجيل لا يُسقط الأمر الذي سببه
//   ✅ القناة غير موجودة أو محذوفة ← يُتجاهل بصمت
//   ✅ نفس القناة لا تستقبل نفس الحدث مرتين
//   ✅ الحقول تُقصّ/tُنظَّف قبل الإرسال لتفادي أخطاء Discord API
// ─────────────────────────────────────────────────────────────────────────────

import { EmbedBuilder } from "discord.js";
import { getConfig } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// أنواع الأحداث
// ─────────────────────────────────────────────────────────────────────────────

/**
 * كل أنواع الأحداث التي يسجّلها البوت
 * القيمة = اسم القناة الفرعية في config.logChannels
 */
export const LogType = Object.freeze({
  POINTS_ADD:      "points",
  POINTS_REMOVE:   "points",
  POINTS_RESET:    "points",
  MODERATION:      "moderation",
  REVIEW:          "reviews",
  APPEAL:          "appeals",
  TASK:            "tasks",
  PROMOTION:       "rewards",
  CONFIG_CHANGED:  "settings",
});

// ─── ألوان كل نوع ──────────────────────────────────────────────────────────────
const TYPE_COLORS = {
  points:     0x57f287,   // أخضر
  moderation: 0xeb459e,   // بنفسجي
  reviews:    0x5865f2,   // أزرق
  appeals:    0xffa500,   // برتقالي
  tasks:      0x00d4aa,   // تركوازي
  rewards:    0xffd700,   // ذهبي
  settings:   0x99aab5,   // رمادي
};

// ─── تسميات عربية لكل قناة (تُعرض في الفوتر) ───────────────────────────────────
const TYPE_LABELS = {
  points:     "💰 نقاط",
  moderation: "⚖️ موديريشن",
  reviews:    "🔍 مراجعات",
  appeals:    "🔁 استئنافات",
  tasks:      "📋 مهام",
  rewards:    "🏆 مكافآت",
  settings:   "⚙️ إعدادات",
};

// ─────────────────────────────────────────────────────────────────────────────
// بناء الـ Embed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُنشئ Embed موحّد للسجل
 *
 * يُستخدم بهذا الشكل في كل مكان في البوت:
 *   makeLogEmbed(LogType.POINTS_ADD, "➕ نقاط مضافة", [{ name, value, inline }])
 *
 * @param {string}  type     - أحد ثوابت LogType
 * @param {string}  title    - عنوان الحدث
 * @param {Array}   fields   - [{ name, value, inline }]
 * @param {object} [opts]    - { description, thumbnail }
 * @returns {EmbedBuilder}
 */
export function makeLogEmbed(type, title, fields = [], opts = {}) {
  const channelKey = LogType[type] || type;   // يقبل "points" مباشرة أيضاً
  const color      = TYPE_COLORS[channelKey] ?? 0x5865f2;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(truncate(title || "حدث", 256))
    .setTimestamp();

  if (opts.description) {
    embed.setDescription(safeFieldValue(opts.description, 4096));
  }

  // نظّف الحقول: لا حقول فارغة، لا قيم تتجاوز حدود Discord
  for (const field of sanitizeFields(fields)) {
    embed.addFields(field);
  }

  if (opts.thumbnail) embed.setThumbnail(opts.thumbnail);

  embed.setFooter({ text: TYPE_LABELS[channelKey] || "📄 سجل" });

  return embed;
}

/**
 * يُرسل Embed إلى كل القنوات المعنية بالحدث
 *
 * لا يرمي أبداً — أي فشل يُسجَّل في الكونسول فقط.
 *
 * @param {Guild}                 guild
 * @param {string}                type   - أحد ثوابت LogType
 * @param {EmbedBuilder|object}   embed  - Embed جاهز أو payload جاهز للإرسال
 * @returns {Promise<number>}     عدد القنوات التي وصلها السجل بنجاح
 */
export async function log(guild, type, embed) {
  try {
    if (!guild) return 0;

    const config      = getConfig(guild.id);
    const logChannels = config.logChannels || {};

    const channelKey = LogType[type] || type;

    // القنوات المستهدفة: القناة النوعية + القناة العامة (all)
    const targetIds = [logChannels[channelKey], logChannels.all]
      .filter(Boolean)
      .filter((id, i, arr) => arr.indexOf(id) === i);   // إزالة التكرار

    if (!targetIds.length) return 0;

    //payload جاهز للإرسال
    const payload = embed instanceof EmbedBuilder
      ? { embeds: [embed] }
      : embed;

    let sent = 0;

    for (const channelId of targetIds) {
      try {
        const ch = guild.channels.cache.get(channelId);
        if (!ch?.isTextBased()) continue;

        await ch.send(payload);
        sent++;
      } catch (err) {
        // قناة محذوفة، أو البوت فقد صلاحية الكتابة، أو rate limit
        console.error(
          `❌ فشل التسجيل في القناة ${channelId} (${channelKey}):`,
          err.message,
        );
      }
    }

    return sent;
  } catch (err) {
    // لا نسمح لخطأ في التسجيل بإسقاط الأمر الأصلي
    console.error("❌ خطأ غير متوقع في logger.log:", err);
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال مساعدة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُزيل الحقول الفارغة ويُقصّر القيم الطويلة
 * Discord يرفض: value فارغ، name > 256، value > 1024، أكثر من 25 حقل
 *
 * @param {Array} fields
 * @returns {Array}
 */
function sanitizeFields(fields) {
  if (!Array.isArray(fields)) return [];

  return fields
    .filter((f) => f && f.name != null && f.value != null)
    .map((f) => ({
      name:   truncate(String(f.name), 256),
      value:  safeFieldValue(String(f.value), 1024),
      inline: Boolean(f.inline),
    }))
    .slice(0, 25);   // أقصى عدد حقول يسمح به Discord
}

/**
 * يضمن أن قيمة الحقل ليست فارغة
 * Discord يرفض الـ Embed إذا كانت قيمة الحقل ""
 */
function safeFieldValue(value, maxLength) {
  const truncated = truncate(value, maxLength);
  return truncated.trim() === "" ? "—" : truncated;
}

/**
 * يقصّر نصاً بطول أقصى مع إضافة ...
 */
function truncate(text, maxLength) {
  if (typeof text !== "string") text = String(text ?? "");
  if (text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 1)) + "…";
}

// ─────────────────────────────────────────────────────────────────────────────
// دالة مساعدة للاختبار: تُرجع قائمة القنوات التي سيصلها نوع معين
// ─────────────────────────────────────────────────────────────────────────────

/**
 * مفيد لتشخيص "ليش السجل ما يوصل؟"
 *
 * @param {string} guildId
 * @param {string} type
 * @returns {Array<string>}
 */
export function resolveLogChannels(guildId, type) {
  const logChannels = getConfig(guildId).logChannels || {};
  const channelKey  = LogType[type] || type;

  return [logChannels[channelKey], logChannels.all]
    .filter(Boolean)
    .filter((id, i, arr) => arr.indexOf(id) === i);
}
