// src/commands/appeal.js
// ─────────────────────────────────────────────────────────────────────────────
// أمر /appeal — استئناف على عقوبة مرفوضة
//
// التدفق:
//   1. المشرف يُدخل معرف الطلب
//   2. البوت يتحقق أن الطلب موجود وله الحق في الاستئناف
//   3. Modal لكتابة سبب الاستئناف
//   4. createAppeal() → ينشئ بطاقة جديدة في القناة المناسبة
//
// القواعد:
//   - مرتان بحد أقصى لكل عقوبة
//   - الاستئناف الأول → أي مراجع
//   - الاستئناف الثاني (نهائي) → رتبة الاستئناف فقط
//   - بعد رفض الثاني → القرار نهائي لا رجعة
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ComponentType,
} from "discord.js";

import { getConfig, getReviews }               from "../utils/db.js";
import { requireMod }                           from "../utils/perms.js";
import { createAppeal, getUserReviews }         from "../systems/reviews.js";
import { formatDuration }                       from "./moderation.js";

// ─────────────────────────────────────────────────────────────────────────────
// تعريف الأمر
// ─────────────────────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName("appeal")
  .setDescription("🔁 استئناف على عقوبة مرفوضة")
  .addSubcommand((sub) =>
    sub
      .setName("submit")
      .setDescription("🔁 تقديم استئناف على عقوبة مرفوضة")
      .addStringOption((o) =>
        o
          .setName("review_id")
          .setDescription("معرف الطلب (من الرسالة التي وصلتك عبر DM)")
          .setRequired(true)
          .setMinLength(5)
          .setMaxLength(30)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("list")
      .setDescription("📋 عرض عقوباتك القابلة للاستئناف")
  )
  .addSubcommand((sub) =>
    sub
      .setName("status")
      .setDescription("🔍 فحص حالة طلب معين")
      .addStringOption((o) =>
        o
          .setName("review_id")
          .setDescription("معرف الطلب")
          .setRequired(true)
      )
  );

// ─────────────────────────────────────────────────────────────────────────────
// تنفيذ الأمر
// ─────────────────────────────────────────────────────────────────────────────

export async function execute(interaction) {
  const config = getConfig(interaction.guildId);

  // ─── فحص الصلاحية ────────────────────────────────────────────────────────────
  if (!requireMod(interaction, config)) return;

  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case "submit": return handleSubmit(interaction);
    case "list":   return handleList(interaction);
    case "status": return handleStatus(interaction);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// /appeal submit
// ─────────────────────────────────────────────────────────────────────────────

async function handleSubmit(interaction) {
  const reviewId = interaction.options.getString("review_id").trim();
  const reviews  = getReviews(interaction.guildId);
  const review   = reviews[reviewId];

  // ─── فحوصات الطلب ────────────────────────────────────────────────────────────

  // الطلب غير موجود
  if (!review) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("❌ الطلب غير موجود")
          .setDescription(
            `لم يُعثر على طلب بمعرف \`${reviewId}\`\n\n` +
            "تأكد من نسخ المعرف بشكل صحيح من رسالة الإشعار التي وصلتك."
          )
          .setTimestamp(),
      ],
      ephemeral: true,
    });
  }

  // ليس طلبه
  if (review.executorId !== interaction.user.id) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setDescription("❌ هذا الطلب ليس لك.")
      ],
      ephemeral: true,
    });
  }

  // الطلب لم يُرفض بعد
  if (review.status !== "rejected") {
    const statusLabels = {
      pending:  "قيد المراجعة ⏳",
      accepted: "مقبول ✅",
    };
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xfee75c)
          .setDescription(`⚠️ هذا الطلب حالته: **${statusLabels[review.status] || review.status}** — لا يمكن الاستئناف عليه.`)
      ],
      ephemeral: true,
    });
  }

  // لا يحق له الاستئناف
  if (!review.canAppeal) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("❌ لا يحق لك الاستئناف")
          .setDescription(
            review.appealNumber >= 2
              ? "وصلت للحد الأقصى من الاستئنافات (2). القرار نهائي."
              : "هذه العقوبة لا يمكن الاستئناف عليها."
          )
          .setTimestamp(),
      ],
      ephemeral: true,
    });
  }

  // ─── عرض تفاصيل الطلب قبل الاستئناف ──────────────────────────────────────────
  const appealNum    = (review.appealNumber || 0) + 1;
  const typeLabel    = review.type === "warn" ? "⚠️ تحذير" : "⏰ تايم أوت";
  const config       = getConfig(interaction.guildId);
  const isFinal      = appealNum === 2;

  const previewRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("appeal_proceed")
      .setLabel(`📝 كتابة سبب الاستئناف ${isFinal ? "(النهائي)" : "الأول"}`)
      .setStyle(isFinal ? ButtonStyle.Danger : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("appeal_cancel")
      .setLabel("❌ إلغاء")
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(isFinal ? 0xed4245 : 0xffa500)
        .setTitle(`🔁 استئناف ${isFinal ? "ثانٍ ونهائي" : "أول"} — ${typeLabel}`)
        .setDescription(
          isFinal
            ? "⚠️ **هذا هو الاستئناف الأخير والنهائي.** لن تتمكن من الاستئناف مجدداً على هذه العقوبة."
            : "يمكنك تقديم سبب للاستئناف على القرار."
        )
        .addFields(
          { name: "العضو المعاقب",  value: `<@${review.targetId}>`,    inline: true },
          { name: "نوع العقوبة",    value: typeLabel,                    inline: true },
          { name: "السبب الأصلي",   value: review.reason || "لا يوجد",  inline: false },
          { name: "سبب الرفض",      value: review.rejectReason || "لم يُذكر سبب" },
          {
            name:  "المراجع",
            value: isFinal
              ? (config.appealRole ? `<@&${config.appealRole}>` : "الإدارة")
              : "أي مراجع متاح",
            inline: true,
          },
        )
        .setTimestamp(),
    ],
    components: [previewRow],
    ephemeral:  true,
  });

  // ─── Collector: تأكيد المتابعة ────────────────────────────────────────────────
  let proceedBtn;
  try {
    proceedBtn = await interaction.channel.awaitMessageComponent({
      filter:        (i) =>
        i.user.id === interaction.user.id &&
        ["appeal_proceed", "appeal_cancel"].includes(i.customId),
      componentType: ComponentType.Button,
      time:          30_000,
    });
  } catch {
    return interaction.editReply({ embeds: [timeoutEmbed()], components: [] });
  }

  if (proceedBtn.customId === "appeal_cancel") {
    return proceedBtn.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0x99aab5)
          .setDescription("❌ تم إلغاء الاستئناف.")
          .setTimestamp(),
      ],
      components: [],
    });
  }

  // ─── Modal: كتابة سبب الاستئناف ──────────────────────────────────────────────
  const modal = new ModalBuilder()
    .setCustomId(`appeal_reason_modal:${reviewId}`)
    .setTitle(`🔁 سبب الاستئناف ${isFinal ? "(النهائي)" : "الأول"}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("appeal_reason")
          .setLabel("اشرح سبب اعتراضك على القرار")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(10)
          .setMaxLength(1000)
          .setPlaceholder(
            "اذكر سبباً واضحاً لماذا تعتقد أن العقوبة كانت خاطئة أو مبالغ فيها..."
          )
      )
    );

  await proceedBtn.showModal(modal);

  // ─── Await Modal Submit ───────────────────────────────────────────────────────
  let modalSubmit;
  try {
    modalSubmit = await proceedBtn.awaitModalSubmit({
      filter: (i) =>
        i.user.id === interaction.user.id &&
        i.customId === `appeal_reason_modal:${reviewId}`,
      time: 120_000,   // دقيقتان لكتابة السبب
    });
  } catch {
    return interaction.editReply({ embeds: [timeoutEmbed()], components: [] });
  }

  const appealReason = modalSubmit.fields.getTextInputValue("appeal_reason").trim();

  // ─── إرسال الاستئناف ──────────────────────────────────────────────────────────
  await modalSubmit.deferUpdate();

  const result = await createAppeal(
    interaction.guild,
    reviewId,
    appealReason,
    interaction.user.id,
  );

  // ─── نتيجة الإرسال ───────────────────────────────────────────────────────────
  if (!result.success) {
    return interaction.editReply({
      embeds: [errorEmbed(result.msg)],
      components: [],
    });
  }

  const finalEmbed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`✅ تم إرسال الاستئناف ${result.appealNumber === 2 ? "النهائي" : "الأول"}`)
    .addFields(
      {
        name:  "رقم الاستئناف",
        value: `${result.appealNumber} / 2`,
        inline: true,
      },
      {
        name:  "المراجع",
        value: result.appealNumber === 2
          ? (getConfig(interaction.guildId).appealRole
              ? `<@&${getConfig(interaction.guildId).appealRole}>`
              : "الإدارة")
          : "أي مراجع متاح",
        inline: true,
      },
      {
        name:  "🆔 معرف الطلب",
        value: `\`${reviewId}\``,
      },
    )
    .setDescription("سيتم مراجعة استئنافك في أقرب وقت. ستصلك رسالة بالنتيجة.")
    .setTimestamp();

  if (result.appealNumber === 2) {
    finalEmbed.setFooter({ text: "⚠️ هذا استئنافك الأخير — القرار القادم نهائي" });
  }

  await interaction.editReply({
    embeds:     [finalEmbed],
    components: [],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// /appeal list
// ─────────────────────────────────────────────────────────────────────────────

async function handleList(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const myReviews   = getUserReviews(interaction.guildId, interaction.user.id);
  const appealable  = myReviews.filter((r) => r.status === "rejected" && r.canAppeal);
  const history     = myReviews.filter((r) => r.isAppeal);

  // ─── لا يوجد شيء ─────────────────────────────────────────────────────────────
  if (!myReviews.length) {
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("📋 طلباتك")
          .setDescription("لا توجد طلبات مسجّلة لك بعد.")
          .setTimestamp(),
      ],
    });
  }

  // ─── الطلبات القابلة للاستئناف ────────────────────────────────────────────────
  let appealableSection = "لا توجد عقوبات قابلة للاستئناف حالياً.";
  if (appealable.length) {
    appealableSection = appealable.map((r) => {
      const typeLabel = r.type === "warn" ? "⚠️" : "⏰";
      const date      = new Date(r.reviewedAt || r.createdAt).toLocaleDateString("ar-SA");
      return `${typeLabel} \`${r.id}\` — ${r.reason?.slice(0, 40)} | **${date}**`;
    }).join("\n");
  }

  // ─── تاريخ الاستئنافات ────────────────────────────────────────────────────────
  let historySection = "";
  if (history.length) {
    historySection = history.slice(0, 5).map((r) => {
      const statusEmoji = { pending: "⏳", accepted: "✅", rejected: "❌" }[r.status] || "❓";
      const num         = r.appealNumber;
      return `${statusEmoji} استئناف ${num} — \`${r.id}\` — ${r.status === "pending" ? "قيد المراجعة" : r.status === "accepted" ? "مقبول" : "مرفوض"}`;
    }).join("\n");
  }

  const embed = new EmbedBuilder()
    .setColor(0xffa500)
    .setTitle("📋 طلباتك")
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      {
        name:  `🔁 قابلة للاستئناف (${appealable.length})`,
        value: appealableSection,
      },
    )
    .setFooter({ text: "استخدم /appeal submit <review_id> لتقديم استئناف" })
    .setTimestamp();

  if (historySection) {
    embed.addFields({
      name:  "📜 تاريخ استئنافاتك",
      value: historySection,
    });
  }

  // ─── إحصائيات سريعة ──────────────────────────────────────────────────────────
  const acceptedCount  = myReviews.filter((r) => r.status === "accepted").length;
  const rejectedCount  = myReviews.filter((r) => r.status === "rejected" && !r.canAppeal).length;
  const pendingCount   = myReviews.filter((r) => r.status === "pending").length;

  embed.addFields({
    name:  "📊 إحصائياتك",
    value: [
      `✅ مقبولة: **${acceptedCount}**`,
      `❌ مرفوضة نهائياً: **${rejectedCount}**`,
      `⏳ قيد المراجعة: **${pendingCount}**`,
      `📋 الإجمالي: **${myReviews.length}**`,
    ].join("  |  "),
  });

  await interaction.editReply({ embeds: [embed] });
}

