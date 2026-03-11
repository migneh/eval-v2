// src/commands/add.js
// ─────────────────────────────────────────────────────────────────────────────
// أمر /add — إضافة نقاط لمشرف أو أكثر
//
// التدفق:
//   1. فحص الصلاحية (إدارة فقط)
//   2. فحص Anti-Abuse Cooldown
//   3. UserSelectMenu → اختيار المشرفين
//   4. Modal → كتابة عدد النقاط
//   5. Embed تأكيد + زر تنفيذ
//   6. تطبيق النقاط + checkPromotion + تسجيل
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ComponentType,
} from "discord.js";

import { getConfig, addPointsToUser, getUserPoints } from "../utils/db.js";
import { requireAdmin, requireNotSelf }              from "../utils/perms.js";
import { log, makeLogEmbed, LogType }                from "../utils/logger.js";
import { checkPromotion }                            from "../systems/promotions.js";

// ─── Anti-Abuse Cooldown Store ────────────────────────────────────────────────
// Map<"guildId:userId" → timestamp>
// يُخزَّن في الذاكرة — يُصفَّر عند إعادة تشغيل البوت
const abuseCooldowns = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// تعريف الأمر
// ─────────────────────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName("add")
  .setDescription("➕ إضافة نقاط لمشرف أو أكثر")
  .addStringOption((o) =>
    o
      .setName("reason")
      .setDescription("سبب الإضافة (يُسجَّل في السجل)")
      .setRequired(false)
      .setMaxLength(200)
  );

// ─────────────────────────────────────────────────────────────────────────────
// تنفيذ الأمر
// ─────────────────────────────────────────────────────────────────────────────

