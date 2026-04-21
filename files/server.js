const express = require("express");
const path    = require("path");
const app     = express();

// زيادة الحد للسماح بالصور الكبيرة لرفع الإثباتات
app.use(express.json({ limit: '10mb' })); 

// إخبار السيرفر بمكان ملفات الواجهة (index.html و bg.jpg)
app.use(express.static(path.join(__dirname, "public"))); 

/* ════════════ الإعدادات ════════════ */
const CONFIG = {
  telegramBotToken: "8709026102:AAGi8aDydKYRFR0d8g-Hk2lMRCnmSIQUemI", // توكن البوت الخاص بك
  telegramGroupId:  "-1003704558008", // ID المجموعة
  openRouterKey:    "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", // مفتاح OpenRouter
  adminPassword: "admin", 

  brothers: [
    { name: "عبدالملك", password: "aa1234", chatId: "HIS_CHAT_ID" }, 
    { name: "اياد", password: "ee123", chatId: "HIS_CHAT_ID" }, 
  ],

  limitMinutes: 120, 
  cooldownHours: 2,  
};

// تمت إضافة uploadTries لكل لاعب
const playerStates = {};
CONFIG.brothers.forEach((b, i) => {
  playerStates[i] = { status: 'idle', endTime: 0, cooldownUntil: 0, wallet: 0, uploadTries: 3 };
});
/* ════════════════════════════════════════════ */

async function sendTelegramText(text) {
  const url = `https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`;
  await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CONFIG.telegramGroupId, text: text }),
  }).catch(console.error);
}

function updatePlayerState(idx) {
  const state = playerStates[idx];
  const brother = CONFIG.brothers[idx];
  
  if (state.status === 'playing' && Date.now() >= state.endTime) {
    state.status = 'cooldown';
    state.cooldownUntil = Date.now() + (CONFIG.cooldownHours * 3600 * 1000);
    sendTelegramText(`🚨 انتهى وقت ${brother.name} ودخل في فترة حظر لمدة ساعتين`);
  }
  
  // تجديد المحاولات عند انتهاء الحظر
  if (state.status === 'cooldown' && Date.now() >= state.cooldownUntil) {
    state.status = 'idle';
    state.uploadTries = 3; 
  }
}

function getOccupiedStatus() {
  for (let i = 0; i < CONFIG.brothers.length; i++) {
    updatePlayerState(i);
    if (playerStates[i].status === 'playing') {
      return { isOccupied: true, occupiedBy: CONFIG.brothers[i].name };
    }
  }
  return { isOccupied: false, occupiedBy: null };
}

app.post("/api/login", (req, res) => {
  const { password } = req.body;
  if (password === CONFIG.adminPassword) return res.json({ ok: true, isAdmin: true });

  const idx = CONFIG.brothers.findIndex(b => b.password === password);
  if (idx === -1) return res.json({ ok: false });
  
  res.json({ ok: true, isAdmin: false, index: idx, name: CONFIG.brothers[idx].name });
});

app.get("/api/status/:idx", (req, res) => {
  const idx = req.params.idx;
  if (!playerStates[idx]) return res.json({ ok: false });
  updatePlayerState(idx);
  res.json({ ok: true, state: playerStates[idx], global: getOccupiedStatus() });
});

app.post("/api/action", async (req, res) => {
  const { idx, action, useWallet } = req.body;
  const state = playerStates[idx];
  const brother = CONFIG.brothers[idx];
  if (!state) return res.json({ ok: false });

  if (action === 'start') {
    const globalStatus = getOccupiedStatus();
    if (globalStatus.isOccupied && globalStatus.occupiedBy !== brother.name) {
      return res.json({ ok: false, error: "الجهاز مشغول" });
    }

    let mins = CONFIG.limitMinutes;
    if (useWallet) { mins = state.wallet; state.wallet = 0; }
    state.status = 'playing';
    state.endTime = Date.now() + (mins * 60 * 1000);
    await sendTelegramText(`🎮 ${brother.name} بدأ اللعب (${useWallet ? 'من المحفظة' : 'أساسي'}).`);
  } 
  else if (action === 'stop') {
    state.status = 'cooldown';
    state.cooldownUntil = Date.now() + (CONFIG.cooldownHours * 3600 * 1000);
    await sendTelegramText(`🛑 ${brother.name} أنهى اللعب مبكراً ودخل الحظر`);
  }
  res.json({ ok: true });
});

