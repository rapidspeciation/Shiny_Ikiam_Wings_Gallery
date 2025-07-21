/*
List all Google Drive links of Files / folder to Google Sheet

Modified version from https://ourtechroom.com/fix/list-all-googledrive-links-files-folder-to-googlesheet/

Modifications:
15/01/2023 Avoid clearing Spreadsheet and listing all files from scratch.
19/06/2023 Avoid listing files inside subfolders whose names end with "_temp"
04/03/2024 Only execute code if current sheet is "Photo_links"
05/05/2025 Added folder selection and 'Replace .(jpg|HEIC|heic) with .JPG for CRISPR' column and
  Optimized performance by caching existing rows in memory and writing new data in batches instead of row-by-row.
04/07/2025 Implemented LongRun (https://github.com/inclu-cat/LongRun) to avoid 6-minute Apps Script time limit.
  Folder selector now accepts *multiple* indices/IDs separated by commas or
 *     spaces, e.g. `1,2,4` or `1 2  4`
*/

// ───────────────────────────────────────────────────────────────────────────────
//  USER CONFIG
// ───────────────────────────────────────────────────────────────────────────────
const FOLDER_MAPPING = {
  "Photos... collected butterflies/JPG_photos": "1EFzjLdjWT-4-BDqACxfrpfYIY78Pmcp0",
  "PERU_2024/JPG":                            "19x8wnj1ZW_8axmsjuIuhF6lI25wGeteA",
  "Photos CRISPR butterflies":                "1fswAA9nyKIDfAQr03bv5DmaCWcZ6-Rzu",
  "Photos Kim took":                          "1XjcfuwpmgPvCy5cwfrtYpnxNrpCMwrcX",
  "Wings of reared butterflies":              "1KzAuIAsKKAMVblp6ShNOYEiF59gu9u3F",
  "Photos... collected butterflies/Raw_photos":"123X-DrY0uIQ8fkNwymCTba4wVkDQl2nC",
  "PERU_2024/RAW":                            "1WnWyDhg2zA6Rh_wvbg-_nYosr9TKZkI-"
};

const HEADERS = [
  "Full Path","Name","Type","Capture Date","URL",
  "Date","Description","Size KB","Owner Email",
  "Replace .(jpg|HEIC|heic) with .JPG for CRISPR"
];

const CHUNK_SIZE_DEFAULT      = 20;   // rows per flush  (≈10 s)
const MAX_EXEC_SECONDS_DEFAULT = 300; // pause at ~5 min ( < 360 s hard limit )
const TRIGGER_DELAY_MINUTES    = 1;   // resume 1 min later

// ──────────────────────────────────────────────────────────────────────────────
//  MENU
// ──────────────────────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('List Files/Folders')
    .addItem('List All Files and Folders', 'showFolderSelector')
    .addToUi();
}

/* ─────────── Folder selector (now multi‑select) ─────────── */
function showFolderSelector() {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Photo_links') {
    SpreadsheetApp.getUi().alert('This script can only run on the "Photo_links" sheet.');
    return;
  }

  // Build prompt
  let prompt = "Enter number(s) separated by commas, or paste custom folder ID(s):\\n";
  const keys = Object.keys(FOLDER_MAPPING);
  keys.forEach((k, i) => prompt += `${i + 1}. ${k}\\n`);

  const resp = Browser.inputBox('Select Folder(s)', prompt, Browser.Buttons.OK_CANCEL);
  if (resp === '') return; // cancelled

  // Split by comma/space, trim, drop blanks
  const tokens = resp.split(/[ ,]+/).map(t => t.trim()).filter(Boolean);
  if (!tokens.length) return;

  // Resolve each token to a Drive folder ID
  const folderIds = tokens.map(t => {
    if (!isNaN(t) && +t >= 1 && +t <= keys.length) {
      return FOLDER_MAPPING[keys[+t - 1]];
    }
    return t; // treat as raw ID
  });

  Browser.msgBox(`Selected ${folderIds.length} folder(s). The crawl will start now and resume automatically until done.`);

  // Pack parameters for LongRun (join with "|" so it stays a single string)
  const params = [
    folderIds.join('|'),          // 0  pipe‑separated list of folder IDs
    true,                        // 1  listAll (include files)
    CHUNK_SIZE_DEFAULT,          // 2  chunk size
    MAX_EXEC_SECONDS_DEFAULT,    // 3  LongRun maxExecutionSeconds
    TRIGGER_DELAY_MINUTES        // 4  trigger delay between runs
  ];

  LongRun.instance.setParameters('ListFilesTask', params);
  ListFilesTask();               // kick‑off first run immediately
}

