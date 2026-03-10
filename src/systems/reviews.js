// src/systems/reviews.js
// ─────────────────────────────────────────────────────────────────────────────
// نظام المراجعة الكامل
//
// الدورة الكاملة:
//   /warn أو /timeout
//       ↓
//   createReview()  ← ينشئ بطاقة في قناة المراجعة
//       ↓
//   المراجع يضغط ✅ أو ❌
//       ↓
//   acceptReview() أو rejectReview()
//       ↓
//   ✅ قبول  → addPointsToUser() → checkPromotion() → إشعار DM
//   ❌ رفض   → يُشال التوقيف → canAppeal=true → إشعار DM
//       ↓
//   /appeal → createAppeal()
//       ↓
//   نفس دورة المراجعة (مرة أو مرتين بحد أقصى)
// ─────────────────────────────────────────────────────────────────────────────

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import {
  getConfig,
  getReviews,
  saveReviews,
  addPointsToUser,
  addMemberLogEntry,
} from "../utils/db.js";

import { log, makeLogEmbed, LogType } from "../utils/logger.js";
import { checkPromotion }             from "./promotions.js";

// ─────────────────────────────────────────────────────────────────────────────
// ثوابت
// ─────────────────────────────────────────────────────────────────────────────

const REMINDER_DELAY_MS = 60 * 60 * 1000;   // 1 ساعة قبل تنبيه التأخر
const MAX_APPEALS       = 2;                  // أقصى عدد استئنافات لكل عقوبة

// ─────────────────────────────────────────────────────────────────────────────
// بناء Embed بطاقة المراجعة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يبني Embed بطاقة المراجعة بناءً على بيانات الطلب
 *
 * @param {object} review  - بيانات الطلب من reviews.json
 * @param {Guild}  guild   - السيرفر (لجلب أيقونته)
 * @returns {EmbedBuilder}
 */
export function buildReviewEmbed(review, guild) {
  const isWarn    = review.type === "warn";
  const typeLabel = isWarn ? "⚠️ تحذير" : "⏰ تايم أوت";
  const color     = review.isAppeal
    ? 0xffa500                          // برتقالي للاستئناف
    : isWarn ? 0xfee75c : 0xeb459e;    // أصفر للتحذير، بنفسجي للتوقيف

  // حساب نقاط العقوبة المتوقعة
  const config       = getConfig(guild.id);
  const expectedPts  = calcExpectedPoints(review, config);

  // عنوان الـ Embed
  let title = `${typeLabel} — بانتظار المراجعة`;
  if (review.isAppeal) {
    title = review.appealNumber === 2
      ? `🔁 استئناف نهائي — ${typeLabel}`
      : `🔁 استئناف أول — ${typeLabel}`;
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setThumbnail(guild.iconURL({ dynamic: true }))
    .addFields(
      { name: "👮 المشرف المنفذ",  value: `<@${review.executorId}>`,  inline: true },
      { name: "🎯 العضو المعاقب",  value: `<@${review.targetId}>`,    inline: true },
      { name: "📋 نوع العقوبة",    value: typeLabel,                   inline: true },
      { name: "📝 السبب",          value: review.reason || "لا يوجد سبب" },
      { name: "🏆 النقاط المتوقعة", value: `${expectedPts} نقطة`,     inline: true },
      { name: "🆔 معرف الطلب",     value: `\`${review.id}\``,         inline: true },
    )
    .setTimestamp(review.createdAt);

  // مدة التوقيف إن وُجدت
  if (!isWarn && review.duration) {
    const hours   = Math.floor(review.duration / 60);
    const minutes = review.duration % 60;
    const durText = hours > 0
      ? `${hours} ساعة ${minutes > 0 ? `و ${minutes} دقيقة` : ""}`
      : `${minutes} دقيقة`;
    embed.addFields({ name: "⏱ المدة", value: durText, inline: true });
  }

  // سبب الاستئناف
  if (review.isAppeal && review.appealReason) {
    embed.addFields({ name: "🗣 سبب الاستئناف", value: review.appealReason });
  }

  return embed;
}

// ─────────────────────────────────────────────────────────────────────────────
// بناء أزرار المراجعة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يبني صف الأزرار (قبول / رفض)
 *
 * @param {string}  reviewId  - معرف الطلب
 * @param {boolean} disabled  - هل الأزرار معطّلة (بعد اتخاذ القرار)
 * @returns {ActionRowBuilder}
 */
export function buildReviewButtons(reviewId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`review_accept:${reviewId}`)
      .setLabel("✅ قبول")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`review_reject:${reviewId}`)
      .setLabel("❌ رفض")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// إنشاء طلب مراجعة جديد
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُنشئ بطاقة مراجعة في قناة المراجعة
 *
 * @param {Guild}  guild
 * @param {object} data  - { type, executorId, targetId, reason, duration? }
 * @returns {string|null} - reviewId أو null إذا لم تكن هناك قناة مراجعة
 */
