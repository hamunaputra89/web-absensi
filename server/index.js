const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const sqlite3 = require('sqlite3').verbose();

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DATABASE_URL || './data/attendance.db';
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;
const SERVICE_ACCOUNT_KEY_BASE64 = process.env.SERVICE_ACCOUNT_KEY_BASE64;

if (!SERVICE_ACCOUNT_KEY_BASE64) {
  console.warn('SERVICE_ACCOUNT_KEY_BASE64 not set. Drive upload disabled until configured.');
}

// Ensure folders
fs.mkdirSync(path.join(__dirname, '..', 'uploads'), { recursive: true });
fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });

// Init DB
const db = new sqlite3.Database(DB_PATH);
function initDb() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, descriptor TEXT, photo_path TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, timestamp TEXT, photo_path TEXT)`);
  });
}
initDb();

// Drive client
let drive = null;
async function getDriveClient() {
  if (!SERVICE_ACCOUNT_KEY_BASE64) return null;
  if (drive) return drive;
  const keyJson = JSON.parse(Buffer.from(SERVICE_ACCOUNT_KEY_BASE64, 'base64').toString('utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials: keyJson,
    scopes: ['https://www.googleapis.com/auth/drive']
  });
  drive = google.drive({ version: 'v3', auth });
  return drive;
}

function saveBase64Image(dataUrl, filepath) {
  const matches = dataUrl.match(/^data:(image\/(png|jpeg));base64,(.+)$/);
  if (!matches) throw new Error('Invalid image data');
  const buffer = Buffer.from(matches[3], 'base64');
  fs.writeFileSync(filepath, buffer);
}

function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

async function findBestMatch(descriptor) {
  return new Promise((resolve, reject) => {
    db.all('SELECT id, name, descriptor FROM users', [], (err, rows) => {
      if (err) return reject(err);
      let best = null;
      for (const r of rows) {
        try {
          const desc = JSON.parse(r.descriptor);
          const dist = distance(desc, descriptor);
          if (!best || dist < best.distance) {
            best = { id: r.id, name: r.name, distance: dist };
          }
        } catch (e) { /* ignore */ }
      }
      resolve(best);
    });
  });
}

async function uploadFileToDrive(localPath, name, mimeType) {
  try {
    const d = await getDriveClient();
    if (!d) return null;
    // Check if a file with same name exists in folder
    const q = `'${DRIVE_FOLDER_ID}' in parents and name = '${name.replace("'","\\'")}' and trashed = false`;
    const res = await d.files.list({ q, fields: 'files(id, name)' });
    if (res.data.files && res.data.files.length > 0) {
      const fileId = res.data.files[0].id;
      await d.files.update({ fileId, media: { mimeType, body: fs.createReadStream(localPath) } });
      return fileId;
    } else {
      const r2 = await d.files.create({
        requestBody: { name, parents: [DRIVE_FOLDER_ID] },
        media: { mimeType, body: fs.createReadStream(localPath) },
        fields: 'id'
      });
      return r2.data.id;
    }
  } catch (e) {
    console.error('Drive upload error', e.message || e);
    return null;
  }
}

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.post('/enroll', async (req, res) => {
  const { name, descriptor, photo } = req.body;
  if (!name || !descriptor) return res.status(400).json({ message: 'name and descriptor required' });
  const timestamp = Date.now();
  const photoPath = path.join(__dirname, '..', 'uploads', `enroll-${timestamp}.jpg`);
  try {
    if (photo) saveBase64Image(photo, photoPath);
  } catch (e) { console.warn('Failed to save photo', e.message); }
  db.run('INSERT INTO users (name, descriptor, photo_path) VALUES (?, ?, ?)', [name, JSON.stringify(descriptor), photoPath], function(err) {
    if (err) return res.status(500).json({ message: 'DB error' });
    res.json({ message: 'Enroll sukses', id: this.lastID });
  });
});

app.post('/checkin', async (req, res) => {
  const { descriptor, photo } = req.body;
  if (!descriptor) return res.status(400).json({ message: 'descriptor required' });
  const desc = descriptor;
  let best = null;
  try { best = await findBestMatch(desc); } catch (e) { return res.status(500).json({ message: 'DB error find' }); }
  const THRESHOLD = 0.6;
  if (!best || best.distance > THRESHOLD) return res.json({ success: false, message: 'No match' });
  const timestamp = new Date().toISOString();
  const photoName = `checkin-${best.id}-${Date.now()}.jpg`;
  const photoPath = path.join(__dirname, '..', 'uploads', photoName);
  try { if (photo) saveBase64Image(photo, photoPath); } catch (e) { console.warn('Save photo fail', e.message); }
  db.run('INSERT INTO attendance (user_id, name, timestamp, photo_path) VALUES (?, ?, ?, ?)', [best.id, best.name, timestamp, photoPath], async function(err) {
    if (err) return res.status(500).json({ message: 'DB insert error' });
    // Append to local CSV for the day
    const day = (new Date()).toISOString().slice(0,10);
    const csvPath = path.join(__dirname, '..', 'data', `attendance-${day}.csv`);
    const row = `${best.id},"${best.name}",${timestamp},${photoName}\n`;
    if (!fs.existsSync(csvPath)) fs.writeFileSync(csvPath, 'user_id,name,timestamp,photo\n');
    fs.appendFileSync(csvPath, row);
    // Upload photo and CSV to Drive (non-blocking)
    (async () => {
      try {
        if (DRIVE_FOLDER_ID && SERVICE_ACCOUNT_KEY_BASE64) {
          await uploadFileToDrive(photoPath, photoName, 'image/jpeg');
          await uploadFileToDrive(csvPath, `attendance-${day}.csv`, 'text/csv');
        }
      } catch (e) { console.warn('Upload background error', e.message); }
    })();

    res.json({ success: true, id: this.lastID, name: best.name });
  });
});

app.get('/users', (req, res) => {
  db.all('SELECT id, name FROM users', [], (err, rows) => {
    if (err) return res.status(500).json({ message: 'DB error' });
    res.json(rows);
  });
});

app.get('/attendance', (req, res) => {
  db.all('SELECT * FROM attendance ORDER BY id DESC LIMIT 100', [], (err, rows) => {
    if (err) return res.status(500).json({ message: 'DB error' });
    res.json(rows);
  });
});

app.listen(PORT, () => console.log('Server running on port', PORT));
