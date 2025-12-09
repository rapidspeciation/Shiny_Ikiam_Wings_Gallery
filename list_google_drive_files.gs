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
  Folder selector now accepts *multiple* indices/IDs separated by commas or spaces, e.g. `1,2,4` or `1 2  4`
20/11/2025 Clean Dead Links: Checks URLs, deletes rows if file is missing. Includes Runtime & ETA calculation.
08/12/2025 Improved performance by getting Google Drive files in batches. And fix running in the background.
  Queue-based folder processing for reliable resume across subprocesses.
*/

// ─── CONFIG ───
const FOLDER_MAPPING = {
  "Photos... collected butterflies/JPG_photos": "1EFzjLdjWT-4-BDqACxfrpfYIY78Pmcp0",
  "PERU_2024/JPG":                              "19x8wnj1ZW_8axmsjuIuhF6lI25wGeteA",
  "Photos CRISPR butterflies":                  "1fswAA9nyKIDfAQr03bv5DmaCWcZ6-Rzu",
  "Photos Kim took":                            "1XjcfuwpmgPvCy5cwfrtYpnxNrpCMwrcX",
  "Wings of reared butterflies":                "1KzAuIAsKKAMVblp6ShNOYEiF59gu9u3F",
  "Photos... collected butterflies/Raw_photos": "123X-DrY0uIQ8fkNwymCTba4wVkDQl2nC",
  "PERU_2024/RAW":                              "1WnWyDhg2zA6Rh_wvbg-_nYosr9TKZkI-"
};

const HEADERS = [
  "Full Path","Name","Type","Capture Date","URL",
  "Date","Description","Size KB","Owner Email",
  "Replace .(jpg|HEIC|heic) with .JPG for CRISPR"
];

const CHUNK_SIZE    = 50;   // Rows per flush (larger = faster but more memory)
const BATCH_CHECK   = 100;  // URLs to check per batch when cleaning
const MAX_EXEC_SEC  = 250;  // 4 min 10s (buffer for API calls that can take 90s+)
const TRIGGER_DELAY = 0.1;  // Minimal delay between triggers

// ─── MENU ───
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📷 Photo Database Tools')
    .addItem('🔄 Full Sync (Clean + Add New)', 'startFullSync')
    .addItem('➕ Append New Files Only', 'startAppendOnly')
    .addSeparator()
    .addItem('📊 Check Status', 'checkStatus')
    .addItem('🛑 Stop Script', 'stopScript')
    .addToUi();
}

// ─── ENTRY POINTS ───
function startFullSync() {
  if (!canStart_()) return;
  const ids = promptFolders_();
  if (!ids) return;
  setProp_('FOLDERS', ids.join('|'));
  setUser_();
  SpreadsheetApp.getActiveSpreadsheet().toast('🔄 Starting Full Sync...', '📷 Photo Database', 5);
  initTask_('CleanTask', ['true', MAX_EXEC_SEC, TRIGGER_DELAY]);
}

function startAppendOnly() {
  if (!canStart_()) return;
  const ids = promptFolders_();
  if (!ids) return;
  setProp_('FOLDERS', ids.join('|'));
  setUser_();
  SpreadsheetApp.getActiveSpreadsheet().toast('➕ Starting Append...', '📷 Photo Database', 5);
  initTask_('ListTask', [ids.join('|'), 'true', CHUNK_SIZE, MAX_EXEC_SEC, TRIGGER_DELAY]);
}

