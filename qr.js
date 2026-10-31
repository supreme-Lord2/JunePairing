const { makeid } = require('./id');
const QRCode = require('qrcode');
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

router.get('/', async (_req, res) => {
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
    socket.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
      if (qr && !res.headersSent) {
        try {
          const png = await QRCode.toBuffer(qr, { type: 'png', margin: 2, width: 480 });
          res.status(200)
            .type('png')
            .set({ 'Cache-Control': 'no-store, private, max-age=0', Pragma: 'no-cache' })
            .send(png);
        } catch (error) {
          console.error('[qr] QR rendering failed:', error);
          if (!res.headersSent) res.status(500).json({ code: 'QR rendering failed' });
        }
      }

      if (connection === 'open') {
        try {
          await new Promise(resolve => setTimeout(resolve, 2500));
          const credsFile = path.join(authPath, 'creds.json');
          if (!fs.existsSync(credsFile)) throw new Error('WhatsApp credentials were not saved');
          const session = Buffer.from(fs.readFileSync(credsFile)).toString('base64');
          const sent = await socket.sendMessage(socket.user.id, { text: `June-X:-${session}` });
          await socket.sendMessage(socket.user.id, {
            text: '✅ Session connected successfully\n⚙️ Type: Base64\nstatus: 🟢 online',
          }, { quoted: sent });
        } catch (error) {
          console.error('[qr] session delivery failed:', error.message);
        } finally {
          setTimeout(() => {
            socket.ws?.close();
            removeSession(id);
          }, 100);
        }
      } else if (connection === 'close' && disconnectStatus(lastDisconnect?.error) === DisconnectReason.loggedOut) {
        removeSession(id);
      }
    });
  } catch (error) {
    console.error('[qr] QR generation failed:', error);
    removeSession(id);
    if (!res.headersSent) res.status(503).json({ code: 'Service is Currently Unavailable' });
  }
});

module.exports = router;
