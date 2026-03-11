// src/commands/moderation.js
// ─────────────────────────────────────────────────────────────────────────────
// أوامر /warn و /timeout
//
// التدفق المشترك:
//   1. فحص الصلاحية (إدارة فقط)
//   2. فحص أن المستهدف ليس هو المنفذ
//   3. فحص صلاحيات البوت
//   4. تنفيذ العقوبة فوراً
//   5. إرسال بطاقة للمراجعة → createReview()
//   6. رد على المنفذ بالنتيجة
//
// القواعد:
//   - العقوبة تُنفَّذ فوراً (timeout/warn) ثم تذهب للمراجعة
//   - إذا رُفضت → يُشال التوقيف تلقائياً
//   - صلاحية الأمرين مرتبطة بـ ModerateMembers في ديسكورد
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";

import { getConfig }      from "../utils/db.js";
import { requireAdmin }   from "../utils/perms.js";
import { createReview }   from "../systems/reviews.js";

// ─────────────────────────────────────────────────────────────────────────────
// /warn
// ─────────────────────────────────────────────────────────────────────────────

export const warnData = new SlashCommandBuilder()
  .setName("warn")
  .setDescription("⚠️ تحذير عضو — يُرسل للمراجعة قبل احتساب النقاط")
  .addUserOption((o) =>
    o
      .setName("member")
      .setDescription("العضو المستهدف")
      .setRequired(true)
  )
  .addStringOption((o) =>
    o
      .setName("reason")
      .setDescription("سبب التحذير")
      .setRequired(true)
      .setMaxLength(500)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export async function executeWarn(interaction) {
  const config = getConfig(interaction.guildId);

  // ─── 1. فحص الصلاحية ─────────────────────────────────────────────────────────
  if (!requireAdmin(interaction, config)) return;

  const targetUser = interaction.options.getUser("member");
  const reason     = interaction.options.getString("reason");

  // ─── 2. منع تحذير النفس ──────────────────────────────────────────────────────
  if (targetUser.id === interaction.user.id) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setDescription("❌ لا يمكنك تحذير نفسك.")
      ],
      ephemeral: true,
    });
  }

  // ─── 3. منع تحذير البوت ──────────────────────────────────────────────────────
  if (targetUser.bot) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setDescription("❌ لا يمكنك تحذير بوت.")
      ],
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  // ─── 4. جلب العضو وفحص الهرمية ───────────────────────────────────────────────
  let targetMember;
  try {
    targetMember = await interaction.guild.members.fetch(targetUser.id);
  } catch {
    return interaction.editReply({
      embeds: [errorEmbed("لم يُعثر على العضو في السيرفر.")],
    });
  }

  // فحص هرمية الرتب — لا تحذّر من هو أعلى رتبة منك
  const executorMember = interaction.member;
  if (
    !interaction.guild.members.me?.permissions.has(PermissionFlagsBits.ModerateMembers)
  ) {
    return interaction.editReply({
      embeds: [errorEmbed("البوت لا يملك صلاحية ModerateMembers.")],
    });
  }

  if (
    executorMember.roles.highest.position <= targetMember.roles.highest.position &&
    interaction.guild.ownerId !== interaction.user.id
  ) {
    return interaction.editReply({
      embeds: [warningEmbed("لا يمكنك تحذير عضو يملك رتبة مساوية أو أعلى منك.")],
    });
  }

  // ─── 5. إرسال DM للعضو المُحذَّر (اختياري) ───────────────────────────────────
  await sendPunishmentDM(targetUser, interaction.guild, "warn", reason, null);

  // ─── 6. إرسال لقناة المراجعة ─────────────────────────────────────────────────
  const reviewId = await createReview(interaction.guild, {
    type:       "warn",
    executorId: interaction.user.id,
    targetId:   targetUser.id,
    reason,
  });

  // ─── 7. الرد على المنفذ ───────────────────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle("⚠️ تم إرسال التحذير للمراجعة")
    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: "العضو المُحذَّر",  value: `<@${targetUser.id}>`,  inline: true },
      { name: "المشرف المنفذ",   value: `<@${interaction.user.id}>`, inline: true },
      { name: "السبب",           value: reason },
    )
    .setTimestamp();

  if (reviewId) {
    embed.addFields({
      name:  "🆔 معرف الطلب",
      value: `\`${reviewId}\``,
    });
    embed.setFooter({ text: "ستُضاف النقاط بعد قبول المراجعة" });
  } else {
    embed.addFields({
      name:  "⚠️ تنبيه",
      value: "لا توجد قناة مراجعة مُعدَّة. استخدم `/setup` لتحديدها.",
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

// ─────────────────────────────────────────────────────────────────────────────
// /timeout
// ─────────────────────────────────────────────────────────────────────────────

export const timeoutData = new SlashCommandBuilder()
  .setName("timeout")
  .setDescription("⏰ توقيف عضو مؤقتاً — يُرسل للمراجعة قبل احتساب النقاط")
  .addUserOption((o) =>
    o
      .setName("member")
      .setDescription("العضو المستهدف")
      .setRequired(true)
  )
  .addIntegerOption((o) =>
    o
      .setName("duration")
      .setDescription("المدة بالدقائق")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(40_320)   // 28 يوم = أقصى مدة في ديسكورد
  )
  .addStringOption((o) =>
    o
      .setName("reason")
      .setDescription("سبب التوقيف")
      .setRequired(true)
      .setMaxLength(500)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export async function executeTimeout(interaction) {
  const config = getConfig(interaction.guildId);

  // ─── 1. فحص الصلاحية ─────────────────────────────────────────────────────────
  if (!requireAdmin(interaction, config)) return;

  const targetUser = interaction.options.getUser("member");
  const duration   = interaction.options.getInteger("duration");   // بالدقائق
  const reason     = interaction.options.getString("reason");

  // ─── 2. منع توقيف النفس ──────────────────────────────────────────────────────
  if (targetUser.id === interaction.user.id) {
    return interaction.reply({
      embeds: [errorEmbed("❌ لا يمكنك توقيف نفسك.")],
      ephemeral: true,
    });
  }

  // ─── 3. منع توقيف البوت ──────────────────────────────────────────────────────
  if (targetUser.bot) {
    return interaction.reply({
      embeds: [errorEmbed("❌ لا يمكنك توقيف بوت.")],
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  // ─── 4. جلب العضو وفحص الهرمية ───────────────────────────────────────────────
  let targetMember;
  try {
    targetMember = await interaction.guild.members.fetch(targetUser.id);
  } catch {
    return interaction.editReply({
      embeds: [errorEmbed("لم يُعثر على العضو في السيرفر.")],
    });
  }

  // فحص صلاحية البوت
  if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    return interaction.editReply({
      embeds: [errorEmbed("البوت لا يملك صلاحية ModerateMembers.")],
    });
  }

  // فحص هرمية الرتب
  const executorMember = interaction.member;
  if (
    executorMember.roles.highest.position <= targetMember.roles.highest.position &&
    interaction.guild.ownerId !== interaction.user.id
  ) {
    return interaction.editReply({
      embeds: [warningEmbed("لا يمكنك توقيف عضو يملك رتبة مساوية أو أعلى منك.")],
    });
  }

  // فحص هرمية البوت
  if (
    interaction.guild.members.me.roles.highest.position <=
    targetMember.roles.highest.position
  ) {
    return interaction.editReply({
      embeds: [errorEmbed("رتبة البوت أدنى من رتبة العضو — لا يمكن التوقيف.")],
    });
  }

  // فحص إذا كان العضو مالك السيرفر
  if (targetUser.id === interaction.guild.ownerId) {
    return interaction.editReply({
      embeds: [errorEmbed("لا يمكن توقيف مالك السيرفر.")],
    });
  }

  // ─── 5. تطبيق التوقيف فوراً ──────────────────────────────────────────────────
  const durationMs = duration * 60 * 1000;

  try {
    await targetMember.timeout(durationMs, `${reason} | منفذ بواسطة ${interaction.user.tag}`);
  } catch (err) {
    return interaction.editReply({
      embeds: [errorEmbed(`فشل التوقيف: ${err.message}`)],
    });
  }

  // ─── 6. إرسال DM للعضو الموقوف ───────────────────────────────────────────────
  await sendPunishmentDM(targetUser, interaction.guild, "timeout", reason, duration);

  // ─── 7. إرسال لقناة المراجعة ─────────────────────────────────────────────────
  const reviewId = await createReview(interaction.guild, {
    type:       "timeout",
    executorId: interaction.user.id,
    targetId:   targetUser.id,
    reason,
    duration,   // بالدقائق
  });

  // ─── 8. حساب النقاط المتوقعة للعرض ──────────────────────────────────────────
  const modPoints  = config.modPoints || {};
  const base       = modPoints.timeoutBase    ?? 5;
  const perHour    = modPoints.timeoutPerHour ?? 3;
  const hours      = Math.ceil(duration / 60);
  const expectedPts = base + (perHour * hours);

  // ─── 9. الرد على المنفذ ───────────────────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setColor(0xeb459e)
    .setTitle("⏰ تم التوقيف — بانتظار المراجعة")
    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: "العضو الموقوف",    value: `<@${targetUser.id}>`,      inline: true },
      { name: "المشرف المنفذ",   value: `<@${interaction.user.id}>`, inline: true },
      { name: "المدة",            value: formatDuration(duration),    inline: true },
      { name: "السبب",            value: reason },
      { name: "النقاط المتوقعة", value: `${expectedPts} نقطة (عند القبول)`, inline: true },
    )
    .setTimestamp();

  if (reviewId) {
    embed.addFields({
      name:  "🆔 معرف الطلب",
      value: `\`${reviewId}\``,
    });
    embed.setFooter({ text: "ستُضاف النقاط بعد قبول المراجعة • إذا رُفض يُشال التوقيف تلقائياً" });
  } else {
    embed.addFields({
      name:  "⚠️ تنبيه",
      value: "لا توجد قناة مراجعة مُعدَّة. استخدم `/setup` لتحديدها.",
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال مساعدة مشتركة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُرسل DM للعضو المعاقب يُخبره بالعقوبة
 *
 * @param {User}        targetUser
 * @param {Guild}       guild
 * @param {string}      type       - "warn" | "timeout"
 * @param {string}      reason
 * @param {number|null} duration   - بالدقائق (للتوقيف فقط)
 */
async function sendPunishmentDM(targetUser, guild, type, reason, duration) {
  try {
    const isTimeout  = type === "timeout";
    const color      = isTimeout ? 0xeb459e : 0xfee75c;
    const title      = isTimeout ? "⏰ تم توقيفك" : "⚠️ تلقيت تحذيراً";

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(`في سيرفر **${guild.name}**`)
      .addFields({ name: "السبب", value: reason })
      .setThumbnail(guild.iconURL({ dynamic: true }))
      .setTimestamp();

    if (isTimeout && duration) {
      embed.addFields({
        name:  "المدة",
        value: formatDuration(duration),
      });
    }

    await targetUser.send({ embeds: [embed] });
  } catch {
    // العضو أوقف الـ DMs — لا بأس
  }
}

/**
 * يُحوّل الدقائق لنص مقروء
 *
 * @param {number} minutes
 * @returns {string}
 */
export function formatDuration(minutes) {
  if (minutes < 60) {
    return `${minutes} دقيقة`;
  }

  const hours = Math.floor(minutes / 60);
  const mins  = minutes % 60;

  if (hours < 24) {
    return mins > 0 ? `${hours} ساعة و ${mins} دقيقة` : `${hours} ساعة`;
  }

  const days     = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days} يوم و ${remHours} ساعة` : `${days} يوم`;
}

// ─── Embeds المساعدة ──────────────────────────────────────────────────────────

function errorEmbed(msg) {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setDescription(`❌ ${msg}`)
    .setTimestamp();
}

function warningEmbed(msg) {
  return new EmbedBuilder()
    .setColor(0xfee75c)
    .setDescription(`⚠️ ${msg}`)
    .setTimestamp();
}
