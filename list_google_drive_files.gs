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
20/11/2025 Clean Dead Links: Checks URLs, deletes rows if file is missing. Includes Runtime & ETA calculation.
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

const CHUNK_SIZE_DEFAULT      = 20;   
const MAX_EXEC_SECONDS_DEFAULT = 250; // Safe buffer (Apps Script limit is 360s)
const TRIGGER_DELAY_MINUTES    = 1;   

// ──────────────────────────────────────────────────────────────────────────────
//  MENU
// ──────────────────────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Photo Database Tools')
    .addItem('🔄 Full Sync (Clean Dead Links + Add New)', 'startFullSync')
    .addItem('➕ Append New Files Only', 'startAppendOnly')
    .addSeparator()
    .addItem('⚠️ Stop/Reset Script', 'resetScript')
    .addToUi();
}

// ──────────────────────────────────────────────────────────────────────────────
//  ENTRY POINTS
// ──────────────────────────────────────────────────────────────────────────────

/** 
 * OPTION 1: Full Sync
 * Asks for folders ONCE, then runs CleanTask -> ListTask 
 */
function startFullSync() {
  const folderIds = promptForFolders();
  if (!folderIds) return;

  // Store folder IDs for the second step
  PropertiesService.getScriptProperties().setProperty('PENDING_FOLDER_IDS', folderIds.join('|'));

  // Start Step 1: Cleaning
  initLongRunTask('CleanDeadLinksTask', [
    true, // isChained (should run listing after?)
    MAX_EXEC_SECONDS_DEFAULT,
    TRIGGER_DELAY_MINUTES
  ]);
}

/** 
 * OPTION 2: Append Only (Skip cleaning)
 */
function startAppendOnly() {
  const folderIds = promptForFolders();
  if (!folderIds) return;

  // Start Step 2 directly
  initLongRunTask('ListFilesTask', [
    folderIds.join('|'),
    true, // listAll
    CHUNK_SIZE_DEFAULT,
    MAX_EXEC_SECONDS_DEFAULT,
    TRIGGER_DELAY_MINUTES
  ]);
}

/**
 * RESETS all timers, states and logs.
 */
function resetScript() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const props = PropertiesService.getScriptProperties();
  
  removeTransientLog(sheet);
  
  // Reset LongRun
  LongRun.instance.reset('CleanDeadLinksTask');
  LongRun.instance.reset('ListFilesTask');
  
  // Reset Custom Properties
  props.deleteProperty('PENDING_FOLDER_IDS');
  props.deleteProperty('CLEAN_CURRENT_ROW');
  props.deleteProperty('CLEAN_START_TIME');
  props.deleteProperty('CLEAN_START_ROW');
  props.deleteProperty('CLEAN_DELETED_COUNT');

  SpreadsheetApp.getActiveSpreadsheet().toast("Script reset. Timers cleared.");
}

