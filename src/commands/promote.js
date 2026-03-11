// src/commands/promote.js
// ─────────────────────────────────────────────────────────────────────────────
// أمر /promote — إدارة ترقيات المشرفين
//
// الأوامر الفرعية:
//   /promote up   @member reason  → ترقية يدوية للمرحلة التالية
//   /promote down @member reason  → تخفيض يدوي للمرحلة السابقة
//   /promote info                 → عرض السلم الوظيفي مع إحصائيات
//
// القواعد:
//   - up / down تتطلبان صلاحية إدارة
//   - info متاح للجميع
//   - لا يمكن ترقية/تخفيض نفسك
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from "discord.js";

import { getConfig, getUserPoints }           from "../utils/db.js";
import { requireAdmin }                        from "../utils/perms.js";
import { manualPromote, getLadderStats }       from "../systems/promotions.js";

// ─────────────────────────────────────────────────────────────────────────────
// تعريف الأمر
// ─────────────────────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName("promote")
  .setDescription("⬆️ إدارة ترقيات المشرفين")
  .addSubcommand((sub) =>
    sub
      .setName("up")
      .setDescription("⬆️ ترقية مشرف للمرحلة التالية يدوياً")
      .addUserOption((o) =>
        o.setName("member").setDescription("المشرف المستهدف").setRequired(true)
      )
      .addStringOption((o) =>
        o
          .setName("reason")
          .setDescription("سبب الترقية")
          .setRequired(true)
          .setMaxLength(200)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("down")
      .setDescription("⬇️ تخفيض مشرف للمرحلة السابقة يدوياً")
      .addUserOption((o) =>
        o.setName("member").setDescription("المشرف المستهدف").setRequired(true)
      )
      .addStringOption((o) =>
        o
          .setName("reason")
          .setDescription("سبب التخفيض")
          .setRequired(true)
          .setMaxLength(200)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("info")
      .setDescription("📊 عرض السلم الوظيفي الكامل مع إحصائيات")
  );

// ─────────────────────────────────────────────────────────────────────────────
// تنفيذ الأمر
// ─────────────────────────────────────────────────────────────────────────────

export async function execute(interaction) {
  const sub    = interaction.options.getSubcommand();
  const config = getConfig(interaction.guildId);

  switch (sub) {
    case "up":   return handleUp(interaction, config);
    case "down": return handleDown(interaction, config);
    case "info": return handleInfo(interaction, config);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// /promote up
// ─────────────────────────────────────────────────────────────────────────────

async function handleUp(interaction, config) {
  // ─── فحص الصلاحية ────────────────────────────────────────────────────────────
  if (!requireAdmin(interaction, config)) return;

  const targetUser = interaction.options.getUser("member");
  const reason     = interaction.options.getString("reason");

  // ─── منع الترقية لنفسه ────────────────────────────────────────────────────────
  if (targetUser.id === interaction.user.id) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setDescription("❌ لا يمكنك ترقية نفسك.")
      ],
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  // ─── معاينة قبل التنفيذ ──────────────────────────────────────────────────────
  const milestones = getSortedMilestones(config);

  let member;
  try {
    member = await interaction.guild.members.fetch(targetUser.id);
  } catch {
    return interaction.editReply({
      embeds: [errorEmbed("لم يُعثر على العضو في السيرفر.")],
    });
  }

  const currentIdx = milestones.findIndex((m) => member.roles.cache.has(m.roleId));
  const targetIdx  = currentIdx === -1 ? 0 : currentIdx + 1;

  if (targetIdx >= milestones.length) {
    return interaction.editReply({
      embeds: [warningEmbed("المشرف وصل للمرحلة الأعلى بالفعل — لا يمكن الترقية أكثر.")],
    });
  }

  const fromMilestone = currentIdx >= 0 ? milestones[currentIdx] : null;
  const toMilestone   = milestones[targetIdx];
  const userData      = getUserPoints(interaction.guildId, targetUser.id);

  // ─── Embed التأكيد ────────────────────────────────────────────────────────────
  const confirmRow = buildConfirmRow("promote_up");

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle("⬆️ تأكيد الترقية")
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: "المشرف",          value: `<@${targetUser.id}>`,                                          inline: true },
          { name: "النقاط الحالية",  value: `${(userData.total || 0).toLocaleString()}`,                    inline: true },
          { name: "من رتبة",         value: fromMilestone ? `<@&${fromMilestone.roleId}>` : "لا رتبة",     inline: true },
          { name: "إلى رتبة",        value: `<@&${toMilestone.roleId}>`,                                    inline: true },
          { name: "السبب",           value: reason },
        )
        .setFooter({ text: "لديك 30 ثانية للتأكيد" })
        .setTimestamp(),
    ],
    components: [confirmRow],
  });

  // ─── Collector التأكيد ────────────────────────────────────────────────────────
  const btn = await awaitConfirm(interaction, "promote_up");
  if (!btn) return;

  if (btn.customId === "promote_up_cancel") {
    return btn.update({ embeds: [cancelEmbed()], components: [] });
  }

  // ─── تنفيذ الترقية ───────────────────────────────────────────────────────────
  await btn.update({ embeds: [loadingEmbed("⬆️ جاري الترقية...")], components: [] });

  const result = await manualPromote(
    interaction.guild,
    targetUser.id,
    "up",
    interaction.user.id,
    reason,
  );

  if (!result.success) {
    return interaction.editReply({ embeds: [errorEmbed(result.msg)] });
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("✅ تمت الترقية بنجاح")
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: "المشرف",        value: `<@${targetUser.id}>`,          inline: true },
          { name: "المنفذ",        value: `<@${interaction.user.id}>`,    inline: true },
          { name: "الرتبة الجديدة", value: `<@&${result.newRoleId}>`,    inline: true },
          { name: "السبب",         value: reason },
        )
        .setTimestamp(),
    ],
    components: [],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// /promote down