export async function execute(interaction) {
  const config = getConfig(interaction.guildId);

  // ─── 1. فحص الصلاحية ─────────────────────────────────────────────────────────
  if (!requireAdmin(interaction, config)) return;

  // ─── 2. فحص Anti-Abuse Cooldown ──────────────────────────────────────────────
  const abKey       = `${interaction.guildId}:${interaction.user.id}`;
  const abCooldownMs = (config.limits?.abuseCooldown ?? 30) * 1000;
  const lastUsed    = abuseCooldowns.get(abKey) || 0;
  const cooldownLeft = abCooldownMs - (Date.now() - lastUsed);

  if (cooldownLeft > 0) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xfee75c)
          .setTitle("⏳ انتظر قليلاً")
          .setDescription(
            `يجب الانتظار **${Math.ceil(cooldownLeft / 1000)} ثانية** قبل استخدام هذا الأمر مجدداً.`
          )
          .setTimestamp(),
      ],
      ephemeral: true,
    });
  }

  // ─── 3. قراءة الإعدادات ───────────────────────────────────────────────────────
  const reason     = interaction.options.getString("reason") || "بدون سبب";
  const maxAdd     = config.limits?.maxAdd    ?? 500;
  const maxMembers = config.limits?.maxMembers ?? 10;

  // ─── 4. UserSelectMenu — اختيار المشرفين ──────────────────────────────────────
  const selectRow = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId("add_select_users")
      .setPlaceholder(`اختر من 1 إلى ${maxMembers} مشرف`)
      .setMinValues(1)
      .setMaxValues(maxMembers)
  );

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("➕ إضافة نقاط — الخطوة 1 من 3")
        .setDescription("اختر المشرفين الذين تريد إضافة نقاط لهم:")
        .addFields(
          { name: "السبب",      value: reason,         inline: true },
          { name: "الحد الأقصى", value: `${maxAdd} نقطة`, inline: true },
        )
        .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
        .setFooter({ text: "ستنتهي هذه الجلسة خلال 60 ثانية" })
        .setTimestamp(),
    ],
    components: [selectRow],
    ephemeral:  true,
  });

  // ─── Collector: UserSelect ────────────────────────────────────────────────────
  let selectInteraction;
  try {
    selectInteraction = await interaction.channel.awaitMessageComponent({
      filter:        (i) => i.user.id === interaction.user.id && i.customId === "add_select_users",
      componentType: ComponentType.UserSelect,
      time:          60_000,
    });
  } catch {
    return interaction.editReply({
      embeds: [timeoutEmbed()],
      components: [],
    });
  }

  const selectedUsers = selectInteraction.values;

  // ─── فحص: لا يضيف لنفسه ──────────────────────────────────────────────────────
  if (!requireNotSelf(selectInteraction, selectedUsers)) return;

  // ─── 5. Modal — كتابة عدد النقاط ─────────────────────────────────────────────
  const modal = new ModalBuilder()
    .setCustomId("add_points_modal")
    .setTitle("➕ إضافة نقاط — الخطوة 2 من 3")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("points_amount")
          .setLabel(`عدد النقاط (1 — ${maxAdd})`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(6)
          .setPlaceholder(`مثال: 100`)
      )
    );

  await selectInteraction.showModal(modal);

  // ─── Await Modal Submit ───────────────────────────────────────────────────────
  let modalSubmit;
  try {
    modalSubmit = await selectInteraction.awaitModalSubmit({
      filter: (i) => i.user.id === interaction.user.id && i.customId === "add_points_modal",
      time:   60_000,
    });
  } catch {
    return interaction.editReply({
      embeds: [timeoutEmbed()],
      components: [],
    });
  }

  // ─── تحقق من صحة المدخل ──────────────────────────────────────────────────────
  const rawAmount = modalSubmit.fields.getTextInputValue("points_amount").trim();
  const amount    = parseInt(rawAmount);

  if (isNaN(amount) || amount <= 0 || !Number.isInteger(amount)) {
    return modalSubmit.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setDescription("❌ عدد النقاط يجب أن يكون رقماً صحيحاً موجباً.")
      ],
      ephemeral: true,
    });
  }

  if (amount > maxAdd) {
    return modalSubmit.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setDescription(`❌ الحد الأقصى للإضافة هو **${maxAdd} نقطة** في العملية الواحدة.`)
      ],
      ephemeral: true,
    });
  }

  // ─── 6. Embed التأكيد + زر التنفيذ ──────────────────────────────────────────
  // نعرض النقاط الحالية لكل مشرف قبل التأكيد
  const previewLines = await buildPreviewLines(interaction.guildId, selectedUsers, amount, "add");

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("add_confirm")
      .setLabel("✅ تأكيد الإضافة")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("add_cancel")
      .setLabel("❌ إلغاء")
      .setStyle(ButtonStyle.Secondary),
  );

  await modalSubmit.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("➕ تأكيد الإضافة — الخطوة 3 من 3")
        .setDescription(previewLines)
        .addFields(
          { name: "النقاط المضافة",    value: `+${amount}`,                inline: true },
          { name: "عدد المشرفين",      value: `${selectedUsers.length}`,   inline: true },
          { name: "السبب",             value: reason,                        inline: true },
          { name: "إجمالي النقاط المضافة", value: `${amount * selectedUsers.length} نقطة` },
        )
        .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
        .setFooter({ text: "لديك 30 ثانية للتأكيد" })
        .setTimestamp(),
    ],
    components: [confirmRow],
    ephemeral:  true,
  });

  // ─── Collector: Confirm / Cancel ─────────────────────────────────────────────
  let btnInteraction;
  try {
    btnInteraction = await interaction.channel.awaitMessageComponent({
      filter:        (i) => i.user.id === interaction.user.id && ["add_confirm", "add_cancel"].includes(i.customId),
      componentType: ComponentType.Button,
      time:          30_000,
    });
  } catch {
    return modalSubmit.editReply({
      embeds: [timeoutEmbed()],
      components: [],
    });
  }

  // ─── إلغاء ───────────────────────────────────────────────────────────────────
  if (btnInteraction.customId === "add_cancel") {
    return btnInteraction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0x99aab5)
          .setDescription("❌ تم إلغاء العملية.")
          .setTimestamp(),
      ],
      components: [],
    });
  }

  // ─── 7. تطبيق النقاط ─────────────────────────────────────────────────────────
  abuseCooldowns.set(abKey, Date.now());

  const results = [];
  for (const userId of selectedUsers) {
    const updated = addPointsToUser(
      interaction.guildId,
      userId,
      amount,
      "manual",
      reason,
      interaction.user.id,
    );
    results.push({ userId, newTotal: updated.total });
    await checkPromotion(interaction.guild, userId, interaction.user.id);
  }

  // ─── 8. Embed النتيجة ─────────────────────────────────────────────────────────
  const resultLines = results
    .map((r) => `<@${r.userId}> — **${r.newTotal} نقطة** (+${amount})`)
    .join("\n");

  await btnInteraction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("✅ تمت الإضافة بنجاح")
        .setDescription(resultLines)
        .addFields(
          { name: "النقاط المضافة", value: `+${amount}`,              inline: true },
          { name: "المنفذ",         value: `<@${interaction.user.id}>`, inline: true },
          { name: "السبب",          value: reason,                      inline: true },
        )
        .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
        .setTimestamp(),
    ],
    components: [],
  });

  // ─── 9. تسجيل في السجل ───────────────────────────────────────────────────────
  await log(
    interaction.guild,
    LogType.POINTS_ADD,
    makeLogEmbed(LogType.POINTS_ADD, "➕ نقاط مضافة", [
      { name: "المنفذ",        value: `<@${interaction.user.id}>`,                       inline: true },
      { name: "النقاط",        value: `+${amount}`,                                      inline: true },
      { name: "العدد",         value: `${selectedUsers.length} مشرف`,                   inline: true },
      { name: "السبب",         value: reason },
      { name: "المستفيدون",    value: selectedUsers.map((u) => `<@${u}>`).join(" ") },
      { name: "النتائج",       value: results.map((r) => `<@${r.userId}>: ${r.newTotal}`).join(" | ") },
    ], {
      thumbnail: interaction.guild.iconURL({ dynamic: true }),
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال مساعدة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يبني نص المعاينة للتأكيد
 * يُظهر: النقاط الحالية ← بعد الإضافة/الخصم
 */
async function buildPreviewLines(guildId, userIds, amount, action) {
  const lines = userIds.map((userId) => {
    const current  = getUserPoints(guildId, userId).total || 0;
    const newTotal = action === "add"
      ? current + amount
      : Math.max(0, current - amount);
    const arrow    = action === "add" ? `+${amount}` : `-${amount}`;
    return `<@${userId}>: **${current}** → **${newTotal}** (${arrow})`;
  });
  return lines.join("\n");
}

/**
 * Embed انتهاء الوقت
 */
function timeoutEmbed() {
  return new EmbedBuilder()
    .setColor(0x99aab5)
    .setDescription("⏰ انتهت مهلة العملية. يمكنك إعادة تشغيل الأمر.")
    .setTimestamp();
}