export async function createReview(guild, data) {
  const config          = getConfig(guild.id);
  const reviewChannelId = config.reviewChannel;

  if (!reviewChannelId) return null;

  const ch = guild.channels.cache.get(reviewChannelId);
  if (!ch?.isTextBased()) return null;

  // ─── إنشاء الطلب ─────────────────────────────────────────────────────────────
  const reviewId = generateReviewId();

  const review = {
    id:           reviewId,
    type:         data.type,         // "warn" | "timeout"
    executorId:   data.executorId,
    targetId:     data.targetId,
    reason:       data.reason || "لا يوجد سبب",
    duration:     data.duration || null,  // بالدقائق (للتوقيف فقط)
    guildId:      guild.id,
    status:       "pending",          // pending | accepted | rejected
    createdAt:    Date.now(),
    messageId:    null,               // يُضاف بعد إرسال الرسالة
    channelId:    null,               // يُضاف بعد إرسال الرسالة
    reviewerId:   null,               // من راجع الطلب
    reviewedAt:   null,               // وقت المراجعة
    rejectReason: null,               // سبب الرفض
    isAppeal:     false,
    appealNumber: 0,                  // 0 = طلب أصلي، 1 = استئناف أول، 2 = ثانٍ
    appealReason: null,
    canAppeal:    false,              // هل يحق الاستئناف بعد الرفض
  };

  // ─── إرسال البطاقة ───────────────────────────────────────────────────────────
  const embed = buildReviewEmbed(review, guild);
  const row   = buildReviewButtons(reviewId);

  let msg;
  try {
    msg = await ch.send({ embeds: [embed], components: [row] });
  } catch (err) {
    console.error("❌ فشل إرسال بطاقة المراجعة:", err);
    return null;
  }

  // ─── حفظ الطلب ───────────────────────────────────────────────────────────────
  review.messageId = msg.id;
  review.channelId = ch.id;

  const reviews      = getReviews(guild.id);
  reviews[reviewId]  = review;
  saveReviews(guild.id, reviews);

  // ─── تسجيل في السجل ──────────────────────────────────────────────────────────
  await log(guild, LogType.MODERATION, makeLogEmbed(LogType.MODERATION,
    review.type === "warn" ? "⚠️ تحذير جديد" : "⏰ تايم أوت جديد",
    [
      { name: "المشرف",    value: `<@${review.executorId}>`, inline: true },
      { name: "العضو",     value: `<@${review.targetId}>`,   inline: true },
      { name: "السبب",     value: review.reason },
      { name: "معرف الطلب", value: `\`${reviewId}\`` },
    ]
  ));

  // ─── جدولة تنبيه التأخر ───────────────────────────────────────────────────────
  scheduleReminder(guild, reviewId, ch.id, false);

  return reviewId;
}

// ─────────────────────────────────────────────────────────────────────────────
// إنشاء استئناف
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُحوّل طلب مرفوض إلى استئناف ويُرسله للقناة المناسبة
 *
 * @param {Guild}  guild
 * @param {string} reviewId     - معرف الطلب الأصلي
 * @param {string} appealReason - سبب الاستئناف
 * @param {string} executorId   - المشرف الذي يستأنف
 * @returns {{ success, msg? }}
 */