// استقبال الصورة والتحقق من المحاولات
app.post("/api/proof", async (req, res) => {
  const { brotherIndex, image } = req.body;
  const brother = CONFIG.brothers[brotherIndex];
  const state = playerStates[brotherIndex];
  
  if (!brother || !image) return res.json({ ok: false });
  
  // التحقق من المحاولات المتبقية
  if (state.uploadTries <= 0) {
    return res.json({ ok: false, error: 'لقد استنفدت جميع محاولاتك (3/3)' });
  }
  
  state.uploadTries -= 1; // خصم محاولة
  let approved = false;

  try {
    const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${CONFIG.openRouterKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: [
          { type: "text", text: "أنت نظام تدقيق آلي صارم. هذه الصورة يجب أن تكون لقطة شاشة (Screenshot) حقيقية لتطبيق تتبع رياضي أو صحي (مثل Apple Fitness, Samsung Health, Strava). ابحث في الصورة عن وقت النشاط (مشي أو جري) وتأكد أن المدة تتراوح بين 15 دقيقة و 30 دقيقة. إذا كانت الصورة صحيحة والمدة تقع بالضبط في هذا النطاق (من 15 إلى 30)، أجب بكلمة 'نعم' فقط. أما إذا كانت الصورة عشوائية، أو كانت المدة أقل من 15 دقيقة، أو أكثر من 30 دقيقة، أو كانت تبدو مزيفة، أجب بكلمة 'لا' فقط" },
          { type: "image_url", image_url: { url: image } }
        ]}]
      })
    });
    const orData = await orRes.json();
    if (orData.choices[0].message.content.includes("نعم") || orData.choices[0].message.content.includes("Yes")) {
      approved = true;
      state.wallet += 120;
    }
  } catch (e) {}

  try {
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
    const blob = new Blob([Buffer.from(base64Data, 'base64')], { type: 'image/jpeg' });
    const formData = new FormData();
    formData.append('chat_id', CONFIG.telegramGroupId);
    formData.append('photo', blob, 'proof.jpg');
    formData.append('caption', `🏃 إثبات نشاط: ${brother.name}\n🤖 قرار الذكاء الاصطناعي: ${approved ? '✅ مقبول (+ساعتين)' : '❌ مرفوض'}\n🔄 المحاولات المتبقية: ${state.uploadTries}`);
    await fetch(`https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendPhoto`, { method: 'POST', body: formData });
  } catch (e) {}

  res.json({ ok: true, approved, triesLeft: state.uploadTries });
});

// Admin API
app.get("/api/admin/users", (req, res) => {
  const users = CONFIG.brothers.map((b, i) => {
    updatePlayerState(i);
    return { index: i, name: b.name, state: playerStates[i] };
  });
  res.json({ ok: true, users });
});

app.post("/api/admin/action", async (req, res) => {
  const { idx, action } = req.body;
  const state = playerStates[idx];
  const brother = CONFIG.brothers[idx];

  if (action === 'add_time') {
    if (state.status === 'playing') state.endTime += 10 * 60 * 1000;
  } 
  else if (action === 'end_time') {
    state.status = 'cooldown';
    state.cooldownUntil = Date.now() + (CONFIG.cooldownHours * 3600 * 1000);
    await sendTelegramText(`⚠️ الإدارة أنهت جلسة ${brother.name}`);
  } 
  else if (action === 'ban_1h') {
    state.status = 'cooldown';
    state.cooldownUntil = Date.now() + (3600 * 1000);
    await sendTelegramText(`⛔ الإدارة حظرت ${brother.name} لساعة`);
  } 
  else if (action === 'unban') {
    state.status = 'idle';
    state.cooldownUntil = 0;
    state.uploadTries = 3; // تصفير المحاولات عند فك الحظر
    await sendTelegramText(`✅ الإدارة فكت الحظر وصفرت المحاولات عن ${brother.name}`);
  }
  res.json({ ok: true });
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