function checkStatus() {
  const props = PropertiesService.getScriptProperties();
  const user = props.getProperty('RUN_USER');
  const task = props.getProperty('RUN_TASK');
  const started = props.getProperty('RUN_START');
  const folders = props.getProperty('FOLDERS');
  const triggers = ScriptApp.getProjectTriggers().length;
  
  let msg;
  if (!user && !task) {
    msg = '✅ No script currently running.';
  } else {
    let runtime = 'N/A';
    if (started) {
      const sec = Math.floor((Date.now() - parseInt(started)) / 1000);
      runtime = formatTime_(sec);
    }
    msg = '👤 User: ' + user + '\n' +
          '📋 Task: ' + task + '\n' +
          '⏱️ Runtime: ' + runtime + '\n' +
          '🔄 Triggers: ' + triggers + '\n' +
          '📁 Folders: ' + (folders ? folders.split('|').length : 0);
  }
  SpreadsheetApp.getUi().alert('📊 Script Status', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

function stopScript() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('🛑 Stop Script', 'Stop all running tasks?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  
  setProp_('ABORT', 'true');
  
  // Delete all triggers
  ScriptApp.getProjectTriggers().forEach(t => {
    try { ScriptApp.deleteTrigger(t); } catch(e) {}
  });
  
  // Reset LongRun
  try {
    LongRun.instance.reset('CleanTask');
    LongRun.instance.reset('ListTask');
  } catch(e) {}
  
  // Clear props
  ['FOLDERS','CLEAN_IDX','CLEAN_START','CLEAN_DEL','CLEAN_BATCH','CLEAN_CHECKED',
   'LIST_ADDED','LIST_FOLDER','LIST_START','LIST_BATCH','LIST_FOLDER_QUEUE','LIST_CHECKED',
   'RUN_USER','RUN_TASK','RUN_START'].forEach(k => delProp_(k));
  
  // Mark abort in sheet
  const sheet = getSheet_();
  if (sheet) {
    removeLog_(sheet);
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1).setValue('🛑 Aborted by user at row ' + lastRow);
    SpreadsheetApp.flush();
  }
  
  SpreadsheetApp.getActiveSpreadsheet().toast('🛑 Script stopped.', '📷 Photo Database', 5);
}

// ─── CLEAN TASK ───
function CleanTask() {
  const funcName = 'CleanTask';
  const longRun = LongRun.instance;
  
  const isResuming = !!PropertiesService.getScriptProperties().getProperty('CLEAN_IDX');
  console.log('DEBUG: CleanTask started, isResuming=' + isResuming);
  
  if (shouldAbort_()) { cleanup_('CleanTask'); return; }
  
  const p = longRun.getParameters(funcName);
  const isChained = p[0] === 'true';
  longRun.setMaxExecutionSeconds(Number(p[1]) || MAX_EXEC_SEC);
  longRun.setTriggerDelayMinutes(Number(p[2]) || TRIGGER_DELAY);
  longRun.startOrResume(funcName);
  
  const sheet = getSheet_();
  if (!sheet) { longRun.end(funcName); return; }
  
  const props = PropertiesService.getScriptProperties();
  const user = props.getProperty('RUN_USER') || 'Unknown';
  
  // Remove status rows first
  let lastRow = sheet.getLastRow();
  while (lastRow > 1) {
    const lastVal = sheet.getRange(lastRow, 1).getValue();
    if (typeof lastVal === 'string' && (lastVal.startsWith('⏳') || lastVal.startsWith('🛑') || lastVal.startsWith('✓'))) {
      sheet.deleteRow(lastRow);
      lastRow--;
    } else {
      break;
    }
  }
  SpreadsheetApp.flush();
  
  // Get checked IDs from previous runs (to skip)
  const checkedStr = props.getProperty('CLEAN_CHECKED') || '';
  const checkedIds = new Set(checkedStr ? checkedStr.split(',') : []);
  
  // Read all URLs, filter out already checked
  let urlData = [];
  if (lastRow > 1) {
    const allData = sheet.getRange(2, 5, lastRow - 1, 1).getValues().flat();
    for (let i = 0; i < allData.length; i++) {
      const id = extractFileId_(allData[i]);
      if (id && !checkedIds.has(id)) {
        urlData.push({ row: i + 2, id: id });
      }
    }
  }
  
  // Get or init state
  let startTime = parseInt(props.getProperty('CLEAN_START')) || Date.now();
  let deleted = parseInt(props.getProperty('CLEAN_DEL')) || 0;
  let batchIdx = parseInt(props.getProperty('CLEAN_BATCH')) || 0;
  let totalChecked = checkedIds.size;
  
  if (!isResuming) {
    setProp_('CLEAN_START', startTime.toString());
  }
  
  const totalUrls = urlData.length + checkedIds.size;
  const deadIds = [];
  
  // Status helper
  const getStatus = () => {
    const runtime = formatTime_((Date.now() - startTime) / 1000);
    const checked = totalChecked;
    const eta = checked > 0 ? formatTime_((totalUrls - checked) * (Date.now() - startTime) / 1000 / checked) : '...';
    return '⏳ ' + user + ' | Clean: ' + checked + '/' + totalUrls + ' | Dead: ' + deleted + ' | Run: ' + runtime + ' | ETA: ' + eta;
  };
  
  updateLog_(sheet, getStatus());
  console.log('DEBUG: CleanTask, toCheck=' + urlData.length + ', alreadyChecked=' + checkedIds.size);
  
  let suspended = false;
  let currentIdx = 0;
  
  try {
    // Process URLs
    while (currentIdx < urlData.length && !suspended) {
      if (shouldAbort_()) break;
      
      // Check suspend
      if (longRun.checkShouldSuspend(funcName, batchIdx)) {
        console.log('DEBUG: CleanTask suspending at idx=' + currentIdx);
        suspended = true;
        break;
      }
      
      // Check batch of URLs
      const batchEnd = Math.min(currentIdx + BATCH_CHECK, urlData.length);
      
      for (let i = currentIdx; i < batchEnd; i++) {
        const item = urlData[i];
        checkedIds.add(item.id);
        totalChecked++;
        if (isFileDeleted_(item.id)) {
          deadIds.push(item.id);
          deleted++;
        }
      }
      
      currentIdx = batchEnd;
      batchIdx++;
      
      // Update progress
      updateLog_(sheet, getStatus());
      
      // Save state
      setProp_('CLEAN_DEL', deleted.toString());
      setProp_('CLEAN_BATCH', batchIdx.toString());
      
      console.log('DEBUG: CleanTask batch ' + batchIdx + ', checked=' + totalChecked + '/' + totalUrls + ', dead=' + deadIds.length);
      
      // Delete dead rows found in this subprocess (every few batches or at end)
      if (deadIds.length >= 10 || currentIdx >= urlData.length) {
        deleteRowsByFileId_(sheet, deadIds);
        deadIds.length = 0; // Clear after deletion
      }
    }
    
    // Save checked IDs (limit to avoid property size limit)
    const checkedArr = Array.from(checkedIds).slice(-5000);
    setProp_('CLEAN_CHECKED', checkedArr.join(','));
    
    // Delete any remaining dead rows
    if (deadIds.length > 0) {
      deleteRowsByFileId_(sheet, deadIds);
    }
    
    if (!suspended && currentIdx >= urlData.length) {
      // Finished
      removeLog_(sheet);
      const elapsed = formatTime_((Date.now() - startTime) / 1000);
      sheet.getRange(sheet.getLastRow() + 1, 1).setValue('✓ Clean done: ' + deleted + ' removed in ' + elapsed);
      
      // Clear clean state
      ['CLEAN_IDX','CLEAN_START','CLEAN_DEL','CLEAN_BATCH','CLEAN_CHECKED'].forEach(k => delProp_(k));
      console.log('DEBUG: CleanTask completed, deleted=' + deleted);
      
      // Chain to list task
      if (isChained) {
        const folders = props.getProperty('FOLDERS');
        if (folders) {
          console.log('DEBUG: CleanTask chaining to ListTask');
          initTask_('ListTask', [folders, 'true', CHUNK_SIZE, MAX_EXEC_SEC, TRIGGER_DELAY]);
        }
      } else {
        clearUser_();
      }
    } else if (suspended) {
      const triggers = ScriptApp.getProjectTriggers().length;
      console.log('DEBUG: CleanTask suspended, triggers=' + triggers);
    }
  } finally {
    longRun.end(funcName);
  }
}

// Delete rows by file ID (searches URL column for matching IDs)
function deleteRowsByFileId_(sheet, deadIds) {
  if (!deadIds || deadIds.length === 0) return;
  
  const deadSet = new Set(deadIds);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  
  const urls = sheet.getRange(2, 5, lastRow - 1, 1).getValues().flat();
  const rowsToDelete = [];
  
  for (let i = 0; i < urls.length; i++) {
    const id = extractFileId_(urls[i]);
    if (id && deadSet.has(id)) {
      rowsToDelete.push(i + 2);
    }
  }
  
  // Delete from bottom up
  rowsToDelete.sort((a, b) => b - a);
  for (const row of rowsToDelete) {
    sheet.deleteRow(row);
  }
  
  if (rowsToDelete.length > 0) {
    SpreadsheetApp.flush();
    console.log('DEBUG: deleted ' + rowsToDelete.length + ' dead rows');
  }
}

// Extract file ID from Google Drive URL
function extractFileId_(url) {
  if (!url) return null;
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// Check if file is deleted
function isFileDeleted_(fileId) {
  if (!fileId) return false;
  try {
    const file = Drive.Files.get(fileId, { fields: 'trashed' });
    return file.trashed === true;
  } catch(e) {
    return e.message.includes('File not found') || e.message.includes('404');
  }
}

// ─── LIST TASK ───
function ListTask() {
  const funcName = 'ListTask';
  const longRun = LongRun.instance;
  
  const isResuming = longRun.isRunning(funcName) || PropertiesService.getScriptProperties().getProperty('LIST_BATCH');
  console.log('DEBUG: ListTask started, isResuming=' + !!isResuming);
  
  if (shouldAbort_()) { cleanup_('ListTask'); return; }
  
  const p = longRun.getParameters(funcName);
  const rootIds = (p[0] || '').split('|').filter(Boolean);
  const listAll = p[1] === 'true';
  const chunkSize = Number(p[2]) || CHUNK_SIZE;
  longRun.setMaxExecutionSeconds(Number(p[3]) || MAX_EXEC_SEC);
  longRun.setTriggerDelayMinutes(Number(p[4]) || TRIGGER_DELAY);
  longRun.startOrResume(funcName);
  
  // Init start time if first run
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('LIST_START')) {
    setProp_('LIST_START', Date.now().toString());
  }
  
  let suspended = false;
  let aborted = false;
  
  try {
    // Get current folder index
    let folderIdx = parseInt(props.getProperty('LIST_FOLDER')) || 0;
    
    for (let i = folderIdx; i < rootIds.length; i++) {
      if (shouldAbort_()) { aborted = true; break; }
      setProp_('LIST_FOLDER', i.toString());
      const result = crawlFolder_(rootIds[i], listAll, chunkSize, longRun, funcName, i + 1, rootIds.length);
      if (result === 'suspended') { suspended = true; break; }
      if (result === 'aborted') { aborted = true; break; }
    }
    
    if (!suspended && !aborted) {
      const sheet = getSheet_();
      if (sheet) {
        removeLog_(sheet);
        const added = parseInt(props.getProperty('LIST_ADDED')) || 0;
        const startTime = parseInt(props.getProperty('LIST_START')) || Date.now();
        const runtime = formatTime_((Date.now() - startTime) / 1000);
        sheet.getRange(sheet.getLastRow() + 1, 1).setValue('✓ Sync done: ' + added + ' files added in ' + runtime);
      }
      ['FOLDERS','LIST_ADDED','LIST_FOLDER','LIST_START','LIST_BATCH','LIST_FOLDER_QUEUE','LIST_CHECKED'].forEach(k => delProp_(k));
      clearUser_();
      console.log('DEBUG: ListTask completed');
    } else if (suspended) {
      const triggers = ScriptApp.getProjectTriggers().length;
      console.log('DEBUG: ListTask suspended, triggers=' + triggers + ', will resume in ' + TRIGGER_DELAY + ' min');
    } else if (aborted) {
      console.log('DEBUG: ListTask aborted by user');
    }
  } finally {
    longRun.end(funcName);
  }
}

function crawlFolder_(rootId, listAll, chunkSize, longRun, funcName, folderNum, totalFolders) {
  const sheet = getSheet_();
  if (!sheet) return 'error';
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  
  const props = PropertiesService.getScriptProperties();
  const user = props.getProperty('RUN_USER') || 'Unknown';
  const startTime = parseInt(props.getProperty('LIST_START')) || Date.now();
  let batchIdx = parseInt(props.getProperty('LIST_BATCH')) || 0;
  let totalCheckedPersisted = parseInt(props.getProperty('LIST_CHECKED')) || 0;
  
  const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
  console.log('DEBUG: crawlFolder_ started, batchIdx=' + batchIdx + ', totalElapsed=' + elapsedSec + 's, totalChecked=' + totalCheckedPersisted);
  
  // Remove ALL status/abort rows at bottom
  let lastRow = sheet.getLastRow();
  let deletedRows = 0;
  while (lastRow > 1) {
    const lastVal = sheet.getRange(lastRow, 1).getValue();
    if (typeof lastVal === 'string' && (lastVal.startsWith('⏳') || lastVal.startsWith('🛑') || lastVal.startsWith('✓'))) {
      sheet.deleteRow(lastRow);
      lastRow--;
      deletedRows++;
    } else {
      break;
    }
  }
  if (deletedRows > 0) {
    console.log('DEBUG: deleted ' + deletedRows + ' status row(s)');
    SpreadsheetApp.flush();
  }
  
  // Build seen set from existing names (column B)
  // Using just filename ensures no duplicates across folders
  const seen = new Set();
  if (lastRow > 1) {
    sheet.getRange(2, 2, lastRow - 1, 1).getValues().flat().filter(String).forEach(n => seen.add(n));
  }
  console.log('DEBUG: seen set built with ' + seen.size + ' entries');
  
  const root = DriveApp.getFolderById(rootId);
  const rootName = root.getName();
  
  const buffer = [];
  let nextRow = lastRow + 1;
  let added = parseInt(props.getProperty('LIST_ADDED')) || 0;
  let suspended = false;
  let checkedCount = 0;
  
  // Status helper
  const getStatus = () => {
    const runtime = formatTime_((Date.now() - startTime) / 1000);
    return '⏳ ' + user + ' | Folder ' + folderNum + '/' + totalFolders + ' "' + rootName + '" | Added: ' + added + ' | Run: ' + runtime;
  };
  
  updateLog_(sheet, getStatus());
  
  // Add root folder if not seen
  if (!seen.has(rootName)) {
    buffer.push(buildRowFromMeta_(rootName, rootName, 'Folder', root.getUrl(), root.getDateCreated(), root.getDescription(), 0, root.getOwner().getEmail(), ''));
    seen.add(rootName);
    added++;
  }
  
  const fields = 'nextPageToken, files(id, name, mimeType, webViewLink, createdTime, description, size, owners, imageMediaMetadata)';
  
  // Use a queue of folders to process (persisted in properties)
  // Each queue item: { id, path, pageToken (optional) }
  let folderQueueStr = props.getProperty('LIST_FOLDER_QUEUE') || '';
  let folderQueue = folderQueueStr ? JSON.parse(folderQueueStr) : [{ id: rootId, path: rootName }];
  
  // Persisted total checked count (across all subprocesses)
  let totalChecked = parseInt(props.getProperty('LIST_CHECKED')) || 0;
  
  // Save state helper
  const saveState = (pageToken) => {
    // Save pageToken in current folder item so we resume from correct page
    if (folderQueue.length > 0 && pageToken) {
      folderQueue[0].pageToken = pageToken;
    }
    setProp_('LIST_FOLDER_QUEUE', JSON.stringify(folderQueue));
    setProp_('LIST_CHECKED', totalChecked.toString());
  };
  
  // Process folders from queue (breadth-first)
  while (folderQueue.length > 0 && !suspended) {
    if (shouldAbort_()) break;
    
    const current = folderQueue[0]; // Peek at first item
    const folderId = current.id;
    const path = current.path;
    let folderPageToken = current.pageToken || null; // Resume from saved page token
    
    // Check suspend before processing folder
    if (longRun.checkShouldSuspend(funcName, batchIdx)) {
      console.log('DEBUG: checkShouldSuspend TRUE, saving state');
      setProp_('LIST_BATCH', batchIdx.toString());
      setProp_('LIST_ADDED', added.toString());
      saveState(folderPageToken);
      suspended = true;
      break;
    }
    
    if (folderPageToken) {
      console.log('DEBUG: resuming folder "' + path + '" from saved page token');
    }
    
    do {
      if (suspended || shouldAbort_()) break;
      
      // Get batch of files/folders from this folder
      const response = Drive.Files.list({
        q: "'" + folderId + "' in parents and trashed = false",
        fields: fields,
        pageSize: 1000,
        pageToken: folderPageToken
      });
      
      const files = response.files || [];
      totalChecked += files.length;
      checkedCount += files.length;
      console.log('DEBUG: API returned ' + files.length + ' items, totalChecked=' + totalChecked);
      
      // Save the next page token for potential resume
      folderPageToken = response.nextPageToken;
      
      // Check suspend AFTER each API call (API calls can take 30-90s each)
      if (longRun.checkShouldSuspend(funcName, batchIdx)) {
        console.log('DEBUG: checkShouldSuspend TRUE after API call');
        setProp_('LIST_BATCH', batchIdx.toString());
        setProp_('LIST_ADDED', added.toString());
        saveState(folderPageToken);
        suspended = true;
        break;
      }
      
      for (const file of files) {
        if (suspended || shouldAbort_()) break;
        
        const name = file.name;
        const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
        
        // Skip _temp folders
        if (isFolder && name.endsWith('_temp')) continue;
        
        // Queue subfolders for later processing
        if (isFolder && listAll) {
          folderQueue.push({ id: file.id, path: path ? path + '/' + name : name });
        }
        
        if (!seen.has(name)) {
          const kind = isFolder ? 'Folder' : 'File';
          const capture = (file.imageMediaMetadata && file.imageMediaMetadata.time) ? parseCaptureDate_(file.imageMediaMetadata.time) : '';
          const ownerEmail = (file.owners && file.owners.length > 0) ? file.owners[0].emailAddress : '';
          
          buffer.push(buildRowFromMeta_(path ? path + '/' + name : name, name, kind, file.webViewLink, new Date(file.createdTime), file.description || '', (file.size || 0) / 1024, ownerEmail, capture));
          seen.add(name);
          added++;
          
          // Flush if buffer full
          if (buffer.length >= chunkSize) {
            batchIdx++;
            setProp_('LIST_ADDED', added.toString());
            setProp_('LIST_BATCH', batchIdx.toString());
            nextRow = flushBufferWithStatus_(sheet, buffer, nextRow, getStatus());
            console.log('DEBUG: flushed batch, batchIdx=' + batchIdx + ', added=' + added);
            
            if (longRun.checkShouldSuspend(funcName, batchIdx)) {
              console.log('DEBUG: checkShouldSuspend TRUE after flush');
              saveState(folderPageToken);
              suspended = true;
              break;
            }
          }
        }
      }
      
    } while (folderPageToken && !suspended && !shouldAbort_());
    
    // Remove completed folder from queue (only if not suspended mid-folder)
    if (!suspended && !folderPageToken) {
      folderQueue.shift();
      console.log('DEBUG: folder "' + path + '" done, queue size=' + folderQueue.length);
    }
  }
  
  console.log('DEBUG: processFolder finished, suspended=' + suspended + ', buffer.length=' + buffer.length + ', added=' + added + ', totalChecked=' + totalChecked + ', queueLeft=' + folderQueue.length);
  
  // Flush remaining buffer
  if (buffer.length) {
    setProp_('LIST_ADDED', added.toString());
    flushBufferWithStatus_(sheet, buffer, nextRow, getStatus());
    console.log('DEBUG: final flush, total added=' + added);
  }
  
  // Final status update
  if (!suspended && folderQueue.length === 0) {
    updateLog_(sheet, getStatus());
    console.log('DEBUG: folder "' + rootName + '" completed');
    delProp_('LIST_FOLDER_QUEUE');
    delProp_('LIST_CHECKED');
  } else if (suspended) {
    saveState(null); // Save queue state without changing pageToken
  }
  
  if (shouldAbort_()) return 'aborted';
  return suspended ? 'suspended' : 'done';
}

// Build row from API metadata (no extra API calls needed)
function buildRowFromMeta_(fullPath, name, kind, url, createdDate, description, sizeKb, ownerEmail, captureDate) {
  return [fullPath, name, kind, captureDate, url, createdDate, description, sizeKb, ownerEmail];
}

// Parse EXIF date string
function parseCaptureDate_(timeStr) {
  if (!timeStr) return '';
  const m = timeStr.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  return m ? new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + 'Z') : timeStr;
}

