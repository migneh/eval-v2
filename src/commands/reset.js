// src/commands/reset.js
// ─────────────────────────────────────────────────────────────────────────────
// أمر /reset — تصفير نقاط مشرف أو الكل
//
// الميزات:
//   - بدون mention → تصفير الكل (مع تأكيد مزدوج للأمان)
//   - مع mention → تصفير مشرف واحد
//   - تأكيد بزر قبل التنفيذ
//   - تسجيل في السجل
//   - يُصفّر كل مصادر النقاط (يدوي + XP + موديريشن + مهام + التاريخ)
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from "discord.js";

import {
  getConfig,
  getUserPoints,
  saveUserPoints,
  getPoints,
  savePoints,
} from "../utils/db.js";

import { requireAdmin }              from "../utils/perms.js";
import { log, makeLogEmbed, LogType } from "../utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// تعريف الأمر
// ─────────────────────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName("reset")
  .setDescription("🔁 تصفير نقاط مشرف أو الكل")
  .addUserOption((o) =>
    o
      .setName("member")
      .setDescription("المشرف المستهدف (اتركه فارغاً لتصفير الكل)")
      .setRequired(false)
  );

// ─────────────────────────────────────────────────────────────────────────────
// تنفيذ الأمر
// ─────────────────────────────────────────────────────────────────────────────

