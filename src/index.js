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

// ─── تحميل config.js ─────────────────────────────────────────────────────────
let token, clientId;

try {
  const cfg = await import("../config.js");
  token    = cfg.default.token;
  clientId = cfg.default.clientId;

  if (!token || token === "ضع_توكن_البوت_هنا") {
    throw new Error("التوكن غير صالح");
  }
  if (!clientId || clientId === "ضع_client_id_هنا") {
    throw new Error("الـ clientId غير صالح");
  }
} catch (err) {
  console.error("─────────────────────────────────────────");
  console.error("❌ خطأ في config.js:", err.message);
  console.error("📋 الحل: انسخ config.example.js إلى config.js وعدّل القيم");
  console.error("─────────────────────────────────────────");
  process.exit(1);
}

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
      // استيراد ديناميكي لتجنب الدورة الدائرية
      const { incrementTaskProgress } = await import("./systems/tasks.js");
      await incrementTaskProgress(guild, userId, "voice", minutes).catch(() => {});
    }

    // إذا انتقل لقناة ثانية، سجّل وقت الدخول الجديد
    if (switchedChannel) {
      voiceSessions.set(key, Date.now());
    }
  }
});

// ─── معالجة الأخطاء غير المتوقعة ─────────────────────────────────────────────
process.on("unhandledRejection", (err) => {
  console.error("❌ unhandledRejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("❌ uncaughtException:", err);
  // لا نوقف البوت — نسجّل الخطأ فقط
});

// ─── تسجيل الدخول ────────────────────────────────────────────────────────────
await client.login(token);
