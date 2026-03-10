// src/utils/perms.js
// ─────────────────────────────────────────────────────────────────────────────
// نظام الصلاحيات المتدرج
//
// الهرمية:
//   👑 مالك السيرفر        → كل شيء
//   🛡 Administrator       → كل شيء
//   🔰 رتب الإدارة         → /add /remove /reset /warn /timeout /setup ...
//   🎖 رتب المشرفين        → /points /top /rank /mytasks /appeal (على نفسه فقط)
// ─────────────────────────────────────────────────────────────────────────────

import { EmbedBuilder, PermissionFlagsBits } from "discord.js";

// ─────────────────────────────────────────────────────────────────────────────
// دوال الفحص الأساسية
// ─────────────────────────────────────────────────────────────────────────────

/**
 * هل العضو مالك السيرفر؟
 *
 * @param {GuildMember} member
 * @returns {boolean}
 */
export function isOwner(member) {
  if (!member?.guild) return false;
  return member.guild.ownerId === member.id;
}

/**
 * هل العضو يملك صلاحية Administrator في ديسكورد؟
 *
 * @param {GuildMember} member
 * @returns {boolean}
 */
export function isDiscordAdmin(member) {
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

/**
 * هل العضو مدير؟ (مالك أو Administrator أو رتبة إدارة من /setup)
 * هؤلاء يستطيعون: /add /remove /reset /warn /timeout /setup /memberlog /task /promote
 *
 * @param {GuildMember} member
 * @param {object}      config  - إعدادات السيرفر من getConfig()
 * @returns {boolean}
 */
export function isAdmin(member, config) {
  if (!member) return false;

  // مالك السيرفر → كل الصلاحيات دائماً
  if (isOwner(member)) return true;

  // Administrator في ديسكورد → كل الصلاحيات دائماً
  if (isDiscordAdmin(member)) return true;

  // رتب الإدارة المخصصة من /setup
  const adminRoles = config?.adminRoles || [];
  return adminRoles.some((roleId) => member.roles.cache.has(roleId));
}

/**
 * هل العضو مشرف؟ (مدير أو رتبة مشرف من /setup)
 * هؤلاء يستطيعون: /points /top /rank /mytasks /appeal
 *
 * @param {GuildMember} member
 * @param {object}      config
 * @returns {boolean}
 */
export function isMod(member, config) {
  if (!member) return false;

  // المديرون يملكون صلاحيات المشرفين أيضاً
  if (isAdmin(member, config)) return true;

  // رتب المشرفين المخصصة من /setup
  const modRoles = config?.modRoles || [];
  return modRoles.some((roleId) => member.roles.cache.has(roleId));
}

/**
 * هل العضو يستطيع مراجعة الاستئنافات النهائية؟
 * (مدير أو رتبة الاستئناف من /setup)
 *
 * @param {GuildMember} member
 * @param {object}      config
 * @returns {boolean}
 */
export function isAppealReviewer(member, config) {
  if (!member) return false;

  if (isAdmin(member, config)) return true;

  const appealRole = config?.appealRole;
  if (!appealRole) return false;

  return member.roles.cache.has(appealRole);
}

/**
 * هل العضو يستطيع مراجعة بطاقات المراجعة العادية؟
 * حالياً = نفس صلاحية المدير
 *
 * @param {GuildMember} member
 * @param {object}      config
 * @returns {boolean}
 */
export function canReview(member, config) {
  return isAdmin(member, config);
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال Guard — تُرسل رسالة خطأ وترجع false إذا لم يكن للعضو الصلاحية
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Embed الخطأ الموحّد لرسائل رفض الصلاحية
 */
function noPermEmbed(message) {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setDescription(`❌ ${message}`)
    .setTimestamp();
}

/**
 * تحقق من صلاحية المدير — إذا لم تتوفر يُرسل رسالة ويُعيد false
 *
 * @param {CommandInteraction} interaction
 * @param {object}             config
 * @returns {boolean}
 *
 * @example
 * if (!requireAdmin(interaction, config)) return;
 */
export function requireAdmin(interaction, config) {
  if (isAdmin(interaction.member, config)) return true;

  interaction.reply({
    embeds: [noPermEmbed("ليس لديك صلاحية استخدام هذا الأمر.\nتحتاج رتبة إدارة أو Administrator.")],
    ephemeral: true,
  }).catch(() => {});

  return false;
}

/**
 * تحقق من صلاحية المشرف — إذا لم تتوفر يُرسل رسالة ويُعيد false
 *
 * @param {CommandInteraction} interaction
 * @param {object}             config
 * @returns {boolean}
 *
 * @example
 * if (!requireMod(interaction, config)) return;
 */
export function requireMod(interaction, config) {
  if (isMod(interaction.member, config)) return true;

  interaction.reply({
    embeds: [noPermEmbed("ليس لديك صلاحية استخدام هذا الأمر.\nتحتاج رتبة مشرف على الأقل.")],
    ephemeral: true,
  }).catch(() => {});

  return false;
}

/**
 * تحقق من صلاحية مراجع الاستئنافات
 *
 * @param {CommandInteraction} interaction
 * @param {object}             config
 * @returns {boolean}
 */
export function requireAppealReviewer(interaction, config) {
  if (isAppealReviewer(interaction.member, config)) return true;

  interaction.reply({
    embeds: [noPermEmbed("ليس لديك صلاحية مراجعة الاستئنافات النهائية.")],
    ephemeral: true,
  }).catch(() => {});

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// حماية Self-Action
// ─────────────────────────────────────────────────────────────────────────────

/**
 * هل يحاول العضو تعديل نقاط نفسه؟
 * ممنوع حتى على المالك والـ Administrator
 *
 * @param {string} executorId  - من يُنفّذ الأمر
 * @param {Array}  targetIds   - قائمة المستهدفين
 * @returns {boolean}          - true = يحاول تعديل نفسه (مرفوض)
 */
export function isSelfAction(executorId, targetIds) {
  return targetIds.includes(executorId);
}

/**
 * تحقق من أن المنفذ لا يستهدف نفسه
 * إذا استهدف نفسه يُرسل رسالة خطأ ويُعيد false
 *
 * @param {CommandInteraction} interaction
 * @param {Array<string>}      targetIds
 * @returns {boolean} - true = آمن (لا يستهدف نفسه)
 */
export function requireNotSelf(interaction, targetIds) {
  if (!isSelfAction(interaction.user.id, targetIds)) return true;

  interaction.reply({
    embeds: [noPermEmbed("لا يمكنك تعديل نقاطك بنفسك.\nهذا مقيّد حتى على المالك والمديرين.")],
    ephemeral: true,
  }).catch(() => {});

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// مقارنة الرتب (لمنع تعديل من هو أعلى رتبة)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * هل رتبة المنفذ أعلى من رتبة المستهدف؟
 * يُستخدم لمنع تعديل نقاط من هو أعلى منك
 *
 * @param {GuildMember} executor - من يُنفّذ الأمر
 * @param {GuildMember} target   - المستهدف
 * @returns {boolean}            - true = المنفذ أعلى رتبة (مسموح)
 */
export function isHigherRole(executor, target) {
  // مالك السيرفر أعلى دائماً
  if (executor.guild.ownerId === executor.id) return true;

  const executorHighest = executor.roles.highest.position;
  const targetHighest   = target.roles.highest.position;

  return executorHighest > targetHighest;
}

// ─────────────────────────────────────────────────────────────────────────────
// فحص صلاحيات البوت نفسه
// ─────────────────────────────────────────────────────────────────────────────

/**
 * هل يملك البوت صلاحية معينة في قناة أو سيرفر؟
 *
 * @param {Guild}      guild      - السيرفر
 * @param {bigint}     permission - مثلاً PermissionFlagsBits.ManageRoles
 * @returns {boolean}
 */
export function botHasPerm(guild, permission) {
  const botMember = guild.members.me;
  if (!botMember) return false;
  return botMember.permissions.has(permission);
}

/**
 * هل رتبة البوت أعلى من رتبة العضو؟
 * ضروري لإضافة/حذف الرتب والتوقيف
 *
 * @param {Guild}       guild
 * @param {GuildMember} targetMember
 * @returns {boolean}
 */
export function botRoleHigherThan(guild, targetMember) {
  const botMember = guild.members.me;
  if (!botMember) return false;
  return botMember.roles.highest.position > targetMember.roles.highest.position;
}
