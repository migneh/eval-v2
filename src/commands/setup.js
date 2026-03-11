// src/commands/setup.js
// ─────────────────────────────────────────────────────────────────────────────
// أمر /setup — لوحة الإعدادات الكاملة
//
// الأقسام:
//   📌 القسم 1: الرتب (مشرفين / إدارة / استئناف)
//   📌 القسم 2: قناة المراجعة
//   📌 القسم 3: إعدادات XP
//   📌 القسم 4: إعدادات نقاط الموديريشن
//   📌 القسم 5: المراحل والمكافآت
//   📌 القسم 6: قنوات السجل
//   📌 القسم 7: حدود مكافحة الإساءة
//
// التدفق:
//   - embed رئيسي مع أزرار لكل قسم
//   - كل زر يفتح modal أو select menu
//   - embed يُحدَّث بعد كل تغيير
//   - يسجل التغييرات في السجل
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ComponentType,
} from "discord.js";

import { getConfig, saveConfig }              from "../utils/db.js";
import { requireAdmin }                        from "../utils/perms.js";
import { log, makeLogEmbed, LogType }          from "../utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// تعريف الأمر
// ─────────────────────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("📌 لوحة إعدادات البوت الكاملة");

// ─────────────────────────────────────────────────────────────────────────────
// تنفيذ الأمر
// ─────────────────────────────────────────────────────────────────────────────

