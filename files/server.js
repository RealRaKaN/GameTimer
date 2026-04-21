const express = require("express");
const path    = require("path");
const app     = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, "public")));

/* ════════════ الإعدادات ════════════ */
const CONFIG = {
  telegramBotToken: "8709026102:AAGi8aDydKYRFR0d8g-Hk2lMRCnmSIQUemI", 
  telegramGroupId:  "-1003704558008", 
  openRouterKey:    "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",
  adminPassword:    "admin", // كلمة مرور الإدارة

  brothers: [
    { name: "عبدالملك", password: "aa1234", index: 0 }, 
    { name: "اياد", password: "ee123", index: 1 }, 
  ],

  limitMinutes: 120, // ساعتان الوقت الأصلي
  cooldownHours: 2,  // حظر إجباري ساعتان للراحة
};

const playerStates = {};
CONFIG.brothers.forEach((b, i) => {
  playerStates[i] = { 
    status: 'idle', 
    endTime: 0, 
    cooldownUntil: 0, 
    wallet: 0, 
    uploadTries: 3 
  };
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
  if (state.status === 'playing' && Date.now() >= state.endTime) {
    state.status = 'cooldown';
    state.cooldownUntil = Date.now() + (CONFIG.cooldownHours * 3600 * 1000);
    sendTelegramText(`🚨 انتهى وقت ${CONFIG.brothers[idx].name} ودخل في فترة حظر إجبارية للراحة.`);
  }
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

// API تسجيل الدخول
app.post("/api/login", (req, res) => {
  const { password } = req.body;
  if (password === CONFIG.adminPassword) {
    return res.json({ ok: true, isAdmin: true }); // دخول المسؤول
  }
  const idx = CONFIG.brothers.findIndex(b => b.password === password);
  if (idx === -1) return res.json({ ok: false });
  res.json({ ok: true, isAdmin: false, index: idx, name: CONFIG.brothers[idx].name });
});

// حالة اللاعبين
app.get("/api/status/:idx", (req, res) => {
  const idx = req.params.idx;
  if (!playerStates[idx]) return res.json({ ok: false });
  updatePlayerState(idx);
  res.json({ ok: true, state: playerStates[idx], global: getOccupiedStatus() });
});

// إجراءات اللعب
app.post("/api/action", async (req, res) => {
  const { idx, action, useWallet } = req.body;
  const state = playerStates[idx];
  if (action === 'start') {
    const globalStatus = getOccupiedStatus();
    if (globalStatus.isOccupied && globalStatus.occupiedBy !== CONFIG.brothers[idx].name) {
      return res.json({ ok: false, error: "الجهاز مشغول" });
    }
    let mins = CONFIG.limitMinutes;
    if (useWallet) { mins = state.wallet; state.wallet = 0; }
    state.status = 'playing';
    state.endTime = Date.now() + (mins * 60 * 1000);
    await sendTelegramText(`🎮 ${CONFIG.brothers[idx].name} بدأ اللعب.`);
  } else if (action === 'stop') {
    state.status = 'cooldown';
    state.cooldownUntil = Date.now() + (CONFIG.cooldownHours * 3600 * 1000);
  }
  res.json({ ok: true });
});

// رفع الإثبات بالذكاء الاصطناعي
app.post("/api/proof", async (req, res) => {
  const { brotherIndex, image } = req.body;
  const state = playerStates[brotherIndex];
  if (state.uploadTries <= 0) return res.json({ ok: false, error: 'استنفدت المحاولات' });
  
  state.uploadTries -= 1;
  let approved = false;
  try {
    const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${CONFIG.openRouterKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: [
          { type: "text", text: "أنت نظام تدقيق رياضي. تأكد أن الصورة تظهر نشاط مشي بين 15 و 30 دقيقة. أجب بـ 'نعم' فقط للقبول." },
          { type: "image_url", image_url: { url: image } }
        ]}]
      })
    });
    const orData = await orRes.json();
    if (orData.choices[0].message.content.includes("نعم")) {
      approved = true;
      state.wallet += 120; // إضافة ساعتين
    }
  } catch (e) { console.error(e); }
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

app.post("/api/admin/action", (req, res) => {
  const { idx, action } = req.body;
  if (action === 'unban') {
    playerStates[idx].status = 'idle';
    playerStates[idx].cooldownUntil = 0;
  }
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`الموقع يعمل على المنفذ ${PORT}`));
