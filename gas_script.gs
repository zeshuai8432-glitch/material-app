/**
 * 現場材料管理 — 雲端同步後端（Google Apps Script）
 *
 * 資料存成你 Google 雲端硬碟裡的一個 JSON 檔（fieldmat-data.json），
 * 沒有大小限制，只有你自己看得到。
 *
 * ── 部署步驟 ──
 * 1. 開 https://script.google.com → 新增專案
 * 2. 把這整份貼進 Code.gs（覆蓋原本內容）→ 存檔
 * 3. 右上「部署」→「新增部署作業」
 * 4. 類型選「網頁應用程式」
 *    - 執行身分：我
 *    - 具有存取權的使用者：任何人
 * 5. 部署後複製「網頁應用程式」網址（.../exec 結尾）
 * 6. 貼到 app 的 設定 → 雲端同步 → 儲存網址
 *
 * 註：第一次部署會跳授權，選你的 Google 帳號、按「進階 → 前往（不安全）」授權即可。
 */

var FILE_NAME = 'fieldmat-data.json';

function doGet(e) {
  var content = '{}';
  var files = DriveApp.getFilesByName(FILE_NAME);
  if (files.hasNext()) content = files.next().getBlob().getDataAsString();
  return ContentService.createTextOutput(content)
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var body = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var files = DriveApp.getFilesByName(FILE_NAME);
    if (files.hasNext()) {
      files.next().setContent(body);
    } else {
      DriveApp.createFile(FILE_NAME, body, 'application/json');
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