export async function execute(interaction) {
  const config = getConfig(interaction.guildId);

  if (!requireAdmin(interaction, config)) return;

  await interaction.deferReply({ ephemeral: true });

  // ─── الـ Embed الرئيسي ────────────────────────────────────────────────────────
  await interaction.editReply({
    embeds:     [buildMainEmbed(config, interaction.guild)],
    components: buildMainRows(),
  });

  // ─── Collector رئيسي ─────────────────────────────────────────────────────────
  const collector = interaction.channel.createMessageComponentCollector({
    filter: (i) =>
      i.user.id === interaction.user.id &&
      i.customId.startsWith("setup_"),
    time: 300_000,   // 5 دقائق
  });

  collector.on("collect", async (i) => {
    // تجديد الـ config في كل تفاعل
    const cfg = getConfig(interaction.guildId);

    switch (i.customId) {
      case "setup_roles":       await handleRoles(i, cfg, interaction);       break;
      case "setup_review_ch":   await handleReviewChannel(i, cfg, interaction); break;
      case "setup_xp":          await handleXp(i, cfg, interaction);          break;
      case "setup_modpoints":   await handleModPoints(i, cfg, interaction);   break;
      case "setup_milestones":  await handleMilestones(i, cfg, interaction);  break;
      case "setup_logchannels": await handleLogChannels(i, cfg, interaction); break;
      case "setup_limits":      await handleLimits(i, cfg, interaction);      break;
      case "setup_refresh":     await handleRefresh(i, cfg, interaction);     break;
    }
  });

  collector.on("end", async () => {
    await interaction.editReply({ components: [] }).catch(() => {});
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// بناء الـ Embed الرئيسي
// ─────────────────────────────────────────────────────────────────────────────

function buildMainEmbed(config, guild) {
  const check  = (val) => (val ? "✅" : "❌");
  const rolesOk = config.modRoles?.length && config.adminRoles?.length;

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📌 لوحة الإعدادات")
    .setThumbnail(guild.iconURL({ dynamic: true }))
    .addFields(
      // ── الرتب ──
      {
        name: "👥 الرتب",
        value: [
          `مشرفون: ${config.modRoles?.length ? config.modRoles.map((r) => `<@&${r}>`).join(" ") : "❌ غير مُعدَّة"}`,
          `إدارة: ${config.adminRoles?.length ? config.adminRoles.map((r) => `<@&${r}>`).join(" ") : "❌ غير مُعدَّة"}`,
          `استئناف: ${config.appealRole ? `<@&${config.appealRole}>` : "❌ غير مُعدَّة"}`,
        ].join("\n"),
        inline: false,
      },
      // ── قنوات ──
      {
        name: "📢 القنوات",
        value: [
          `مراجعة: ${config.reviewChannel ? `<#${config.reviewChannel}>` : "❌"}`,
          `إعلانات ترقية: ${config.promotionAnnouncementChannel ? `<#${config.promotionAnnouncementChannel}>` : "❌"}`,
          `سجل النقاط: ${config.logChannels?.points ? `<#${config.logChannels.points}>` : "❌"}`,
          `سجل الموديريشن: ${config.logChannels?.moderation ? `<#${config.logChannels.moderation}>` : "❌"}`,
          `سجل الترقيات: ${config.logChannels?.promotions ? `<#${config.logChannels.promotions}>` : "❌"}`,
          `سجل كامل: ${config.logChannels?.all ? `<#${config.logChannels.all}>` : "❌"}`,
        ].join("\n"),
        inline: false,
      },
      // ── XP ──
      {
        name: "💬 إعدادات XP",
        value: [
          `الحد الأدنى: **${config.xp?.minXp ?? 5}**`,
          `الحد الأقصى: **${config.xp?.maxXp ?? 35}**`,
          `Cooldown: **${config.xp?.cooldown ?? 60}** ثانية`,
          `الحد اليومي: **${config.xp?.dailyLimit ?? 500}** نقطة`,
        ].join("  |  "),
        inline: false,
      },
      // ── نقاط الموديريشن ──
      {
        name: "⚖️ نقاط الموديريشن",
        value: [
          `تحذير: **${config.modPoints?.warn ?? 10}** نقطة`,
          `تايم أوت (أساسي): **${config.modPoints?.timeoutBase ?? 5}** نقطة`,
          `تايم أوت (للساعة): **${config.modPoints?.timeoutPerHour ?? 3}** نقطة`,
        ].join("  |  "),
        inline: false,
      },
      // ── المراحل ──
      {
        name: "🏆 المراحل",
        value: config.milestones?.length
          ? config.milestones
              .sort((a, b) => a.points - b.points)
              .map((m) => `<@&${m.roleId}> ← ${m.points.toLocaleString()} نقطة`)
              .join("\n")
          : "❌ لا توجد مراحل مُعدَّة",
        inline: false,
      },
      // ── الحدود ──
      {
        name: "🛡 حدود مكافحة الإساءة",
        value: [
          `أقصى إضافة: **${config.limits?.maxAdd ?? 500}**`,
          `أقصى خصم: **${config.limits?.maxRemove ?? 500}**`,
          `Cooldown الأوامر: **${config.limits?.abuseCooldown ?? 30}** ثانية`,
          `أقصى مشرفين في عملية: **${config.limits?.maxMembers ?? 10}**`,
        ].join("  |  "),
        inline: false,
      },
    )
    .setFooter({ text: "اضغط على الأزرار أدناه لتعديل كل قسم • تنتهي الجلسة خلال 5 دقائق" })
    .setTimestamp();
}

// ─────────────────────────────────────────────────────────────────────────────
// بناء أزرار اللوحة الرئيسية
// ─────────────────────────────────────────────────────────────────────────────

function buildMainRows() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("setup_roles")
      .setLabel("👥 الرتب")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("setup_review_ch")
      .setLabel("📋 قناة المراجعة")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("setup_logchannels")
      .setLabel("📢 قنوات السجل")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("setup_milestones")
      .setLabel("🏆 المراحل")
      .setStyle(ButtonStyle.Primary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("setup_xp")
      .setLabel("💬 إعدادات XP")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("setup_modpoints")
      .setLabel("⚖️ نقاط الموديريشن")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("setup_limits")
      .setLabel("🛡 حدود الإساءة")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("setup_refresh")
      .setLabel("🔄 تحديث")
      .setStyle(ButtonStyle.Success),
  );

  return [row1, row2];
}

// ─────────────────────────────────────────────────────────────────────────────
// معالجات الأقسام
// ─────────────────────────────────────────────────────────────────────────────

// ── القسم 1: الرتب ───────────────────────────────────────────────────────────

async function handleRoles(i, config, interaction) {

  // ─── اختيار رتب المشرفين ──────────────────────────────────────────────────────
  const modRoleRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("setup_mod_roles")
      .setPlaceholder("اختر رتب المشرفين (يمكن أكثر من رتبة)")
      .setMinValues(1)
      .setMaxValues(10)
  );

  await i.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("👥 إعداد الرتب — رتب المشرفين")
        .setDescription(
          "اختر الرتب التي تعتبرها **مشرفين**.\n" +
          "هؤلاء يكسبون XP ويمكنهم استخدام `/points` و`/mytasks`."
        )
        .addFields({
          name:  "الرتب الحالية",
          value: config.modRoles?.length
            ? config.modRoles.map((r) => `<@&${r}>`).join(" ")
            : "غير مُعدَّة",
        })
        .setFooter({ text: "الخطوة 1 من 3 — رتب المشرفين" })
    ],
    components: [modRoleRow],
  });

  let modRoleInteraction;
  try {
    modRoleInteraction = await interaction.channel.awaitMessageComponent({
      filter:        (c) => c.user.id === interaction.user.id && c.customId === "setup_mod_roles",
      componentType: ComponentType.RoleSelect,
      time:          60_000,
    });
  } catch {
    return refreshMain(interaction, config);
  }

  config.modRoles = modRoleInteraction.values;

  // ─── اختيار رتب الإدارة ───────────────────────────────────────────────────────
  const adminRoleRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("setup_admin_roles")
      .setPlaceholder("اختر رتب الإدارة (يمكن أكثر من رتبة)")
      .setMinValues(1)
      .setMaxValues(10)
  );

  await modRoleInteraction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("👥 إعداد الرتب — رتب الإدارة")
        .setDescription(
          "اختر الرتب التي تعتبرها **إدارة**.\n" +
          "هؤلاء يمكنهم استخدام `/add` و`/remove` و`/reset` و`/promote`."
        )
        .addFields({
          name:  "الرتب الحالية",
          value: config.adminRoles?.length
            ? config.adminRoles.map((r) => `<@&${r}>`).join(" ")
            : "غير مُعدَّة",
        })
        .setFooter({ text: "الخطوة 2 من 3 — رتب الإدارة" })
    ],
    components: [adminRoleRow],
  });

  let adminRoleInteraction;
  try {
    adminRoleInteraction = await interaction.channel.awaitMessageComponent({
      filter:        (c) => c.user.id === interaction.user.id && c.customId === "setup_admin_roles",
      componentType: ComponentType.RoleSelect,
      time:          60_000,
    });
  } catch {
    saveConfig(interaction.guildId, config);
    return refreshMain(interaction, config);
  }

  config.adminRoles = adminRoleInteraction.values;

  // ─── اختيار رتبة الاستئناف ────────────────────────────────────────────────────
  const appealRoleRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("setup_appeal_role")
      .setPlaceholder("اختر رتبة الاستئناف (رتبة واحدة)")
      .setMinValues(1)
      .setMaxValues(1)
  );

  await adminRoleInteraction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("👥 إعداد الرتب — رتبة الاستئناف")
        .setDescription(
          "اختر الرتبة التي تتولى مراجعة **الاستئنافات النهائية**.\n" +
          "سيتم ping هذه الرتبة عند تقديم استئناف ثانٍ."
        )
        .addFields({
          name:  "الرتبة الحالية",
          value: config.appealRole ? `<@&${config.appealRole}>` : "غير مُعدَّة",
        })
        .setFooter({ text: "الخطوة 3 من 3 — رتبة الاستئناف" })
    ],
    components: [appealRoleRow],
  });

  let appealRoleInteraction;
  try {
    appealRoleInteraction = await interaction.channel.awaitMessageComponent({
      filter:        (c) => c.user.id === interaction.user.id && c.customId === "setup_appeal_role",
      componentType: ComponentType.RoleSelect,
      time:          60_000,
    });
  } catch {
    saveConfig(interaction.guildId, config);
    return refreshMain(interaction, config);
  }

  config.appealRole = appealRoleInteraction.values[0];

  saveConfig(interaction.guildId, config);
  await logChange(interaction, "👥 الرتب", "تم تحديث رتب المشرفين / الإدارة / الاستئناف");

  await appealRoleInteraction.update({
    embeds:     [buildMainEmbed(getConfig(interaction.guildId), interaction.guild)],
    components: buildMainRows(),
  });
}

