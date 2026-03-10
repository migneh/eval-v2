// src/systems/promotions.js
// ─────────────────────────────────────────────────────────────────────────────
// نظام الترقيات التلقائية واليدوية
//
// المصادر التي تستدعي checkPromotion():
//   - addPointsToUser() في كل مصادر النقاط (manual, xp, moderation, task)
//   - acceptReview() بعد قبول العقوبة
//   - incrementTaskProgress() بعد إكمال مهمة
//
// القواعد الأساسية:
//   ✅ الترقية تلقائية عند تجاوز عتبة المرحلة
//   ❌ النظام لا يخفّض أحداً تلقائياً أبداً
//   ✅ التخفيض اليدوي فقط عبر /promote down
//   ✅ المشرف يحمل رتبة واحدة فقط من السلم في أي وقت
// ─────────────────────────────────────────────────────────────────────────────

import { EmbedBuilder } from "discord.js";

import {
  getConfig,
  getUserPoints,
  getPromotions,
  savePromotions,
  addPromotionEntry,
} from "../utils/db.js";

import { log, makeLogEmbed, LogType } from "../utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// الدالة الرئيسية — تُستدعى بعد كل تغيير في النقاط
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يفحص هل المشرف يستحق ترقية بناءً على نقاطه الحالية
 * إذا نعم → يُعدّل رتبته ويُعلن ويُسجّل
 *
 * @param {Guild}  guild
 * @param {string} userId      - ID المشرف
 * @param {string} triggeredBy - "auto" أو ID من نفّذ التغيير اليدوي
 */
export async function checkPromotion(guild, userId, triggeredBy = "auto") {
  const config     = getConfig(guild.id);
  const milestones = getSortedMilestones(config);

  // لا توجد مراحل مُعدَّة → لا شيء نفعله
  if (!milestones.length) return;

  // ─── جلب العضو ───────────────────────────────────────────────────────────────
  let member;
  try {
    member = await guild.members.fetch(userId);
  } catch {
    // العضو غاب عن السيرفر
    return;
  }

  // ─── النقاط الحالية ──────────────────────────────────────────────────────────
  const userData    = getUserPoints(guild.id, userId);
  const totalPoints = userData.total || 0;

  // ─── أعلى مرحلة يستحقها المشرف حالياً ───────────────────────────────────────
  const targetMilestone = getHighestEligibleMilestone(milestones, totalPoints);

  // ─── كل رتب السلم ────────────────────────────────────────────────────────────
  const allMilestoneRoleIds = milestones.map((m) => m.roleId);

  // ─── الرتب التي يملكها المشرف من السلم حالياً ────────────────────────────────
  const currentMilestoneRoles = allMilestoneRoleIds.filter(
    (roleId) => member.roles.cache.has(roleId)
  );

  const targetRoleId = targetMilestone?.roleId || null;

  // ─── فحص: هل هو بالفعل في الرتبة الصحيحة؟ ───────────────────────────────────
  // إذا يملك رتبة واحدة فقط وهي المستهدفة → لا تغيير
  if (
    targetRoleId &&
    currentMilestoneRoles.length === 1 &&
    currentMilestoneRoles[0] === targetRoleId
  ) return;

  // إذا لا يستحق أي رتبة ولا يملك أي رتبة → لا تغيير
  if (!targetRoleId && currentMilestoneRoles.length === 0) return;

  // ─── إذا لا يستحق رتبة (نقاطه أقل من أدنى مرحلة) ────────────────────────────
  // لا نُشيل رتبه تلقائياً — النظام لا يخفّض
  if (!targetRoleId) return;

  // ─── الرتبة السابقة (للتسجيل) ────────────────────────────────────────────────
  const previousRoleId = currentMilestoneRoles[0] || null;

  // إذا كان لديه الرتبة المستهدفة بالفعل (حتى لو مع رتب أخرى)
  // نُنظّف فقط ونحتفظ بالمستهدفة
  if (currentMilestoneRoles.includes(targetRoleId) && currentMilestoneRoles.length === 1) {
    return;
  }

  // ─── تطبيق التغيير ───────────────────────────────────────────────────────────
  await applyRoleChange(guild, member, allMilestoneRoleIds, targetRoleId);

  // ─── تسجيل التغيير ───────────────────────────────────────────────────────────
  addPromotionEntry(guild.id, userId, {
    type:       triggeredBy === "auto" ? "auto" : "triggered",
    fromRole:   previousRoleId,
    toRole:     targetRoleId,
    points:     totalPoints,
    executorId: triggeredBy === "auto" ? null : triggeredBy,
    reason:     "ترقية تلقائية بناءً على النقاط",
  });

  // ─── إعلان الترقية ───────────────────────────────────────────────────────────
  await announcePromotion(guild, userId, targetRoleId, previousRoleId, totalPoints, config);

  // ─── إشعار DM للمشرف ─────────────────────────────────────────────────────────
  await sendPromotionDM(guild, userId, targetRoleId, totalPoints, "auto");

  // ─── تسجيل في السجل ──────────────────────────────────────────────────────────
  await log(guild, LogType.PROMOTION, makeLogEmbed(LogType.PROMOTION,
    "🏆 ترقية تلقائية",
    [
      { name: "المشرف",       value: `<@${userId}>`,          inline: true },
      { name: "الرتبة الجديدة", value: `<@&${targetRoleId}>`, inline: true },
      { name: "النقاط",       value: `${totalPoints}`,         inline: true },
      {
        name:   "من رتبة",
        value:  previousRoleId ? `<@&${previousRoleId}>` : "لا شيء",
        inline: true,
      },
    ]
  ));
}

