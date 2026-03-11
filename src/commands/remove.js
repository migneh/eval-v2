// src/commands/remove.js
// ─────────────────────────────────────────────────────────────────────────────
// أمر /remove — خصم نقاط من مشرف أو أكثر
//
// التدفق:
//   1. فحص الصلاحية (إدارة فقط)
//   2. فحص Anti-Abuse Cooldown
//   3. UserSelectMenu → اختيار المشرفين
//   4. Modal → كتابة عدد النقاط
//   5. Embed تأكيد + زر تنفيذ
//   6. تطبيق الخصم + تسجيل
//
// قواعد الخصم:
//   - لا تنزل النقاط تحت الصفر (منع القيم السالبة)
//   - المنفذ لا يقدر يخصم من نفسه حتى لو كان أدمن أو أونر
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

// ─── Anti-Abuse Cooldown Store ────────────────────────────────────────────────
const abuseCooldowns = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// تعريف الأمر
// ─────────────────────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName("remove")
  .setDescription("➖ خصم نقاط من مشرف أو أكثر")
  .addStringOption((o) =>
    o
      .setName("reason")
      .setDescription("سبب الخصم (يُسجَّل في السجل)")
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
  const abKey        = `${interaction.guildId}:${interaction.user.id}`;
  const abCooldownMs = (config.limits?.abuseCooldown ?? 30) * 1000;
  const lastUsed     = abuseCooldowns.get(abKey) || 0;
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
  const maxRemove  = config.limits?.maxRemove  ?? 500;
  const maxMembers = config.limits?.maxMembers ?? 10;

  // ─── 4. UserSelectMenu — اختيار المشرفين ──────────────────────────────────────
  const selectRow = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId("remove_select_users")
      .setPlaceholder(`اختر من 1 إلى ${maxMembers} مشرف`)
      .setMinValues(1)
      .setMaxValues(maxMembers)
  );

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle("➖ خصم نقاط — الخطوة 1 من 3")
        .setDescription("اختر المشرفين الذين تريد خصم نقاط منهم:")
        .addFields(
          { name: "السبب",           value: reason,            inline: true },
          { name: "الحد الأقصى للخصم", value: `${maxRemove} نقطة`, inline: true },
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
      filter:        (i) => i.user.id === interaction.user.id && i.customId === "remove_select_users",
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

  // ─── فحص: لا يخصم من نفسه ─────────────────────────────────────────────────────
  if (!requireNotSelf(selectInteraction, selectedUsers)) return;

  // ─── 5. Modal — كتابة عدد النقاط ─────────────────────────────────────────────
  const modal = new ModalBuilder()
    .setCustomId("remove_points_modal")
    .setTitle("➖ خصم نقاط — الخطوة 2 من 3")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("points_amount")
          .setLabel(`عدد النقاط للخصم (1 — ${maxRemove})`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(6)
          .setPlaceholder("مثال: 50")
      )
    );

  await selectInteraction.showModal(modal);

  // ─── Await Modal Submit ───────────────────────────────────────────────────────
  let modalSubmit;
  try {
    modalSubmit = await selectInteraction.awaitModalSubmit({
      filter: (i) => i.user.id === interaction.user.id && i.customId === "remove_points_modal",
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

  if (amount > maxRemove) {
    return modalSubmit.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setDescription(`❌ الحد الأقصى للخصم هو **${maxRemove} نقطة** في العملية الواحدة.`)
      ],
      ephemeral: true,
    });
  }

  // ─── 6. Embed التأكيد + زر التنفيذ ──────────────────────────────────────────
  // نعرض تأثير الخصم على كل مشرف مع تنبيه إذا كان سيصل للصفر
  const previewLines = buildRemovePreviewLines(interaction.guildId, selectedUsers, amount);

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("remove_confirm")
      .setLabel("✅ تأكيد الخصم")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("remove_cancel")
      .setLabel("❌ إلغاء")
      .setStyle(ButtonStyle.Secondary),
  );

  await modalSubmit.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle("➖ تأكيد الخصم — الخطوة 3 من 3")
        .setDescription(previewLines)
        .addFields(
          { name: "النقاط المخصومة",    value: `-${amount}`,               inline: true },
          { name: "عدد المشرفين",       value: `${selectedUsers.length}`,  inline: true },
          { name: "السبب",              value: reason,                      inline: true },
        )
        .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
        .setFooter({ text: "⚠️ النقاط لن تنزل تحت الصفر • لديك 30 ثانية للتأكيد" })
        .setTimestamp(),
    ],
    components: [confirmRow],
    ephemeral:  true,
  });

  // ─── Collector: Confirm / Cancel ─────────────────────────────────────────────
  let btnInteraction;
  try {
    btnInteraction = await interaction.channel.awaitMessageComponent({
      filter:        (i) => i.user.id === interaction.user.id && ["remove_confirm", "remove_cancel"].includes(i.customId),
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
  if (btnInteraction.customId === "remove_cancel") {
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

  // ─── 7. تطبيق الخصم ──────────────────────────────────────────────────────────
  abuseCooldowns.set(abKey, Date.now());

  const results = [];
  for (const userId of selectedUsers) {
    const current  = getUserPoints(interaction.guildId, userId).total || 0;

    // منع الهبوط تحت الصفر — نخصم فقط ما هو موجود
    const actualDeduct = Math.min(amount, current);

    const updated = addPointsToUser(
      interaction.guildId,
      userId,
      -actualDeduct,       // قيمة سالبة
      "manual",
      reason,
      interaction.user.id,
    );

    results.push({
      userId,
      deducted: actualDeduct,
      newTotal: Math.max(0, updated.total),
      wasLimited: actualDeduct < amount,  // هل كانت نقاطه أقل من المطلوب؟
    });
  }

  // ─── 8. Embed النتيجة ─────────────────────────────────────────────────────────
  const resultLines = results.map((r) => {
    const limitNote = r.wasLimited ? ` ⚠️ خُصم ${r.deducted} فقط` : "";
    return `<@${r.userId}> — **${r.newTotal} نقطة** (-${r.deducted})${limitNote}`;
  }).join("\n");

  // تنبيه إذا كان بعضهم محدود
  const hasLimited = results.some((r) => r.wasLimited);

  const resultEmbed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("✅ تم الخصم")
    .setDescription(resultLines)
    .addFields(
      { name: "المطلوب خصمه", value: `-${amount}`,               inline: true },
      { name: "المنفذ",        value: `<@${interaction.user.id}>`, inline: true },
      { name: "السبب",         value: reason,                      inline: true },
    )
    .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
    .setTimestamp();

  if (hasLimited) {
    resultEmbed.addFields({
      name:  "⚠️ ملاحظة",
      value: "بعض المشرفين كانت نقاطهم أقل من المطلوب خصمه — خُصم ما هو متاح فقط ولم تنزل النقاط تحت الصفر.",
    });
  }

  await btnInteraction.update({
    embeds: [resultEmbed],
    components: [],
  });

  // ─── 9. تسجيل في السجل ───────────────────────────────────────────────────────
  await log(
    interaction.guild,
    LogType.POINTS_REMOVE,
    makeLogEmbed(LogType.POINTS_REMOVE, "➖ نقاط مخصومة", [
      { name: "المنفذ",     value: `<@${interaction.user.id}>`,                                              inline: true },
      { name: "المطلوب",   value: `-${amount}`,                                                              inline: true },
      { name: "العدد",      value: `${selectedUsers.length} مشرف`,                                          inline: true },
      { name: "السبب",      value: reason },
      { name: "المتضررون", value: selectedUsers.map((u) => `<@${u}>`).join(" ") },
      {
        name:  "النتائج",
        value: results
          .map((r) => `<@${r.userId}>: ${r.newTotal} ${r.wasLimited ? `(محدود: ${r.deducted})` : ""}`)
          .join(" | "),
      },
    ], {
      thumbnail: interaction.guild.iconURL({ dynamic: true }),
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال مساعدة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يبني نص معاينة الخصم مع تنبيه للمشرفين الذين سينزلون للصفر
 */
function buildRemovePreviewLines(guildId, userIds, amount) {
  return userIds.map((userId) => {
    const current   = getUserPoints(guildId, userId).total || 0;
    const actual    = Math.min(amount, current);
    const newTotal  = Math.max(0, current - actual);
    const willLimit = actual < amount;
    const note      = willLimit ? ` ⚠️ (سيُخصم ${actual} فقط)` : "";
    return `<@${userId}>: **${current}** → **${newTotal}** (-${actual})${note}`;
  }).join("\n");
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