// ── القسم 2: قناة المراجعة ───────────────────────────────────────────────────

async function handleReviewChannel(i, config, interaction) {
  const chRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("setup_review_channel_select")
      .setPlaceholder("اختر قناة المراجعة")
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1)
  );

  await i.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📋 إعداد قناة المراجعة")
        .setDescription(
          "اختر القناة التي ستُرسَل إليها بطاقات المراجعة.\n\n" +
          "**تأكد أن البوت يملك صلاحية الكتابة في هذه القناة.**"
        )
        .addFields({
          name:  "القناة الحالية",
          value: config.reviewChannel ? `<#${config.reviewChannel}>` : "غير مُعدَّة",
        })
    ],
    components: [chRow],
  });

  let chInteraction;
  try {
    chInteraction = await interaction.channel.awaitMessageComponent({
      filter:        (c) => c.user.id === interaction.user.id && c.customId === "setup_review_channel_select",
      componentType: ComponentType.ChannelSelect,
      time:          60_000,
    });
  } catch {
    return refreshMain(interaction, config);
  }

  config.reviewChannel = chInteraction.values[0];
  saveConfig(interaction.guildId, config);
  await logChange(interaction, "📋 قناة المراجعة", `تم تعيينها لـ <#${config.reviewChannel}>`);

  await chInteraction.update({
    embeds:     [buildMainEmbed(getConfig(interaction.guildId), interaction.guild)],
    components: buildMainRows(),
  });
}

