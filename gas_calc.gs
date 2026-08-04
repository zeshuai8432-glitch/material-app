/**
 * 材料計算 — 雲端後端（Google Apps Script）v2
 *
 * 這一版解決「資料被舊版本蓋掉」的根本問題：
 *   1. 版本控管（rev）：每次儲存 rev+1。用戶端存檔時要附上「我是根據哪個 rev 改的」(baseRev)，
 *      對不上 → 伺服器「拒絕寫入」並回傳雲端現況，不會再被過期的分頁/裝置蓋掉。
 *   2. 雲端版本歷史：每次成功儲存都留一份（預設留 30 份），可列出、可還原，
 *      就算真的存錯，也能從雲端拉回任何一個時間點。
 *   3. 縮水保護：新資料比雲端「少很多」(<50%) 且沒帶 force 旗標 → 拒絕並提醒。
 *
 * ── 部署步驟 ──
 * 1. 開 https://script.google.com → 找到材料計算那個專案（或新增專案）
 * 2. 把這整份貼進 Code.gs（覆蓋原本內容）→ 存檔
 * 3. 右上「部署」→「管理部署作業」→ 編輯 → 版本選「新版本」→ 部署
 *    （沿用原本的網址，用戶端不用改）
 * 4. 第一次會跳授權，選你的 Google 帳號 →「進階 → 前往（不安全）」授權
 *
 * 註：SHEET_ID 用你原本那張「材料計算資料庫」，資料不會動到，只會多一個 History 分頁。
 */

const SHEET_ID = '1pEDe07Xwd7xPwpqhprZTpAqsOWPnxGoaurlJUgsERE4';
const USERS_SHEET = 'Users';
const DATA_SHEET = 'Data';
const HIST_SHEET = 'History';
const KEEP_REVS = 30;        // 每個帳號在雲端保留幾個歷史版本
const SHRINK_GUARD = 0.5;    // 新資料小於雲端的這個比例 → 視為異常縮水，需 force 才寫

// ════════════════════════════════════
// ENTRY POINT
// ════════════════════════════════════
function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const { action, payload } = req;

    if (action === 'login')     return respond(login(payload));
    if (action === 'saveData')  return respond(saveData(payload));
    if (action === 'loadData')  return respond(loadData(payload));
    if (action === 'listRevs')  return respond(listRevs(payload));
    if (action === 'getRev')    return respond(getRev(payload));

    return respond({ ok: false, error: '未知指令' });
  } catch (err) {
    return respond({ ok: false, error: err.message });
  }
}

function doGet(e) {
  return respond({ ok: true, message: '材料計算 GAS v2 運作中' });
}

// ════════════════════════════════════
// HELPERS
// ════════════════════════════════════
function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === USERS_SHEET) sheet.appendRow(['username', 'password_hash', 'created_at']);
    if (name === DATA_SHEET)  sheet.appendRow(['username', 'data_json', 'updated_at', 'rev']);
    if (name === HIST_SHEET)  sheet.appendRow(['username', 'rev', 'saved_at', 'data_json']);
  }
  return sheet;
}

function hashPassword(pwd) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, pwd, Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

function verify(username, password) {
  if (!username || !password) return false;
  const rows = getSheet(USERS_SHEET).getDataRange().getValues();
  const hash = hashPassword(password);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === username && rows[i][1] === hash) return true;
  }
  return false;
}

// 找出某帳號在 Data 分頁的列號（1-based，找不到回 -1）；順便回傳現況
function findDataRow(username) {
  const sheet = getSheet(DATA_SHEET);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === username) {
      return { sheet, rowNo: i + 1, json: rows[i][1], updatedAt: rows[i][2], rev: Number(rows[i][3]) || 0 };
    }
  }
  return { sheet, rowNo: -1, json: '', updatedAt: '', rev: 0 };
}

// 粗略量測「資料多寡」：案場數 + 區塊數（用來擋異常縮水）
function measure(obj) {
  try {
    let zones = 0;
    const z = obj && obj.zones || {};
    Object.keys(z).forEach(k => { zones += (z[k] || []).length; });
    return { projects: ((obj && obj.projects) || []).length, zones };
  } catch (e) { return { projects: 0, zones: 0 }; }
}

// ════════════════════════════════════
// LOGIN / REGISTER
// ════════════════════════════════════
function login(payload) {
  const { username, password } = payload;
  if (!username || !password) return { ok: false, error: '請輸入名字和密碼' };

  const sheet = getSheet(USERS_SHEET);
  const rows = sheet.getDataRange().getValues();
  const hash = hashPassword(password);

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === username) {
      return rows[i][1] === hash ? { ok: true, username } : { ok: false, error: '密碼錯誤' };
    }
  }
  sheet.appendRow([username, hash, new Date().toISOString()]);
  return { ok: true, username, isNew: true };
}

