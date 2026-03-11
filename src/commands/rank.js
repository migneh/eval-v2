// src/commands/rank.js
// ─────────────────────────────────────────────────────────────────────────────
// أمر /rank — بطاقة رتبة المشرف
//
// الميزات:
//   - الرتبة الحالية في السلم
//   - النقاط الإجمالية مقسّمة لمصادرها
//   - Progress bar للمرحلة التالية
//   - السلم الوظيفي كاملاً مع علامة "أنت هنا"
//   - آخر 5 تغييرات في تاريخ الترقيات
//   - صورة العضو في الـ thumbnail
// ─────────────────────────────────────────────────────────────────────────────

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

import { getConfig, getUserPoints }           from "../utils/db.js";
import { requireMod }                         from "../utils/perms.js";
import { getUserPromotionHistory }             from "../systems/promotions.js";
import {
  buildProgressBar,
  formatTimeLeft,
} from "../systems/tasks.js";

// ─────────────────────────────────────────────────────────────────────────────
// تعريف الأمر
// ─────────────────────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName("rank")
  .setDescription("🎖 بطاقة رتبة المشرف")
  .addUserOption((o) =>
    o
      .setName("member")
      .setDescription("المشرف (اتركه فارغاً لعرض بطاقتك)")
      .setRequired(false)
  );

// ─────────────────────────────────────────────────────────────────────────────
// تنفيذ الأمر
// ─────────────────────────────────────────────────────────────────────────────