// ─── HELPERS ───
function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName('Photo_links');
}

function promptFolders_() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Photo_links') {
    ui.alert('⚠️ Error', 'Please run this on the "Photo_links" sheet.', ui.ButtonSet.OK);
    return null;
  }
  
  const keys = Object.keys(FOLDER_MAPPING);
  let prompt = 'Enter folder numbers (e.g. 1,3,5):\n\n';
  keys.forEach((k, i) => prompt += (i + 1) + '. ' + k + '\n');
  
  const resp = ui.prompt('📁 Select Folders', prompt, ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return null;
  
  const text = resp.getResponseText();
  if (!text) return null;
  
  const tokens = text.split(/[ ,]+/).map(t => t.trim()).filter(Boolean);
  if (!tokens.length) return null;
  
  return tokens.map(t => {
    if (!isNaN(t) && +t >= 1 && +t <= keys.length) return FOLDER_MAPPING[keys[+t - 1]];
    return t;
  });
}

function canStart_() {
  const props = PropertiesService.getScriptProperties();
  const runningUser = props.getProperty('RUN_USER');
  const currentUser = Session.getActiveUser().getEmail() || 'Unknown';
  
  if (runningUser && runningUser !== currentUser) {
    const started = props.getProperty('RUN_START');
    const runtime = started ? formatTime_((Date.now() - parseInt(started)) / 1000) : 'unknown';
    SpreadsheetApp.getUi().alert('⏳ Script Busy', 
      '👤 Script is being run by: ' + runningUser + '\n' +
      '⏱️ Runtime: ' + runtime + '\n\n' +
      'Wait for it to finish or use Stop Script.', 
      SpreadsheetApp.getUi().ButtonSet.OK);
    return false;
  }
  
  // Clear stale abort flag
  delProp_('ABORT');
  return true;
}