// ─────────────────────────────────────────────────────────────────────────────
// الترقية اليدوية (للأعلى أو للأسفل)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ترقية أو تخفيض يدوي لمشرف
 *
 * @param {Guild}  guild
 * @param {string} userId      - المشرف المستهدف
 * @param {string} direction   - "up" | "down"
 * @param {string} executorId  - من نفّذ الأمر
 * @param {string} reason      - السبب
 * @returns {{ success, msg?, newRoleId? }}
 */
export async function manualPromote(guild, userId, direction, executorId, reason) {
  const config     = getConfig(guild.id);
  const milestones = getSortedMilestones(config);

  // ─── فحوصات أولية ────────────────────────────────────────────────────────────
  if (!milestones.length) {
    return { success: false, msg: "لا توجد مراحل مُعدَّة. أضفها من `/setup`." };
  }

  // ─── جلب العضو ───────────────────────────────────────────────────────────────
  let member;
  try {
    member = await guild.members.fetch(userId);
  } catch {
    return { success: false, msg: "لم يُعثر على العضو في السيرفر." };
  }

  // ─── المرحلة الحالية ─────────────────────────────────────────────────────────
  const currentIndex = milestones.findIndex(
    (m) => member.roles.cache.has(m.roleId)
  );

  // ─── المرحلة المستهدفة ────────────────────────────────────────────────────────
  let targetIndex;

  if (direction === "up") {
    // ترقية → المرحلة التالية
    targetIndex = currentIndex === -1
      ? 0                           // لا رتبة → أول مرحلة
      : currentIndex + 1;
  } else {
    // تخفيض → المرحلة السابقة
    targetIndex = currentIndex - 1;
  }

  // ─── فحص الحدود ──────────────────────────────────────────────────────────────
  if (direction === "up" && targetIndex >= milestones.length) {
    return {
      success: false,
      msg:     "المشرف وصل للمرحلة الأعلى بالفعل — لا يمكن الترقية أكثر.",
    };
  }

  if (direction === "down" && targetIndex < 0) {
    return {
      success: false,
      msg:     currentIndex === -1
        ? "المشرف لا يملك أي رتبة من السلم — لا يمكن التخفيض."
        : "المشرف في المرحلة الأدنى بالفعل — لا يمكن التخفيض أكثر.",
    };
  }

  const targetMilestone  = milestones[targetIndex];
  const previousMilestone = currentIndex >= 0 ? milestones[currentIndex] : null;

  // ─── تطبيق التغيير ───────────────────────────────────────────────────────────
  const allRoleIds = milestones.map((m) => m.roleId);
  await applyRoleChange(guild, member, allRoleIds, targetMilestone.roleId);

  // ─── تسجيل في التاريخ ────────────────────────────────────────────────────────
  const totalPoints = getUserPoints(guild.id, userId).total || 0;

  addPromotionEntry(guild.id, userId, {
    type:       direction === "up" ? "manual_up" : "manual_down",
    fromRole:   previousMilestone?.roleId || null,
    toRole:     targetMilestone.roleId,
    points:     totalPoints,
    executorId,
    reason,
  });

  // ─── إعلان الترقية (فقط عند الترقية للأعلى) ──────────────────────────────────
  if (direction === "up") {
    await announcePromotion(
      guild,
      userId,
      targetMilestone.roleId,
      previousMilestone?.roleId || null,
      totalPoints,
      config,
    );
  }

  // ─── إشعار DM للمشرف ─────────────────────────────────────────────────────────
  await sendPromotionDM(
    guild,
    userId,
    targetMilestone.roleId,
    totalPoints,
    direction === "up" ? "manual_up" : "manual_down",
    reason,
    executorId,
  );

  // ─── تسجيل في السجل ──────────────────────────────────────────────────────────
  await log(guild, LogType.PROMOTION, makeLogEmbed(LogType.PROMOTION,
    direction === "up" ? "⬆️ ترقية يدوية" : "⬇️ تخفيض يدوي",
    [
      { name: "المشرف",        value: `<@${userId}>`,                                inline: true },
      { name: "المنفذ",        value: `<@${executorId}>`,                            inline: true },
      { name: "الرتبة الجديدة", value: `<@&${targetMilestone.roleId}>`,              inline: true },
      {
        name:   "من رتبة",
        value:  previousMilestone ? `<@&${previousMilestone.roleId}>` : "لا شيء",
        inline: true,
      },
      { name: "السبب", value: reason },
    ]
  ));

  return {
    success:    true,
    newRoleId:  targetMilestone.roleId,
    direction,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// إحصائيات السلم الوظيفي
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُرجع إحصائيات السلم الوظيفي: عدد المشرفين في كل مرحلة
 *
 * @param {Guild}  guild
 * @returns {Array<{ milestone, count, members }>}
 */
export async function getLadderStats(guild) {
  const config     = getConfig(guild.id);
  const milestones = getSortedMilestones(config);
  const stats      = [];

  for (const milestone of milestones) {
    let count   = 0;
    let members = [];

    try {
      const role = await guild.roles.fetch(milestone.roleId);
      if (role) {
        count   = role.members.size;
        members = role.members.map((m) => m.id);
      }
    } catch {}

    stats.push({ milestone, count, members });
  }

  return stats;
}

/**
 * يُرجع تاريخ ترقيات مشرف مع تفاصيل كاملة
 *
 * @param {string} guildId
 * @param {string} userId
 * @returns {Array<object>}
 */
export function getUserPromotionHistory(guildId, userId) {
  const promotions = getPromotions(guildId);
  return promotions[userId] || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال مساعدة داخلية
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُرتّب مراحل المكافآت تصاعدياً حسب النقاط
 *
 * @param {object} config
 * @returns {Array<{ points, roleId }>}
 */
function getSortedMilestones(config) {
  return (config.milestones || [])
    .filter((m) => m.points > 0 && m.roleId)
    .slice()
    .sort((a, b) => a.points - b.points);
}

/**
 * يُحدد أعلى مرحلة يستحقها المشرف بناءً على نقاطه
 *
 * @param {Array}  milestones    - مراحل مرتبة تصاعدياً
 * @param {number} totalPoints
 * @returns {object|null}        - المرحلة أو null إذا لم يستحق أي مرحلة
 */
function getHighestEligibleMilestone(milestones, totalPoints) {
  let target = null;
  for (const m of milestones) {
    if (totalPoints >= m.points) target = m;
    else break; // المراحل مرتبة تصاعدياً → ما فوق هذه لا يستحقها
  }
  return target;
}

/**
 * يُطبّق تغيير الرتبة على العضو
 * يحذف كل رتب السلم ثم يضيف الجديدة
 *
 * @param {Guild}       guild
 * @param {GuildMember} member
 * @param {Array}       allRoleIds    - كل رتب السلم
 * @param {string}      targetRoleId  - الرتبة المستهدفة
 */
async function applyRoleChange(guild, member, allRoleIds, targetRoleId) {
  // 1. احذف كل رتب السلم التي يملكها
  for (const roleId of allRoleIds) {
    if (member.roles.cache.has(roleId) && roleId !== targetRoleId) {
      await member.roles.remove(roleId, "تعديل رتبة السلم الوظيفي").catch(() => {});
    }
  }

  // 2. أضف الرتبة الجديدة إن لم يكن يملكها
  if (!member.roles.cache.has(targetRoleId)) {
    await member.roles.add(targetRoleId, "ترقية في السلم الوظيفي").catch(() => {});
  }
}

/**
 * يُرسل إعلان الترقية في قناة الإعلانات
 *
 * @param {Guild}       guild
 * @param {string}      userId
 * @param {string}      newRoleId
 * @param {string|null} oldRoleId
 * @param {number}      totalPoints
 * @param {object}      config
 */
async function announcePromotion(guild, userId, newRoleId, oldRoleId, totalPoints, config) {
  const channelId = config.promotionAnnouncementChannel;
  if (!channelId) return;

  const ch = guild.channels.cache.get(channelId);
  if (!ch?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle("🏆 ترقية!")
    .setDescription(`تهانينا لـ <@${userId}> على ترقيته إلى <@&${newRoleId}>!`)
    .addFields(
      { name: "النقاط الحالية", value: `${totalPoints}`,                              inline: true },
      { name: "من رتبة",        value: oldRoleId ? `<@&${oldRoleId}>` : "البداية",   inline: true },
      { name: "إلى رتبة",       value: `<@&${newRoleId}>`,                            inline: true },
    )
    .setThumbnail(guild.iconURL({ dynamic: true }))
    .setTimestamp();

  await ch.send({
    content: `<@${userId}>`,
    embeds:  [embed],
  }).catch(() => {});
}

/**
 * يُرسل DM للمشرف عند الترقية أو التخفيض
 *
 * @param {Guild}       guild
 * @param {string}      userId
 * @param {string}      newRoleId
 * @param {number}      totalPoints
 * @param {string}      type        - "auto" | "manual_up" | "manual_down"
 * @param {string}      reason      - سبب التغيير (للترقية اليدوية)
 * @param {string|null} executorId  - من نفّذ الأمر (للترقية اليدوية)
 */
async function sendPromotionDM(
  guild,
  userId,
  newRoleId,
  totalPoints,
  type,
  reason      = "",
  executorId  = null,
) {
  try {
    const user = await guild.client.users.fetch(userId);

    const isDown  = type === "manual_down";
    const isAuto  = type === "auto";
    const color   = isDown ? 0xed4245 : 0xffd700;
    const title   = isDown
      ? "⬇️ تم تخفيض رتبتك"
      : "🎉 تهانينا! تمت ترقيتك";

    const description = isDown
      ? `تم تخفيض رتبتك في **${guild.name}** إلى <@&${newRoleId}>`
      : isAuto
        ? `تمت ترقيتك تلقائياً في **${guild.name}** إلى <@&${newRoleId}> بفضل نقاطك!`
        : `تمت ترقيتك يدوياً في **${guild.name}** إلى <@&${newRoleId}>`;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(description)
      .addFields(
        { name: "النقاط الحالية", value: `${totalPoints}`, inline: true },
        { name: "الرتبة الجديدة", value: `<@&${newRoleId}>`, inline: true },
      )
      .setThumbnail(guild.iconURL({ dynamic: true }))
      .setTimestamp();

    if (!isAuto && reason) {
      embed.addFields({ name: "السبب", value: reason });
    }
    if (!isAuto && executorId) {
      embed.addFields({ name: "المنفذ", value: `<@${executorId}>`, inline: true });
    }

    await user.send({ embeds: [embed] });
  } catch {
    // المشرف أوقف الـ DMs — لا بأس
  }
}
