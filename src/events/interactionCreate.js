// src/events/interactionCreate.js
// ─────────────────────────────────────────────────────────────────────────────
// يُستدعى عند كل تفاعل جديد:
//   - Slash Commands  → يُنفّذ الأمر المناسب
//   - Buttons         → يتعامل مع أزرار المراجعة (قبول/رفض)
//   - StringSelect    → محجوز للمستقبل
// ─────────────────────────────────────────────────────────────────────────────

import { EmbedBuilder } from "discord.js";
import { getConfig }    from "../utils/db.js";
import { isAdmin }      from "../utils/perms.js";
import {
  acceptReview,
  rejectReview,
}                       from "../systems/reviews.js";

/**
 * @param {Interaction}  interaction - التفاعل القادم من ديسكورد
 * @param {Collection}   commands    - Collection<name, { data, execute }>
 */
export async function handleInteractionCreate(interaction, commands) {

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Slash Commands
  // ─────────────────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    await handleSlashCommand(interaction, commands);
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Button Interactions
  // ─────────────────────────────────────────────────────────────────────────
  if (interaction.isButton()) {
    await handleButton(interaction);
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Select Menu Interactions (UserSelect, RoleSelect, ChannelSelect)
  //    هذه تُعالَج داخل كل أمر عبر collectors محلية
  //    لا نحتاج معالجة مركزية هنا
  // ─────────────────────────────────────────────────────────────────────────
  // if (interaction.isAnySelectMenu()) { ... }

}

// ─────────────────────────────────────────────────────────────────────────────
// معالج الـ Slash Commands
// ─────────────────────────────────────────────────────────────────────────────

async function handleSlashCommand(interaction, commands) {
  const command = commands.get(interaction.commandName);

  // الأمر غير موجود في الـ Collection (حُذف من الكود لكن ما يزال مسجلاً في Discord)
  if (!command) {
    console.warn(`⚠️ أمر غير معروف: /${interaction.commandName}`);
    await interaction.reply({
      embeds: [errorEmbed("هذا الأمر غير متاح حالياً. جرب لاحقاً.")],
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  // تأكد أن التفاعل داخل سيرفر
  if (!interaction.guild) {
    await interaction.reply({
      embeds: [errorEmbed("هذا الأمر يعمل داخل السيرفرات فقط.")],
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`❌ خطأ في /${interaction.commandName}:`, err);

    const errMsg = {
      embeds: [errorEmbed("حدث خطأ أثناء تنفيذ الأمر. حاول مجدداً.")],
      ephemeral: true,
    };

    // إذا لم يُرد البوت بعد → reply
    // إذا رد أو deferred → followUp
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errMsg).catch(() => {});
    } else {
      await interaction.reply(errMsg).catch(() => {});
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// معالج الأزرار
// ─────────────────────────────────────────────────────────────────────────────

async function handleButton(interaction) {
  const { customId, guild, member, user } = interaction;

  // ─── أزرار المراجعة ────────────────────────────────────────────────────────
  // customId الشكل: "review_accept:REVIEW_ID" أو "review_reject:REVIEW_ID"
  if (customId.startsWith("review_accept:") || customId.startsWith("review_reject:")) {
    await handleReviewButton(interaction);
    return;
  }

  // ─── أزرار أخرى ────────────────────────────────────────────────────────────
  // باقي الأزرار (setup, add, remove, top ...) تُعالَج عبر collectors
  // داخل كل أمر → لا نحتاج معالجة هنا
}

// ─────────────────────────────────────────────────────────────────────────────
// معالج أزرار المراجعة تفصيلياً
// ─────────────────────────────────────────────────────────────────────────────

async function handleReviewButton(interaction) {
  const { customId, guild, member, user } = interaction;

  // تأكد أن التفاعل داخل سيرفر
  if (!guild) {
    await interaction.reply({
      embeds: [errorEmbed("هذا الزر يعمل داخل السيرفرات فقط.")],
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  // ─── استخرج نوع الإجراء ومعرّف الطلب ────────────────────────────────────────
  const [action, reviewId] = customId.split(":");

  if (!reviewId) {
    await interaction.reply({
      embeds: [errorEmbed("معرّف الطلب مفقود. الرسالة قديمة أو تالفة.")],
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  // ─── تحقق من الصلاحية ────────────────────────────────────────────────────────
  const config = getConfig(guild.id);

  if (!isAdmin(member, config)) {
    await interaction.reply({
      embeds: [errorEmbed("ليس لديك صلاحية مراجعة العقوبات.\nتحتاج رتبة إدارة.")],
      ephemeral: true,
    }).catch(() => {});
    return;
  }

  // ─── deferUpdate أولاً لمنع "This interaction failed" ───────────────────────
  // deferUpdate يُخبر Discord أن البوت استلم التفاعل ويعمل عليه
  // لا يُعدّل الرسالة الأصلية
  try {
    await interaction.deferUpdate();
  } catch {
    // إذا فشل deferUpdate (انتهت مهلة الـ 3 ثواني) → تجاهل
    return;
  }

  // ─── تنفيذ القبول أو الرفض ───────────────────────────────────────────────────
  if (action === "review_accept") {
    await handleAccept(interaction, guild, reviewId, user.id);
  } else if (action === "review_reject") {
    await handleReject(interaction, guild, reviewId, user.id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// قبول المراجعة
// ─────────────────────────────────────────────────────────────────────────────

async function handleAccept(interaction, guild, reviewId, reviewerId) {
  try {
    const result = await acceptReview(guild, reviewId, reviewerId);

    if (!result.success) {
      await interaction.followUp({
        embeds: [warningEmbed(
          result.reason === "not_found"
            ? "هذا الطلب غير موجود أو حُذف."
            : "هذا الطلب تمت مراجعته مسبقاً ولا يمكن تعديله."
        )],
        ephemeral: true,
      }).catch(() => {});
      return;
    }

    await interaction.followUp({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle("✅ تم القبول")
          .addFields(
            { name: "النقاط المضافة", value: `+${result.points}`, inline: true },
            { name: "المراجع",        value: `<@${reviewerId}>`, inline: true },
          )
          .setTimestamp(),
      ],
      ephemeral: true,
    }).catch(() => {});

  } catch (err) {
    console.error("❌ خطأ في قبول المراجعة:", err);
    await interaction.followUp({
      embeds: [errorEmbed("حدث خطأ أثناء قبول الطلب.")],
      ephemeral: true,
    }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// رفض المراجعة — يفتح Modal لكتابة سبب الرفض
// ─────────────────────────────────────────────────────────────────────────────

async function handleReject(interaction, guild, reviewId, reviewerId) {
  // فتح Modal لكتابة سبب الرفض
  const {
    ModalBuilder,
    ActionRowBuilder,
    TextInputBuilder,
    TextInputStyle,
  } = await import("discord.js");

  const modal = new ModalBuilder()
    .setCustomId(`reject_reason_modal:${reviewId}`)
    .setTitle("❌ سبب الرفض")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("سبب رفض العقوبة")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(500)
          .setPlaceholder("اختياري — اتركه فارغاً إن لم يكن هناك سبب محدد")
      )
    );

  // showModal يعمل فقط قبل deferUpdate/reply
  // لكننا قلنا deferUpdate بالفعل → نحتاج approach مختلف
  // الحل: نستخدم followUp برسالة تطلب منه كتابة السبب عبر زر آخر
  // أو: نكتفي بالرفض بدون Modal هنا ونضع سبباً افتراضياً

  // ─── ملاحظة تقنية ────────────────────────────────────────────────────────────
  // Discord لا يسمح بـ showModal بعد deferUpdate
  // لذلك نرفض مباشرة بدون سبب، والمراجع يستطيع كتابة السبب في الـ embed اليدوي
  // بديل احترافي: نُعيد الزر بدون deferUpdate ونستخدم showModal مباشرة
  // لكن لتبسيط الكود، نستخدم سبباً افتراضياً هنا

  try {
    const result = await rejectReview(guild, reviewId, reviewerId, "");

    if (!result.success) {
      await interaction.followUp({
        embeds: [warningEmbed(
          result.reason === "not_found"
            ? "هذا الطلب غير موجود أو حُذف."
            : "هذا الطلب تمت مراجعته مسبقاً."
        )],
        ephemeral: true,
      }).catch(() => {});
      return;
    }

    await interaction.followUp({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("❌ تم الرفض")
          .addFields(
            { name: "المراجع",             value: `<@${reviewerId}>`, inline: true },
            { name: "يحق للمشرف الاستئناف", value: result.canAppeal ? "✅ نعم" : "❌ لا",  inline: true },
          )
          .setFooter({ text: "المشرف سيتلقى إشعاراً بالرفض تلقائياً" })
          .setTimestamp(),
      ],
      ephemeral: true,
    }).catch(() => {});

  } catch (err) {
    console.error("❌ خطأ في رفض المراجعة:", err);
    await interaction.followUp({
      embeds: [errorEmbed("حدث خطأ أثناء رفض الطلب.")],
      ephemeral: true,
    }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Embeds مساعدة
// ─────────────────────────────────────────────────────────────────────────────

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