export async function execute(interaction) {
  const config = getConfig(interaction.guildId);

  // ─── فحص الصلاحية ────────────────────────────────────────────────────────────
  if (!requireAdmin(interaction, config)) return;

  const targetUser = interaction.options.getUser("member");
  const isAll      = !targetUser;

  // ─── جمع المعلومات للعرض ──────────────────────────────────────────────────────
  let currentPoints = 0;
  let memberCount   = 0;

  if (isAll) {
    const allPoints = getPoints(interaction.guildId);
    memberCount     = Object.keys(allPoints).length;
    currentPoints   = Object.values(allPoints)
      .reduce((sum, u) => sum + (u.total || 0), 0);
  } else {
    const userData  = getUserPoints(interaction.guildId, targetUser.id);
    currentPoints   = userData.total || 0;
  }

  // ─── Embed التأكيد الأول ──────────────────────────────────────────────────────
  const confirmEmbed = buildConfirmEmbed(isAll, targetUser, currentPoints, memberCount, false);

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("reset_confirm_1")
      .setLabel(isAll ? "⚠️ نعم، صفّر الكل" : "✅ تأكيد التصفير")
      .setStyle(isAll ? ButtonStyle.Danger : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("reset_cancel")
      .setLabel("❌ إلغاء")
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    embeds:    [confirmEmbed],
    components:[confirmRow],
    ephemeral: true,
  });

  // ─── Collector: تأكيد أول ────────────────────────────────────────────────────
  let btn1;
  try {
    btn1 = await interaction.channel.awaitMessageComponent({
      filter:        (i) => i.user.id === interaction.user.id &&
                            ["reset_confirm_1", "reset_cancel"].includes(i.customId),
      componentType: ComponentType.Button,
      time:          30_000,
    });
  } catch {
    return interaction.editReply({ embeds: [timeoutEmbed()], components: [] });
  }

  if (btn1.customId === "reset_cancel") {
    return btn1.update({
      embeds:    [cancelEmbed()],
      components:[],
    });
  }

  // ─── إذا تصفير الكل → تأكيد ثانٍ للأمان ─────────────────────────────────────
  if (isAll) {
    const confirm2Embed = buildConfirmEmbed(true, null, currentPoints, memberCount, true);

    const confirm2Row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("reset_confirm_2")
        .setLabel("🗑 نعم، أنا متأكد — صفّر الكل نهائياً")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("reset_cancel_2")
        .setLabel("❌ إلغاء")
        .setStyle(ButtonStyle.Secondary),
    );

    await btn1.update({
      embeds:    [confirm2Embed],
      components:[confirm2Row],
    });

    // ─── Collector: تأكيد ثانٍ ───────────────────────────────────────────────
    let btn2;
    try {
      btn2 = await interaction.channel.awaitMessageComponent({
        filter:        (i) => i.user.id === interaction.user.id &&
                              ["reset_confirm_2", "reset_cancel_2"].includes(i.customId),
        componentType: ComponentType.Button,
        time:          30_000,
      });
    } catch {
      return interaction.editReply({ embeds: [timeoutEmbed()], components: [] });
    }

    if (btn2.customId === "reset_cancel_2") {
      return btn2.update({
        embeds:    [cancelEmbed()],
        components:[],
      });
    }

    // ─── تنفيذ تصفير الكل ────────────────────────────────────────────────────
    await executeResetAll(interaction, btn2, memberCount, currentPoints);

  } else {
    // ─── تنفيذ تصفير مشرف واحد ───────────────────────────────────────────────
    await executeResetOne(interaction, btn1, targetUser, currentPoints);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// تنفيذ التصفير الكامل
// ─────────────────────────────────────────────────────────────────────────────

async function executeResetAll(interaction, btnInteraction, memberCount, prevTotal) {
  // تصفير كل بيانات النقاط
  savePoints(interaction.guildId, {});

  await btnInteraction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("✅ تم التصفير الكامل")
        .setDescription("تم تصفير نقاط جميع المشرفين بنجاح.")
        .addFields(
          { name: "المشرفون المتأثرون",    value: `${memberCount}`,                inline: true },
          { name: "النقاط التي أُزيلت",   value: `${prevTotal.toLocaleString()}`, inline: true },
          { name: "المنفذ",                value: `<@${interaction.user.id}>`,     inline: true },
        )
        .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
        .setTimestamp(),
    ],
    components: [],
  });

  // ─── تسجيل في السجل ──────────────────────────────────────────────────────────
  await log(
    interaction.guild,
    LogType.POINTS_RESET,
    makeLogEmbed(LogType.POINTS_RESET, "🔁 تصفير كامل لجميع النقاط", [
      { name: "المنفذ",                 value: `<@${interaction.user.id}>`, inline: true },
      { name: "المشرفون المتأثرون",     value: `${memberCount}`,            inline: true },
      { name: "النقاط التي أُزيلت",    value: `${prevTotal.toLocaleString()}`, inline: true },
    ], {
      thumbnail: interaction.guild.iconURL({ dynamic: true }),
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// تنفيذ تصفير مشرف واحد
// ─────────────────────────────────────────────────────────────────────────────

async function executeResetOne(interaction, btnInteraction, targetUser, prevTotal) {
  // تصفير كل حقول النقاط مع الاحتفاظ ببنية المستخدم
  const userData = getUserPoints(interaction.guildId, targetUser.id);

  const resetData = {
    ...userData,
    total:      0,
    manual:     0,
    xp:         0,
    moderation: 0,
    task:       0,
    history:    [
      // إضافة سجل التصفير في التاريخ
      {
        amount:     -prevTotal,
        source:     "manual",
        reason:     "تصفير يدوي بواسطة الإدارة",
        executorId: interaction.user.id,
        timestamp:  Date.now(),
      },
    ],
  };

  saveUserPoints(interaction.guildId, targetUser.id, resetData);

  await btnInteraction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("✅ تم التصفير")
        .setDescription(`تم تصفير نقاط <@${targetUser.id}> بنجاح.`)
        .addFields(
          { name: "النقاط قبل التصفير", value: `${prevTotal.toLocaleString()}`, inline: true },
          { name: "النقاط بعد التصفير", value: "0",                             inline: true },
          { name: "المنفذ",             value: `<@${interaction.user.id}>`,     inline: true },
        )
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .setTimestamp(),
    ],
    components: [],
  });

  // ─── تسجيل في السجل ──────────────────────────────────────────────────────────
  await log(
    interaction.guild,
    LogType.POINTS_RESET,
    makeLogEmbed(LogType.POINTS_RESET, "🔁 تصفير نقاط مشرف", [
      { name: "المنفذ",               value: `<@${interaction.user.id}>`,     inline: true },
      { name: "المستهدف",             value: `<@${targetUser.id}>`,           inline: true },
      { name: "النقاط التي أُزيلت",  value: `${prevTotal.toLocaleString()}`, inline: true },
    ], {
      thumbnail: targetUser.displayAvatarURL({ dynamic: true }),
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال بناء الـ Embeds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * بناء Embed التأكيد
 *
 * @param {boolean}    isAll       - هل تصفير الكل؟
 * @param {User|null}  targetUser  - المستهدف (null إذا isAll)
 * @param {number}     points      - النقاط الحالية
 * @param {number}     count       - عدد المشرفين (للتصفير الكامل)
 * @param {boolean}    isSecond    - هل هذا التأكيد الثاني؟
 */
function buildConfirmEmbed(isAll, targetUser, points, count, isSecond) {
  const embed = new EmbedBuilder().setTimestamp();

  if (isAll) {
    embed
      .setColor(0xed4245)
      .setTitle(isSecond ? "⚠️⚠️ تأكيد نهائي — هذا لا يمكن التراجع عنه!" : "⚠️ تأكيد تصفير الكل")
      .setDescription(
        isSecond
          ? `أنت على وشك **تصفير نقاط ${count} مشرف** وإزالة **${points.toLocaleString()} نقطة** بشكل نهائي.\n\n**هذا الإجراء لا يمكن التراجع عنه!**`
          : `هل تريد تصفير نقاط **جميع المشرفين** في السيرفر؟`
      )
      .addFields(
        { name: "المشرفون المتأثرون",  value: `${count}`,                  inline: true },
        { name: "النقاط الستُزال",    value: `${points.toLocaleString()}`, inline: true },
      );
  } else {
    embed
      .setColor(0xfee75c)
      .setTitle("⚠️ تأكيد تصفير مشرف")
      .setDescription(`هل تريد تصفير نقاط <@${targetUser.id}>؟`)
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: "المستهدف",          value: `<@${targetUser.id}>`,        inline: true },
        { name: "النقاط الحالية",    value: `${points.toLocaleString()}`, inline: true },
        { name: "النقاط بعد التصفير", value: "0",                         inline: true },
      );
  }

  return embed;
}

function timeoutEmbed() {
  return new EmbedBuilder()
    .setColor(0x99aab5)
    .setDescription("⏰ انتهت مهلة العملية. يمكنك إعادة تشغيل الأمر.")
    .setTimestamp();
}

function cancelEmbed() {
  return new EmbedBuilder()
    .setColor(0x99aab5)
    .setDescription("❌ تم إلغاء عملية التصفير.")
    .setTimestamp();
}
