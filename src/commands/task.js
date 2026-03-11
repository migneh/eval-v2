// src/commands/task.js
// ─────────────────────────────────────────────────────────────────────────────
// أمر /task — إدارة المهام
//
// الأوامر الفرعية:
//   /task setup  → ربط مهمة برتبة معينة
//   /task list   → عرض كل المهام المُعدَّة
//   /task remove → حذف مهمة رتبة
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ComponentType,
} from "discord.js";

import {
  getConfig,
  getTaskConfig,
  saveTaskConfig,
} from "../utils/db.js";

import { requireAdmin }                                from "../utils/perms.js";
import { getTypeLabel, getPeriodLabel, buildProgressBar } from "../systems/tasks.js";

// ─────────────────────────────────────────────────────────────────────────────
// تعريف الأمر
// ─────────────────────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName("task")
  .setDescription("📋 إدارة مهام المشرفين")
  .addSubcommand((sub) =>
    sub
      .setName("setup")
      .setDescription("⚙️ ربط مهمة جديدة برتبة")
  )
  .addSubcommand((sub) =>
    sub
      .setName("list")
      .setDescription("📋 عرض كل المهام المُعدَّة")
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("🗑 حذف مهمة رتبة")
  );

// ─────────────────────────────────────────────────────────────────────────────
// تنفيذ الأمر
// ─────────────────────────────────────────────────────────────────────────────

export async function execute(interaction) {
  const config = getConfig(interaction.guildId);

  if (!requireAdmin(interaction, config)) return;

  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case "setup":  return handleSetup(interaction);
    case "list":   return handleList(interaction);
    case "remove": return handleRemove(interaction);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// /task setup
// ─────────────────────────────────────────────────────────────────────────────

async function handleSetup(interaction) {

  // ─── الخطوة 1: اختيار الرتبة ──────────────────────────────────────────────────
  const roleSelectRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("task_setup_role")
      .setPlaceholder("اختر الرتبة المرتبطة بهذه المهمة")
      .setMinValues(1)
      .setMaxValues(1)
  );

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("⚙️ إعداد مهمة — الخطوة 1 من 3")
        .setDescription("اختر الرتبة التي ستُربط بها المهمة.\n\nكل مشرف يملك هذه الرتبة سيُكلَّف بالمهمة.")
        .setFooter({ text: "الجلسة تنتهي خلال 60 ثانية" })
        .setTimestamp(),
    ],
    components: [roleSelectRow],
    ephemeral:  true,
  });

  // ─── Collector: اختيار الرتبة ─────────────────────────────────────────────────
  let roleInteraction;
  try {
    roleInteraction = await interaction.channel.awaitMessageComponent({
      filter:        (i) => i.user.id === interaction.user.id && i.customId === "task_setup_role",
      componentType: ComponentType.RoleSelect,
      time:          60_000,
    });
  } catch {
    return interaction.editReply({ embeds: [timeoutEmbed()], components: [] });
  }

  const selectedRoleId = roleInteraction.values[0];
  const selectedRole   = interaction.guild.roles.cache.get(selectedRoleId);

  // ─── الخطوة 2: اختيار النوع والفترة ──────────────────────────────────────────
  const typeRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("task_setup_type")
      .setPlaceholder("اختر نوع المهمة")
      .addOptions([
        {
          label:       "💬 رسائل",
          description: "عدد الرسائل المُرسَلة في الخادم",
          value:       "messages",
          emoji:       "💬",
        },
        {
          label:       "⚖️ موديريشن",
          description: "عدد العقوبات المقبولة (warn / timeout)",
          value:       "moderation",
          emoji:       "⚖️",
        },
        {
          label:       "🎙 فويس",
          description: "عدد الدقائق في قنوات الصوت",
          value:       "voice",
          emoji:       "🎙",
        },
      ])
  );

  await roleInteraction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("⚙️ إعداد مهمة — الخطوة 2 من 3")
        .setDescription(`الرتبة المختارة: <@&${selectedRoleId}>\n\nاختر نوع المهمة:`)
        .addFields(
          { name: "💬 رسائل",     value: "عدد الرسائل المُرسَلة",          inline: true },
          { name: "⚖️ موديريشن",  value: "عدد العقوبات المقبولة",           inline: true },
          { name: "🎙 فويس",      value: "دقائق في قنوات الصوت",            inline: true },
        )
        .setFooter({ text: "الجلسة تنتهي خلال 60 ثانية" })
        .setTimestamp(),
    ],
    components: [typeRow],
  });

  // ─── Collector: نوع المهمة ────────────────────────────────────────────────────
  let typeInteraction;
  try {
    typeInteraction = await interaction.channel.awaitMessageComponent({
      filter:        (i) => i.user.id === interaction.user.id && i.customId === "task_setup_type",
      componentType: ComponentType.StringSelect,
      time:          60_000,
    });
  } catch {
    return interaction.editReply({ embeds: [timeoutEmbed()], components: [] });
  }

  const selectedType = typeInteraction.values[0];

  // ─── الخطوة 3: Modal (هدف + نقاط + فترة) ─────────────────────────────────────
  const modal = new ModalBuilder()
    .setCustomId("task_setup_modal")
    .setTitle("⚙️ إعداد المهمة — الخطوة 3 من 3")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("task_goal")
          .setLabel(getGoalLabel(selectedType))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(6)
          .setPlaceholder(getGoalPlaceholder(selectedType))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("task_points")
          .setLabel("النقاط المكتسبة عند الإكمال")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(5)
          .setPlaceholder("مثال: 100")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("task_period")
          .setLabel("فترة التجديد (daily / 2days / weekly)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(5)
          .setMaxLength(6)
          .setPlaceholder("daily  أو  2days  أو  weekly")
      ),
    );

  await typeInteraction.showModal(modal);

  // ─── Await Modal Submit ───────────────────────────────────────────────────────
  let modalSubmit;
  try {
    modalSubmit = await typeInteraction.awaitModalSubmit({
      filter: (i) => i.user.id === interaction.user.id && i.customId === "task_setup_modal",
      time:   120_000,
    });
  } catch {
    return interaction.editReply({ embeds: [timeoutEmbed()], components: [] });
  }

  // ─── التحقق من المدخلات ───────────────────────────────────────────────────────
  const rawGoal   = modalSubmit.fields.getTextInputValue("task_goal").trim();
  const rawPoints = modalSubmit.fields.getTextInputValue("task_points").trim();
  const rawPeriod = modalSubmit.fields.getTextInputValue("task_period").trim().toLowerCase();

  const goal   = parseInt(rawGoal);
  const points = parseInt(rawPoints);

  // فحص الأرقام
  if (isNaN(goal) || goal <= 0) {
    return modalSubmit.reply({
      embeds: [errorEmbed("الهدف يجب أن يكون رقماً صحيحاً موجباً.")],
      ephemeral: true,
    });
  }

  if (isNaN(points) || points <= 0) {
    return modalSubmit.reply({
      embeds: [errorEmbed("النقاط يجب أن تكون رقماً صحيحاً موجباً.")],
      ephemeral: true,
    });
  }

  // فحص الفترة
  if (!["daily", "2days", "weekly"].includes(rawPeriod)) {
    return modalSubmit.reply({
      embeds: [errorEmbed("الفترة يجب أن تكون: `daily` أو `2days` أو `weekly`")],
      ephemeral: true,
    });
  }

  // ─── حفظ المهمة ──────────────────────────────────────────────────────────────
  const taskConfig = getTaskConfig(interaction.guildId);

  taskConfig[selectedRoleId] = {
    type:      selectedType,
    goal,
    points,
    period:    rawPeriod,
    createdAt: Date.now(),
    createdBy: interaction.user.id,
  };

  saveTaskConfig(interaction.guildId, taskConfig);

  // ─── Embed النتيجة ────────────────────────────────────────────────────────────
  await modalSubmit.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("✅ تم إعداد المهمة بنجاح")
        .addFields(
          { name: "الرتبة",      value: `<@&${selectedRoleId}>`,         inline: true },
          { name: "النوع",       value: getTypeLabel(selectedType),       inline: true },
          { name: "الهدف",       value: `${goal} ${getUnitLabel(selectedType)}`, inline: true },
          { name: "النقاط",      value: `${points} نقطة`,                inline: true },
          { name: "فترة التجديد", value: getPeriodLabel(rawPeriod),       inline: true },
        )
        .setDescription(
          `كل مشرف يملك <@&${selectedRoleId}> سيُكلَّف بهذه المهمة تلقائياً.`
        )
        .setTimestamp(),
    ],
    ephemeral: true,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// /task list
