// src/index.js
// ─────────────────────────────────────────────────────────────────────────────
// نقطة البداية — يُنشئ الـ Client، يسجّل الأوامر، يربط الأحداث
// ─────────────────────────────────────────────────────────────────────────────

import {
  Client,
  GatewayIntentBits,
  Collection,
  Partials,
} from "discord.js";

import { handleMessageCreate } from "./events/messageCreate.js";
import { handleInteractionCreate } from "./events/interactionCreate.js";
import { incrementTaskProgress, checkExpiredTasks } from "./systems/tasks.js";
import { rescheduleReminders, pruneReviews } from "./systems/reviews.js";
import { loadConfig } from "./utils/config-loader.js";

// ─── استيراد الأوامر ──────────────────────────────────────────────────────────
import * as addCmd        from "./commands/add.js";
import * as removeCmd     from "./commands/remove.js";
import * as pointsCmd     from "./commands/points.js";
import * as topCmd        from "./commands/top.js";
import * as resetCmd      from "./commands/reset.js";
import * as setupCmd      from "./commands/setup.js";
import * as helpCmd       from "./commands/help.js";
import * as rankCmd       from "./commands/rank.js";
import * as promoteCmd    from "./commands/promote.js";
import * as moderationCmd from "./commands/moderation.js";
import * as appealCmd     from "./commands/appeal.js";
import * as memblogCmd    from "./commands/memberlog.js";
import * as mytasksCmd    from "./commands/mytasks.js";
import * as taskCmd       from "./commands/task.js";

// ─── تحميل الإعدادات ──────────────────────────────────────────────────────────
// index.js لا يحتاج clientId — التوكن يكفي لتشغيل البوت
const { token } = await loadConfig({ requireClientId: false });
console.log("🔧 مصدر الإعدادات: تم تحميل التوكن بنجاح");

// ─── إنشاء الـ Client ─────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,            // معلومات السيرفر والقنوات والرتب
    GatewayIntentBits.GuildMessages,     // استقبال الرسائل (للـ XP والمهام)
    GatewayIntentBits.MessageContent,    // قراءة محتوى الرسائل (Privileged)
    GatewayIntentBits.GuildMembers,      // جلب الأعضاء وتعديل رتبهم
    GatewayIntentBits.GuildVoiceStates,  // تتبع الفويس (لمهام الـ voice)
  ],
  partials: [
    Partials.Message,   // استقبال رسائل قديمة قبل بدء البوت
    Partials.Channel,
    Partials.GuildMember,
  ],
});

// ─── تسجيل الأوامر في Collection ────────────────────────────────────────────
client.commands = new Collection();

// الأوامر العادية — كل ملف يصدّر { data, execute }
const regularCommands = [
  addCmd,
  removeCmd,
  pointsCmd,
  topCmd,
  resetCmd,
  setupCmd,
  helpCmd,
  rankCmd,
  promoteCmd,
  appealCmd,
  memblogCmd,
  mytasksCmd,
  taskCmd,
];

for (const cmd of regularCommands) {
  if (!cmd.data || !cmd.execute) {
    console.warn(`⚠️ أمر بدون data أو execute تم تخطيه`);
    continue;
  }
  client.commands.set(cmd.data.name, {
    data:    cmd.data,
    execute: cmd.execute,
  });
}

// moderation.js يصدّر أمرين منفصلين (warn + timeout)
client.commands.set(moderationCmd.warnData.name, {
  data:    moderationCmd.warnData,
  execute: moderationCmd.executeWarn,
});
client.commands.set(moderationCmd.timeoutData.name, {
  data:    moderationCmd.timeoutData,
  execute: moderationCmd.executeTimeout,
});

// ─── حدث: البوت جاهز ─────────────────────────────────────────────────────────
client.once("ready", (c) => {
  console.log("─────────────────────────────────────────");
  console.log(`✅ البوت جاهز: ${c.user.tag}`);
  console.log(`📋 الأوامر المحملة: ${client.commands.size}`);
  console.log(`🌐 السيرفرات: ${c.guilds.cache.size}`);
  console.log("─────────────────────────────────────────");

  // ضبط حالة البوت
  c.user.setPresence({
    activities: [{ name: "/help | إدارة النقاط", type: 0 }],
    status: "online",
  });

  // ─── استعادة التذكيرات المعلّقة بعد إعادة التشغيل ──────────────────────────
  // كانت المؤقتات في الذاكرة فقط فتضيع مع كل إعادة تشغيل
  (async () => {
    let restored = 0;
    let pruned   = 0;

    for (const guild of c.guilds.cache.values()) {
      try {
        restored += rescheduleReminders(guild);
        pruned   += pruneReviews(guild.id);
      } catch (err) {
        console.error(`❌ خطأ في استعادة تذكيرات ${guild.id}:`, err.message);
      }
    }

    if (restored) console.log(`🔔 تم استعادة ${restored} تذكير مراجعة معلّق`);
    if (pruned)   console.log(`🧹 تم أرشفة ${pruned} طلب مراجعة قديم`);
  })();
});

