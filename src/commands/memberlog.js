// src/commands/memberlog.js
// ─────────────────────────────────────────────────────────────────────────────
// أمر /memberlog — سجل عقوبات عضو كامل
//
// الميزات:
//   - يعرض كل العقوبات المسجّلة على العضو (warn / timeout)
//   - نتيجة كل عقوبة: مقبولة / مرفوضة / قُبل الاستئناف / رُفض الاستئناف
//   - المنفذ والمراجع وسبب الرفض إن وُجد
//   - إحصائيات سريعة (الإجمالي / المقبول / المرفوض)
//   - ترقيم الصفحات (8 عقوبات في كل صفحة)
//   - empty state إذا لم يرتكب العضو أي مخالفة
//
// الصلاحية: إدارة فقط
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from "discord.js";

import { getConfig, getMemberLog } from "../utils/db.js";
import { requireAdmin } from "../utils/perms.js";
import { formatDuration } from "./moderation.js";

// ─── ثوابت ────────────────────────────────────────────────────────────────────
const PAGE_SIZE    = 8;
const SESSION_TIME = 120_000;   // دقيقتان

// ─────────────────────────────────────────────────────────────────────────────
// تعريف الأمر
// ─────────────────────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName("memberlog")
  .setDescription("📝 عرض سجل عقوبات عضو")
  .addUserOption((o) =>
    o
      .setName("member")
      .setDescription("العضو المطلوب عرض سجله")
      .setRequired(true)
  );

// ─────────────────────────────────────────────────────────────────────────────
// تنفيذ الأمر
// ─────────────────────────────────────────────────────────────────────────────

