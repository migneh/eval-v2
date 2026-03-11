// src/commands/help.js
// ─────────────────────────────────────────────────────────────────────────────
// أمر /help — دليل الأوامر الكامل
//
// الميزات:
//   - قائمة منسدلة لاختيار الفئة
//   - صفحة مخصصة لكل فئة مع شرح تفصيلي
//   - تُخفي الأوامر التي لا يملك المستخدم صلاحية رؤيتها
//   - زر للعودة للقائمة الرئيسية
//   - متاح للجميع (مشرفين وغيرهم)
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from "discord.js";

import { getConfig }          from "../utils/db.js";
import { isAdmin, isMod }     from "../utils/perms.js";

// ─────────────────────────────────────────────────────────────────────────────
// ثوابت
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_TIME = 120_000;   // دقيقتان

// ─────────────────────────────────────────────────────────────────────────────
// تعريف الأمر
// ─────────────────────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("📖 دليل الأوامر الكامل");

// ─────────────────────────────────────────────────────────────────────────────
// تنفيذ الأمر
// ─────────────────────────────────────────────────────────────────────────────

export async function execute(interaction) {
  const config    = getConfig(interaction.guildId);
  const userIsAdmin = isAdmin(interaction.member, config);
  const userIsMod   = isMod(interaction.member, config);

  // ─── الـ Embed الرئيسي ────────────────────────────────────────────────────────
  await interaction.reply({
    embeds:    [buildHomeEmbed(interaction, userIsMod, userIsAdmin)],
    components:[buildSelectRow(userIsMod, userIsAdmin)],
    ephemeral: true,
  });

  // ─── Collector ────────────────────────────────────────────────────────────────
  const collector = interaction.channel.createMessageComponentCollector({
    filter: (i) =>
      i.user.id === interaction.user.id &&
      ["help_category", "help_home"].includes(i.customId),
    time: SESSION_TIME,
  });

  collector.on("collect", async (i) => {
    // ─── زر الرجوع للرئيسية ──────────────────────────────────────────────────
    if (i.customId === "help_home") {
      await i.update({
        embeds:    [buildHomeEmbed(interaction, userIsMod, userIsAdmin)],
        components:[buildSelectRow(userIsMod, userIsAdmin)],
      });
      return;
    }

    // ─── اختيار فئة ──────────────────────────────────────────────────────────
    if (i.customId === "help_category") {
      const category = i.values[0];
      const embed    = buildCategoryEmbed(category, interaction);
      const backRow  = buildBackRow();

      await i.update({
        embeds:    [embed],
        components:[backRow],
      });
    }
  });

  collector.on("end", async () => {
    await interaction.editReply({ components: [] }).catch(() => {});
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// الـ Embed الرئيسي
// ─────────────────────────────────────────────────────────────────────────────

function buildHomeEmbed(interaction, isMod, isAdmin) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📖 دليل الأوامر")
    .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
    .setDescription(
      "مرحباً! أنا بوت إدارة نقاط المشرفين.\n" +
      "اختر فئة من القائمة أدناه لرؤية الأوامر المتاحة."
    )
    .addFields(
      {
        name:  "📂 الفئات المتاحة",
        value: [
          "📊 **النقاط** — عرض وإدارة النقاط",
          "🏆 **الصدارة والرتب** — لوحة الصدارة وبطاقة الرتبة",
          isMod   ? "📋 **المهام** — متابعة المهام الموكّلة" : "",
          isMod   ? "⚖️ **الموديريشن** — تنفيذ العقوبات والاستئناف" : "",
          isAdmin ? "⚙️ **الإدارة** — إضافة/خصم/تصفير/ترقية" : "",
          isAdmin ? "🔧 **الإعدادات** — /setup و /task" : "",
        ].filter(Boolean).join("\n"),
      },
      {
        name:  "💡 ملاحظة",
        value: "الأوامر المعروضة تعتمد على صلاحياتك في هذا السيرفر.",
      }
    )
    .setFooter({
      text:    `${interaction.guild.name} • الجلسة تنتهي خلال دقيقتين`,
      iconURL: interaction.guild.iconURL({ dynamic: true }),
    })
    .setTimestamp();

  return embed;
}

// ─────────────────────────────────────────────────────────────────────────────
// القائمة المنسدلة
// ─────────────────────────────────────────────────────────────────────────────

function buildSelectRow(isMod, isAdmin) {
  const options = [
    {
      label:       "📊 النقاط",
      description: "عرض نقاطك أو نقاط مشرف آخر",
      value:       "points",
      emoji:       "📊",
    },
    {
      label:       "🏆 الصدارة والرتب",
      description: "لوحة الصدارة وبطاقة الرتبة",
      value:       "leaderboard",
      emoji:       "🏆",
    },
  ];

  if (isMod) {
    options.push(
      {
        label:       "📋 المهام",
        description: "عرض مهامك وتقدمك فيها",
        value:       "tasks",
        emoji:       "📋",
      },
      {
        label:       "⚖️ الموديريشن",
        description: "العقوبات والمراجعة والاستئناف",
        value:       "moderation",
        emoji:       "⚖️",
      },
    );
  }

  if (isAdmin) {
    options.push(
      {
        label:       "⚙️ الإدارة",
        description: "إضافة/خصم/تصفير/ترقية النقاط",
        value:       "admin",
        emoji:       "⚙️",
      },
      {
        label:       "🔧 الإعدادات",
        description: "إعداد البوت وإدارة المهام",
        value:       "settings",
        emoji:       "🔧",
      },
    );
  }

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("help_category")
      .setPlaceholder("📂 اختر فئة...")
      .addOptions(options)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// زر الرجوع
// ─────────────────────────────────────────────────────────────────────────────

function buildBackRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("help_home")
      .setLabel("🏠 القائمة الرئيسية")
      .setStyle(ButtonStyle.Secondary)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Embeds الفئات
// ─────────────────────────────────────────────────────────────────────────────

function buildCategoryEmbed(category, interaction) {
  switch (category) {
    case "points":      return buildPointsEmbed(interaction);
    case "leaderboard": return buildLeaderboardEmbed(interaction);
    case "tasks":       return buildTasksEmbed(interaction);
    case "moderation":  return buildModerationEmbed(interaction);
    case "admin":       return buildAdminEmbed(interaction);
    case "settings":    return buildSettingsEmbed(interaction);
    default:
      return new EmbedBuilder()
        .setColor(0xed4245)
        .setDescription("❌ فئة غير معروفة.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function buildPointsEmbed(interaction) {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("📊 أوامر النقاط")
    .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
    .addFields(
      {
        name:  "📊 `/points [member]`",
        value: [
          "**الوصف:** عرض نقاط مشرف",
          "**الصلاحية:** مشرف",
          "**الخيارات:**",
          "  • `member` — المشرف المستهدف (اختياري، الافتراضي: أنت)",
          "**يعرض:**",
          "  • الإجمالي مقسّماً لمصادره (يدوي / XP / موديريشن / مهام)",
          "  • Progress bar للمرحلة التالية",
          "  • آخر 5 تغييرات في السجل",
          "  • الرتبة الحالية في السلم",
        ].join("\n"),
      },
    )
    .setFooter({ text: "اضغط 🏠 للعودة للقائمة الرئيسية" })
    .setTimestamp();
}

// ─────────────────────────────────────────────────────────────────────────────

function buildLeaderboardEmbed(interaction) {
  return new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle("🏆 أوامر الصدارة والرتب")
    .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
    .addFields(
      {
        name:  "🏆 `/top`",
        value: [
          "**الوصف:** لوحة الصدارة العامة",
          "**الصلاحية:** مشرف",
          "**الميزات:**",
          "  • 10 مشرفين في كل صفحة",
          "  • أزرار تنقل ⏮ ◀ ▶ ⏭",
          "  • ميداليات 🥇🥈🥉 للمراكز الأولى",
          "  • يُشير لموقعك في القائمة تلقائياً",
        ].join("\n"),
      },
      {
        name:  "🎖 `/rank [member]`",
        value: [
          "**الوصف:** بطاقة رتبة مفصّلة",
          "**الصلاحية:** مشرف",
          "**الخيارات:**",
          "  • `member` — المشرف المستهدف (اختياري، الافتراضي: أنت)",
          "**يعرض:**",
          "  • الرتبة الحالية + النقاط مقسّمة لمصادرها",
          "  • Progress bar نحو المرحلة التالية (15 خانة)",
          "  • السلم الوظيفي الكامل مع علامة ← أنت هنا",
          "  • آخر 5 ترقيات في تاريخ المشرف",
        ].join("\n"),
      },
    )
    .setFooter({ text: "اضغط 🏠 للعودة للقائمة الرئيسية" })
    .setTimestamp();
}

// ─────────────────────────────────────────────────────────────────────────────

function buildTasksEmbed(interaction) {
  return new EmbedBuilder()
    .setColor(0xeb459e)
    .setTitle("📋 أوامر المهام")
    .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
    .addFields(
      {
        name:  "📋 `/mytasks`",
        value: [
          "**الوصف:** عرض مهامك الحالية وتقدمك فيها",
          "**الصلاحية:** مشرف",
          "**يعرض لكل مهمة:**",
          "  • نوع المهمة (رسائل / موديريشن / فويس)",
          "  • التقدم الحالي مع progress bar",
          "  • النقاط عند الإكمال",
          "  • الوقت المتبقي حتى التجديد",
          "**ملاحظة:** المهام تُحدَّث تلقائياً — لا تحتاج أمراً يدوياً",
        ].join("\n"),
      },
      {
        name:  "💡 كيف تعمل المهام؟",
        value: [
          "• **رسائل** → تُحدَّث عند كل رسالة ترسلها",
          "• **موديريشن** → تُحدَّث عند قبول عقوبة بالمراجعة",
          "• **فويس** → تُحدَّث بالدقائق عند مغادرة قناة الصوت",
          "• عند الإكمال → تُضاف النقاط فوراً + إشعار DM",
          "• تتجدد المهمة تلقائياً بعد انتهاء فترتها",
        ].join("\n"),
      },
    )
    .setFooter({ text: "اضغط 🏠 للعودة للقائمة الرئيسية" })
    .setTimestamp();
}

// ─────────────────────────────────────────────────────────────────────────────

function buildModerationEmbed(interaction) {
  return new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle("⚖️ أوامر الموديريشن والاستئناف")
    .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
    .addFields(
      {
        name:  "⚠️ `/warn @member reason`",
        value: [
          "**الوصف:** تحذير عضو",
          "**الصلاحية:** إدارة",
          "**ما يحدث:**",
          "  1. يُرسَل DM للعضو المُحذَّر",
          "  2. تُنشأ بطاقة مراجعة في قناة المراجعة",
          "  3. المراجع يضغط ✅ قبول أو ❌ رفض",
          "  4. عند القبول → تُضاف النقاط للمشرف المنفذ",
          "  5. عند الرفض → يحق للمشرف الاستئناف",
        ].join("\n"),
      },
      {
        name:  "⏰ `/timeout @member duration reason`",
        value: [
          "**الوصف:** توقيف عضو مؤقتاً",
          "**الصلاحية:** إدارة",
          "**الخيارات:**",
          "  • `duration` — المدة بالدقائق (1 — 40320)",
          "**ما يحدث:**",
          "  1. يُطبَّق التوقيف فوراً",
          "  2. يُرسَل DM للعضو الموقوف",
          "  3. تُنشأ بطاقة مراجعة",
          "  4. إذا رُفضت → يُشال التوقيف تلقائياً",
          "**النقاط:** نقاط أساسية + نقاط لكل ساعة",
        ].join("\n"),
      },
      {
        name:  "🔁 `/appeal submit review_id`",
        value: [
          "**الوصف:** تقديم استئناف على عقوبة مرفوضة",
          "**الصلاحية:** مشرف",
          "**القواعد:**",
          "  • مرتان بحد أقصى لكل عقوبة",
          "  • الاستئناف الأول: أي مراجع",
          "  • الاستئناف الثاني (نهائي): رتبة الاستئناف فقط",
          "  • بعد رفض الثاني: القرار نهائي لا رجعة",
        ].join("\n"),
      },
      {
        name:  "📋 `/appeal list`",
        value: [
          "**الوصف:** عرض عقوباتك القابلة للاستئناف",
          "**الصلاحية:** مشرف",
          "**يعرض:** العقوبات المرفوضة + تاريخ استئنافاتك + إحصائيات",
        ].join("\n"),
      },
      {
        name:  "🔍 `/appeal status review_id`",
        value: [
          "**الوصف:** فحص تفاصيل وحالة طلب معين",
          "**الصلاحية:** مشرف (طلبك فقط) أو إدارة (أي طلب)",
        ].join("\n"),
      },
      {
        name:  "📝 `/memberlog @member`",
        value: [
          "**الوصف:** عرض سجل عقوبات عضو",
          "**الصلاحية:** إدارة",
          "**يعرض:** كل العقوبات مع نتائجها والمراجعين",
        ].join("\n"),
      },
    )
    .setFooter({ text: "اضغط 🏠 للعودة للقائمة الرئيسية" })
    .setTimestamp();
}

// ─────────────────────────────────────────────────────────────────────────────

function buildAdminEmbed(interaction) {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("⚙️ أوامر الإدارة")
    .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
    .addFields(
      {
        name:  "➕ `/add [reason]`",
        value: [
          "**الوصف:** إضافة نقاط لمشرف أو أكثر",
          "**الصلاحية:** إدارة",
          "**التدفق:**",
          "  1. اختيار المشرفين (UserSelect — حتى 10)",
          "  2. كتابة عدد النقاط (Modal)",
          "  3. Embed تأكيد قبل التطبيق",
          "**حماية:** Cooldown بين الاستخدامات + لا يضيف لنفسه",
        ].join("\n"),
      },
      {
        name:  "➖ `/remove [reason]`",
        value: [
          "**الوصف:** خصم نقاط من مشرف أو أكثر",
          "**الصلاحية:** إدارة",
          "**ملاحظة:** النقاط لا تنزل تحت الصفر أبداً",
          "**التدفق:** نفس /add مع تأكيد مزدوج",
        ].join("\n"),
      },
      {
        name:  "🔁 `/reset [member]`",
        value: [
          "**الوصف:** تصفير نقاط مشرف أو الكل",
          "**الصلاحية:** إدارة",
          "**الخيارات:**",
          "  • `member` — مشرف محدد (اختياري)",
          "  • بدون member → تصفير الكل (تأكيد مزدوج للأمان)",
        ].join("\n"),
      },
      {
        name:  "⬆️ `/promote up @member reason`",
        value: [
          "**الوصف:** ترقية يدوية للمشرف للمرحلة التالية",
          "**الصلاحية:** إدارة",
          "**ما يحدث:** يُعدّل الرتبة + يُعلن + يُرسل DM + يُسجّل",
        ].join("\n"),
      },
      {
        name:  "⬇️ `/promote down @member reason`",
        value: [
          "**الوصف:** تخفيض يدوي للمشرف للمرحلة السابقة",
          "**الصلاحية:** إدارة",
          "**ملاحظة:** التخفيض التلقائي غير موجود — يدوي فقط",
        ].join("\n"),
      },
      {
        name:  "📊 `/promote info`",
        value: [
          "**الوصف:** عرض السلم الوظيفي مع إحصائيات",
          "**الصلاحية:** الجميع",
          "**يعرض:** كل المراحل + عدد المشرفين في كل مرحلة + mini bar",
        ].join("\n"),
      },
    )
    .setFooter({ text: "اضغط 🏠 للعودة للقائمة الرئيسية" })
    .setTimestamp();
}

// ─────────────────────────────────────────────────────────────────────────────

function buildSettingsEmbed(interaction) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🔧 أوامر الإعدادات")
    .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
    .addFields(
      {
        name:  "📌 `/setup`",
        value: [
          "**الوصف:** لوحة الإعدادات الكاملة للبوت",
          "**الصلاحية:** إدارة",
          "**الأقسام:**",
          "  👥 **الرتب** — رتب المشرفين / الإدارة / الاستئناف",
          "  📋 **قناة المراجعة** — تحديد قناة بطاقات المراجعة",
          "  📢 **قنوات السجل** — سجل النقاط / الموديريشن / الترقيات",
          "  💬 **إعدادات XP** — min / max / cooldown / daily limit",
          "  ⚖️ **نقاط الموديريشن** — نقاط التحذير والتوقيف",
          "  🏆 **المراحل** — ربط نقاط بالرتب (صيغة: نقاط,roleId)",
          "  🛡 **حدود الإساءة** — أقصى إضافة / خصم / cooldown",
        ].join("\n"),
      },
      {
        name:  "⚙️ `/task setup`",
        value: [
          "**الوصف:** ربط مهمة جديدة برتبة",
          "**الصلاحية:** إدارة",
          "**الخطوات:**",
          "  1. اختيار الرتبة (RoleSelect)",
          "  2. اختيار نوع المهمة (رسائل / موديريشن / فويس)",
          "  3. كتابة الهدف والنقاط وفترة التجديد (Modal)",
          "**أنواع الفترات:** `daily` / `2days` / `weekly`",
        ].join("\n"),
      },
      {
        name:  "📋 `/task list`",
        value: [
          "**الوصف:** عرض كل المهام المُعدَّة",
          "**الصلاحية:** إدارة",
          "**يعرض:** كل رتبة مع نوع مهمتها وهدفها ونقاطها وفترتها",
        ].join("\n"),
      },
      {
        name:  "🗑 `/task remove`",
        value: [
          "**الوصف:** حذف مهمة رتبة",
          "**الصلاحية:** إدارة",
          "**تحذير:** يُحذف تقدم كل المشرفين في هذه المهمة",
        ].join("\n"),
      },
      {
        name:  "💡 نصائح الإعداد الأولي",
        value: [
          "**الترتيب المقترح لإعداد البوت من الصفر:**",
          "1️⃣ `/setup` → 👥 الرتب أولاً",
          "2️⃣ `/setup` → 📋 قناة المراجعة",
          "3️⃣ `/setup` → 📢 قنوات السجل",
          "4️⃣ `/setup` → 🏆 المراحل",
          "5️⃣ `/setup` → 💬 XP و ⚖️ الموديريشن",
          "6️⃣ `/task setup` لكل رتبة تريد إعطاءها مهمة",
        ].join("\n"),
      },
    )
    .setFooter({ text: "اضغط 🏠 للعودة للقائمة الرئيسية" })
    .setTimestamp();
}