// ─────────────────────────────────────────────────────────────────────────────

async function handleList(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const taskConfig = getTaskConfig(interaction.guildId);
  const entries    = Object.entries(taskConfig);

  // ─── Empty State ──────────────────────────────────────────────────────────────
  if (!entries.length) {
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("📋 المهام المُعدَّة")
          .setDescription(
            "لا توجد مهام مُعدَّة بعد.\n\nاستخدم `/task setup` لإضافة مهمة."
          )
          .setTimestamp(),
      ],
    });
  }

  // ─── بناء الحقول ─────────────────────────────────────────────────────────────
  const fields = entries.map(([roleId, task]) => {
    const bar = buildProgressBar(0, task.goal, 10);
    return {
      name:   `<@&${roleId}>`,
      value: [
        `**النوع:** ${getTypeLabel(task.type)}`,
        `**الهدف:** ${task.goal} ${getUnitLabel(task.type)}`,
        `**النقاط:** ${task.points} نقطة`,
        `**التجديد:** ${getPeriodLabel(task.period)}`,
        `شريط التقدم: ${bar}`,
      ].join("\n"),
      inline: false,
    };
  });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📋 المهام المُعدَّة (${entries.length})`)
    .addFields(fields)
    .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
    .setFooter({ text: "لحذف مهمة: /task remove • لتعديل: أعد /task setup على نفس الرتبة" })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ─────────────────────────────────────────────────────────────────────────────
// /task remove
// ─────────────────────────────────────────────────────────────────────────────

async function handleRemove(interaction) {
  const taskConfig = getTaskConfig(interaction.guildId);
  const entries    = Object.entries(taskConfig);

  // ─── Empty State ──────────────────────────────────────────────────────────────
  if (!entries.length) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xfee75c)
          .setDescription("⚠️ لا توجد مهام مُعدَّة لحذفها.")
      ],
      ephemeral: true,
    });
  }

  // ─── RoleSelect لاختيار الرتبة ───────────────────────────────────────────────
  const roleSelectRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("task_remove_role")
      .setPlaceholder("اختر الرتبة التي تريد حذف مهمتها")
      .setMinValues(1)
      .setMaxValues(1)
  );

  // عرض المهام الحالية للمساعدة
  const currentTasksText = entries.map(([roleId, task]) =>
    `<@&${roleId}> — ${getTypeLabel(task.type)} — ${task.goal} ${getUnitLabel(task.type)} — ${getPeriodLabel(task.period)}`
  ).join("\n");

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle("🗑 حذف مهمة")
        .setDescription("اختر الرتبة التي تريد حذف مهمتها:")
        .addFields({
          name:  "المهام الحالية",
          value: currentTasksText,
        })
        .setFooter({ text: "الجلسة تنتهي خلال 60 ثانية" })
        .setTimestamp(),
    ],
    components: [roleSelectRow],
    ephemeral:  true,
  });

  // ─── Collector: اختيار الرتبة ─────────────────────────────────────────────────
  let roleInteraction;
  try {
    roleInteraction = await interaction.channel.awaitMessageComponent({
      filter:        (i) => i.user.id === interaction.user.id && i.customId === "task_remove_role",
      componentType: ComponentType.RoleSelect,
      time:          60_000,
    });
  } catch {
    return interaction.editReply({ embeds: [timeoutEmbed()], components: [] });
  }

  const selectedRoleId = roleInteraction.values[0];
  const task           = taskConfig[selectedRoleId];

  // ─── تحقق أن الرتبة لها مهمة ─────────────────────────────────────────────────
  if (!task) {
    return roleInteraction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0xfee75c)
          .setDescription(`⚠️ الرتبة <@&${selectedRoleId}> ليس لها مهمة مُعدَّة.`)
      ],
      components: [],
    });
  }

  // ─── Embed التأكيد ────────────────────────────────────────────────────────────
  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("task_remove_confirm")
      .setLabel("🗑 نعم، احذف المهمة")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("task_remove_cancel")
      .setLabel("❌ إلغاء")
      .setStyle(ButtonStyle.Secondary),
  );

  await roleInteraction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle("🗑 تأكيد الحذف")
        .setDescription(`هل تريد حذف مهمة الرتبة <@&${selectedRoleId}>؟`)
        .addFields(
          { name: "النوع",       value: getTypeLabel(task.type),                inline: true },
          { name: "الهدف",       value: `${task.goal} ${getUnitLabel(task.type)}`, inline: true },
          { name: "النقاط",      value: `${task.points} نقطة`,                  inline: true },
          { name: "فترة التجديد", value: getPeriodLabel(task.period),           inline: true },
        )
        .setFooter({ text: "سيُحذف تقدم كل المشرفين في هذه المهمة" })
        .setTimestamp(),
    ],
    components: [confirmRow],
  });

  // ─── Collector: تأكيد ────────────────────────────────────────────────────────
  let btnInteraction;
  try {
    btnInteraction = await interaction.channel.awaitMessageComponent({
      filter:        (i) =>
        i.user.id === interaction.user.id &&
        ["task_remove_confirm", "task_remove_cancel"].includes(i.customId),
      componentType: ComponentType.Button,
      time:          30_000,
    });
  } catch {
    return interaction.editReply({ embeds: [timeoutEmbed()], components: [] });
  }

  if (btnInteraction.customId === "task_remove_cancel") {
    return btnInteraction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0x99aab5)
          .setDescription("❌ تم إلغاء الحذف.")
          .setTimestamp(),
      ],
      components: [],
    });
  }

  // ─── تنفيذ الحذف ─────────────────────────────────────────────────────────────
  delete taskConfig[selectedRoleId];
  saveTaskConfig(interaction.guildId, taskConfig);

  await btnInteraction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("✅ تم حذف المهمة")
        .setDescription(`تم حذف مهمة الرتبة <@&${selectedRoleId}> بنجاح.`)
        .setTimestamp(),
    ],
    components: [],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال مساعدة
// ─────────────────────────────────────────────────────────────────────────────

function getGoalLabel(type) {
  const labels = {
    messages:   "الهدف: عدد الرسائل المطلوبة",
    moderation: "الهدف: عدد العقوبات المطلوبة",
    voice:      "الهدف: عدد الدقائق في الفويس",
  };
  return labels[type] || "الهدف";
}

function getGoalPlaceholder(type) {
  const placeholders = {
    messages:   "مثال: 500",
    moderation: "مثال: 10",
    voice:      "مثال: 120",
  };
  return placeholders[type] || "أدخل الهدف";
}

function getUnitLabel(type) {
  const units = {
    messages:   "رسالة",
    moderation: "عقوبة",
    voice:      "دقيقة",
  };
  return units[type] || "";
}

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