// ── القسم 3: إعدادات XP ─────────────────────────────────────────────────────

async function handleXp(i, config, interaction) {
  const modal = new ModalBuilder()
    .setCustomId("setup_xp_modal")
    .setTitle("💬 إعدادات XP")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("xp_min")
          .setLabel("الحد الأدنى للـ XP في الرسالة الواحدة")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(config.xp?.minXp ?? 5))
          .setPlaceholder("مثال: 5")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("xp_max")
          .setLabel("الحد الأقصى للـ XP في الرسالة الواحدة")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(config.xp?.maxXp ?? 35))
          .setPlaceholder("مثال: 35")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("xp_cooldown")
          .setLabel("الـ Cooldown بين رسائل XP (بالثواني)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(config.xp?.cooldown ?? 60))
          .setPlaceholder("مثال: 60")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("xp_daily")
          .setLabel("الحد الأقصى اليومي للـ XP")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(config.xp?.dailyLimit ?? 500))
          .setPlaceholder("مثال: 500")
      ),
    );

  await i.showModal(modal);

  let modalSubmit;
  try {
    modalSubmit = await i.awaitModalSubmit({
      filter: (m) => m.user.id === interaction.user.id && m.customId === "setup_xp_modal",
      time:   120_000,
    });
  } catch {
    return refreshMain(interaction, config);
  }

  const minXp     = parseInt(modalSubmit.fields.getTextInputValue("xp_min"))     || 5;
  const maxXp     = parseInt(modalSubmit.fields.getTextInputValue("xp_max"))     || 35;
  const cooldown  = parseInt(modalSubmit.fields.getTextInputValue("xp_cooldown"))|| 60;
  const dailyLimit = parseInt(modalSubmit.fields.getTextInputValue("xp_daily"))  || 500;

  config.xp = { minXp, maxXp, cooldown, dailyLimit };
  saveConfig(interaction.guildId, config);
  await logChange(interaction, "💬 إعدادات XP", `min:${minXp} max:${maxXp} cooldown:${cooldown}s daily:${dailyLimit}`);

  await modalSubmit.deferUpdate();
  await interaction.editReply({
    embeds:     [buildMainEmbed(getConfig(interaction.guildId), interaction.guild)],
    components: buildMainRows(),
  });
}

