const fs = require('fs');
const path = require('path');
const DB_FILE = path.join(__dirname, 'database.json');

function getSessionDate() {
  const now = new Date();
  if (now.getHours() < 1 || (now.getHours() === 1 && now.getMinutes() < 30)) {
    const p = new Date(now); p.setDate(p.getDate() - 1);
    return p.toISOString().split('T')[0];
  }
  return now.toISOString().split('T')[0];
}

function load() {
  if (!fs.existsSync(DB_FILE)) return { sessions: {} };
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); }
  catch { return { sessions: {} }; }
}

function save(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

function initDate(data, date) {
  if (!data.sessions[date]) data.sessions[date] = { messages: [], rejected: [] };
  if (!data.sessions[date].rejected) data.sessions[date].rejected = [];
}

function saveEntry(entry) {
  const data = load();
  initDate(data, entry.date);
  data.sessions[entry.date].messages.push({ id: Date.now(), ...entry });
  save(data);
}

function cancelEntry(entry) {
  const data = load();
  initDate(data, entry.date);
  data.sessions[entry.date].messages.push({ id: Date.now(), ...entry });
  save(data);
}

function saveRejected(entry) {
  const data = load();
  initDate(data, entry.date);
  data.sessions[entry.date].rejected.push({ id: Date.now(), ...entry });
  save(data);
}

function getDataForDate(date) {
  const s = load().sessions[date];
  return { messages: s?.messages || [], rejected: s?.rejected || [] };
}

function getRejected(date) {
  return load().sessions[date]?.rejected || [];
}

function getAllDates() {
  return Object.keys(load().sessions).sort().reverse();
}

function resetDate(date, group) {
  const data = load();
  if (!data.sessions[date]) return;
  if (group) {
    // Sirf us group ka data delete karo
    data.sessions[date].messages = (data.sessions[date].messages||[]).filter(m => m.group !== group);
    data.sessions[date].rejected = (data.sessions[date].rejected||[]).filter(r => r.group !== group);
  } else {
    data.sessions[date] = { messages: [], rejected: [] };
  }
  save(data);
}

module.exports = { saveEntry, cancelEntry, saveRejected, getRejected, getDataForDate, getAllDates, getSessionDate, resetDate };
