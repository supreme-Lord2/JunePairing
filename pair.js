const { makeid } = require('./id');
const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

const router = express.Router();
const TEMP_ROOT = path.join(__dirname, 'temp');
const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });

function sessionPath(id) {
  return path.join(TEMP_ROOT, id);
}

function removeSession(id) {
  fs.rmSync(sessionPath(id), { recursive: true, force: true });
}

function disconnectStatus(error) {
  return error?.output?.statusCode || error?.statusCode || error?.data?.statusCode;
}

router.get('/', async (req, res) => {
  const number = String(req.query.number || '').replace(/\D/g, '');
  if (!/^\d{11,15}$/.test(number)) {
    return res.status(400).json({ code: 'Enter a valid phone number with country code (11–15 digits).' });
  }

  const id = makeid(8);
  const authPath = sessionPath(id);

  try {
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      makeCacheableSignalKeyStore,
      Browsers,
      DisconnectReason,
    } = await import('@whiskeysockets/baileys');

    fs.mkdirSync(TEMP_ROOT, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const socket = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      browser: Browsers.macOS('Desktop'),
      printQRInTerminal: false,
      logger,
    });

    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (connection !== 'open') {
        if (connection === 'close' && disconnectStatus(lastDisconnect?.error) !== DisconnectReason.loggedOut) {
          console.error('[pairing] WhatsApp connection closed before completion');
        }
        return;
      }

      try {
        await new Promise(resolve => setTimeout(resolve, 2500));
        const credsFile = path.join(authPath, 'creds.json');
        if (!fs.existsSync(credsFile)) throw new Error('WhatsApp credentials were not saved');
        const session = Buffer.from(fs.readFileSync(credsFile)).toString('base64');
        const sent = await socket.sendMessage(socket.user.id, { text: `June-X:-${session}` });
        await socket.sendMessage(socket.user.id, {
          text: '✅ Session paired successfully\n⚙️ Type: Base64\nstatus: 🟢 online',
        }, { quoted: sent });
        if (typeof socket.newsletterFollow === 'function') {
          await socket.newsletterFollow('120363400224487887@newsletter').catch(() => {});
        }
      } catch (error) {
        console.error('[pairing] session delivery failed:', error.message);
      } finally {
        setTimeout(() => {
          socket.ws?.close();
          removeSession(id);
        }, 100);
      }
    });

    if (!state.creds.registered) {
      const code = await socket.requestPairingCode(number);
      return res.json({ code });
    }

    return res.status(409).json({ code: 'A session already exists for this request.' });
  } catch (error) {
    console.error('[pairing] pairing-code generation failed:', error);
    removeSession(id);
    if (!res.headersSent) return res.status(503).json({ code: 'Service Currently Unavailable' });
  }
});

module.exports = router;