// ──────────────────────────────────────────────────────────────────────────────
//  TASK 1: CLEAN DEAD LINKS (Bottom-Up Deletion with ETA)
// ──────────────────────────────────────────────────────────────────────────────
function CleanDeadLinksTask() {
  const funcName = 'CleanDeadLinksTask';
  const longRun = LongRun.instance;
  
  // Get Params
  const p = longRun.getParameters(funcName);
  const isChained = (p[0] === 'true' || p[0] === true);
  const maxExec = Number(p[1]) || MAX_EXEC_SECONDS_DEFAULT;
  const delay = Number(p[2]) || TRIGGER_DELAY_MINUTES;

  longRun.setMaxExecutionSeconds(maxExec);
  longRun.setTriggerDelayMinutes(delay);

  // Start/Resume
  const startIndex = longRun.startOrResume(funcName); 
  
  const sheet = SpreadsheetApp.getActiveSheet();
  validateSheet(sheet);
  
  const props = PropertiesService.getScriptProperties();
  
  // --- INITIALIZATION & STATE RESTORATION ---
  let currentRow = parseInt(props.getProperty('CLEAN_CURRENT_ROW'));
  let startTime  = parseInt(props.getProperty('CLEAN_START_TIME'));
  let startRow   = parseInt(props.getProperty('CLEAN_START_ROW'));
  let deletedCount = parseInt(props.getProperty('CLEAN_DELETED_COUNT')) || 0;

  // If this is the VERY first run (no state saved)
  if (isNaN(currentRow)) {
    let lastRow = sheet.getLastRow();
    // Ignore existing transient log if present (starts with hourglass)
    const lastVal = sheet.getRange(lastRow, 1).getValue();
    if (typeof lastVal === 'string' && lastVal.startsWith("⏳")) {
      lastRow--; 
    }
    
    currentRow = lastRow;
    startRow = lastRow;
    startTime = Date.now();
    
    // Save Initial State
    props.setProperty('CLEAN_START_TIME', startTime.toString());
    props.setProperty('CLEAN_START_ROW', startRow.toString());
  }

  let suspended = false;
  let checkedInThisRun = 0;

  try {
    // Loop backwards from bottom to row 2 (skip header)
    for (let r = currentRow; r >= 2; r--) {
      
      // Check Time / Suspend every 5 rows
      if (checkedInThisRun > 0 && checkedInThisRun % 5 === 0) {
        if (longRun.checkShouldSuspend(funcName, 1)) {
          suspended = true;
          // Save state before quitting
          props.setProperty('CLEAN_CURRENT_ROW', r.toString());
          props.setProperty('CLEAN_DELETED_COUNT', deletedCount.toString());
          break;
        }
      }

      // Update Log every 10 rows (Calculate Stats)
      if (checkedInThisRun % 10 === 0) {
        const now = Date.now();
        const elapsedSeconds = (now - startTime) / 1000;
        const rowsProcessed = startRow - r; // Total rows scanned so far
        
        let etaText = "Calculating...";
        if (rowsProcessed > 0 && elapsedSeconds > 0) {
          const speed = rowsProcessed / elapsedSeconds; // rows per second
          const remainingRows = r - 1; // rows left to check
          const etaSeconds = remainingRows / speed;
          etaText = formatTime_(etaSeconds);
        }

        const statusMsg = `⏳ Row ${r} | Deleted: ${deletedCount} | Run: ${formatTime_(elapsedSeconds)} | ETA: ${etaText}`;
        updateTransientLog(sheet, statusMsg);
      }

      const url = sheet.getRange(r, 5).getValue(); // Column E is URL
      
      if (isDeadLink_(url)) {
        sheet.deleteRow(r);
        deletedCount++;
      }
      
      checkedInThisRun++;
    }

    if (!suspended) {
      // FINISHED CLEANING
      removeTransientLog(sheet);
      
      // Clear all temp properties
      props.deleteProperty('CLEAN_CURRENT_ROW');
      props.deleteProperty('CLEAN_START_TIME');
      props.deleteProperty('CLEAN_START_ROW');
      props.deleteProperty('CLEAN_DELETED_COUNT');
      
      longRun.end(funcName);
      
      const totalTime = (Date.now() - startTime) / 1000;
      SpreadsheetApp.getActiveSpreadsheet().toast(`Cleanup Done! Removed ${deletedCount} rows in ${formatTime_(totalTime)}.`);
      
      // Trigger Step 2 if chained
      if (isChained) {
        const savedIds = props.getProperty('PENDING_FOLDER_IDS');
        if (savedIds) {
          initLongRunTask('ListFilesTask', [
            savedIds,
            true,
            CHUNK_SIZE_DEFAULT,
            MAX_EXEC_SECONDS_DEFAULT,
            TRIGGER_DELAY_MINUTES
          ]);
        }
      }
    }

  } catch (e) {
    updateTransientLog(sheet, `❌ Error: ${e.message}`);
  }
}