export async function execute(interaction) {
  const config = getConfig(interaction.guildId);

  // ─── فحص الصلاحية ────────────────────────────────────────────────────────────
  if (!requireMod(interaction, config)) return;

  // ─── تحديد الهدف ─────────────────────────────────────────────────────────────
  const targetUser = interaction.options.getUser("member") || interaction.user;
  const isSelf     = targetUser.id === interaction.user.id;

  await interaction.deferReply();

  // ─── جلب العضو ───────────────────────────────────────────────────────────────
  let member;
  try {
    member = await interaction.guild.members.fetch(targetUser.id);
  } catch {
    // العضو غاب عن السيرفر
  }

  const displayName = member?.displayName || targetUser.username;
  const avatarURL   = targetUser.displayAvatarURL({ dynamic: true, size: 256 });

  // ─── بيانات النقاط ───────────────────────────────────────────────────────────
  const userData    = getUserPoints(interaction.guildId, targetUser.id);
  const totalPoints = userData.total || 0;

  // ─── مراحل المكافآت مرتبة تصاعدياً ──────────────────────────────────────────
  const milestones = (config.milestones || [])
    .filter((m) => m.points > 0 && m.roleId)
    .sort((a, b) => a.points - b.points);

  // ─── المرحلة الحالية والتالية ─────────────────────────────────────────────────
  let currentMilestone = null;
  let nextMilestone    = null;

  for (let i = 0; i < milestones.length; i++) {
    if (totalPoints >= milestones[i].points) {
      currentMilestone = milestones[i];
    } else if (!nextMilestone) {
      nextMilestone = milestones[i];
    }
  }

  // ─── Progress Bar ─────────────────────────────────────────────────────────────
  const progressSection = buildProgressSection(
    totalPoints,
    currentMilestone,
    nextMilestone,
  );

  // ─── السلم الوظيفي الكامل ─────────────────────────────────────────────────────
  const ladderSection = buildLadderSection(milestones, member, totalPoints);

  // ─── تاريخ الترقيات ───────────────────────────────────────────────────────────
  const promotionHistory = getUserPromotionHistory(interaction.guildId, targetUser.id);
  const historySection   = buildHistorySection(promotionHistory);

  // ─── لون الـ Embed ────────────────────────────────────────────────────────────
  // أخضر للمالك، أزرق للآخرين، بنفسجي للنفس
  const embedColor = isSelf
    ? 0x5865f2
    : currentMilestone
      ? 0xffd700
      : 0x57f287;

  // ─── بناء الـ Embed ───────────────────────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setAuthor({
      name:    `🎖 بطاقة ${displayName}`,
      iconURL: avatarURL,
    })
    .setThumbnail(avatarURL)
    .addFields(
      // ── الرتبة والنقاط ──
      {
        name:   "🎖 الرتبة الحالية",
        value:  currentMilestone
          ? `<@&${currentMilestone.roleId}>`
          : "لا توجد رتبة بعد",
        inline: true,
      },
      {
        name:   "⭐ إجمالي النقاط",
        value:  `**${totalPoints.toLocaleString("ar-SA")}**`,
        inline: true,
      },
      {
        name:   "📊 المصادر",
        value: [
          `✋ يدوية: **${(userData.manual || 0).toLocaleString()}**`,
          `💬 XP: **${(userData.xp || 0).toLocaleString()}**`,
          `⚖️ موديريشن: **${(userData.moderation || 0).toLocaleString()}**`,
          `📋 مهام: **${(userData.task || 0).toLocaleString()}**`,
        ].join("  |  "),
        inline: false,
      },
    )
    .setFooter({
      text:    `${interaction.guild.name} • ${isSelf ? "بطاقتك" : `بطاقة ${displayName}`}`,
      iconURL: interaction.guild.iconURL({ dynamic: true }),
    })
    .setTimestamp();

  // ─── Progress Bar ──────────────────────────────────────────────────────────
  embed.addFields({
    name:  "📈 التقدم",
    value: progressSection,
  });

  // ─── السلم الوظيفي ──────────────────────────────────────────────────────────
  if (ladderSection) {
    embed.addFields({
      name:  "🪜 السلم الوظيفي",
      value: ladderSection,
    });
  }

  // ─── تاريخ الترقيات ─────────────────────────────────────────────────────────
  if (historySection) {
    embed.addFields({
      name:  "📜 آخر الترقيات",
      value: historySection,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال بناء الأقسام
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يبني قسم Progress Bar
 */
function buildProgressSection(totalPoints, currentMilestone, nextMilestone) {
  if (!nextMilestone && !currentMilestone) {
    return "لم تُعدَّ مراحل بعد. استخدم `/setup` لإضافة مراحل.";
  }

  if (!nextMilestone) {
    // وصل للمرحلة القصوى
    return [
      `🏆 **وصلت للمرحلة القصوى!** <@&${currentMilestone.roleId}>`,
      `${buildProgressBar(1, 1, 15)} **MAX**`,
      `⭐ **${totalPoints.toLocaleString()}** نقطة`,
    ].join("\n");
  }

  // حساب التقدم من المرحلة الحالية للتالية
  const from       = currentMilestone?.points || 0;
  const to         = nextMilestone.points;
  const current    = totalPoints - from;
  const goal       = to - from;
  const bar        = buildProgressBar(current, goal, 15);
  const needed     = to - totalPoints;
  const percentage = Math.min(100, Math.round((current / goal) * 100));

  const lines = [
    `${bar} **${percentage}%**`,
    `**${totalPoints.toLocaleString()}** / **${to.toLocaleString()}** — متبقي **${needed.toLocaleString()} نقطة**`,
    `المرحلة التالية: <@&${nextMilestone.roleId}>`,
  ];

  if (currentMilestone) {
    lines.push(`المرحلة الحالية: <@&${currentMilestone.roleId}>`);
  }

  return lines.join("\n");
}

/**
 * يبني السلم الوظيفي الكامل مع علامة "أنت هنا"
 */
function buildLadderSection(milestones, member, totalPoints) {
  if (!milestones.length) return null;

  const lines = milestones.map((m, i) => {
    const isCurrentRole  = member?.roles.cache.has(m.roleId);
    const isEligible     = totalPoints >= m.points;
    const isNext         = !isEligible && (i === 0 || totalPoints >= milestones[i - 1]?.points);

    let prefix = "○";
    if (isCurrentRole) prefix = "●";       // عنده الرتبة حالياً
    else if (isEligible) prefix = "✓";     // مستحق لكن لم تُضَف بعد

    const hereTag  = isCurrentRole ? " **← أنت هنا**" : "";
    const nextTag  = isNext && !isCurrentRole ? " *(التالية)*" : "";
    const pointsTag = `${m.points.toLocaleString()} نقطة`;

    return `${prefix} <@&${m.roleId}> — ${pointsTag}${hereTag}${nextTag}`;
  });

  return lines.join("\n");
}

/**
 * يبني قسم آخر 5 ترقيات
 */
function buildHistorySection(history) {
  if (!history?.length) return null;

  const typeLabels = {
    auto:        "🤖 تلقائي",
    triggered:   "🤖 تلقائي",
    manual_up:   "⬆️ يدوي",
    manual_down: "⬇️ يدوي",
  };

  const lines = history.slice(0, 5).map((p) => {
    const typeLabel = typeLabels[p.type] || p.type;
    const date      = new Date(p.timestamp).toLocaleDateString("ar-SA", {
      day:   "numeric",
      month: "short",
      year:  "numeric",
    });

    const roleText = p.toRole
      ? `<@&${p.toRole}>`
      : "لا رتبة";

    return `${typeLabel} → ${roleText} • *${date}* • ${p.points.toLocaleString()} نقطة`;
  });

  return lines.join("\n");
}