function setUser_() {
  const user = Session.getActiveUser().getEmail() || 'Unknown';
  setProp_('RUN_USER', user);
  setProp_('RUN_START', Date.now().toString());
}

function clearUser_() {
  delProp_('RUN_USER');
  delProp_('RUN_TASK');
  delProp_('RUN_START');
}

function initTask_(funcName, params) {
  setProp_('RUN_TASK', funcName);
  LongRun.instance.setParameters(funcName, params);
  if (funcName === 'CleanTask') CleanTask();
  else if (funcName === 'ListTask') ListTask();
}

function cleanup_(funcName) {
  delProp_('ABORT');
  try { LongRun.instance.reset(funcName); } catch(e) {}
  clearUser_();
}

function shouldAbort_() {
  return PropertiesService.getScriptProperties().getProperty('ABORT') === 'true';
}

function setProp_(key, val) {
  PropertiesService.getScriptProperties().setProperty(key, val);
}

function delProp_(key) {
  PropertiesService.getScriptProperties().deleteProperty(key);
}

function updateLog_(sheet, msg) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) {
    sheet.getRange(1, 1).setValue(msg);
    SpreadsheetApp.flush();
    return;
  }
  const val = sheet.getRange(lastRow, 1).getValue();
  if (typeof val === 'string' && val.startsWith('⏳')) {
    sheet.getRange(lastRow, 1).setValue(msg);
  } else {
    sheet.getRange(lastRow + 1, 1).setValue(msg);
  }
  SpreadsheetApp.flush();
}

