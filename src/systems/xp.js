// src/systems/xp.js
// ─────────────────────────────────────────────────────────────────────────────
// نظام XP التلقائي
//
// كيف يعمل:
//   1. المشرف يرسل رسالة
//   2. نتحقق أن له رتبة مشرف
//   3. نتحقق أن الـ cooldown انتهى
//   4. نتحقق أنه لم يتجاوز الحد اليومي
//   5. نُعطيه XP عشوائي بين minXp و maxXp
//   6. نستدعي checkPromotion() لفحص الترقية
// ─────────────────────────────────────────────────────────────────────────────

import {
  getConfig,
  getXpState,
  saveXpState,
  addPointsToUser,
} from "../utils/db.js";
import { isMod }           from "../utils/perms.js";
import { checkPromotion }  from "./promotions.js";
import { log, makeLogEmbed, LogType } from "../utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// الدالة الرئيسية
// ─────────────────────────────────────────────────────────────────────────────

/**
 * معالجة XP عند كل رسالة
 *
 * @param {Message} message - رسالة ديسكورد
 */
export async function handleXp(message) {
  const { guild, member, author } = message;

  // ─── فلترة ───────────────────────────────────────────────────────────────────
  if (!guild || !member || author.bot) return;

  const config = getConfig(guild.id);

  // هل العضو مشرف؟ (له رتبة modRoles أو adminRoles)
  if (!isMod(member, config)) return;

  // ─── إعدادات XP ──────────────────────────────────────────────────────────────
  const xpCfg     = config.xp || {};
  const minXp     = xpCfg.minXp     ?? 5;
  const maxXp     = xpCfg.maxXp     ?? 35;
  const cooldownMs = (xpCfg.cooldown  ?? 60) * 1000;   // تحويل لـ ms
  const dailyLimit = xpCfg.dailyLimit ?? 500;

  // ─── حالة XP الحالية للمشرف ──────────────────────────────────────────────────
  const state     = getXpState(guild.id);
  const userId    = author.id;
  const userState = state[userId] || {
    lastXp:   0,      // timestamp آخر XP مكتسب
    dailyXp:  0,      // مجموع XP اليوم
    dayStart: 0,      // timestamp بداية اليوم الحالي
  };

  const now = Date.now();

  // ─── إعادة تعيين يومية ───────────────────────────────────────────────────────
  // إذا مرّت 24 ساعة منذ بداية اليوم → صفّر العداد اليومي
  if (now - userState.dayStart > 86_400_000) {
    userState.dailyXp  = 0;
    userState.dayStart = now;
  }

  // ─── فحص الـ Cooldown ─────────────────────────────────────────────────────────
  if (now - userState.lastXp < cooldownMs) return;

  // ─── فحص الحد اليومي ─────────────────────────────────────────────────────────
  if (userState.dailyXp >= dailyLimit) return;

  // ─── حساب XP المكتسب ─────────────────────────────────────────────────────────
  // عشوائي بين minXp و maxXp
  const rawXp    = randomInt(minXp, maxXp);

  // لا نتجاوز الحد اليومي المتبقي
  const remaining = dailyLimit - userState.dailyXp;
  const xpGain    = Math.min(rawXp, remaining);

  if (xpGain <= 0) return;

  // ─── حفظ الحالة الجديدة ───────────────────────────────────────────────────────
  userState.lastXp  = now;
  userState.dailyXp += xpGain;
  state[userId]      = userState;
  saveXpState(guild.id, state);

  // ─── إضافة النقاط ────────────────────────────────────────────────────────────
  addPointsToUser(
    guild.id,
    userId,
    xpGain,
    "xp",
    "نشاط رسائل",
    null,    // لا يوجد منفذ — تلقائي
  );

  // ─── فحص الترقية ─────────────────────────────────────────────────────────────
  await checkPromotion(guild, userId);

  // ─── تسجيل في السجل (اختياري — معلّق لتفادي الفيضان) ────────────────────────
  // XP يُعطى بكثرة، لو سجّلنا كل مرة ستمتلئ قناة السجل بسرعة
  // فعّله فقط لو أردت تتبع دقيق:
  //
  // await log(guild, LogType.POINTS_ADD, makeLogEmbed(LogType.POINTS_ADD, "💬 XP مكتسب", [
  //   { name: "المشرف", value: `<@${userId}>`, inline: true },
  //   { name: "XP",     value: `+${xpGain}`,   inline: true },
  //   { name: "اليومي", value: `${userState.dailyXp} / ${dailyLimit}`, inline: true },
  // ]));
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال مساعدة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُرجع رقماً عشوائياً صحيحاً بين min و max (شاملاً)
 *
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomInt(min, max) {
  if (min >= max) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال مساعدة مُصدَّرة (تُستخدم في /setup لعرض الإحصائيات)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُرجع حالة XP لمشرف واحد
 *
 * @param {string} guildId
 * @param {string} userId
 * @returns {{ lastXp, dailyXp, dayStart, remainingToday }}
 */
export function getUserXpState(guildId, userId) {
  const state     = getXpState(guildId);
  const userState = state[userId] || { lastXp: 0, dailyXp: 0, dayStart: 0 };
  const config    = getConfig(guildId);
  const dailyLimit = config.xp?.dailyLimit ?? 500;

  // إذا مرّت 24 ساعة → العداد اليومي صفر
  const isNewDay = Date.now() - userState.dayStart > 86_400_000;

  return {
    lastXp:         userState.lastXp,
    dailyXp:        isNewDay ? 0 : (userState.dailyXp || 0),
    dayStart:       userState.dayStart,
    remainingToday: isNewDay ? dailyLimit : Math.max(0, dailyLimit - (userState.dailyXp || 0)),
  };
}

/**
 * يُرجع الوقت المتبقي حتى انتهاء الـ cooldown (بالثواني)
 * يُستخدم في /mytasks أو /rank لعرض "متاح بعد X ثانية"
 *
 * @param {string} guildId
 * @param {string} userId
 * @returns {number} - الثواني المتبقية (0 إذا انتهى)
 */
export function getXpCooldownLeft(guildId, userId) {
  const state      = getXpState(guildId);
  const userState  = state[userId];
  if (!userState) return 0;

  const config      = getConfig(guildId);
  const cooldownMs  = (config.xp?.cooldown ?? 60) * 1000;
  const elapsed     = Date.now() - (userState.lastXp || 0);
  const remaining   = cooldownMs - elapsed;

  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/**
 * يُعيد تعيين XP اليومي لمشرف واحد (للاختبار أو الإدارة)
 *
 * @param {string} guildId
 * @param {string} userId
 */
export function resetUserDailyXp(guildId, userId) {
  const state = getXpState(guildId);
  if (state[userId]) {
    state[userId].dailyXp  = 0;
    state[userId].dayStart = Date.now();
    saveXpState(guildId, state);
  }
}

/**
 * يُعيد تعيين XP اليومي لكل مشرفي السيرفر
 * يمكن استدعاؤها من cron job عند منتصف الليل
 *
 * @param {string} guildId
 */
export function resetAllDailyXp(guildId) {
  const state = getXpState(guildId);
  const now   = Date.now();

  for (const userId of Object.keys(state)) {
    state[userId].dailyXp  = 0;
    state[userId].dayStart = now;
  }

  saveXpState(guildId, state);
}
