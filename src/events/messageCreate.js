// src/events/messageCreate.js
// ─────────────────────────────────────────────────────────────────────────────
// يُستدعى عند كل رسالة جديدة في السيرفر
// المهام:
//   1. يُعطي XP للمشرف إن استوفى الشروط
//   2. يُحدّث تقدم مهام نوع "messages"
// ─────────────────────────────────────────────────────────────────────────────

import { handleXp }                from "../systems/xp.js";
import { incrementTaskProgress }   from "../systems/tasks.js";

/**
 * @param {Message} message - رسالة ديسكورد الكاملة
 */
export async function handleMessageCreate(message) {

  // ─── تصفية مبكرة ────────────────────────────────────────────────────────────
  // تجاهل البوتات
  if (message.author.bot) return;

  // تجاهل الرسائل خارج السيرفرات (DMs)
  if (!message.guild) return;

  // تجاهل الرسائل بدون عضو (نادر لكن ممكن)
  if (!message.member) return;

  // ─── 1. نظام XP ─────────────────────────────────────────────────────────────
  // handleXp يتحقق داخلياً من:
  //   - هل للعضو رتبة مشرف؟
  //   - هل انتهى الـ cooldown؟
  //   - هل تجاوز الحد اليومي؟
  await handleXp(message);

  // ─── 2. تقدم مهام الرسائل ───────────────────────────────────────────────────
  // incrementTaskProgress يتحقق داخلياً من:
  //   - هل للعضو رتبة مشرف؟
  //   - هل له مهمة نوع "messages"؟
  //   - هل انتهت فترة التجديد؟ (يُعيد التقدم للصفر)
  await incrementTaskProgress(message.guild, message.author.id, "messages", 1);

}