// ── القسم 4: نقاط الموديريشن ─────────────────────────────────────────────────

async function handleModPoints(i, config, interaction) {
  const modal = new ModalBuilder()
    .setCustomId("setup_modpoints_modal")
    .setTitle("⚖️ نقاط الموديريشن")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("mp_warn")
          .setLabel("نقاط التحذير الواحد")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(config.modPoints?.warn ?? 10))
          .setPlaceholder("مثال: 10")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("mp_timeout_base")
          .setLabel("نقاط التوقيف الأساسية (بغض النظر عن المدة)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(config.modPoints?.timeoutBase ?? 5))
          .setPlaceholder("مثال: 5")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("mp_timeout_hour")
          .setLabel("نقاط إضافية لكل ساعة توقيف")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(config.modPoints?.timeoutPerHour ?? 3))
          .setPlaceholder("مثال: 3")
      ),
    );

  await i.showModal(modal);

  let modalSubmit;
  try {
    modalSubmit = await i.awaitModalSubmit({
      filter: (m) => m.user.id === interaction.user.id && m.customId === "setup_modpoints_modal",
      time:   120_000,
    });
  } catch {
    return refreshMain(interaction, config);
  }

  const warn            = parseInt(modalSubmit.fields.getTextInputValue("mp_warn"))         || 10;
  const timeoutBase     = parseInt(modalSubmit.fields.getTextInputValue("mp_timeout_base")) || 5;
  const timeoutPerHour  = parseInt(modalSubmit.fields.getTextInputValue("mp_timeout_hour")) || 3;

  config.modPoints = { warn, timeoutBase, timeoutPerHour };
  saveConfig(interaction.guildId, config);
  await logChange(interaction, "⚖️ نقاط الموديريشن", `warn:${warn} base:${timeoutBase} perHour:${timeoutPerHour}`);

  await modalSubmit.deferUpdate();
  await interaction.editReply({
    embeds:     [buildMainEmbed(getConfig(interaction.guildId), interaction.guild)],
    components: buildMainRows(),
  });
}

// ── القسم 5: المراحل ─────────────────────────────────────────────────────────