// ════════════════════════════════════
// SAVE（含版本控管、歷史、縮水保護）
// ════════════════════════════════════
function saveData(payload) {
  const { username, password, data, baseRev, force } = payload;
  if (!verify(username, password)) return { ok: false, error: '身份驗證失敗' };

  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { ok: false, error: '伺服器忙碌，請重試' }; }

  try {
    const cur = findDataRow(username);
    const now = new Date().toISOString();

    // 1) 版本檢查：帶了 baseRev 且對不上 → 拒絕，回傳雲端現況讓用戶端決定
    if (cur.rowNo > 0 && baseRev != null && Number(baseRev) !== cur.rev) {
      let cloudData = null;
      try { cloudData = JSON.parse(cur.json); } catch (e) {}
      return {
        ok: false, conflict: true, rev: cur.rev, updatedAt: cur.updatedAt, data: cloudData,
        error: '雲端已有更新版本（rev ' + cur.rev + '），你的版本是 ' + baseRev
      };
    }

    // 2) 縮水保護：資料量掉一半以上且沒帶 force → 拒絕
    if (cur.rowNo > 0 && !force) {
      let old = null;
      try { old = JSON.parse(cur.json); } catch (e) {}
      if (old) {
        const a = measure(old), b = measure(data);
        const shrank = (a.zones > 10 && b.zones < a.zones * SHRINK_GUARD) ||
                       (a.projects > 0 && b.projects === 0);
        if (shrank) {
          return {
            ok: false, shrink: true, rev: cur.rev, was: a, now: b,
            error: '新資料比雲端少很多（區塊 ' + a.zones + ' → ' + b.zones + '），已擋下'
          };
        }
      }
    }

    // 3) 寫入 + 版本 +1
    const newRev = cur.rev + 1;
    const json = JSON.stringify(data);
    if (cur.rowNo > 0) {
      cur.sheet.getRange(cur.rowNo, 2).setValue(json);
      cur.sheet.getRange(cur.rowNo, 3).setValue(now);
      cur.sheet.getRange(cur.rowNo, 4).setValue(newRev);
    } else {
      cur.sheet.appendRow([username, json, now, newRev]);
    }

    // 4) 留一份歷史，並修剪成最新 KEEP_REVS 份
    try {
      const hs = getSheet(HIST_SHEET);
      hs.appendRow([username, newRev, now, json]);
      const hrows = hs.getDataRange().getValues();
      const mine = [];
      for (let i = 1; i < hrows.length; i++) if (hrows[i][0] === username) mine.push(i + 1);
      if (mine.length > KEEP_REVS) {
        // 由下往上刪，避免列號位移
        mine.slice(0, mine.length - KEEP_REVS).reverse().forEach(r => hs.deleteRow(r));
      }
    } catch (e) {}

    return { ok: true, rev: newRev, updatedAt: now };
  } finally {
    lock.releaseLock();
  }
}

// ════════════════════════════════════
// LOAD
// ════════════════════════════════════
function loadData(payload) {
  const { username, password } = payload;
  if (!verify(username, password)) return { ok: false, error: '身份驗證失敗' };

  const cur = findDataRow(username);
  if (cur.rowNo < 0) return { ok: true, data: null, rev: 0 };
  try {
    return { ok: true, data: JSON.parse(cur.json), rev: cur.rev, updatedAt: cur.updatedAt };
  } catch (e) {
    return { ok: false, error: '資料損壞' };
  }
}

// ════════════════════════════════════
// 雲端版本歷史：列出／取回某一版
// ════════════════════════════════════
function listRevs(payload) {
  const { username, password } = payload;
  if (!verify(username, password)) return { ok: false, error: '身份驗證失敗' };

  const rows = getSheet(HIST_SHEET).getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] !== username) continue;
    let m = { projects: 0, zones: 0 };
    try { m = measure(JSON.parse(rows[i][3])); } catch (e) {}
    out.push({ rev: Number(rows[i][1]) || 0, at: rows[i][2], projects: m.projects, zones: m.zones });
  }
  out.sort((a, b) => b.rev - a.rev);
  return { ok: true, revs: out };
}

function getRev(payload) {
  const { username, password, rev } = payload;
  if (!verify(username, password)) return { ok: false, error: '身份驗證失敗' };

  const rows = getSheet(HIST_SHEET).getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][0] === username && Number(rows[i][1]) === Number(rev)) {
      try { return { ok: true, rev: Number(rev), at: rows[i][2], data: JSON.parse(rows[i][3]) }; }
      catch (e) { return { ok: false, error: '這一版資料損壞' }; }
    }
  }
  return { ok: false, error: '找不到這一版' };
}
