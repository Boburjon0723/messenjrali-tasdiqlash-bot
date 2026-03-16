require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const BACKEND_URL = process.env.BACKEND_URL || 'https://backend-production-6de74.up.railway.app';
const BOT_CONTROL_TOKEN = process.env.BOT_CONTROL_TOKEN || '';
const BOT_LINK_TOKEN = process.env.BOT_LINK_TOKEN || '';
// Backend BotModel token (Authorization: Bot <token> uchun)
const BOT_API_TOKEN = process.env.BOT_API_TOKEN || '';
const PORT = process.env.PORT || 8080;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is not set. Please configure it in .env');
  process.exit(1);
}

console.log('Starting Telegram bot with polling...');
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Simple state: user chat -> waiting for link code
const linkingState = new Map();

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  await bot.sendMessage(
    chatId,
    'Assalomu alaykum! Bu MessenjrAli hisobingiz uchun xavfsiz Telegram bot.\n\n' +
      '1) Hisobingizni bog‘lash:\n' +
      '   - MessenjrAli ilovasidagi profil sozlamalaridan maxsus bog‘lash kodini oling.\n' +
      '   - So‘ng shu kodni shu yerga yuboring (masalan: ABC123).\n\n' +
      '2) Telefon raqamni yuborish:\n' +
      '   - /phone buyrug‘ini bosing, keyin “📱 Raqamimni yuborish” tugmasi orqali raqamingizni ulashing.'
  );

  linkingState.set(chatId, { step: 'awaiting_code' });
});

// Telefon raqamini tugma orqali yuborish oqimi
bot.onText(/\/phone/, async (msg) => {
  const chatId = msg.chat.id;

  await bot.sendMessage(
    chatId,
    'Telefon raqamingizni tizimga yuborish uchun pastdagi tugmani bosing:',
    {
      reply_markup: {
        keyboard: [
          [
            {
              text: '📱 Raqamimni yuborish',
              request_contact: true,
            },
          ],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    }
  );
});

// Foydalanuvchi kontakt yuborganda, backend ga telefonni uzatish
bot.on('contact', async (msg) => {
  const contact = msg.contact;
  if (!contact || !contact.phone_number) {
    return;
  }

  if (!BOT_API_TOKEN) {
    console.warn('BOT_API_TOKEN is not set. /api/bot/update-phone chaqirig‘i autentifikatsiyadan o‘tmasligi mumkin.');
  }

  const chatId = msg.chat.id;
  const phone = contact.phone_number;

  try {
    await axios.post(
      `${BACKEND_URL}/api/bot/update-phone`,
      { chatId, phone },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: BOT_API_TOKEN ? `Bot ${BOT_API_TOKEN}` : undefined,
        },
      }
    );

    await bot.sendMessage(
      chatId,
      `Telefon raqamingiz (${phone}) tizimda yangilandi ✅`,
      { reply_markup: { remove_keyboard: true } }
    );
  } catch (err) {
    console.error('Failed to update phone via backend:', err?.response?.data || err.message || err);
    await bot.sendMessage(
      chatId,
      'Telefon raqamini yangilashda xatolik yuz berdi. Iltimos, keyinroq yana urinib ko‘ring.'
    );
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || '';

  const state = linkingState.get(chatId);
  if (!state || state.step !== 'awaiting_code') {
    // ignore other messages for now
    return;
  }

  const trimmed = text.trim().toUpperCase();
  const code = trimmed.replace(/\s+/g, '');

  if (code.length < 4 || code.length > 16) {
    await bot.sendMessage(chatId, 'Iltimos, MessenjrAli ilovasidagi profil bo‘limidan olingan bog‘lash kodini yuboring (masalan: ABC123).');
    return;
  }

  try {
    if (!BOT_LINK_TOKEN) {
      console.warn('BOT_LINK_TOKEN is not set. Link requests may be rejected by backend.');
    }

    await axios.post(
      `${BACKEND_URL}/api/auth/link-telegram`,
      {
        linkCode: code,
        chatId,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-bot-link-token': BOT_LINK_TOKEN,
        },
      }
    );

    await bot.sendMessage(
      chatId,
      'Telegram akkauntingiz MessenjrAli hisobingiz bilan muvaffaqiyatli bog‘landi.\n' +
        'Endi parolni unutganingizda tasdiqlash kodlari aynan shu bot orqali yuboriladi.'
    );
    linkingState.delete(chatId);
  } catch (err) {
    console.error('Failed to link telegram account:', err?.response?.data || err.message || err);
    await bot.sendMessage(
      chatId,
      'Bog‘lashda xatolik yuz berdi. Iltimos, telefon raqamingiz to‘g‘riligini tekshiring yoki keyinroq yana urinib ko‘ring.'
    );
  }
});

// Simple HTTP server for backend -> bot integration (send reset code)
const app = express();
app.use(express.json());

app.post('/internal/send-reset-code', async (req, res) => {
  try {
    const controlHeader = req.headers['x-bot-control-token'];
    if (!BOT_CONTROL_TOKEN || controlHeader !== BOT_CONTROL_TOKEN) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const { chatId, code } = req.body || {};

    if (!chatId || !code) {
      return res.status(400).json({ message: 'chatId and code are required' });
    }

    await bot.sendMessage(
      chatId,
      `MessenjrAli parolni tiklash kodi: ${code}\n\n` +
        'Bu kodni hech kimga bermang. Saytdagi tasdiqlash formaga shu kodni kiriting.'
    );

    return res.json({ success: true });
  } catch (err) {
    console.error('Failed to send reset code via bot:', err?.message || err);
    return res.status(500).json({ message: 'Failed to send reset code' });
  }
});

app.get('/', (_req, res) => {
  res.json({ ok: true, status: 'bot-running' });
});

app.listen(PORT, () => {
  console.log(`Bot HTTP control server listening on port ${PORT}`);
});