async function handleMilestones(i, config, interaction) {
  const modal = new ModalBuilder()
    .setCustomId("setup_milestones_modal")
    .setTitle("🏆 إعداد المراحل")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("milestones_data")
          .setLabel("المراحل بالصيغة: نقاط,roleId (سطر لكل مرحلة)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder(
            "مثال:\n" +
            "500,1234567890123456789\n" +
            "1000,9876543210987654321\n" +
            "2000,1111111111111111111"
          )
          .setValue(
            config.milestones?.length
              ? config.milestones
                  .sort((a, b) => a.points - b.points)
                  .map((m) => `${m.points},${m.roleId}`)
                  .join("\n")
              : ""
          )
          .setMaxLength(2000)
      ),
    );

  await i.showModal(modal);

  let modalSubmit;
  try {
    modalSubmit = await i.awaitModalSubmit({
      filter: (m) => m.user.id === interaction.user.id && m.customId === "setup_milestones_modal",
      time:   120_000,
    });
  } catch {
    return refreshMain(interaction, config);
  }

  const raw   = modalSubmit.fields.getTextInputValue("milestones_data").trim();
  const lines = raw.split("\n").filter((l) => l.trim());

  const milestones = [];
  const errors     = [];

  for (const line of lines) {
    const [rawPoints, rawRoleId] = line.split(",").map((s) => s.trim());
    const points = parseInt(rawPoints);

    if (isNaN(points) || points <= 0) {
      errors.push(`سطر غير صالح: "${line}" — النقاط يجب أن تكون رقماً موجباً`);
      continue;
    }
    if (!rawRoleId || rawRoleId.length < 17) {
      errors.push(`سطر غير صالح: "${line}" — معرف الرتبة غير صحيح`);
      continue;
    }

    milestones.push({ points, roleId: rawRoleId });
  }

  if (errors.length) {
    await modalSubmit.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xfee75c)
          .setTitle("⚠️ بعض السطور بها أخطاء")
          .setDescription(errors.join("\n"))
          .addFields({
            name:  "المراحل المقبولة",
            value: milestones.length
              ? milestones.map((m) => `${m.points} نقطة ← <@&${m.roleId}>`).join("\n")
              : "لا توجد مراحل مقبولة",
          })
          .setTimestamp(),
      ],
      ephemeral: true,
    });

    if (!milestones.length) return;
  } else {
    await modalSubmit.deferUpdate();
  }

  config.milestones = milestones;
  saveConfig(interaction.guildId, config);
  await logChange(interaction, "🏆 المراحل", `تم تعيين ${milestones.length} مرحلة`);

  await interaction.editReply({
    embeds:     [buildMainEmbed(getConfig(interaction.guildId), interaction.guild)],
    components: buildMainRows(),
  });
}

// ── القسم 6: قنوات السجل ─────────────────────────────────────────────────────