// ─── حدث: رسالة جديدة (XP + تقدم المهام) ────────────────────────────────────
client.on("messageCreate", (message) => {
  handleMessageCreate(message).catch((err) => {
    console.error("❌ خطأ في messageCreate:", err);
  });
});

// ─── حدث: تفاعل جديد (أوامر + أزرار المراجعة) ───────────────────────────────
client.on("interactionCreate", (interaction) => {
  handleInteractionCreate(interaction, client.commands).catch((err) => {
    console.error("❌ خطأ في interactionCreate:", err);
  });
});

// ─── حدث: الفويس (لمهام نوع voice) ──────────────────────────────────────────
// يتتبع وقت دخول/خروج المشرف من قنوات الصوت
const voiceSessions = new Map(); // userId → timestamp دخول

client.on("voiceStateUpdate", async (oldState, newState) => {
  const userId  = newState.member?.id || oldState.member?.id;
  const guild   = newState.guild || oldState.guild;
  if (!userId || !guild) return;

  const joinedChannel  = !oldState.channelId && newState.channelId;
  const leftChannel    = oldState.channelId  && !newState.channelId;
  const switchedChannel = oldState.channelId && newState.channelId &&
                          oldState.channelId !== newState.channelId;

  if (joinedChannel) {
    // سجّل وقت الدخول
    voiceSessions.set(`${guild.id}:${userId}`, Date.now());
    return;
  }

  if (leftChannel || switchedChannel) {
    const key       = `${guild.id}:${userId}`;
    const joinedAt  = voiceSessions.get(key);
    if (!joinedAt) return;

    const minutes = Math.floor((Date.now() - joinedAt) / 60000);
    voiceSessions.delete(key);

    if (minutes > 0) {
      // استيراد ثابت في الأعلى — لا توجد دورة دائرية لأن tasks.js
      // لا يستورد index.js إطلاقاً
      await incrementTaskProgress(guild, userId, "voice", minutes).catch(() => {});
    }

    // إذا انتقل لقناة ثانية، سجّل وقت الدخول الجديد
    if (switchedChannel) {
      voiceSessions.set(key, Date.now());
    }
  }
});

// ─── حدث: مغادرة عضو → نظّف جلسة الفويس المعلّقة ────────────────────────────
client.on("guildMemberRemove", (member) => {
  voiceSessions.delete(`${member.guild.id}:${member.id}`);
});

// ─── حدث: مغادرة البوت لسيرفر → نظّف كل جلساته ──────────────────────────────
client.on("guildDelete", (guild) => {
  for (const key of voiceSessions.keys()) {
    if (key.startsWith(`${guild.id}:`)) voiceSessions.delete(key);
  }
});

// ─── فحص دوري: المهام المنتهية (كل ساعة) ─────────────────────────────────────
// checkExpiredTasks كان معطّلاً تماماً — لا أحد يستدعيه، ومهام الفويس
// والأسبوعية كانت تنتهي بصمت بدون إشعار
const HOUR_MS = 60 * 60 * 1000;

const taskCheckTimer = setInterval(async () => {
  for (const guild of client.guilds.cache.values()) {
    try {
      await checkExpiredTasks(guild);

      // تنظيف دوري — يمنع نمو reviews.json بلا حد
      const removed = pruneReviews(guild.id);
      if (removed) {
        console.log(`🧹 أُرشف ${removed} طلب قديم في ${guild.name}`);
      }
    } catch (err) {
      console.error(`❌ خطأ في الفحص الدوري (${guild.id}):`, err.message);
    }
  }
}, HOUR_MS);

// لا تمنع الـ timer من إيقاف عملية Node إذا لم يبقَ شيء آخر
taskCheckTimer.unref?.();

// ─── معالجة الأخطاء غير المتوقعة ─────────────────────────────────────────────
process.on("unhandledRejection", (err) => {
  // نتوقّع كثيراً من هذه (صلاحيات مفقودة، رسائل محذوفة) — نسجّل ونكمل
  console.error("❌ unhandledRejection:", err);
});

process.on("uncaughtException", (err) => {
  // استثناء غير متزامن خارج أي try/catch = البوت في حالة غير متوقّعة.
  // المتابعة كانت تُبقي البوت يعمل بحالة تالفة بصمت — الأفضل
  // تسجيل الخطأ ثم الخروج ليُعيد المشرف (PM2 / systemd / Docker) تشغيله نظيفاً.
  console.error("❌ uncaughtException:", err);
  console.error("⏹ سيتم إيقاف البوت. سيُعاد تشغيله تلقائياً إن كنت تستخدم مشرف عمليات.");

  client.destroy();
  process.exit(1);
});

// ─── إيقاف نظيف عند Ctrl+C أو إشارة الإيقاف ──────────────────────────────────
async function shutdown(signal) {
  console.log(`\n🛑 استلام ${signal} — جاري إيقاف البوت...`);

  clearInterval(taskCheckTimer);

  try {
    client.destroy();
    console.log("✅ تم قطع الاتصال بديسكورد.");
  } catch {
    // تجاهل
  }

  process.exit(0);
}

process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ─── تسجيل الدخول ────────────────────────────────────────────────────────────
await client.login(token);