function removeLog_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 0) {
    const val = sheet.getRange(lastRow, 1).getValue();
    if (typeof val === 'string' && val.startsWith('⏳')) {
      sheet.deleteRow(lastRow);
      SpreadsheetApp.flush();
    }
  }
}

function formatTime_(sec) {
  if (!sec || sec < 0) return '0s';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

function flushBufferWithStatus_(sheet, buffer, startRow, statusMsg) {
  // Check if last row is status row, if so overwrite it
  const lastRow = sheet.getLastRow();
  let writeRow = startRow;
  if (lastRow > 0) {
    const val = sheet.getRange(lastRow, 1).getValue();
    if (typeof val === 'string' && val.startsWith('⏳')) {
      writeRow = lastRow; // Overwrite status row with data
    }
  }
  
  // Build data rows
  const rows = buffer.map((row, i) => {
    const r = writeRow + i;
    const formula = (row[2] === 'File')
      ? '=REGEXREPLACE(REGEXREPLACE(B' + r + ',\"\\.(jpg|HEIC|heic)$\",\".JPG\"),\"([vd])1\\.(JPG)$\",\"$1.JPG\")'
      : '';
    return [...row, formula];
  });
  
  // Add status row at the end
  const statusRow = [statusMsg, '', '', '', '', '', '', '', '', ''];
  rows.push(statusRow);
  
  // Write all rows at once (data + status)
  sheet.getRange(writeRow, 1, rows.length, HEADERS.length).setValues(rows);
  SpreadsheetApp.flush();
  
  buffer.length = 0;
  return writeRow + rows.length - 1; // Return next data row (excluding status)
}