// src/commands/top.js
// ─────────────────────────────────────────────────────────────────────────────
// أمر /top — لوحة الصدارة
//
// الميزات:
//   - يعرض 10 مشرفين في كل صفحة
//   - ترتيب تنازلي حسب الإجمالي
//   - تنقل بين الصفحات بأزرار (السابق / التالي)
//   - ميداليات للمراكز الثلاثة الأولى
//   - يُحدد موقع المستخدم الحالي في القائمة
//   - empty state إذا لا يوجد أحد
//   - يُخفي الأزرار بعد انتهاء الجلسة
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from "discord.js";

import { getConfig, getSortedLeaderboard } from "../utils/db.js";
import { requireMod }                       from "../utils/perms.js";

// ─────────────────────────────────────────────────────────────────────────────
// ثوابت
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE     = 10;
const SESSION_TIME  = 120_000;   // دقيقتان
const MEDALS        = ["🥇", "🥈", "🥉"];

// ─────────────────────────────────────────────────────────────────────────────
// تعريف الأمر
// ─────────────────────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName("top")
  .setDescription("🏆 قائمة أعلى المشرفين نقاطاً");

// ─────────────────────────────────────────────────────────────────────────────
// تنفيذ الأمر
// ─────────────────────────────────────────────────────────────────────────────

export async function execute(interaction) {
  const config = getConfig(interaction.guildId);

  // ─── فحص الصلاحية ────────────────────────────────────────────────────────────
  if (!requireMod(interaction, config)) return;

  // ─── جلب البيانات ────────────────────────────────────────────────────────────
  const sorted     = getSortedLeaderboard(interaction.guildId);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));

  // ─── Empty State ──────────────────────────────────────────────────────────────
  if (!sorted.length) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("🏆 لوحة الصدارة")
          .setDescription(
            "لا يوجد مشرفون لديهم نقاط بعد.\n\nابدأ بإضافة نقاط عبر `/add` أو انتظر حتى يكسبوا XP من نشاطهم!"
          )
          .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
          .setTimestamp(),
      ],
    });
  }

  // ─── موقع المستخدم الحالي في القائمة ─────────────────────────────────────────
  const myRank = sorted.findIndex((e) => e.userId === interaction.user.id);

  // ─── الصفحة الأولى ───────────────────────────────────────────────────────────
  let currentPage = 0;

  // إذا للمستخدم رتبة → انتقل للصفحة التي يظهر فيها
  if (myRank >= 0) {
    currentPage = Math.floor(myRank / PAGE_SIZE);
  }

  const embed = await buildPageEmbed(interaction, sorted, currentPage, totalPages, myRank);
  const row   = buildNavRow(currentPage, totalPages);

  await interaction.reply({
    embeds:     [embed],
    components: totalPages > 1 ? [row] : [],
  });

  // ─── لا يوجد تنقل إذا صفحة واحدة ─────────────────────────────────────────────
  if (totalPages <= 1) return;

  // ─── Collector للتنقل ────────────────────────────────────────────────────────
  const collector = interaction.channel.createMessageComponentCollector({
    filter:        (i) => i.user.id === interaction.user.id &&
                          ["top_first", "top_prev", "top_next", "top_last"].includes(i.customId),
    componentType: ComponentType.Button,
    time:          SESSION_TIME,
  });

  collector.on("collect", async (btn) => {
    switch (btn.customId) {
      case "top_first": currentPage = 0;               break;
      case "top_prev":  currentPage = Math.max(0, currentPage - 1);              break;
      case "top_next":  currentPage = Math.min(totalPages - 1, currentPage + 1); break;
      case "top_last":  currentPage = totalPages - 1;  break;
    }

    const newEmbed = await buildPageEmbed(interaction, sorted, currentPage, totalPages, myRank);
    const newRow   = buildNavRow(currentPage, totalPages);

    await btn.update({ embeds: [newEmbed], components: [newRow] });
  });

  collector.on("end", async () => {
    // أخفِ الأزرار بعد انتهاء الجلسة
    await interaction.editReply({ components: [] }).catch(() => {});
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// بناء Embed الصفحة
// ─────────────────────────────────────────────────────────────────────────────

async function buildPageEmbed(interaction, sorted, page, totalPages, myRank) {
  const start = page * PAGE_SIZE;
  const slice = sorted.slice(start, start + PAGE_SIZE);

  // ─── بناء الأسطر ─────────────────────────────────────────────────────────────
  const lines = await Promise.all(
    slice.map(async (entry, i) => {
      const globalRank = start + i + 1;
      const medal      = MEDALS[globalRank - 1] ?? `\`#${globalRank}\``;
      const isMe       = entry.userId === interaction.user.id;

      // محاولة جلب اسم العضو
      let name;
      try {
        const member = await interaction.guild.members.fetch(entry.userId);
        name = member.displayName;
      } catch {
        // العضو غاب — نستخدم mention
        name = `<@${entry.userId}>`;
      }

      const meTag  = isMe ? " **← أنت**" : "";
      const points = entry.total.toLocaleString("ar-SA");

      return `${medal} **${name}** — ${points} نقطة${meTag}`;
    })
  );

  // ─── سطر موقع المستخدم (إذا لم يكن في الصفحة الحالية) ─────────────────────────
  let myPositionNote = "";
  const myPageIndex = myRank >= 0 ? Math.floor(myRank / PAGE_SIZE) : -1;

  if (myRank >= 0 && myPageIndex !== page) {
    const myEntry  = sorted[myRank];
    const myPoints = myEntry.total.toLocaleString("ar-SA");
    myPositionNote = `\n\n*موقعك في القائمة: **#${myRank + 1}** بـ ${myPoints} نقطة*`;
  }

  // ─── بناء الـ Embed ───────────────────────────────────────────────────────────
  return new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle("🏆 لوحة الصدارة")
    .setDescription(lines.join("\n") + myPositionNote)
    .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
    .addFields(
      { name: "إجمالي المشرفين", value: `${sorted.length}`, inline: true },
      { name: "الصفحة",          value: `${page + 1} / ${totalPages}`, inline: true },
      { name: "المراكز المعروضة", value: `${start + 1} — ${Math.min(start + PAGE_SIZE, sorted.length)}`, inline: true },
    )
    .setFooter({
      text:    `${interaction.guild.name} • تُحدَّث عند كل تفاعل`,
      iconURL: interaction.guild.iconURL({ dynamic: true }),
    })
    .setTimestamp();
}

// ─────────────────────────────────────────────────────────────────────────────
// بناء أزرار التنقل
// ─────────────────────────────────────────────────────────────────────────────

function buildNavRow(page, totalPages) {
  const isFirst = page === 0;
  const isLast  = page >= totalPages - 1;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("top_first")
      .setLabel("⏮")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isFirst),
    new ButtonBuilder()
      .setCustomId("top_prev")
      .setLabel("◀ السابق")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isFirst),
    new ButtonBuilder()
      .setCustomId("top_next")
      .setLabel("التالي ▶")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isLast),
    new ButtonBuilder()
      .setCustomId("top_last")
      .setLabel("⏭")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isLast),
  );
}
