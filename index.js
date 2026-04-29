const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('./database');

// ── SERVER ──────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Explicit panel route
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'panel.html')));
app.get('/panel', (req, res) => res.sendFile(path.join(__dirname, 'public', 'panel.html')));
app.get('/api/data', (req, res) => res.json(db.getDataForDate(req.query.date || db.getSessionDate())));
app.get('/api/rejected', (req, res) => res.json(db.getRejected(req.query.date || db.getSessionDate())));
app.post('/api/reset', (req, res) => { db.resetDate(req.query.date || db.getSessionDate(), req.query.group || null); res.json({ ok: true }); });

// QR code page — Railway pe scan karne ke liye
let currentQR = null;
app.get('/qr', (req, res) => {
  if (!currentQR) {
    res.send(`<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:50px">
      <h2>✅ WhatsApp Already Connected!</h2>
      <p>Bot chal raha hai.</p>
    </body></html>`);
  } else {
    res.send(`<html><head><title>QR Scan</title></head>
    <body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:30px">
      <h2>📱 WhatsApp QR Scan Karo</h2>
      <p>WhatsApp → Linked Devices → Link a Device</p>
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(currentQR)}" 
           style="margin:20px auto;display:block;border:4px solid #fff;border-radius:10px">
      <p style="color:#aaa;font-size:13px">Page refresh karo agar QR expire ho jaye</p>
      <script>setTimeout(()=>location.reload(), 30000);</script>
    </body></html>`);
  }
});

app.listen(3000, () => console.log('🌐 Panel: http://localhost:3000/panel.html | QR: http://localhost:3000/qr'));

// ── GROUP IDs ───────────────────────────────────────────────────────────────
const GROUPS = {
  DAY:   '120363403626551391@g.us',
  NIGHT: '120363419264594279@g.us',
  TEST:  '120363408105704264@g.us',
};

// ── STICKER HASH → STEP MAP ─────────────────────────────────────────────────
const STICKER_STEP_MAP = {
  '8b0d908617115e1a': 1,
  'afa127f1b24ef210': 2,
  '23037cdea033000b': 3,
  '50d9712b47e5e00b': 4,
  'e6d695c5a23d9290': 5,
};

// ── MARKETS ─────────────────────────────────────────────────────────────────
const MARKETS = {
  'kalyan night':'KALYAN NIGHT','kalyan':'KALYAN','kalyaan':'KALYAN',
  'klyan':'KALYAN','klyn':'KALYAN','kalayan':'KALYAN',
  '\u0915\u0932\u094d\u092f\u093e\u0923':'KALYAN',
  'milan day':'MILAN DAY','milan night':'MILAN NIGHT',
  'milanday':'MILAN DAY','milannight':'MILAN NIGHT',
  'milan':'MILAN','miln':'MILAN','\u092e\u093f\u0932\u0928':'MILAN',
  'sridevi':'SRIDEVI','shridevi':'SRIDEVI','shri devi':'SRIDEVI',
  'shiridevi':'SRIDEVI','sri devi':'SRIDEVI','srdevi':'SRIDEVI',
  'shreedevi':'SRIDEVI','sridev':'SRIDEVI',
  '\u0936\u094d\u0930\u0940\u0926\u0947\u0935\u0940':'SRIDEVI',
  'rajdhani day':'RAJDHANI DAY','rajdhani night':'RAJDHANI NIGHT',
  'rajdhani':'RAJDHANI','rajdani':'RAJDHANI',
  'time bazar':'TIME BAZAR','timebazar':'TIME BAZAR','time':'TIME BAZAR',
  'main bazar':'MAIN BAZAR','mainbazar':'MAIN BAZAR','main':'MAIN BAZAR',
  'madhur day':'MADHUR DAY','madhur night':'MADHUR NIGHT','madhur':'MADHUR',
  'supreme day':'SUPREME DAY','supreme night':'SUPREME NIGHT','supreme':'SUPREME',
  'mahalaxmi':'MAHALAXMI',
};

function detectMarket(line) {
  const l = line.toLowerCase().trim();
  const sorted = Object.entries(MARKETS).sort((a,b) => b[0].length - a[0].length);
  for (const [alias, name] of sorted) {
    if (l.includes(alias)) return name;
  }
  return null;
}

// ── TOTAL EXTRACTOR ─────────────────────────────────────────────────────────
// Handles ALL formats seen in screenshots:
//   T500  T.500  T-500  T 500  T...500  T,,500  T___500  T500rs  T6600rs
//   Tl500  Ttl500  To500  To.1800  To 50  TO 50
//   Total500  Total600  Total:160  Total...790  Total,rs
//   total amount 600  T,,, 200₹
//   ======120  =========120
//   kul 500  कुल 500
function extractTotal(line) {
  const l = line.trim();

  // ===== style
  if (/^={3,}/.test(l)) {
    const m = l.match(/(\d+)\s*(?:rs|₹)?\s*$/i);
    return m ? parseInt(m[1]) : null;
  }

  // Separator: ANY non-digit chars between keyword and number
  // This covers: dots, dashes, commas, spaces, underscores, colons, ₹, rs, em-dash
  const ANY = '[^\\d]*';

  const patterns = [
    // "total amount" first (longer match)
    /total\s*amount[^\d]*(\d+)/i,
    // "total" anywhere
    /total[^\d]*(\d+)/i,
    // Hindi
    /(?:कुल्ल?|kul)[^\d]*(\d+)/i,
    // ttl, tl, to, t — word boundary on left, any separator, then number
    /\bttl[^\d]*(\d+)/i,
    /\btl[^\d]*(\d+)/i,
    /\bto[^\d]*(\d+)/i,   // "To 50", "To.1800", "TO 50"
    /(?:^|[\s:])t[^\d]*(\d+)/i,  // "T500", "T.500", "T,,,200"
  ];

  for (const pat of patterns) {
    // Use global to get LAST (rightmost) match — for "all 50rs Total 150rs"
    const gPat = new RegExp(pat.source, 'gi');
    let lastVal = null, m;
    while ((m = gPat.exec(l)) !== null) {
      const v = parseInt(m[1]);
      if (!isNaN(v) && v > 0) lastVal = v;
    }
    if (lastVal !== null) return lastVal;
  }

  return null;
}

