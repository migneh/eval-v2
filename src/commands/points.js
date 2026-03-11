// src/commands/points.js
// ─────────────────────────────────────────────────────────────────────────────
// أمر /points — عرض نقاط مشرف
//
// الميزات:
//   - يعرض النقاط الإجمالية مقسّمة لمصادرها (يدوي / XP / موديريشن / مهام)
//   - يدعم mention لعرض نقاط شخص آخر
//   - يعرض آخر 5 تغييرات في التاريخ
//   - progress bar للمرحلة التالية
//   - صورة العضو في الـ thumbnail
// ─────────────────────────────────────────────────────────────────────────────

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

import { getConfig, getUserPoints }      from "../utils/db.js";
import { requireMod }                    from "../utils/perms.js";
import { buildProgressBar, formatTimeLeft, getTypeLabel } from "../systems/tasks.js";

// ─────────────────────────────────────────────────────────────────────────────
// تعريف الأمر
// ─────────────────────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName("points")
  .setDescription("📊 عرض نقاط مشرف")
  .addUserOption((o) =>
    o
      .setName("member")
      .setDescription("المشرف (اتركه فارغاً لعرض نقاطك)")
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

  // ─── جلب بيانات العضو ────────────────────────────────────────────────────────
  let member;
  try {
    member = await interaction.guild.members.fetch(targetUser.id);
  } catch {
    // العضو غاب عن السيرفر لكن بياناته موجودة
  }

  const userData     = getUserPoints(interaction.guildId, targetUser.id);
  const displayName  = member?.displayName || targetUser.username;
  const avatarURL    = targetUser.displayAvatarURL({ dynamic: true, size: 256 });

  // ─── مراحل المكافآت ───────────────────────────────────────────────────────────
  const milestones = (config.milestones || [])
    .filter((m) => m.points > 0 && m.roleId)
    .sort((a, b) => a.points - b.points);

  const totalPoints      = userData.total || 0;
  const currentMilestone = milestones.filter((m) => totalPoints >= m.points).pop() || null;
  const nextMilestone    = milestones.find((m) => totalPoints < m.points) || null;

  // ─── Progress Bar للمرحلة التالية ─────────────────────────────────────────────
  let progressField = null;
  if (nextMilestone) {
    const from    = currentMilestone?.points || 0;
    const to      = nextMilestone.points;
    const current = totalPoints - from;
    const goal    = to - from;
    const bar     = buildProgressBar(current, goal, 12);
    progressField = {
      name:  `📈 التقدم نحو المرحلة التالية — ${to} نقطة`,
      value: `${bar}\n**${totalPoints}** / **${to}** — متبقي **${to - totalPoints} نقطة**`,
    };
  } else if (currentMilestone) {
    progressField = {
      name:  "🏆 المرحلة",
      value: `وصلت للمرحلة القصوى! <@&${currentMilestone.roleId}>`,
    };
  }

  // ─── آخر 5 تغييرات ───────────────────────────────────────────────────────────
  let historyField = null;
  if (userData.history?.length) {
    const sourceLabels = {
      manual:     "✋ يدوي",
      xp:         "💬 XP",
      moderation: "⚖️ موديريشن",
      task:       "📋 مهمة",
    };

    const lines = userData.history.slice(0, 5).map((h) => {
      const sign   = h.amount >= 0 ? "+" : "";
      const source = sourceLabels[h.source] || h.source;
      const time   = formatRelativeTime(h.timestamp);
      const reason = h.reason?.length > 30
        ? h.reason.slice(0, 30) + "..."
        : (h.reason || "-");
      return `${sign}**${h.amount}** (${source}) — ${reason} • *${time}*`;
    });

    historyField = {
      name:  "📜 آخر 5 تغييرات",
      value: lines.join("\n"),
    };
  }

  // ─── بناء الـ Embed ───────────────────────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setColor(isSelf ? 0x5865f2 : 0x57f287)
    .setAuthor({
      name:    `نقاط ${displayName}`,
      iconURL: avatarURL,
    })
    .setThumbnail(avatarURL)
    .addFields(
      // ── الإجمالي ──
      {
        name:   "🏆 الإجمالي",
        value:  `## ${totalPoints.toLocaleString("ar-SA")} نقطة`,
        inline: false,
      },
      // ── تفصيل المصادر ──
      {
        name:   "✋ يدوية",
        value:  `${(userData.manual || 0).toLocaleString()}`,
        inline: true,
      },
      {
        name:   "💬 XP",
        value:  `${(userData.xp || 0).toLocaleString()}`,
        inline: true,
      },
      {
        name:   "⚖️ موديريشن",
        value:  `${(userData.moderation || 0).toLocaleString()}`,
        inline: true,
      },
      {
        name:   "📋 مهام",
        value:  `${(userData.task || 0).toLocaleString()}`,
        inline: true,
      },
      // ── الرتبة الحالية ──
      {
        name:   "🎖 الرتبة الحالية",
        value:  currentMilestone ? `<@&${currentMilestone.roleId}>` : "لا توجد رتبة بعد",
        inline: true,
      },
    )
    .setFooter({
      text:    interaction.guild.name,
      iconURL: interaction.guild.iconURL({ dynamic: true }),
    })
    .setTimestamp();

  // ─── إضافة الحقول الاختيارية ──────────────────────────────────────────────────
  if (progressField) embed.addFields(progressField);
  if (historyField)  embed.addFields(historyField);

  await interaction.reply({ embeds: [embed] });
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال مساعدة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُحوّل timestamp لنص وقت نسبي بالعربية
 * مثال: "منذ 5 دقائق" | "منذ 2 ساعة" | "منذ 3 أيام"
 */
function formatRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);

  if (days  > 0) return `منذ ${days} ${days === 1 ? "يوم" : "أيام"}`;
  if (hours > 0) return `منذ ${hours} ${hours === 1 ? "ساعة" : "ساعات"}`;
  if (mins  > 0) return `منذ ${mins} ${mins === 1 ? "دقيقة" : "دقائق"}`;
  return "الآن";
}