/* ─────────── LongRun task entry point ─────────── */
function ListFilesTask() {
  const funcName = 'ListFilesTask';
  const longRun  = LongRun.instance;

  // Retrieve parameters
  const p            = longRun.getParameters(funcName);
  const rootIds      = (p[0] || '').split('|').filter(Boolean); // multiple IDs
  const listAll      = (p[1] === true || p[1] === 'true');
  const CHUNK_SIZE   = Number(p[2]) || CHUNK_SIZE_DEFAULT;
  const maxExec      = Number(p[3]) || MAX_EXEC_SECONDS_DEFAULT;
  const triggerDelay = Number(p[4]) || TRIGGER_DELAY_MINUTES;

  longRun.setMaxExecutionSeconds(maxExec);
  longRun.setTriggerDelayMinutes(triggerDelay);

  // Start/resume (index used only to let LongRun manage triggers)
  longRun.startOrResume(funcName);

  try {
    for (let id of rootIds) {
      const suspended = crawlDriveLongRun_(id, listAll, CHUNK_SIZE, longRun, funcName);
      if (suspended) break; // next trigger is already set
    }
  } finally {
    longRun.end(funcName); // tidy up if finished
  }
}

/* ─────────── Drive crawler that can suspend mid‑flight ─────────── */
function crawlDriveLongRun_(rootId, listAll, CHUNK_SIZE, longRun, funcName) {
  const ui    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = SpreadsheetApp.getActiveSheet();

  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);

  // Names already listed → skip duplicates across reruns
  let seen = new Set();
  if (sheet.getLastRow() > 1) {
    seen = new Set(sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues().flat().filter(String));
  }

  const buffer    = [];
  let   nextRow   = sheet.getLastRow() + 1;
  let   written   = 0;
  let   chunkIdx  = 0;
  let   suspended = false; // flag to break recursion

  const root     = DriveApp.getFolderById(rootId);
  const rootName = root.getName();

  if (!seen.has(rootName)) {
    buffer.push(buildRow_('', rootName, 'Folder', root));
    seen.add(rootName);
  }

  // Flush helper
  const maybeFlush = () => {
    if (buffer.length >= CHUNK_SIZE) {
      nextRow = flushBuffer_(sheet, buffer, nextRow);
      written += CHUNK_SIZE;
      chunkIdx++;
      ui.toast(`Processed ${written} item(s)…`);
      if (longRun.checkShouldSuspend(funcName, chunkIdx)) suspended = true;
    }
  };

  // Depth‑first traversal with early exit
  const walk = (folder, path) => {
    if (suspended) return;

    // sub‑folders
    const subFolders = folder.getFolders();
    while (!suspended && subFolders.hasNext()) {
      const f = subFolders.next();
      const n = f.getName();
      if (n.endsWith('_temp')) continue;
      if (!seen.has(n)) {
        buffer.push(buildRow_(path, n, 'Folder', f));
        seen.add(n);
        maybeFlush();
      }
      walk(f, path ? `${path}/${n}` : n);
    }

    // files
    if (listAll && !suspended) {
      const files = folder.getFiles();
      while (!suspended && files.hasNext()) {
        const file = files.next();
        const n    = file.getName();
        if (seen.has(n)) continue;
        buffer.push(buildRow_(path, n, 'File', file));
        seen.add(n);
        maybeFlush();
      }
    }
  };

  walk(root, rootName);

  if (buffer.length && !suspended) {
    flushBuffer_(sheet, buffer, nextRow);
    written += buffer.length;
  }

  ui.toast(suspended ? `Suspending… ${written} new row(s) added so far.`
                     : `Finished folder. Added ${written} new row(s).`);
  return suspended; // tell caller whether we hit the time wall
}

// ──────────────────────────────────────────────────────────────────────────────
//  Utility helpers (unchanged)
// ──────────────────────────────────────────────────────────────────────────────
function buildRow_(path, name, kind, entry) {
  const capture = (kind === 'File') ? getCaptureDate_(entry.getId()) : '';
  return [
    (path ? `${path}/` : '') + name,
    name,
    kind,
    capture,
    entry.getUrl(),
    entry.getDateCreated(),
    entry.getDescription(),
    entry.getSize() / 1024,
    entry.getOwner().getEmail()
  ];
}

function flushBuffer_(sheet, buffer, startRow) {
  const rows = buffer.map((row, i) => {
    const r = startRow + i;
    const formula = (row[2] === 'File')
      ? `=REGEXREPLACE(REGEXREPLACE(B${r},"\\.(jpg|HEIC|heic)$",".JPG"),"([vd])1\\.(JPG)$","$1.JPG")`
      : '';
    return [...row, formula];
  });
  sheet.getRange(startRow, 1, rows.length, HEADERS.length).setValues(rows);
  SpreadsheetApp.flush();
  buffer.length = 0;
  return startRow + rows.length;
}

/** Return EXIF capture date or '' (requires Drive API). */
function getCaptureDate_(fileId) {
  try {
    const meta = Drive.Files.get(fileId, { fields: 'imageMediaMetadata/time' });
    const t = meta.imageMediaMetadata && meta.imageMediaMetadata.time;
    if (!t) return '';
    const m = t.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`) : t;
  } catch (e) {
    return '';
  }
}