function isTotalLine(line) {
  const l = line.trim();
  if (/^={3,}/.test(l) && /\d/.test(l)) return true;
  return extractTotal(l) !== null;
}

function getSession(line) {
  return /close/i.test(line) ? 'CLOSE' : 'OPEN';
}

// ── MESSAGE PARSER ──────────────────────────────────────────────────────────
function parseMessage(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let market = null, session = 'OPEN', declaredTotal = null;

  for (const line of lines) {
    const tot = extractTotal(line);
    if (tot !== null) { declaredTotal = tot; continue; }
    const mkt = detectMarket(line);
    if (mkt) { market = mkt; session = getSession(line); continue; }
    if (/open|close/i.test(line) && !/\d/.test(line)) session = getSession(line);
  }

  return { market, session, declaredTotal };
}

// ── WHATSAPP CLIENT ──────────────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] }
});

let currentStep = 1;

client.on('qr', qr => {
  currentQR = qr;
  console.log('\n📱 QR scan karo — browser mein kholo: /qr\n');
  qrcode.generate(qr, { small: true });
});
client.on('authenticated', () => { currentQR = null; });
client.on('ready', () => {
  console.log(`\n✅ Bot LIVE!\n📅 DAY:   ${GROUPS.DAY}\n🌙 NIGHT: ${GROUPS.NIGHT}\n`);
  scheduleReset();
});

client.on('message', async (msg) => {
  try {
    const chat = await msg.getChat();
    const gid = chat.id._serialized;

    // Group ID logger — sabhi groups print karo
    if (chat.isGroup) {
      console.log(`📋 Group: "${chat.name}" | ID: ${gid}`);
    }

    // Only our groups
    const session_type = gid === GROUPS.DAY ? 'DAY' : gid === GROUPS.NIGHT ? 'NIGHT' : gid === GROUPS.TEST ? 'DAY' : null;
    if (!session_type) return;

    // ── STICKER = Step switch ───────────────────────────────────────────
    if (msg.type === 'sticker') {
      try {
        const media = await msg.downloadMedia();
        if (media && media.data) {
          const hash = crypto.createHash('sha256').update(media.data).digest('hex').slice(0, 16);
          console.log(`🎴 Hash: ${hash}`);
          if (STICKER_STEP_MAP[hash]) {
            const closedStep = STICKER_STEP_MAP[hash];
            currentStep = closedStep + 1;
            console.log(`📌 Step ${closedStep} CLOSED → Step ${currentStep} STARTED`);
          }
        }
      } catch(e) { console.log('Sticker err:', e.message); }
      return;
    }

    if (msg.type === 'image' || msg.type === 'video') return;

    if (msg.type !== 'chat') return;
    const text = msg.body.trim();
    if (!text) return;

    // ── STEP COMMAND: /s1 /s2 /s3 /s4 /s5 ───────────────────────────
    // /s1 = Step 1 band, Step 2 shuru
    const stepCmd = text.match(/^\/s([1-5])$/i);
    if (stepCmd) {
      const closedStep = parseInt(stepCmd[1]);
      currentStep = closedStep + 1;
      console.log(`📌 /s${closedStep} → Step ${closedStep} CLOSED, Step ${currentStep} STARTED`);
      return;
    }

    // ── CANCEL: ❌ + quoted msg ────────────────────────────────────────
    if (/❌/.test(text) && msg.hasQuotedMsg) {
      const quotedMsg = await msg.getQuotedMessage();
      const quotedResult = parseMessage(quotedMsg.body || '');
      if (quotedResult.declaredTotal) {
        db.cancelEntry({
          step: currentStep,
          market: quotedResult.market || 'UNKNOWN',
          session: quotedResult.session,
          group: session_type,
          total: -quotedResult.declaredTotal,
          cancelled: true,
          rawMessage: quotedMsg.body || '',
          timestamp: new Date().toISOString(),
          date: db.getSessionDate(),
        });
        console.log(`🚫 CANCELLED | ${quotedResult.market||'?'} | -₹${quotedResult.declaredTotal}`);
      }
      return;
    }

    // ── NORMAL MESSAGE ─────────────────────────────────────────────────
    const result = parseMessage(text);

    if (!result.declaredTotal) {
      // REJECTED — total detect nahi hua
      db.saveRejected({
        rawMessage: text,
        group: session_type,
        timestamp: new Date().toISOString(),
        date: db.getSessionDate(),
      });
      console.log(`⚠️  REJECTED | ${session_type} | "${text.slice(0,50)}"`);
      return;
    }

    db.saveEntry({
      step: currentStep,
      market: result.market || 'UNKNOWN',
      session: result.session,
      group: session_type,
      total: result.declaredTotal,
      cancelled: false,
      rawMessage: text,
      timestamp: new Date().toISOString(),
      date: db.getSessionDate(),
    });

    console.log(`✅ Step:${currentStep} | ${session_type} | ${result.market||'?'} | ${result.session} | ₹${result.declaredTotal}`);

  } catch (err) { console.error('❌ Error:', err.message); }
});

function scheduleReset() {
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 1 && now.getMinutes() === 30) {
      currentStep = 1;
      console.log('🔄 1:30 AM reset');
    }
  }, 60000);
}

client.initialize();
