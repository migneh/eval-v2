// src/systems/tasks.js
// ─────────────────────────────────────────────────────────────────────────────
// نظام المهام التلقائية
//
// كيف يعمل:
//   - الأدمن يربط كل رتبة بمهمة عبر /task setup
//   - البوت يراقب النشاط ويُحدّث التقدم تلقائياً
//   - عند الإكمال → تُضاف النقاط + تتجدد المهمة تلقائياً
//   - مشرف بأكثر من رتبة = مهام مجمّعة من كل رتبه
//
// أنواع المهام:
//   messages   → عدد الرسائل
//   moderation → عدد العقوبات المقبولة
//   voice      → دقائق الفويس (تُمرَّر من index.js)
// ─────────────────────────────────────────────────────────────────────────────

import { EmbedBuilder } from "discord.js";

import {
  getConfig,
  getTaskConfig,
  saveTaskConfig,
  getTaskProgress,
  saveTaskProgress,
  addPointsToUser,
} from "../utils/db.js";

import { isMod }           from "../utils/perms.js";
import { checkPromotion }  from "./promotions.js";
import { log, makeLogEmbed, LogType } from "../utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// ثوابت
// ─────────────────────────────────────────────────────────────────────────────

// مُدد فترات التجديد بالميلي ثانية
export const PERIOD_MS = {
  daily:  86_400_000,   // 24 ساعة
  "2days": 172_800_000, // 48 ساعة
  weekly: 604_800_000,  // 7 أيام
};

// وقت التحذير قبل انتهاء المهمة (ساعة قبل الانتهاء)
const WARN_BEFORE_MS = 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// الدالة الرئيسية — تُستدعى من messageCreate و voiceStateUpdate و acceptReview
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُحدّث تقدم مشرف في مهام نوع معين
 *
 * @param {Guild}  guild
 * @param {string} userId  - المشرف
 * @param {string} type    - "messages" | "moderation" | "voice"
 * @param {number} amount  - المقدار المُضاف (1 للرسائل/عقوبات، دقائق للفويس)
 */
