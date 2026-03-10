// src/deploy.js
// ─────────────────────────────────────────────────────────────────────────────
// يُسجّل جميع الـ Slash Commands في Discord API
// شغّله مرة واحدة بعد أي تعديل على الأوامر:  npm run deploy
// ─────────────────────────────────────────────────────────────────────────────

import { REST, Routes } from "discord.js";

// ─── استيراد data كل أمر ─────────────────────────────────────────────────────
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
    throw new Error("التوكن غير صالح — عدّل config.js أولاً");
  }
  if (!clientId || clientId === "ضع_client_id_هنا") {
    throw new Error("الـ clientId غير صالح — عدّل config.js أولاً");
  }
} catch (err) {
  console.error("─────────────────────────────────────────");
  console.error("❌ خطأ في config.js:", err.message);
  console.error("📋 الحل: انسخ config.example.js إلى config.js وعدّل القيم");
  console.error("─────────────────────────────────────────");
  process.exit(1);
}

// ─── تجميع الـ data ───────────────────────────────────────────────────────────
// كل أمر يجب أن يُحوَّل إلى JSON خام قبل الإرسال لـ Discord API
const commandsData = [
  // نقاط
  addCmd.data,
  removeCmd.data,
  pointsCmd.data,
  topCmd.data,
  resetCmd.data,

  // ترقيات
  rankCmd.data,
  promoteCmd.data,

  // موديريشن
  moderationCmd.warnData,       // warn
  moderationCmd.timeoutData,    // timeout
  appealCmd.data,
  memblogCmd.data,

  // مهام
  mytasksCmd.data,
  taskCmd.data,

  // إعدادات ومساعدة
  setupCmd.data,
  helpCmd.data,
].map((cmd) => {
  // تحقق أن الـ data صالح
  if (!cmd || typeof cmd.toJSON !== "function") {
    console.error("❌ أمر بدون toJSON:", cmd);
    return null;
  }
  return cmd.toJSON();
}).filter(Boolean); // احذف أي null

// ─── إرسال الأوامر لـ Discord API ────────────────────────────────────────────
const rest = new REST({ version: "10" }).setToken(token);

console.log("─────────────────────────────────────────");
console.log(`⏳ جاري تسجيل ${commandsData.length} أمر...`);

try {
  // PUT → يستبدل كل الأوامر الموجودة بالقائمة الجديدة
  // استخدم Routes.applicationCommands للأوامر العالمية (تظهر في كل السيرفرات)
  // استخدم Routes.applicationGuildCommands لأمر سيرفر محدد (أسرع في التحديث)
  const data = await rest.put(
    Routes.applicationCommands(clientId),
    { body: commandsData },
  );

  console.log(`✅ تم تسجيل ${data.length} أمر بنجاح!`);
  console.log("─────────────────────────────────────────");
  console.log("📋 الأوامر المسجّلة:");
  data.forEach((cmd, i) => {
    console.log(`   ${i + 1}. /${cmd.name}`);
  });
  console.log("─────────────────────────────────────────");
  console.log("⚡ ملاحظة: الأوامر العالمية تستغرق حتى ساعة للظهور.");
  console.log("   للاختبار السريع استخدم applicationGuildCommands مع Guild ID.");
  console.log("─────────────────────────────────────────");

} catch (err) {
  console.error("─────────────────────────────────────────");
  console.error("❌ فشل تسجيل الأوامر:");

  // أخطاء شائعة وحلولها
  if (err.code === 50035) {
    console.error("   السبب: خطأ في بناء أحد الأوامر (Invalid Form Body)");
    console.error("   الحل:  تحقق من options وأنواع البيانات في الأمر المشكل");
  } else if (err.status === 401) {
    console.error("   السبب: التوكن غير صحيح أو منتهي");
    console.error("   الحل:  أعد نسخ التوكن من Developer Portal");
  } else if (err.status === 429) {
    console.error("   السبب: Rate Limit — كثرة الطلبات");
    console.error("   الحل:  انتظر دقيقة وأعد المحاولة");
  } else {
    console.error("   الخطأ:", err.message);
  }

  console.error("─────────────────────────────────────────");
  process.exit(1);
}