export async function execute(interaction) {
  const config = getConfig(interaction.guildId);

  // ─── فحص الصلاحية ────────────────────────────────────────────────────────────
  if (!requireAdmin(interaction, config)) return;

  const targetUser = interaction.options.getUser("member");

  await interaction.deferReply({ ephemeral: true });

  // ─── جلب السجل ───────────────────────────────────────────────────────────────
  const memberLog = getMemberLog(interaction.guildId);
  const entries   = memberLog[targetUser.id] || [];

  // ─── Empty State ──────────────────────────────────────────────────────────────
  if (!entries.length) {
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle("📝 سجل العقوبات")
          .setDescription(
            `<@${targetUser.id}> ليس لديه أي عقوبات مسجّلة.\n\n` +
            "سجل نظيف ✨"
          )
          .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
          .setTimestamp(),
      ],
    });
  }

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  let currentPage  = 0;

  // ─── الرد الأول ───────────────────────────────────────────────────────────────
  await interaction.editReply({
    embeds:     [buildEmbed(interaction, targetUser, entries, currentPage, totalPages)],
    components: totalPages > 1 ? [buildNavRow(currentPage, totalPages)] : [],
  });

  if (totalPages <= 1) return;

  // ─── Collector للتنقل ────────────────────────────────────────────────────────
  const collector = interaction.channel.createMessageComponentCollector({
    filter: (i) =>
      i.user.id === interaction.user.id &&
      ["mlog_first", "mlog_prev", "mlog_next", "mlog_last"].includes(i.customId),
    componentType: ComponentType.Button,
    time:          SESSION_TIME,
  });

  collector.on("collect", async (btn) => {
    switch (btn.customId) {
      case "mlog_first": currentPage = 0;                                     break;
      case "mlog_prev":  currentPage = Math.max(0, currentPage - 1);          break;
      case "mlog_next":  currentPage = Math.min(totalPages - 1, currentPage + 1); break;
      case "mlog_last":  currentPage = totalPages - 1;                        break;
    }

    await btn.update({
      embeds:     [buildEmbed(interaction, targetUser, entries, currentPage, totalPages)],
      components: [buildNavRow(currentPage, totalPages)],
    });
  });

  collector.on("end", async () => {
    await interaction.editReply({ components: [] }).catch(() => {});
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// بناء الـ Embed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يبني Embed صفحة من سجل العقوبات
 *
 * @param {CommandInteraction} interaction
 * @param {User}    targetUser
 * @param {Array}   entries      - كل السجلات (مرتبة من الأحدث)
 * @param {number}  page         - رقم الصفحة (يبدأ من 0)
 * @param {number}  totalPages
 * @returns {EmbedBuilder}
 */
function buildEmbed(interaction, targetUser, entries, page, totalPages) {
  const start = page * PAGE_SIZE;
  const slice = entries.slice(start, start + PAGE_SIZE);

  const fields = slice.map((entry, i) => {
    const globalIndex = start + i + 1;
    const isTimeout   = entry.type === "timeout";
    const typeLabel   = isTimeout ? "⏰ تايم أوت" : "⚠️ تحذير";

    const lines = [
      `**النوع:** ${typeLabel}`,
      `**السبب:** ${entry.reason || "لا يوجد سبب"}`,
      `**المنفذ:** <@${entry.executorId}>`,
      `**النتيجة:** ${resultEmoji(entry.result)} ${entry.result || "غير محددة"}`,
    ];

    if (isTimeout && entry.duration) {
      lines.push(`**المدة:** ${formatDuration(entry.duration)}`);
    }
    if (entry.reviewerId) {
      lines.push(`**المراجع:** <@${entry.reviewerId}>`);
    }
    if (entry.rejectReason) {
      lines.push(`**سبب الرفض:** ${entry.rejectReason}`);
    }
    lines.push(`**التاريخ:** ${formatDate(entry.timestamp)}`);

    return {
      name:  `#${globalIndex} — ${typeLabel}`,
      value: lines.join("\n"),
    };
  });

  // ─── إحصائيات سريعة ────────────────────────────────────────────────────────
  const accepted = entries.filter((e) => /مقبول/.test(e.result || "")).length;
  const rejected = entries.filter((e) => /مرفوض/.test(e.result || "")).length;
  const timeouts = entries.filter((e) => e.type === "timeout").length;
  const warns    = entries.length - timeouts;

  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle(`📝 سجل عقوبات ${targetUser.username}`)
    .setDescription(`<@${targetUser.id}> — **${entries.length}** عقوبة مسجّلة`)
    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
    .addFields(fields)
    .addFields({
      name:   "📊 الإحصائيات",
      value: [
        `✅ مقبولة: **${accepted}**`,
        `❌ مرفوضة: **${rejected}**`,
        `⚠️ تحذيرات: **${warns}**`,
        `⏰ توقيفات: **${timeouts}**`,
      ].join("  |  "),
      inline: false,
    })
    .setFooter({
      text:    totalPages > 1
        ? `${interaction.guild.name} • صفحة ${page + 1} / ${totalPages}`
        : interaction.guild.name,
      iconURL: interaction.guild.iconURL({ dynamic: true }),
    })
    .setTimestamp();

  return embed;
}

// ─────────────────────────────────────────────────────────────────────────────
// أزرار التنقل
// ─────────────────────────────────────────────────────────────────────────────

function buildNavRow(page, totalPages) {
  const isFirst = page === 0;
  const isLast  = page >= totalPages - 1;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("mlog_first")
      .setLabel("⏮")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isFirst),
    new ButtonBuilder()
      .setCustomId("mlog_prev")
      .setLabel("◀ السابق")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isFirst),
    new ButtonBuilder()
      .setCustomId("mlog_next")
      .setLabel("التالي ▶")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isLast),
    new ButtonBuilder()
      .setCustomId("mlog_last")
      .setLabel("⏭")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isLast),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال مساعدة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُحوّل نص النتيجة إلى إيموجي مناسب
 */
function resultEmoji(result) {
  if (!result) return "❓";
  if (/قُبل/.test(result))  return "🔁";   // استئناف مقبول
  if (/مقبول/.test(result)) return "✅";
  if (/مرفوض/.test(result)) return "❌";
  return "❓";
}

/**
 * يُنسّق timestamp لتاريخ مقروء بالعربية
 */
function formatDate(timestamp) {
  if (!timestamp) return "—";

  try {
    return new Date(timestamp).toLocaleDateString("ar-SA", {
      day:   "numeric",
      month: "short",
      year:  "numeric",
    });
  } catch {
    return "—";
  }
}