// ─────────────────────────────────────────────────────────────────────────────

async function handleDown(interaction, config) {
  // ─── فحص الصلاحية ────────────────────────────────────────────────────────────
  if (!requireAdmin(interaction, config)) return;

  const targetUser = interaction.options.getUser("member");
  const reason     = interaction.options.getString("reason");

  // ─── منع التخفيض لنفسه ────────────────────────────────────────────────────────
  if (targetUser.id === interaction.user.id) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setDescription("❌ لا يمكنك تخفيض نفسك.")
      ],
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  // ─── معاينة قبل التنفيذ ──────────────────────────────────────────────────────
  const milestones = getSortedMilestones(config);

  let member;
  try {
    member = await interaction.guild.members.fetch(targetUser.id);
  } catch {
    return interaction.editReply({
      embeds: [errorEmbed("لم يُعثر على العضو في السيرفر.")],
    });
  }

  const currentIdx = milestones.findIndex((m) => member.roles.cache.has(m.roleId));

  if (currentIdx === -1) {
    return interaction.editReply({
      embeds: [warningEmbed("المشرف لا يملك أي رتبة من السلم — لا يمكن التخفيض.")],
    });
  }

  if (currentIdx === 0) {
    return interaction.editReply({
      embeds: [warningEmbed("المشرف في المرحلة الأدنى بالفعل — لا يمكن التخفيض أكثر.")],
    });
  }

  const fromMilestone = milestones[currentIdx];
  const toMilestone   = milestones[currentIdx - 1];
  const userData      = getUserPoints(interaction.guildId, targetUser.id);

  // ─── Embed التأكيد ────────────────────────────────────────────────────────────
  const confirmRow = buildConfirmRow("promote_down", true);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle("⬇️ تأكيد التخفيض")
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: "المشرف",         value: `<@${targetUser.id}>`,                    inline: true },
          { name: "النقاط الحالية", value: `${(userData.total || 0).toLocaleString()}`, inline: true },
          { name: "من رتبة",        value: `<@&${fromMilestone.roleId}>`,             inline: true },
          { name: "إلى رتبة",       value: `<@&${toMilestone.roleId}>`,               inline: true },
          { name: "السبب",          value: reason },
        )
        .setFooter({ text: "⚠️ هذا الإجراء سيُخفّض رتبة المشرف • لديك 30 ثانية" })
        .setTimestamp(),
    ],
    components: [confirmRow],
  });

  // ─── Collector التأكيد ────────────────────────────────────────────────────────
  const btn = await awaitConfirm(interaction, "promote_down");
  if (!btn) return;

  if (btn.customId === "promote_down_cancel") {
    return btn.update({ embeds: [cancelEmbed()], components: [] });
  }

  // ─── تنفيذ التخفيض ───────────────────────────────────────────────────────────
  await btn.update({ embeds: [loadingEmbed("⬇️ جاري التخفيض...")], components: [] });

  const result = await manualPromote(
    interaction.guild,
    targetUser.id,
    "down",
    interaction.user.id,
    reason,
  );

  if (!result.success) {
    return interaction.editReply({ embeds: [errorEmbed(result.msg)] });
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle("✅ تم التخفيض")
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: "المشرف",        value: `<@${targetUser.id}>`,       inline: true },
          { name: "المنفذ",        value: `<@${interaction.user.id}>`, inline: true },
          { name: "الرتبة الجديدة", value: `<@&${result.newRoleId}>`, inline: true },
          { name: "السبب",         value: reason },
        )
        .setTimestamp(),
    ],
    components: [],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// /promote info