// Helper: Check if file exists using Drive API
function isDeadLink_(url) {
  if (!url || url === "") return false; // Empty is not "dead"
  
  // Extract ID from URL
  const match = url.match(/id=([a-zA-Z0-9_-]+)/) || url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return false; // Can't parse ID, skip
  
  const id = match[1];
  
  try {
    // Fast check using Advanced Drive API
    // If this throws 404, file is gone.
    const file = Drive.Files.get(id, { fields: "trashed" });
    if (file.trashed) return true; // File exists but is in trash -> Treat as dead
    return false; // File exists and is active
  } catch (e) {
    // If error is "File not found" or 404, it's dead.
    if (e.message.includes('File not found') || e.message.includes('404')) {
      return true;
    }
    return false; 
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  TASK 2: LIST FILES
// ──────────────────────────────────────────────────────────────────────────────
function ListFilesTask() {
  const funcName = 'ListFilesTask';
  const longRun  = LongRun.instance;

  // Retrieve parameters
  const p            = longRun.getParameters(funcName);
  const rootIds      = (p[0] || '').split('|').filter(Boolean); 
  const listAll      = (p[1] === true || p[1] === 'true');
  const CHUNK_SIZE   = Number(p[2]) || CHUNK_SIZE_DEFAULT;
  const maxExec      = Number(p[3]) || MAX_EXEC_SECONDS_DEFAULT;
  const triggerDelay = Number(p[4]) || TRIGGER_DELAY_MINUTES;

  longRun.setMaxExecutionSeconds(maxExec);
  longRun.setTriggerDelayMinutes(triggerDelay);

  longRun.startOrResume(funcName);

  let suspended = false;

  try {
    for (let id of rootIds) {
      suspended = crawlDriveLongRun_(id, listAll, CHUNK_SIZE, longRun, funcName);
      if (suspended) break; 
    }
  } finally {
    if (!suspended) {
      longRun.end(funcName); 
      const sheet = SpreadsheetApp.getActiveSheet();
      removeTransientLog(sheet);
      SpreadsheetApp.getActiveSpreadsheet().toast("Sync Complete!");
    }
  }
}

function crawlDriveLongRun_(rootId, listAll, CHUNK_SIZE, longRun, funcName) {
  const ui    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = SpreadsheetApp.getActiveSheet();
  validateSheet(sheet);

  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);

  // Cache existing names to avoid duplicates
  let lastRealRow = sheet.getLastRow();
  const lastVal = sheet.getRange(lastRealRow, 1).getValue();
  if (typeof lastVal === 'string' && lastVal.startsWith("⏳")) {
    lastRealRow--;
  }

  let seen = new Set();
  if (lastRealRow > 1) {
    const data = sheet.getRange(2, 2, lastRealRow - 1, 1).getValues();
    seen = new Set(data.flat().filter(String));
  }

  const buffer    = [];
  let   nextRow   = lastRealRow + 1;
  let   written   = 0;
  let   chunkIdx  = 0;
  let   suspended = false; 

  const root     = DriveApp.getFolderById(rootId);
  const rootName = root.getName();

  updateTransientLog(sheet, `⏳ Status: Scanning folder "${rootName}"...`);

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
      
      updateTransientLog(sheet, `⏳ Status: Scanning "${rootName}"... Added ${written} items.`);
      
      if (longRun.checkShouldSuspend(funcName, chunkIdx)) suspended = true;
    }
  };

  // Traversal
  const walk = (folder, path) => {
    if (suspended) return;

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

  return suspended; 
}


// ──────────────────────────────────────────────────────────────────────────────
//  UI & HELPERS
// ──────────────────────────────────────────────────────────────────────────────

function promptForFolders() {
  const sheet = SpreadsheetApp.getActiveSheet();
  validateSheet(sheet);

  let prompt = "Enter number(s) separated by commas (e.g., 1, 3):\\n";
  const keys = Object.keys(FOLDER_MAPPING);
  keys.forEach((k, i) => prompt += `${i + 1}. ${k}\\n`);

  const resp = Browser.inputBox('Select Folders to Scan', prompt, Browser.Buttons.OK_CANCEL);
  if (resp === 'cancel' || resp === '') return null;

  const tokens = resp.split(/[ ,]+/).map(t => t.trim()).filter(Boolean);
  if (!tokens.length) return null;

  const folderIds = tokens.map(t => {
    if (!isNaN(t) && +t >= 1 && +t <= keys.length) {
      return FOLDER_MAPPING[keys[+t - 1]];
    }
    return t; 
  });

  return folderIds;
}

function initLongRunTask(funcName, paramsArray) {
  LongRun.instance.setParameters(funcName, paramsArray);
  if (funcName === 'CleanDeadLinksTask') CleanDeadLinksTask();
  if (funcName === 'ListFilesTask') ListFilesTask();
}

function validateSheet(sheet) {
  if (sheet.getName() !== 'Photo_links') {
    SpreadsheetApp.getUi().alert('Error: This script must run on the "Photo_links" sheet.');
    throw new Error('Wrong Sheet');
  }
}

// ─── TRANSIENT LOG HELPERS ───

function updateTransientLog(sheet, message) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return;

  const lastCell = sheet.getRange(lastRow, 1);
  const val = lastCell.getValue();

  // If last row is already a status log (starts with hourglass), overwrite it
  if (typeof val === 'string' && val.startsWith("⏳")) {
    lastCell.setValue(message);
    SpreadsheetApp.flush();
  } else {
    // Append new status log
    const newRow = lastRow + 1;
    sheet.getRange(newRow, 1).setValue(message)
         .setFontStyle("italic")
         .setFontColor("#666666");
    try { sheet.getRange(newRow, 1, 1, 5).merge(); } catch(e){}
    SpreadsheetApp.flush();
  }
}

function removeTransientLog(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 0) {
    const val = sheet.getRange(lastRow, 1).getValue();
    if (typeof val === 'string' && val.startsWith("⏳")) {
      sheet.deleteRow(lastRow);
      SpreadsheetApp.flush();
    }
  }
}

function formatTime_(seconds) {
  if (!seconds || seconds < 0) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

// ─── DATA HELPERS ───

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
  removeTransientLog(sheet);
  
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