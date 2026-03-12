require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const BACKEND_URL = process.env.BACKEND_URL || 'https://backend-production-6de74.up.railway.app';
const BOT_CONTROL_TOKEN = process.env.BOT_CONTROL_TOKEN || '';
const BOT_LINK_TOKEN = process.env.BOT_LINK_TOKEN || '';
const PORT = process.env.PORT || 8080;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is not set. Please configure it in .env');
  process.exit(1);
}

console.log('Starting Telegram bot with polling...');
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Simple state: user chat -> waiting for phone
const linkingState = new Map();

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  await bot.sendMessage(
    chatId,
    'Assalomu alaykum! Bu MessenjrAli hisobingiz uchun xavfsiz Telegram bot.\n\n' +
      'Hisobingizni bog‘lash uchun telefon raqamingizni xalqaro formatda yuboring, masalan:\n' +
      '+998901234567'
  );

  linkingState.set(chatId, { step: 'awaiting_phone' });
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || '';

  const state = linkingState.get(chatId);
  if (!state || state.step !== 'awaiting_phone') {
    // ignore other messages for now
    return;
  }

  const trimmed = text.trim();
  const phone = trimmed.replace(/\s+/g, '');

  if (!phone.startsWith('+') || phone.length < 10) {
    await bot.sendMessage(chatId, 'Iltimos, telefon raqamingizni to‘liq xalqaro formatda yuboring. Masalan: +998901234567');
    return;
  }

  try {
    if (!BOT_LINK_TOKEN) {
      console.warn('BOT_LINK_TOKEN is not set. Link requests may be rejected by backend.');
    }

    await axios.post(
      `${BACKEND_URL}/api/auth/link-telegram`,
      {
        phone,
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