// ─────────────────────────────────────────────────────────────────────────────

async function handleInfo(interaction, config) {
  await interaction.deferReply();

  const milestones = getSortedMilestones(config);

  // ─── Empty State ──────────────────────────────────────────────────────────────
  if (!milestones.length) {
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("🪜 السلم الوظيفي")
          .setDescription("لم تُعدَّ مراحل بعد.\n\nاستخدم `/setup` → 🏆 تعديل مراحل المكافآت.")
          .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
          .setTimestamp(),
      ],
    });
  }

  // ─── جلب إحصائيات كل مرحلة ───────────────────────────────────────────────────
  const stats = await getLadderStats(interaction.guild);

  // ─── بناء الأسطر ─────────────────────────────────────────────────────────────
  const lines = stats.map((s, i) => {
    const num        = i + 1;
    const bar        = buildMiniBar(s.count, getMaxCount(stats));
    const countText  = `👥 **${s.count}**`;
    const pointsText = `${s.milestone.points.toLocaleString()} نقطة`;

    return [
      `**${num}.** <@&${s.milestone.roleId}>`,
      `${bar} ${countText} | ${pointsText}`,
    ].join("\n");
  });

  // ─── إجمالي المشرفين في السلم ────────────────────────────────────────────────
  const totalInLadder = stats.reduce((sum, s) => sum + s.count, 0);

  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle("🪜 السلم الوظيفي")
    .setDescription(lines.join("\n\n"))
    .addFields(
      { name: "عدد المراحل",          value: `${milestones.length}`,   inline: true },
      { name: "مشرفو السلم",          value: `${totalInLadder}`,        inline: true },
      { name: "المرحلة القصوى",       value: `${milestones[milestones.length - 1]?.points.toLocaleString()} نقطة`, inline: true },
    )
    .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
    .setFooter({
      text:    `${interaction.guild.name} • للترقية اليدوية: /promote up @member reason`,
      iconURL: interaction.guild.iconURL({ dynamic: true }),
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال مساعدة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُرتّب مراحل المكافآت تصاعدياً
 */
function getSortedMilestones(config) {
  return (config.milestones || [])
    .filter((m) => m.points > 0 && m.roleId)
    .sort((a, b) => a.points - b.points);
}

/**
 * ينتظر ضغطة زر التأكيد أو الإلغاء
 *
 * @param {CommandInteraction} interaction
 * @param {string}             prefix       - بادئة الـ customId
 * @returns {ButtonInteraction|null}
 */
async function awaitConfirm(interaction, prefix) {
  try {
    return await interaction.channel.awaitMessageComponent({
      filter:        (i) =>
        i.user.id === interaction.user.id &&
        [`${prefix}_confirm`, `${prefix}_cancel`].includes(i.customId),
      componentType: ComponentType.Button,
      time:          30_000,
    });
  } catch {
    await interaction.editReply({
      embeds:     [timeoutEmbed()],
      components: [],
    });
    return null;
  }
}

/**
 * يبني صف أزرار التأكيد والإلغاء
 *
 * @param {string}  prefix   - بادئة الـ customId
 * @param {boolean} isDanger - هل زر التأكيد أحمر؟
 */
function buildConfirmRow(prefix, isDanger = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}_confirm`)
      .setLabel("✅ تأكيد")
      .setStyle(isDanger ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${prefix}_cancel`)
      .setLabel("❌ إلغاء")
      .setStyle(ButtonStyle.Secondary),
  );
}

/**
 * يبني mini progress bar لعدد المشرفين
 *
 * @param {number} count   - عدد المشرفين في المرحلة
 * @param {number} max     - أكبر عدد بين المراحل
 * @returns {string}
 */
function buildMiniBar(count, max) {
  if (max === 0) return "░░░░░";
  const filled = Math.round((count / max) * 5);
  return "█".repeat(filled) + "░".repeat(5 - filled);
}

/**
 * يُرجع أكبر عدد مشرفين بين المراحل
 */
function getMaxCount(stats) {
  return Math.max(...stats.map((s) => s.count), 1);
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

function cancelEmbed() {
  return new EmbedBuilder()
    .setColor(0x99aab5)
    .setDescription("❌ تم إلغاء العملية.")
    .setTimestamp();
}

function timeoutEmbed() {
  return new EmbedBuilder()
    .setColor(0x99aab5)
    .setDescription("⏰ انتهت مهلة العملية. يمكنك إعادة تشغيل الأمر.")
    .setTimestamp();
}

function loadingEmbed(msg) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setDescription(`⏳ ${msg}`)
    .setTimestamp();
}