export async function createAppeal(guild, reviewId, appealReason, executorId) {
  const reviews = getReviews(guild.id);
  const review  = reviews[reviewId];

  // ─── فحوصات ──────────────────────────────────────────────────────────────────
  if (!review) {
    return { success: false, msg: "الطلب غير موجود." };
  }
  if (review.executorId !== executorId) {
    return { success: false, msg: "هذا الطلب ليس لك." };
  }
  if (!review.canAppeal) {
    return { success: false, msg: "لا يحق لك الاستئناف على هذا الطلب." };
  }
  if (review.appealNumber >= MAX_APPEALS) {
    return { success: false, msg: "وصلت للحد الأقصى من الاستئنافات." };
  }

  const config      = getConfig(guild.id);
  const appealNum   = review.appealNumber + 1;

  // تحديد القناة المستهدفة
  // الاستئناف الأول → قناة المراجعة العادية
  // الاستئناف الثاني → قناة الاستئنافات (أو المراجعة إن لم تكن محددة)
  const targetChannelId = appealNum === 2
    ? (config.logChannels?.appeals || config.reviewChannel)
    : config.reviewChannel;

  if (!targetChannelId) {
    return { success: false, msg: "لا توجد قناة مراجعة مُعدَّة." };
  }

  const ch = guild.channels.cache.get(targetChannelId);
  if (!ch?.isTextBased()) {
    return { success: false, msg: "قناة المراجعة غير متاحة." };
  }

  // ─── تحديث الطلب ─────────────────────────────────────────────────────────────
  review.status       = "pending";
  review.isAppeal     = true;
  review.appealNumber = appealNum;
  review.appealReason = appealReason;
  review.canAppeal    = false;
  review.reviewerId   = null;
  review.reviewedAt   = null;
  review.rejectReason = null;

  // ─── إرسال بطاقة الاستئناف ───────────────────────────────────────────────────
  const embed = buildReviewEmbed(review, guild);
  const row   = buildReviewButtons(reviewId);

  // ping لرتبة الاستئناف في الاستئناف الثاني
  let content = "";
  if (appealNum === 2 && config.appealRole) {
    content = `<@&${config.appealRole}> — استئناف نهائي يحتاج مراجعتكم!`;
  }

  let msg;
  try {
    msg = await ch.send({ content, embeds: [embed], components: [row] });
  } catch (err) {
    console.error("❌ فشل إرسال بطاقة الاستئناف:", err);
    return { success: false, msg: "فشل إرسال الاستئناف. تحقق من صلاحيات البوت." };
  }

  review.messageId = msg.id;
  review.channelId = ch.id;
  reviews[reviewId] = review;
  saveReviews(guild.id, reviews);

  // ─── تسجيل في السجل ──────────────────────────────────────────────────────────
  await log(guild, LogType.APPEAL, makeLogEmbed(LogType.APPEAL,
    `🔁 استئناف ${appealNum === 2 ? "ثانٍ (نهائي)" : "أول"}`,
    [
      { name: "المشرف",    value: `<@${executorId}>`,  inline: true },
      { name: "الاستئناف", value: `رقم ${appealNum}`, inline: true },
      { name: "السبب",     value: appealReason || "لا يوجد سبب" },
    ]
  ));

  // ─── جدولة تنبيه التأخر ───────────────────────────────────────────────────────
  scheduleReminder(guild, reviewId, ch.id, true);

  return {
    success:     true,
    appealNumber: appealNum,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// قبول المراجعة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يقبل طلب المراجعة — يُضيف النقاط ويُحدّث البطاقة
 *
 * @param {Guild}  guild
 * @param {string} reviewId   - معرف الطلب
 * @param {string} reviewerId - من قبل الطلب
 * @returns {{ success, points?, reason? }}
 */
export async function acceptReview(guild, reviewId, reviewerId) {
  const reviews = getReviews(guild.id);
  const review  = reviews[reviewId];

  // ─── فحوصات ──────────────────────────────────────────────────────────────────
  if (!review) {
    return { success: false, reason: "not_found" };
  }
  if (review.status !== "pending") {
    return { success: false, reason: "already_reviewed" };
  }

  // ─── حساب النقاط ─────────────────────────────────────────────────────────────
  const config = getConfig(guild.id);
  const points = calcExpectedPoints(review, config);

  // ─── تحديث الطلب ─────────────────────────────────────────────────────────────
  review.status     = "accepted";
  review.reviewerId = reviewerId;
  review.reviewedAt = Date.now();
  review.canAppeal  = false;

  reviews[reviewId] = review;
  saveReviews(guild.id, reviews);

  // ─── إضافة النقاط للمشرف ─────────────────────────────────────────────────────
  const typeLabel = review.type === "warn" ? "تحذير" : "تايم أوت";
  addPointsToUser(
    guild.id,
    review.executorId,
    points,
    "moderation",
    `عقوبة مقبولة: ${typeLabel}`,
    reviewerId,
  );

  // ─── تسجيل في سجل الأعضاء ────────────────────────────────────────────────────
  addMemberLogEntry(guild.id, review.targetId, {
    type:       review.type,
    duration:   review.duration,
    reason:     review.reason,
    executorId: review.executorId,
    reviewerId,
    result:     review.isAppeal ? "قُبل الاستئناف" : "مقبولة",
  });

  // ─── تحديث بطاقة المراجعة ────────────────────────────────────────────────────
  await updateReviewMessage(guild, review, {
    status:     "✅ مقبولة",
    color:      0x57f287,
    reviewerId,
    extra:      `النقاط المضافة: **+${points}**`,
  });

  // ─── إشعار DM للمشرف ─────────────────────────────────────────────────────────
  await notifyExecutor(guild, review, "accepted", points);

  // ─── تسجيل في سجل البوت ──────────────────────────────────────────────────────
  await log(guild, LogType.REVIEW, makeLogEmbed(LogType.REVIEW, "✅ عقوبة مقبولة", [
    { name: "المشرف",  value: `<@${review.executorId}>`, inline: true },
    { name: "المراجع", value: `<@${reviewerId}>`,         inline: true },
    { name: "النقاط",  value: `+${points}`,               inline: true },
    { name: "النوع",   value: typeLabel,                   inline: true },
  ]));

  // ─── فحص الترقية ─────────────────────────────────────────────────────────────
  await checkPromotion(guild, review.executorId);

  return { success: true, points };
}

// ─────────────────────────────────────────────────────────────────────────────
// رفض المراجعة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يرفض طلب المراجعة — يُشيل العقوبة ويُتيح الاستئناف
 *
 * @param {Guild}  guild
 * @param {string} reviewId     - معرف الطلب
 * @param {string} reviewerId   - من رفض الطلب
 * @param {string} rejectReason - سبب الرفض (اختياري)
 * @returns {{ success, canAppeal?, reason? }}
 */
export async function rejectReview(guild, reviewId, reviewerId, rejectReason = "") {
  const reviews = getReviews(guild.id);
  const review  = reviews[reviewId];

  // ─── فحوصات ──────────────────────────────────────────────────────────────────
  if (!review) {
    return { success: false, reason: "not_found" };
  }
  if (review.status !== "pending") {
    return { success: false, reason: "already_reviewed" };
  }

  // ─── هل يحق الاستئناف؟ ────────────────────────────────────────────────────────
  const canAppeal = review.appealNumber < MAX_APPEALS;

  // ─── تحديث الطلب ─────────────────────────────────────────────────────────────
  review.status       = "rejected";
  review.reviewerId   = reviewerId;
  review.reviewedAt   = Date.now();
  review.rejectReason = rejectReason || null;
  review.canAppeal    = canAppeal;

  reviews[reviewId] = review;
  saveReviews(guild.id, reviews);

  // ─── إزالة التوقيف من العضو ──────────────────────────────────────────────────
  if (review.type === "timeout") {
    try {
      const targetMember = await guild.members.fetch(review.targetId);
      await targetMember.timeout(null, "عقوبة مرفوضة من المراجع");
    } catch {
      // العضو غير موجود أو انتهى التوقيف مسبقاً — لا بأس
    }
  }

  // ─── تسجيل في سجل الأعضاء ────────────────────────────────────────────────────
  addMemberLogEntry(guild.id, review.targetId, {
    type:         review.type,
    duration:     review.duration,
    reason:       review.reason,
    executorId:   review.executorId,
    reviewerId,
    result:       review.appealNumber > 0 ? "رُفض الاستئناف" : "مرفوضة",
    rejectReason: rejectReason || null,
  });

  // ─── تحديث بطاقة المراجعة ────────────────────────────────────────────────────
  await updateReviewMessage(guild, review, {
    status:     "❌ مرفوضة",
    color:      0xed4245,
    reviewerId,
    extra:      rejectReason
      ? `سبب الرفض: ${rejectReason}`
      : "لم يُذكر سبب للرفض",
  });

  // ─── إشعار DM للمشرف ─────────────────────────────────────────────────────────
  await notifyExecutor(guild, review, "rejected", 0, rejectReason, canAppeal);

  // ─── تسجيل في سجل البوت ──────────────────────────────────────────────────────
  const typeLabel = review.type === "warn" ? "تحذير" : "تايم أوت";
  await log(guild, LogType.REVIEW, makeLogEmbed(LogType.REVIEW, "❌ عقوبة مرفوضة", [
    { name: "المشرف",              value: `<@${review.executorId}>`, inline: true },
    { name: "المراجع",             value: `<@${reviewerId}>`,         inline: true },
    { name: "النوع",               value: typeLabel,                   inline: true },
    { name: "يحق الاستئناف",       value: canAppeal ? "✅" : "❌",   inline: true },
    { name: "سبب الرفض",          value: rejectReason || "لم يُذكر" },
  ]));

  return { success: true, canAppeal };
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال مساعدة داخلية
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يحسب النقاط المتوقعة للعقوبة بناءً على الإعدادات
 *
 * @param {object} review
 * @param {object} config
 * @returns {number}
 */
function calcExpectedPoints(review, config) {
  const mp = config.modPoints || {};

  if (review.type === "warn") {
    return mp.warn ?? 10;
  }

  // تايم أوت: نقاط أساسية + نقاط لكل ساعة
  const base    = mp.timeoutBase    ?? 5;
  const perHour = mp.timeoutPerHour ?? 3;
  const hours   = review.duration
    ? Math.ceil(review.duration / 60)   // duration بالدقائق → تحويل لساعات
    : 0;

  return base + (perHour * hours);
}

/**
 * يُحدّث رسالة بطاقة المراجعة بعد اتخاذ القرار
 * يُعطّل الأزرار ويُضيف حقل الحالة
 *
 * @param {Guild}  guild
 * @param {object} review
 * @param {object} opts   - { status, color, reviewerId, extra }
 */
async function updateReviewMessage(guild, review, opts) {
  try {
    const ch = guild.channels.cache.get(review.channelId);
    if (!ch) return;

    const msg = await ch.messages.fetch(review.messageId);
    if (!msg) return;

    // أعد بناء الـ Embed بنفس البيانات + إضافة حقل الحالة
    const embed = buildReviewEmbed(review, guild);
    embed.setColor(opts.color);
    embed.addFields(
      { name: "📌 الحالة",    value: opts.status,            inline: true },
      { name: "👤 المراجع",   value: `<@${opts.reviewerId}>`, inline: true },
    );
    if (opts.extra) {
      embed.addFields({ name: "📎 ملاحظة", value: opts.extra });
    }

    // عطّل الأزرار
    const disabledRow = buildReviewButtons(review.id, true);

    await msg.edit({ embeds: [embed], components: [disabledRow] });
  } catch {
    // الرسالة حُذفت أو البوت فقد الوصول — لا بأس
  }
}

/**
 * يُرسل DM للمشرف المنفذ لإعلامه بنتيجة المراجعة
 *
 * @param {Guild}   guild
 * @param {object}  review
 * @param {string}  result      - "accepted" | "rejected"
 * @param {number}  points      - النقاط المضافة (عند القبول)
 * @param {string}  rejectReason
 * @param {boolean} canAppeal
 */
async function notifyExecutor(
  guild,
  review,
  result,
  points      = 0,
  rejectReason = "",
  canAppeal   = false,
) {
  try {
    const user = await guild.client.users.fetch(review.executorId);

    const typeLabel = review.type === "warn" ? "تحذير" : "تايم أوت";
    const isAccepted = result === "accepted";

    const embed = new EmbedBuilder()
      .setColor(isAccepted ? 0x57f287 : 0xed4245)
      .setTitle(isAccepted ? "✅ تم قبول عقوبتك" : "❌ تم رفض عقوبتك")
      .setDescription(
        isAccepted
          ? `تمت مراجعة **${typeLabel}** الذي نفّذته على <@${review.targetId}> وقُبل.`
          : `تمت مراجعة **${typeLabel}** الذي نفّذته على <@${review.targetId}> ورُفض.`
      )
      .addFields(
        { name: "السيرفر",    value: guild.name,      inline: true },
        { name: "نوع العقوبة", value: typeLabel,       inline: true },
      )
      .setTimestamp();

    if (isAccepted) {
      embed.addFields({ name: "🏆 النقاط المضافة", value: `+${points}` });
    } else {
      if (rejectReason) {
        embed.addFields({ name: "📝 سبب الرفض", value: rejectReason });
      }
      embed.addFields({
        name:  "🔁 الاستئناف",
        value: canAppeal
          ? `يحق لك الاستئناف. استخدم \`/appeal\` وأدخل معرف الطلب: \`${review.id}\``
          : "لا يحق لك الاستئناف — القرار نهائي.",
      });
    }

    await user.send({ embeds: [embed] });
  } catch {
    // المشرف أوقف الـ DMs — لا بأس
  }
}

/**
 * يُجدول تنبيه تأخر المراجعة بعد ساعة
 * إذا بقي الطلب pending لأكثر من ساعة → يُرسل ping في القناة
 *
 * @param {Guild}   guild
 * @param {string}  reviewId
 * @param {string}  channelId
 * @param {boolean} isAppeal    - هل هو استئناف؟
 */
function scheduleReminder(guild, reviewId, channelId, isAppeal) {
  setTimeout(async () => {
    try {
      const reviews = getReviews(guild.id);
      const review  = reviews[reviewId];

      // إذا تمت مراجعته → لا تنبيه
      if (!review || review.status !== "pending") return;

      const config = getConfig(guild.id);
      const ch     = guild.channels.cache.get(channelId);
      if (!ch?.isTextBased()) return;

      const typeLabel = review.type === "warn" ? "تحذير" : "تايم أوت";

      // في الاستئناف الثاني → ping رتبة الاستئناف
      let pingText = "";
      if (isAppeal && review.appealNumber === 2 && config.appealRole) {
        pingText = `<@&${config.appealRole}> `;
      }

      await ch.send({
        content: `${pingText}⏰ **تذكير:** يوجد ${isAppeal ? "استئناف" : typeLabel} معلّق منذ أكثر من ساعة!\n🆔 \`${reviewId}\``,
      });
    } catch {
      // السيرفر أو القناة غير متاحة
    }
  }, REMINDER_DELAY_MS);
}

/**
 * يُولّد معرف فريد للطلب
 * الشكل: timestamp_randomString
 * مثال: "1710000000000_ab3f2"
 *
 * @returns {string}
 */
function generateReviewId() {
  const rand = Math.random().toString(36).slice(2, 7);
  return `${Date.now()}_${rand}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال استعلام مُصدَّرة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُرجع كل الطلبات المعلّقة مرتبة حسب الأولوية
 * (تايم أوت أولاً، ثم تحذير — ومن الأقدم للأحدث داخل كل نوع)
 *
 * @param {string} guildId
 * @returns {Array<object>}
 */
export function getPendingReviews(guildId) {
  const reviews = getReviews(guildId);

  return Object.values(reviews)
    .filter((r) => r.status === "pending")
    .sort((a, b) => {
      // التوقيف قبل التحذير
      if (a.type !== b.type) {
        return a.type === "timeout" ? -1 : 1;
      }
      // داخل نفس النوع → الأقدم أولاً
      return a.createdAt - b.createdAt;
    });
}

/**
 * يُرجع طلبات مشرف معين (للاستئناف والتتبع)
 *
 * @param {string} guildId
 * @param {string} executorId
 * @returns {Array<object>}
 */
export function getUserReviews(guildId, executorId) {
  const reviews = getReviews(guildId);
  return Object.values(reviews)
    .filter((r) => r.executorId === executorId)
    .sort((a, b) => b.createdAt - a.createdAt);
}
