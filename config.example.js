// config.example.js
// ─────────────────────────────────────────────────────────────────────────────
// ملف الإعدادات النموذجي
//
// طريقة الاستخدام:
//   1. انسخ هذا الملف باسم config.js:
//        cp config.example.js config.js
//   2. ضع التوكن ومعرّف التطبيق داخل config.js
//   3. لا ترفع config.js إلى Git أبداً (موجود في .gitignore)
//
// أو استخدم متغيّرات البيئة بدلاً من الملف (مفيد للاستضافة السحابية):
//   export DISCORD_TOKEN='...'
//   export DISCORD_CLIENT_ID='...'
// ─────────────────────────────────────────────────────────────────────────────

export default {
  // توكن البوت — من Discord Developer Portal → Bot → Reset Token
  token: "ضع_توكن_البوت_هنا",

  // معرّف التطبيق — من General Information → Application ID
  // مطلوب فقط لتسجيل الأوامر (npm run deploy)
  clientId: "ضع_client_id_هنا",
};