async function handleLogChannels(i, config, interaction) {
  // نجمع القنوات عبر modal لأن ChannelSelect لا يدعم 6 قنوات دفعة واحدة
  // الحل: نطلب IDs مباشرة في modal

  const modal = new ModalBuilder()
    .setCustomId("setup_logch_modal")
    .setTitle("📢 قنوات السجل")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("log_all")
          .setLabel("سجل كامل (كل الأحداث) — channel ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(config.logChannels?.all || "")
          .setPlaceholder("1234567890123456789")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("log_points")
          .setLabel("سجل النقاط — channel ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(config.logChannels?.points || "")
          .setPlaceholder("1234567890123456789")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("log_moderation")
          .setLabel("سجل الموديريشن — channel ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(config.logChannels?.moderation || "")
          .setPlaceholder("1234567890123456789")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("log_promotions")
          .setLabel("سجل الترقيات — channel ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(config.logChannels?.promotions || "")
          .setPlaceholder("1234567890123456789")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("log_reviews")
          .setLabel("سجل المراجعات + قناة إعلانات الترقية — channel ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(config.logChannels?.reviews || config.promotionAnnouncementChannel || "")
          .setPlaceholder("1234567890123456789")
      ),
    );

  await i.showModal(modal);

  let modalSubmit;
  try {
    modalSubmit = await i.awaitModalSubmit({
      filter: (m) => m.user.id === interaction.user.id && m.customId === "setup_logch_modal",
      time:   120_000,
    });
  } catch {
    return refreshMain(interaction, config);
  }

  // دالة للتحقق من صحة الـ ID (أو إفراغه)
  const parseId = (raw) => {
    const val = raw.trim();
    return val.length >= 17 ? val : null;
  };

  const all        = parseId(modalSubmit.fields.getTextInputValue("log_all"));
  const points     = parseId(modalSubmit.fields.getTextInputValue("log_points"));
  const moderation = parseId(modalSubmit.fields.getTextInputValue("log_moderation"));
  const promotions = parseId(modalSubmit.fields.getTextInputValue("log_promotions"));
  const reviews    = parseId(modalSubmit.fields.getTextInputValue("log_reviews"));

  config.logChannels = { all, points, moderation, promotions, reviews };

  // قناة إعلانات الترقية = قناة المراجعات (اختياري — يمكن تعديله)
  if (reviews) config.promotionAnnouncementChannel = reviews;

  saveConfig(interaction.guildId, config);
  await logChange(interaction, "📢 قنوات السجل", "تم تحديث قنوات السجل");

  await modalSubmit.deferUpdate();
  await interaction.editReply({
    embeds:     [buildMainEmbed(getConfig(interaction.guildId), interaction.guild)],
    components: buildMainRows(),
  });
}

// ── القسم 7: حدود مكافحة الإساءة ─────────────────────────────────────────────

async function handleLimits(i, config, interaction) {
  const modal = new ModalBuilder()
    .setCustomId("setup_limits_modal")
    .setTitle("🛡 حدود مكافحة الإساءة")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("limit_maxadd")
          .setLabel("أقصى نقاط يمكن إضافتها في عملية واحدة")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(config.limits?.maxAdd ?? 500))
          .setPlaceholder("مثال: 500")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("limit_maxremove")
          .setLabel("أقصى نقاط يمكن خصمها في عملية واحدة")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(config.limits?.maxRemove ?? 500))
          .setPlaceholder("مثال: 500")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("limit_cooldown")
          .setLabel("Cooldown بين عمليات add/remove (بالثواني)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(config.limits?.abuseCooldown ?? 30))
          .setPlaceholder("مثال: 30")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("limit_maxmembers")
          .setLabel("أقصى عدد مشرفين في عملية add/remove واحدة")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(config.limits?.maxMembers ?? 10))
          .setPlaceholder("مثال: 10")
      ),
    );

  await i.showModal(modal);

  let modalSubmit;
  try {
    modalSubmit = await i.awaitModalSubmit({
      filter: (m) => m.user.id === interaction.user.id && m.customId === "setup_limits_modal",
      time:   120_000,
    });
  } catch {
    return refreshMain(interaction, config);
  }

  const maxAdd       = parseInt(modalSubmit.fields.getTextInputValue("limit_maxadd"))     || 500;
  const maxRemove    = parseInt(modalSubmit.fields.getTextInputValue("limit_maxremove"))  || 500;
  const abuseCooldown = parseInt(modalSubmit.fields.getTextInputValue("limit_cooldown")) || 30;
  const maxMembers   = parseInt(modalSubmit.fields.getTextInputValue("limit_maxmembers"))|| 10;

  config.limits = { maxAdd, maxRemove, abuseCooldown, maxMembers };
  saveConfig(interaction.guildId, config);
  await logChange(interaction, "🛡 حدود الإساءة", `maxAdd:${maxAdd} maxRemove:${maxRemove} cooldown:${abuseCooldown}s members:${maxMembers}`);

  await modalSubmit.deferUpdate();
  await interaction.editReply({
    embeds:     [buildMainEmbed(getConfig(interaction.guildId), interaction.guild)],
    components: buildMainRows(),
  });
}

// ── تحديث ────────────────────────────────────────────────────────────────────

async function handleRefresh(i, config, interaction) {
  await i.update({
    embeds:     [buildMainEmbed(getConfig(interaction.guildId), interaction.guild)],
    components: buildMainRows(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال مساعدة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُعيد عرض اللوحة الرئيسية
 */
async function refreshMain(interaction, config) {
  await interaction.editReply({
    embeds:     [buildMainEmbed(getConfig(interaction.guildId), interaction.guild)],
    components: buildMainRows(),
  }).catch(() => {});
}

/**
 * يُسجّل تغيير الإعدادات في قناة السجل
 */
async function logChange(interaction, section, details) {
  await log(
    interaction.guild,
    LogType.CONFIG_CHANGED,
    makeLogEmbed(LogType.CONFIG_CHANGED, `⚙️ تغيير الإعدادات — ${section}`, [
      { name: "المنفذ",   value: `<@${interaction.user.id}>`, inline: true },
      { name: "القسم",   value: section,                      inline: true },
      { name: "التفاصيل", value: details },
    ])
  );
}
