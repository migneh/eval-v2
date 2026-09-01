// src/commands/mytasks.js
// ─────────────────────────────────────────────────────────────────────────────
// أمر /mytasks — عرض مهام المشرف الحالية
//
// الميزات:
//   - كل مهمة مرتبطة برتبة يملكها المشرف
//   - progress bar + النسبة المئوية لكل مهمة
//   - الوقت المتبقي حتى تجدد المهمة
//   - النقاط عند الإكمال
//   - ترتيب: غير المكتملة أولاً
//   - empty state إذا لا توجد مهام أو لا رتب مشرف
//
// الصلاحية: مشرف
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";

import { getConfig, getUserPoints } from "../utils/db.js";
import { requireMod }               from "../utils/perms.js";
import {
  getUserTasks,
  getTypeLabel,
  getPeriodLabel,
  buildProgressBar,
  formatTimeLeft,
} from "../systems/tasks.js";
import { getUserXpState, getXpCooldownLeft } from "../systems/xp.js";

// ─────────────────────────────────────────────────────────────────────────────
// تعريف الأمر
// ─────────────────────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName("mytasks")
  .setDescription("📋 عرض مهامك الحالية وتقدمك فيها");

// ─────────────────────────────────────────────────────────────────────────────
// تنفيذ الأمر
// ─────────────────────────────────────────────────────────────────────────────

export async function execute(interaction) {
  const config = getConfig(interaction.guildId);

  // ─── فحص الصلاحية ────────────────────────────────────────────────────────────
  if (!requireMod(interaction, config)) return;

  await interaction.deferReply({ ephemeral: true });

  // ─── جلب العضو ───────────────────────────────────────────────────────────────
  let member;
  try {
    member = await interaction.guild.members.fetch(interaction.user.id);
  } catch {
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setDescription("❌ لم يُعثر على عضويتك في السيرفر.")
          .setTimestamp(),
      ],
    });
  }

  // ─── جلب المهام ──────────────────────────────────────────────────────────────
  const tasks = getUserTasks(interaction.guild, interaction.user.id, member);

  // ─── Empty State ──────────────────────────────────────────────────────────────
  if (!tasks.length) {
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("📋 مهامك")
          .setDescription(
            "لا توجد مهام مُكلَّفة بك حالياً.\n\n" +
            "**الأسباب المحتملة:**\n" +
            "• لم تُعدَّ أي مهام بعد — الإدارة تضيفها عبر `/task setup`\n" +
            "• المهام المُعدَّة مرتبطة برتب لا تملكها"
          )
          .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
          .setTimestamp(),
      ],
    });
  }

  // ─── بناء حقول المهام ────────────────────────────────────────────────────────
  const fields = tasks.map((task) => {
    const bar       = buildProgressBar(task.current, task.goal, 12);
    const status    = task.completed ? "✅ مكتملة" : "⏳ جارية";
    const timeLeft  = task.completed
      ? `تتجدد بعد ${getPeriodLabel(task.period)}`
      : `متبقي ${formatTimeLeft(task.timeLeft)}`;

    return {
      name: `<@&${task.roleId}> — ${getTypeLabel(task.type)}`,
      value: [
        `${bar} **${task.percentage}%**`,
        `**${task.current}** / **${task.goal}** ${getUnitLabel(task.type)}`,
        `🏆 النقاط: **${task.points}**`,
        `⏱ ${timeLeft}`,
        `📌 ${status}`,
      ].join("\n"),
      inline: false,
    };
  });

  // ─── إحصائيات ────────────────────────────────────────────────────────────────
  const completedCount = tasks.filter((t) => t.completed).length;
  const totalPoints    = tasks
    .filter((t) => !t.completed)
    .reduce((sum, t) => sum + t.points, 0);

  const userData   = getUserPoints(interaction.guildId, interaction.user.id);
  const xpState    = getUserXpState(interaction.guildId, interaction.user.id);
  const xpCooldown = getXpCooldownLeft(interaction.guildId, interaction.user.id);

  const embed = new EmbedBuilder()
    .setColor(0x00d4aa)
    .setTitle("📋 مهامك")
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .addFields(fields)
    .addFields({
      name: "📊 ملخص",
      value: [
        `المهام: **${tasks.length}**`,
        `مكتملة: **${completedCount}**`,
        `نقاط متاحة: **${totalPoints}**`,
      ].join("  |  "),
      inline: false,
    })
    .setFooter({
      text: `${interaction.guild.name} • نقاطك: ${(userData.total || 0).toLocaleString()} • XP اليوم: ${xpState.dailyXp}${xpCooldown > 0 ? ` • cooldown: ${xpCooldown}ث` : ""}`,
      iconURL: interaction.guild.iconURL({ dynamic: true }),
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال مساعدة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * وحدة القياس حسب نوع المهمة
 */
function getUnitLabel(type) {
  const units = {
    messages:   "رسالة",
    moderation: "عقوبة",
    voice:      "دقيقة",
  };
  return units[type] || "";
}