export async function incrementTaskProgress(guild, userId, type, amount = 1) {
  const config     = getConfig(guild.id);
  const taskConfig = getTaskConfig(guild.id);

  // لا توجد مهام مُعدَّة → تجاهل
  if (!Object.keys(taskConfig).length) return;

  // ─── جلب العضو ───────────────────────────────────────────────────────────────
  let member;
  try {
    member = await guild.members.fetch(userId);
  } catch {
    return;
  }

  // هل هو مشرف؟
  if (!isMod(member, config)) return;

  const progress     = getTaskProgress(guild.id);
  const userProgress = progress[userId] || {};
  const now          = Date.now();
  let   changed      = false;

  // ─── تحقق من كل رتبة لها مهمة ───────────────────────────────────────────────
  for (const [roleId, taskDef] of Object.entries(taskConfig)) {

    // هل المشرف يملك هذه الرتبة؟
    if (!member.roles.cache.has(roleId)) continue;

    // هل نوع المهمة يطابق؟
    if (taskDef.type !== type) continue;

    // ─── حالة التقدم لهذه المهمة ─────────────────────────────────────────────
    if (!userProgress[roleId]) {
      userProgress[roleId] = {
        current:     0,
        lastReset:   now,
        completed:   false,
        lastWarned:  0,
      };
    }

    const p       = userProgress[roleId];
    const periodMs = getPeriodMs(taskDef.period);

    // ─── إعادة تعيين إذا انتهت الفترة ───────────────────────────────────────
    if (now - p.lastReset > periodMs) {
      p.current    = 0;
      p.lastReset  = now;
      p.completed  = false;
      p.lastWarned = 0;
    }

    // إذا أكملت → لا تقدّم حتى التجديد
    if (p.completed) continue;

    // ─── إضافة التقدم ────────────────────────────────────────────────────────
    p.current = Math.min(p.current + amount, taskDef.goal);
    changed   = true;

    // ─── فحص التحذير المبكر ──────────────────────────────────────────────────
    await checkTaskWarning(guild, userId, roleId, taskDef, p, periodMs, now);

    // ─── فحص الإكمال ─────────────────────────────────────────────────────────
    if (p.current >= taskDef.goal) {
      await completeTask(guild, userId, roleId, taskDef, p);
    }
  }

  // ─── حفظ التقدم ──────────────────────────────────────────────────────────────
  if (changed) {
    progress[userId] = userProgress;
    saveTaskProgress(guild.id, progress);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// إكمال المهمة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُنفّذ منطق إكمال المهمة: إضافة النقاط + إشعار + تسجيل
 *
 * @param {Guild}  guild
 * @param {string} userId
 * @param {string} roleId
 * @param {object} taskDef  - إعدادات المهمة
 * @param {object} p        - حالة التقدم (مرجع مباشر — يُعدَّل هنا)
 */
async function completeTask(guild, userId, roleId, taskDef, p) {
  // ─── تحديث الحالة ────────────────────────────────────────────────────────────
  p.completed = true;

  // ─── إضافة النقاط ────────────────────────────────────────────────────────────
  const typeLabel = getTypeLabel(taskDef.type);
  addPointsToUser(
    guild.id,
    userId,
    taskDef.points,
    "task",
    `إكمال مهمة: ${typeLabel}`,
    null,
  );

  // ─── فحص الترقية ─────────────────────────────────────────────────────────────
  await checkPromotion(guild, userId);

  // ─── إشعار DM ────────────────────────────────────────────────────────────────
  await sendTaskCompletionDM(guild, userId, taskDef, roleId);

  // ─── تسجيل في السجل ──────────────────────────────────────────────────────────
  await log(guild, LogType.TASK, makeLogEmbed(LogType.TASK,
    "✅ مهمة مكتملة",
    [
      { name: "المشرف",  value: `<@${userId}>`,          inline: true },
      { name: "الرتبة",  value: `<@&${roleId}>`,          inline: true },
      { name: "النوع",   value: typeLabel,                 inline: true },
      { name: "الهدف",   value: `${taskDef.goal}`,        inline: true },
      { name: "النقاط",  value: `+${taskDef.points}`,     inline: true },
    ]
  ));
}

// ─────────────────────────────────────────────────────────────────────────────
// تحذير قبل انتهاء الوقت
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يفحص إذا اقترب انتهاء وقت المهمة غير المكتملة ويُرسل تحذيراً
 *
 * @param {Guild}  guild
 * @param {string} userId
 * @param {string} roleId
 * @param {object} taskDef
 * @param {object} p         - حالة التقدم
 * @param {number} periodMs
 * @param {number} now
 */
async function checkTaskWarning(guild, userId, roleId, taskDef, p, periodMs, now) {
  if (p.completed) return;

  const timeLeft    = periodMs - (now - p.lastReset);
  const alreadyWarn = p.lastWarned && (now - p.lastWarned < periodMs);

  // تحذير إذا: بقي أقل من ساعة + لم نُرسل تحذيراً في هذه الدورة
  if (timeLeft > 0 && timeLeft <= WARN_BEFORE_MS && !alreadyWarn) {
    p.lastWarned = now;
    await sendTaskWarningDM(guild, userId, taskDef, roleId, p, timeLeft);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// فحص المهام المنتهية (يُستدعى بشكل دوري)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يفحص كل مشرفي السيرفر ويُرسل إشعارات للمهام المنتهية غير المكتملة
 * يُستدعى كل ساعة من index.js (اختياري)
 *
 * @param {Guild} guild
 */
export async function checkExpiredTasks(guild) {
  const taskConfig  = getTaskConfig(guild.id);
  const progress    = getTaskProgress(guild.id);
  const now         = Date.now();

  if (!Object.keys(taskConfig).length) return;

  for (const [userId, userProgress] of Object.entries(progress)) {
    for (const [roleId, taskDef] of Object.entries(taskConfig)) {
      const p = userProgress[roleId];
      if (!p || p.completed) continue;

      const periodMs = getPeriodMs(taskDef.period);
      const timeLeft = periodMs - (now - p.lastReset);

      // انتهى الوقت
      if (timeLeft <= 0) {
        await sendTaskExpiredDM(guild, userId, taskDef, roleId, p);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// جلب مهام مشرف
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُرجع قائمة مهام مشرف مع حالة كل مهمة
 * يُستخدم في /mytasks
 *
 * @param {Guild}       guild
 * @param {string}      userId
 * @param {GuildMember} member
 * @returns {Array<TaskStatus>}
 *
 * @typedef {object} TaskStatus
 * @property {string}  roleId
 * @property {string}  type
 * @property {number}  goal
 * @property {string}  period
 * @property {number}  points
 * @property {number}  current     - التقدم الحالي
 * @property {boolean} completed   - هل مكتملة؟
 * @property {number}  timeLeft    - الوقت المتبقي بالـ ms
 * @property {number}  percentage  - نسبة الإكمال (0-100)
 */
export function getUserTasks(guild, userId, member) {
  const taskConfig  = getTaskConfig(guild.id);
  const progress    = getTaskProgress(guild.id);
  const userProgress = progress[userId] || {};
  const now         = Date.now();
  const tasks       = [];

  for (const [roleId, taskDef] of Object.entries(taskConfig)) {
    // هل المشرف يملك هذه الرتبة؟
    if (!member.roles.cache.has(roleId)) continue;

    const p         = userProgress[roleId] || { current: 0, lastReset: now, completed: false };
    const periodMs  = getPeriodMs(taskDef.period);
    const timeLeft  = Math.max(0, periodMs - (now - (p.lastReset || now)));
    const isExpired = timeLeft <= 0;

    // إذا انتهت الدورة → التقدم صفر
    const current   = isExpired ? 0 : (p.current || 0);
    const completed = !isExpired && (p.completed || false);

    tasks.push({
      roleId,
      type:       taskDef.type,
      goal:       taskDef.goal,
      period:     taskDef.period,
      points:     taskDef.points,
      current,
      completed,
      timeLeft,
      percentage: Math.min(100, Math.round((current / taskDef.goal) * 100)),
    });
  }

  // ترتيب: غير المكتملة أولاً، ثم حسب نسبة التقدم تنازلياً
  return tasks.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return b.percentage - a.percentage;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// إرسال الإشعارات
// ─────────────────────────────────────────────────────────────────────────────

/**
 * إشعار DM عند إكمال المهمة
 */
async function sendTaskCompletionDM(guild, userId, taskDef, roleId) {
  try {
    const user = await guild.client.users.fetch(userId);

    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle("✅ أكملت مهمة!")
          .setDescription(
            `أكملت مهمة **${getTypeLabel(taskDef.type)}** في **${guild.name}**`
          )
          .addFields(
            { name: "الرتبة",    value: `<@&${roleId}>`,      inline: true },
            { name: "الهدف",     value: `${taskDef.goal}`,    inline: true },
            { name: "🏆 النقاط", value: `+${taskDef.points}`, inline: true },
            {
              name:  "🔄 التجديد",
              value: `المهمة ستتجدد بعد ${getPeriodLabel(taskDef.period)}`,
            },
          )
          .setThumbnail(guild.iconURL({ dynamic: true }))
          .setTimestamp(),
      ],
    });
  } catch {}
}

/**
 * إشعار DM تحذير قبل انتهاء الوقت
 */
async function sendTaskWarningDM(guild, userId, taskDef, roleId, p, timeLeft) {
  try {
    const user       = await guild.client.users.fetch(userId);
    const minutes    = Math.ceil(timeLeft / 60000);
    const remaining  = taskDef.goal - p.current;

    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xfee75c)
          .setTitle("⚠️ تحذير: مهمة على وشك الانتهاء!")
          .setDescription(
            `تبقى **${minutes} دقيقة** لإكمال مهمة **${getTypeLabel(taskDef.type)}** في **${guild.name}**`
          )
          .addFields(
            { name: "الرتبة",         value: `<@&${roleId}>`,           inline: true },
            { name: "التقدم الحالي",  value: `${p.current} / ${taskDef.goal}`, inline: true },
            { name: "المتبقي",        value: `${remaining} ${getUnitLabel(taskDef.type)}`, inline: true },
          )
          .setThumbnail(guild.iconURL({ dynamic: true }))
          .setTimestamp(),
      ],
    });
  } catch {}
}

/**
 * إشعار DM عند انتهاء وقت المهمة دون إكمال
 */
async function sendTaskExpiredDM(guild, userId, taskDef, roleId, p) {
  try {
    const user = await guild.client.users.fetch(userId);

    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("❌ انتهى وقت المهمة!")
          .setDescription(
            `انتهت فترة مهمة **${getTypeLabel(taskDef.type)}** في **${guild.name}** دون إكمالها.`
          )
          .addFields(
            { name: "الرتبة",        value: `<@&${roleId}>`,                  inline: true },
            { name: "التقدم الأخير", value: `${p.current} / ${taskDef.goal}`, inline: true },
            { name: "النقاط الفائتة", value: `${taskDef.points} نقطة`,        inline: true },
            {
              name:  "🔄 التجديد",
              value: "ستبدأ المهمة من جديد تلقائياً في دورتها القادمة.",
            },
          )
          .setThumbnail(guild.iconURL({ dynamic: true }))
          .setTimestamp(),
      ],
    });
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال مساعدة مُصدَّرة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * يُرجع مدة الفترة بالـ ms
 *
 * @param {string} period - "daily" | "2days" | "weekly"
 * @returns {number}
 */
export function getPeriodMs(period) {
  return PERIOD_MS[period] ?? PERIOD_MS.daily;
}

/**
 * تسميات الأنواع بالعربية
 */
export function getTypeLabel(type) {
  const labels = {
    messages:   "💬 رسائل",
    moderation: "⚖️ موديريشن",
    voice:      "🎙 فويس",
  };
  return labels[type] || type;
}

/**
 * تسميات الفترات بالعربية
 */
export function getPeriodLabel(period) {
  const labels = {
    daily:  "24 ساعة",
    "2days": "48 ساعة",
    weekly: "7 أيام",
  };
  return labels[period] || period;
}

/**
 * وحدة القياس حسب النوع
 */
function getUnitLabel(type) {
  const units = {
    messages:   "رسالة",
    moderation: "عقوبة",
    voice:      "دقيقة",
  };
  return units[type] || "";
}

/**
 * يُنشئ progress bar نصي
 *
 * @param {number} current
 * @param {number} goal
 * @param {number} length  - طول الشريط (افتراضي 10)
 * @returns {string}       - مثال: "████░░░░░░ 40%"
 */
export function buildProgressBar(current, goal, length = 10) {
  const pct    = goal > 0 ? Math.min(current / goal, 1) : 0;
  const filled = Math.round(pct * length);
  const empty  = length - filled;
  return `${"█".repeat(filled)}${"░".repeat(empty)} ${Math.round(pct * 100)}%`;
}

/**
 * يُنسّق الوقت المتبقي
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatTimeLeft(ms) {
  if (ms <= 0) return "انتهت";

  const days    = Math.floor(ms / 86_400_000);
  const hours   = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000)  / 60_000);

  if (days > 0)   return `${days} يوم ${hours > 0 ? `و ${hours} ساعة` : ""}`;
  if (hours > 0)  return `${hours} ساعة ${minutes > 0 ? `و ${minutes} دقيقة` : ""}`;
  return `${minutes} دقيقة`;
}