// ─────────────────────────────────────────────────────────────────────────────
// /appeal status
// ─────────────────────────────────────────────────────────────────────────────

async function handleStatus(interaction) {
  const reviewId = interaction.options.getString("review_id").trim();
  const reviews  = getReviews(interaction.guildId);
  const review   = reviews[reviewId];

  // ─── الطلب غير موجود ─────────────────────────────────────────────────────────
  if (!review) {
    return interaction.reply({
      embeds: [errorEmbed(`لم يُعثر على طلب بمعرف \`${reviewId}\``)],
      ephemeral: true,
    });
  }

  // ─── ليس طلبه (إلا إذا كان أدمن) ─────────────────────────────────────────────
  const config = getConfig(interaction.guildId);
  const isOwner   = interaction.guild.ownerId === interaction.user.id;
  const isAdminUser = interaction.member.permissions.has("Administrator");
  const isHisReview = review.executorId === interaction.user.id;

  if (!isHisReview && !isOwner && !isAdminUser) {
    return interaction.reply({
      embeds: [errorEmbed("لا يمكنك عرض تفاصيل طلب ليس لك.")],
      ephemeral: true,
    });
  }

  // ─── بناء الـ Embed ───────────────────────────────────────────────────────────
  const statusEmoji = { pending: "⏳", accepted: "✅", rejected: "❌" }[review.status] || "❓";
  const statusText  = {
    pending:  "قيد المراجعة",
    accepted: "مقبول",
    rejected: "مرفوض",
  }[review.status] || review.status;

  const typeLabel = review.type === "warn" ? "⚠️ تحذير" : "⏰ تايم أوت";

  const embed = new EmbedBuilder()
    .setColor(
      review.status === "accepted" ? 0x57f287 :
      review.status === "rejected" ? 0xed4245 :
      0xffa500
    )
    .setTitle(`🔍 تفاصيل الطلب \`${reviewId}\``)
    .addFields(
      { name: "نوع العقوبة",   value: typeLabel,                                    inline: true },
      { name: "العضو المعاقب", value: `<@${review.targetId}>`,                      inline: true },
      { name: "الحالة",        value: `${statusEmoji} ${statusText}`,               inline: true },
      { name: "السبب",         value: review.reason || "لا يوجد" },
    )
    .setTimestamp(review.createdAt);

  if (review.type === "timeout" && review.duration) {
    embed.addFields({
      name:  "المدة",
      value: formatDuration(review.duration),
      inline: true,
    });
  }

  if (review.reviewerId) {
    embed.addFields(
      { name: "المراجع",    value: `<@${review.reviewerId}>`,                      inline: true },
      { name: "وقت المراجعة", value: review.reviewedAt
          ? new Date(review.reviewedAt).toLocaleDateString("ar-SA", {
              day: "numeric", month: "short", year: "numeric",
              hour: "2-digit", minute: "2-digit",
            })
          : "—",
        inline: true,
      },
    );
  }

  if (review.status === "rejected" && review.rejectReason) {
    embed.addFields({ name: "سبب الرفض", value: review.rejectReason });
  }

  // معلومات الاستئناف
  if (review.appealNumber > 0) {
    embed.addFields({
      name:  "🔁 الاستئناف",
      value: [
        `رقم الاستئناف: **${review.appealNumber}**`,
        review.appealReason ? `السبب: ${review.appealReason}` : "",
      ].filter(Boolean).join("\n"),
    });
  }

  // هل يمكن الاستئناف؟
  if (review.status === "rejected") {
    embed.addFields({
      name:  "الاستئناف",
      value: review.canAppeal
        ? `✅ يحق لك الاستئناف (استئناف ${(review.appealNumber || 0) + 1}/2)\nاستخدم: \`/appeal submit ${reviewId}\``
        : "❌ وصلت للحد الأقصى من الاستئنافات — القرار نهائي",
    });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال مساعدة
// ─────────────────────────────────────────────────────────────────────────────

function errorEmbed(msg) {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setDescription(`❌ ${msg}`)
    .setTimestamp();
}

function timeoutEmbed() {
  return new EmbedBuilder()
    .setColor(0x99aab5)
    .setDescription("⏰ انتهت مهلة العملية. يمكنك إعادة تشغيل الأمر.")
    .setTimestamp();
}
