/**
 * ============================================================================
 * Storage Audit & Cleaner Pro
 * File: storage_audit.js
 * 
 * Sistem Audit Penyimpanan Native Node.js (Zero Dependencies / Tanpa npm install)
 * Menggunakan modul native: http, fs, path, crypto, child_process, os.
 * ============================================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { exec } = require('child_process');

const DEFAULT_PORT = 3000;
const DEFAULT_TARGET_FOLDER = './Bahan Latihan P12';
const GIANT_FILE_THRESHOLD = 2 * 1024 * 1024; // 2 MB sesuai tampilan visual screenshot (≥ 2 MB)

// Helper format ukuran file
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Fungsi hashing SHA-256 streaming
function getFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

// Pemindaian rekursif seluruh file dalam folder
async function scanDirectory(dirPath, rootPath = null) {
  if (!rootPath) rootPath = dirPath;
  let fileList = [];

  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    console.error(`Gagal membaca direktori: ${dirPath}`, err.message);
    return fileList;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    try {
      if (entry.isDirectory()) {
        const subFiles = await scanDirectory(fullPath, rootPath);
        fileList = fileList.concat(subFiles);
      } else if (entry.isFile()) {
        const stats = fs.statSync(fullPath);
        const relPath = path.relative(rootPath, fullPath) || entry.name;
        const normalizedRelPath = relPath.replace(/\\/g, '/');
        const folderDir = path.dirname(normalizedRelPath);
        const ext = path.extname(entry.name).toLowerCase();
        const extClean = ext.replace('.', '').toUpperCase() || 'FILE';
        const isTmp = ext === '.tmp';
        const isGiant = stats.size >= GIANT_FILE_THRESHOLD;

        let sha256 = '';
        try {
          sha256 = await getFileSha256(fullPath);
        } catch (hashErr) {
          sha256 = 'ERROR_HASH';
        }

        fileList.push({
          fileName: entry.name,
          relativePath: normalizedRelPath,
          folderDir: folderDir === '.' ? '' : folderDir,
          absolutePath: path.resolve(fullPath),
          sizeBytes: stats.size,
          sizeFormatted: formatBytes(stats.size),
          format: extClean,
          sha256: sha256,
          isTmp: isTmp,
          isGiant: isGiant,
          mtime: stats.mtime.toISOString(),
          mtimeMs: stats.mtimeMs
        });
      }
    } catch (e) {
      console.warn(`Gagal memproses file ${fullPath}:`, e.message);
    }
  }

  return fileList;
}

// Analisis audit penyimpanan berdasarkan daftar file
function analyzeFiles(files, rootPath) {
  const totalFiles = files.length;
  let totalBytes = 0;
  const giantFiles = [];
  const hashMap = new Map();
  const tmpFiles = [];
  const subfoldersSet = new Set();

  for (const file of files) {
    totalBytes += file.sizeBytes;

    if (file.folderDir) {
      subfoldersSet.add(file.folderDir);
    }

    if (file.isGiant) {
      giantFiles.push(file);
    }

    if (file.isTmp) {
      tmpFiles.push(file);
    }

    if (file.sha256 && file.sha256 !== 'ERROR_HASH') {
      if (!hashMap.has(file.sha256)) {
        hashMap.set(file.sha256, []);
      }
      hashMap.get(file.sha256).push(file);
    }
  }

  // Filter kelompok duplikat
  const duplicateGroups = [];
  let potentialDuplicateSavingBytes = 0;

  for (const [hash, groupFiles] of hashMap.entries()) {
    if (groupFiles.length >= 2) {
      groupFiles.sort((a, b) => a.mtimeMs - b.mtimeMs || a.relativePath.length - b.relativePath.length);

      const originalFile = groupFiles[0];
      const duplicatesToDelete = groupFiles.slice(1);
      const groupFileSize = originalFile.sizeBytes;
      const wastedBytes = duplicatesToDelete.length * groupFileSize;

      potentialDuplicateSavingBytes += wastedBytes;

      duplicateGroups.push({
        hash: hash,
        count: groupFiles.length,
        fileSize: groupFileSize,
        fileSizeFormatted: formatBytes(groupFileSize),
        wastedBytes: wastedBytes,
        wastedFormatted: formatBytes(wastedBytes),
        originalFile: originalFile,
        duplicateFiles: duplicatesToDelete,
        allFiles: groupFiles
      });
    }
  }

  duplicateGroups.sort((a, b) => b.wastedBytes - a.wastedBytes);
  const top20DuplicateGroups = duplicateGroups.slice(0, 20);

  giantFiles.sort((a, b) => b.sizeBytes - a.sizeBytes);
  const top15GiantFiles = giantFiles.slice(0, 15);

  let potentialTmpSavingBytes = 0;
  const duplicateAbsolutePaths = new Set();
  duplicateGroups.forEach(g => g.duplicateFiles.forEach(f => duplicateAbsolutePaths.add(f.absolutePath)));

  for (const tmp of tmpFiles) {
    if (!duplicateAbsolutePaths.has(tmp.absolutePath)) {
      potentialTmpSavingBytes += tmp.sizeBytes;
    }
  }

  const totalPotentialSavingBytes = potentialDuplicateSavingBytes + potentialTmpSavingBytes;
  const subfoldersList = Array.from(subfoldersSet).sort();

  return {
    rootPath: path.resolve(rootPath),
    subfolders: subfoldersList,
    metrics: {
      totalFiles: totalFiles,
      totalBytes: totalBytes,
      totalFormatted: formatBytes(totalBytes),
      giantFilesCount: giantFiles.length,
      giantFilesTotalBytes: giantFiles.reduce((acc, f) => acc + f.sizeBytes, 0),
      giantFilesTotalFormatted: formatBytes(giantFiles.reduce((acc, f) => acc + f.sizeBytes, 0)),
      potentialSavingBytes: totalPotentialSavingBytes,
      potentialSavingFormatted: formatBytes(totalPotentialSavingBytes),
      duplicateGroupsCount: duplicateGroups.length,
      tmpFilesCount: tmpFiles.length
    },
    top15GiantFiles: top15GiantFiles,
    top20DuplicateGroups: top20DuplicateGroups,
    tmpFiles: tmpFiles,
    allFilesCount: files.length
  };
}

// In-place Cleaner
function executeCleanUp(targetFolderPath, filePathsToDelete = null) {
  const resolvedTarget = path.resolve(targetFolderPath);
  if (!fs.existsSync(resolvedTarget)) {
    throw new Error(`Target folder tidak ditemukan: ${resolvedTarget}`);
  }

  const results = {
    deletedFiles: [],
    failedFiles: [],
    freedBytes: 0,
    freedFormatted: '0 B'
  };

  let pathsToDelete = [];
  if (Array.isArray(filePathsToDelete) && filePathsToDelete.length > 0) {
    pathsToDelete = filePathsToDelete;
  }

  for (const itemPath of pathsToDelete) {
    const resolvedItem = path.resolve(itemPath);
    const relative = path.relative(resolvedTarget, resolvedItem);
    const isInsideTarget = relative && !relative.startsWith('..') && !path.isAbsolute(relative);

    if (!isInsideTarget) {
      results.failedFiles.push({
        path: resolvedItem,
        reason: 'Keamanan: File berada di luar folder target yang dipindai.'
      });
      continue;
    }

    try {
      if (fs.existsSync(resolvedItem)) {
        const stats = fs.statSync(resolvedItem);
        const size = stats.size;
        fs.unlinkSync(resolvedItem);
        results.freedBytes += size;
        results.deletedFiles.push({
          path: resolvedItem,
          relativePath: relative.replace(/\\/g, '/'),
          sizeBytes: size,
          sizeFormatted: formatBytes(size)
        });
      }
    } catch (err) {
      results.failedFiles.push({
        path: resolvedItem,
        reason: err.message
      });
    }
  }

  results.freedFormatted = formatBytes(results.freedBytes);
  return results;
}

// Mencari lokasi fisik folder di harddisk jika pengguna memilih via browser upload folder
function resolvePhysicalFolderPath(folderName) {
  if (!folderName) return null;

  // Daftar kandidat lokasi pencarian di komputer pengguna
  const userHome = os.homedir();
  const candidates = [
    path.resolve(folderName),
    path.resolve('.', folderName),
    path.resolve('..', folderName),
    path.join(userHome, 'Desktop', folderName),
    path.join(userHome, 'Documents', folderName),
    path.join(userHome, 'Downloads', folderName),
    path.join(userHome, 'Documents', 'StorageCleaner', folderName),
    path.join(userHome, folderName)
  ];

  for (const cand of candidates) {
    try {
      if (fs.existsSync(cand) && fs.statSync(cand).isDirectory()) {
        return path.resolve(cand);
      }
    } catch (e) {}
  }

  // Jika folder bernama "Bahan Latihan P12"
  if (folderName.toLowerCase().includes('bahan latihan')) {
    const p12 = path.resolve('Bahan Latihan P12');
    if (fs.existsSync(p12)) return p12;
  }

  // Fallback: jika folderName adalah path lengkap
  if (fs.existsSync(folderName) && fs.statSync(folderName).isDirectory()) {
    return path.resolve(folderName);
  }

  return null;
}

// Helper membuka native Windows File Explorer dialog picker
function openNativeFileExplorer(initialDir = '') {
  return new Promise((resolve) => {
    const psScript = path.resolve(__dirname, 'browse_folder.ps1');
    const resolvedInitial = initialDir && fs.existsSync(path.resolve(initialDir)) ? path.resolve(initialDir) : path.resolve('.');
    const cmd = `powershell.exe -STA -NoProfile -ExecutionPolicy Bypass -File "${psScript}" -InitialDirectory "${resolvedInitial}"`;

    console.log(`[FILE EXPLORER] Membuka jendela File Explorer OS...`);
    exec(cmd, { windowsHide: false }, (err, stdout, stderr) => {
      if (err) {
        console.warn(`[FILE EXPLORER WARN]`, err.message);
        return resolve({ success: false, error: err.message });
      }

      const result = (stdout || '').trim();
      if (!result || result === 'CANCELLED') {
        console.log(`[FILE EXPLORER] Pemilihan folder dibatalkan.`);
        return resolve({ success: false, cancelled: true });
      }

      console.log(`[FILE EXPLORER] Berhasil memilih folder: ${result}`);
      return resolve({ success: true, folderPath: result });
    });
  });
}

// Handler request body JSON
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        if (!body) return resolve({});
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', err => reject(err));
  });
}

// Template HTML + CSS + JS Web Dashboard UI
function getDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Storage Audit & Cleaner - Pembersihan Storage Riil</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #0a0e17;
      --bg-card: #111827;
      --bg-card-subtle: #172033;
      --border-color: rgba(255, 255, 255, 0.08);
      --border-hover: rgba(59, 130, 246, 0.4);
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      
      --accent-blue: #2563eb;
      --accent-cyan: #0ea5e9;
      --accent-green: #10b981;
      --accent-amber: #f59e0b;
      --accent-rose: #f43f5e;
      --accent-purple: #8b5cf6;

      --radius-sm: 8px;
      --radius-md: 12px;
      --radius-lg: 16px;
      --radius-xl: 20px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: var(--bg-dark);
      color: var(--text-main);
      min-height: 100vh;
      line-height: 1.5;
      padding: 24px;
      background-image: 
        radial-gradient(circle at 10% 10%, rgba(14, 165, 233, 0.08) 0%, transparent 40%),
        radial-gradient(circle at 90% 20%, rgba(139, 92, 246, 0.08) 0%, transparent 40%);
    }

    .container {
      max-width: 1320px;
      margin: 0 auto;
    }

    /* Top Navigation Header */
    .top-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      flex-wrap: wrap;
      gap: 16px;
    }

    .brand-section {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .brand-icon-box {
      width: 44px;
      height: 44px;
      border-radius: var(--radius-md);
      background: linear-gradient(135deg, #0284c7, #0ea5e9);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      box-shadow: 0 4px 15px rgba(14, 165, 233, 0.35);
    }

    .brand-title-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .brand-title {
      font-size: 20px;
      font-weight: 800;
      color: #fff;
      letter-spacing: -0.01em;
    }

    .badge-direct-exec {
      font-size: 11px;
      font-weight: 700;
      color: #4ade80;
      background: rgba(34, 197, 94, 0.12);
      border: 1px solid rgba(34, 197, 94, 0.35);
      padding: 3px 10px;
      border-radius: 9999px;
      letter-spacing: 0.03em;
    }

    .brand-subtitle {
      font-size: 13px;
      color: var(--text-muted);
      font-weight: 500;
      margin-top: 2px;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 10px 18px;
      border-radius: var(--radius-md);
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s ease;
      border: none;
      text-decoration: none;
      white-space: nowrap;
    }

    .btn-rescan {
      background: #1e293b;
      color: #cbd5e1;
      border: 1px solid rgba(255, 255, 255, 0.12);
    }

    .btn-rescan:hover {
      background: #273549;
      color: #fff;
    }

    .btn-clean-primary {
      background: linear-gradient(135deg, #e11d48, #f43f5e);
      color: #fff;
      box-shadow: 0 4px 15px rgba(225, 29, 72, 0.4);
    }

    .btn-clean-primary:hover:not(:disabled) {
      background: linear-gradient(135deg, #be123c, #e11d48);
      transform: translateY(-1px);
    }

    .btn-clean-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      filter: grayscale(0.8);
    }

    /* Target Harddisk Aktif Card */
    .target-bar-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      padding: 16px 20px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    }

    .target-info-side {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
      flex: 1;
    }

    .folder-gold-icon {
      font-size: 26px;
      line-height: 1;
    }

    .target-label {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 3px;
    }

    .target-path-text {
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      font-weight: 700;
      color: #38bdf8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 600px;
    }

    .target-buttons-group {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .btn-browse-os {
      background: #2563eb;
      color: #fff;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);
    }

    .btn-browse-os:hover {
      background: #1d4ed8;
      transform: translateY(-1px);
    }

    .btn-upload-folder {
      background: #059669;
      color: #fff;
      box-shadow: 0 4px 12px rgba(5, 150, 105, 0.35);
    }

    .btn-upload-folder:hover {
      background: #047857;
      transform: translateY(-1px);
    }

    .btn-input-path {
      background: #334155;
      color: #f1f5f9;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .btn-input-path:hover {
      background: #475569;
    }

    /* 4 Storage Metric Cards */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 18px;
      margin-bottom: 28px;
    }

    @media (max-width: 1024px) {
      .metrics-grid { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 640px) {
      .metrics-grid { grid-template-columns: 1fr; }
    }

    .metric-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      padding: 20px 22px;
      position: relative;
      overflow: hidden;
      transition: transform 0.2s, border-color 0.2s;
    }

    .metric-card:hover {
      transform: translateY(-2px);
      border-color: var(--border-hover);
    }

    .metric-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
    }

    .metric-card.card-blue::before { background: #38bdf8; }
    .metric-card.card-purple::before { background: #a855f7; }
    .metric-card.card-amber::before { background: #f59e0b; }
    .metric-card.card-gold::before { background: #34d399; }

    .metric-top-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .metric-card-title {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .metric-card-icon {
      font-size: 18px;
    }

    .metric-main-value {
      font-size: 32px;
      font-weight: 800;
      color: #fff;
      line-height: 1.1;
      margin-bottom: 8px;
      letter-spacing: -0.02em;
    }

    .metric-sub-text {
      font-size: 12px;
      color: var(--text-dim);
      font-weight: 500;
    }

    /* Giant Files Section */
    .content-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      padding: 24px;
      margin-bottom: 28px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    }

    .card-header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      flex-wrap: wrap;
      gap: 14px;
    }

    .card-title-group {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .card-header-title {
      font-size: 17px;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .count-pill {
      font-size: 11px;
      font-weight: 700;
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
      padding: 3px 10px;
      border-radius: 9999px;
    }

    .search-box-wrap {
      position: relative;
      width: 260px;
    }

    .search-input {
      width: 100%;
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: var(--radius-sm);
      padding: 8px 14px;
      font-size: 13px;
      color: #fff;
      outline: none;
    }

    .search-input:focus {
      border-color: #38bdf8;
    }

    /* Table */
    .table-responsive {
      overflow-x: auto;
      border-radius: var(--radius-md);
      border: 1px solid rgba(255, 255, 255, 0.05);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }

    th {
      background: #0b1120;
      color: var(--text-muted);
      font-weight: 700;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 14px 16px;
      border-bottom: 1px solid var(--border-color);
    }

    td {
      padding: 14px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: var(--text-main);
      vertical-align: middle;
    }

    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(255, 255, 255, 0.02); }

    .file-name-container {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 600;
      color: #f1f5f9;
    }

    .file-icon {
      font-size: 16px;
      opacity: 0.85;
    }

    .file-path-col {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: var(--text-dim);
      max-width: 480px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-size-col {
      font-weight: 700;
      font-family: 'JetBrains Mono', monospace;
      color: #fff;
    }

    .format-pill {
      display: inline-block;
      font-size: 10px;
      font-weight: 800;
      padding: 3px 8px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.07);
      color: #cbd5e1;
      border: 1px solid rgba(255, 255, 255, 0.12);
      letter-spacing: 0.05em;
    }

    /* Accordion for Duplicates */
    .accordion-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .accordion-item {
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      overflow: hidden;
    }

    .accordion-item.active {
      border-color: rgba(99, 102, 241, 0.4);
    }

    .accordion-header {
      padding: 14px 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
    }

    .accordion-header:hover { background: rgba(255, 255, 255, 0.02); }

    .accordion-body {
      padding: 0 18px 16px 18px;
      display: none;
      border-top: 1px solid rgba(255, 255, 255, 0.04);
    }

    .accordion-item.active .accordion-body { display: block; }

    .file-row-dup {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      margin-top: 8px;
      background: rgba(0, 0, 0, 0.25);
      border-radius: var(--radius-sm);
      font-size: 12px;
    }

    /* Input Path Modal */
    .modal-backdrop {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(8px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 20px;
    }

    .modal-backdrop.show { display: flex; }

    .modal-box {
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: var(--radius-lg);
      max-width: 600px;
      width: 100%;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
      padding: 24px;
    }

    .modal-title {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .modal-desc {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 16px;
    }

    .modal-input {
      width: 100%;
      background: #090d16;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: var(--radius-md);
      padding: 12px 16px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      color: #fff;
      margin-bottom: 16px;
      outline: none;
    }

    .modal-input:focus { border-color: #38bdf8; }

    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }

    /* Toast Notification Bottom Right */
    .toast-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2000;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 440px;
    }

    .toast-pill {
      background: #111827;
      border: 1px solid rgba(255, 255, 255, 0.12);
      padding: 12px 18px;
      border-radius: var(--radius-md);
      box-shadow: 0 10px 30px rgba(0,0,0,0.6);
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      animation: slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      backdrop-filter: blur(12px);
    }

    .toast-info {
      border-color: rgba(56, 189, 248, 0.4);
      background: rgba(15, 23, 42, 0.95);
      color: #7dd3fc;
    }

    .toast-success {
      border-color: rgba(34, 197, 94, 0.4);
      background: rgba(6, 78, 59, 0.95);
      color: #86efac;
    }

    .toast-error {
      border-color: rgba(239, 68, 68, 0.4);
      background: rgba(127, 29, 29, 0.95);
      color: #fca5a5;
    }

    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      border-top-color: #fff;
      animation: spin 0.8s linear infinite;
      display: inline-block;
    }

    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <!-- Top Navigation Header -->
    <div class="top-header">
      <div class="brand-section">
        <div class="brand-icon-box">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
          </svg>
        </div>
        <div>
          <div class="brand-title-wrap">
            <h1 class="brand-title">Storage Audit & Cleaner</h1>
            <span class="badge-direct-exec">Direct Execution</span>
          </div>
          <p class="brand-subtitle">Pembersihan Storage Riil di Harddisk Komputer</p>
        </div>
      </div>

      <div class="header-actions">
        <button id="btnPindaiUlang" class="btn btn-rescan" onclick="triggerScan()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
          <span id="btnPindaiText">Pindai Ulang</span>
        </button>

        <button id="btnCleanAction" class="btn btn-clean-primary" onclick="openCleanModal()" disabled>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path>
          </svg>
          <span>Bersihkan Duplikat & Sampah</span>
        </button>
      </div>
    </div>

    <!-- TARGET HARDDISK AKTIF BAR (Sesuai Screenshot User) -->
    <div class="target-bar-card">
      <div class="target-info-side">
        <div class="folder-gold-icon">📁</div>
        <div style="min-width: 0;">
          <div class="target-label">TARGET HARDDISK AKTIF:</div>
          <div class="target-path-text" id="activeHarddiskPath">C:\\Users\\Student\\Documents\\StorageCleaner\\Bahan Latihan P12</div>
        </div>
      </div>

      <div class="target-buttons-group">
        <!-- 1. Browse Folder (Dialog OS) -->
        <button id="btnBrowseOS" class="btn btn-browse-os" onclick="browseFolderOSDialog()" title="Buka dialog File Explorer Windows bawaan komputer">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <span id="browseOSText">Browse Folder (Dialog OS)</span>
        </button>

        <!-- 2. Pilih / Upload Folder (Browser Native Directory Picker) -->
        <button id="btnUploadFolder" class="btn btn-upload-folder" onclick="triggerBrowserFolderPicker()" title="Pilih folder langsung dari peramban">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
          <span>Pilih / Upload Folder</span>
        </button>
        <!-- Hidden file input for webkitdirectory -->
        <input type="file" id="browserFolderPickerInput" webkitdirectory directory multiple style="display: none;" onchange="onBrowserFolderSelected(event)">

        <!-- 3. Input Path -->
        <button id="btnInputPath" class="btn btn-input-path" onclick="openInputPathModal()" title="Ketik atau tempel path folder manual">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
          <span>Input Path</span>
        </button>
      </div>
    </div>

    <!-- 4 KARTU METRIK STORAGE (Persis Layout & Warna Screenshot) -->
    <div class="metrics-grid">
      <!-- 1. Total File Di-Scan -->
      <div class="metric-card card-blue">
        <div class="metric-top-row">
          <span class="metric-card-title">TOTAL FILE DI-SCAN</span>
          <span class="metric-card-icon">📁</span>
        </div>
        <div class="metric-main-value" id="valTotalFiles">0</div>
        <div class="metric-sub-text">STG-01: Memindai seluruh file rekursif</div>
      </div>

      <!-- 2. Total Kapasitas Folder -->
      <div class="metric-card card-purple">
        <div class="metric-top-row">
          <span class="metric-card-title">TOTAL KAPASITAS FOLDER</span>
          <span class="metric-card-icon">💾</span>
        </div>
        <div class="metric-main-value" id="valTotalKapasitas">0 B</div>
        <div class="metric-sub-text">Ukuran data fisik asli di disk</div>
      </div>

      <!-- 3. File Raksasa (≥ 2 MB) -->
      <div class="metric-card card-amber">
        <div class="metric-top-row">
          <span class="metric-card-title">FILE RAKSASA (≥ 2 MB)</span>
          <span class="metric-card-icon">⚠️</span>
        </div>
        <div class="metric-main-value" id="valGiantFiles">0</div>
        <div class="metric-sub-text">STG-03: Terdeteksi file boros kuota</div>
      </div>

      <!-- 4. Potensi Hemat Ruang -->
      <div class="metric-card card-gold">
        <div class="metric-top-row">
          <span class="metric-card-title">POTENSI HEMAT RUANG</span>
          <span class="metric-card-icon">✨</span>
        </div>
        <div class="metric-main-value" id="valPotensiHemat">0 B</div>
        <div class="metric-sub-text">Duplikat identik & file sampah .tmp</div>
      </div>
    </div>

    <!-- TABEL DAFTAR FILE RAKSASA (≥ 2 MB) -->
    <div class="content-card">
      <div class="card-header-bar">
        <div class="card-title-group">
          <h2 class="card-header-title">
            <span>📦</span>
            <span>Daftar File Raksasa (≥ 2 MB)</span>
          </h2>
          <span class="count-pill" id="giantFilesCountPill">0 file</span>
        </div>

        <div class="search-box-wrap">
          <input type="text" id="giantSearchInput" class="search-input" placeholder="Cari file raksasa..." oninput="filterGiantTable()">
        </div>
      </div>

      <div class="table-responsive">
        <table>
          <thead>
            <tr>
              <th style="width: 320px;">NAMA FILE</th>
              <th>PATH LOKASI HARDDISK</th>
              <th style="width: 130px;">UKURAN</th>
              <th style="width: 90px; text-align: center;">FORMAT</th>
            </tr>
          </thead>
          <tbody id="giantTableBody">
            <tr>
              <td colspan="4" style="text-align: center; color: var(--text-dim); padding: 30px;">
                Memuat data berkas dari harddisk...
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- KELOMPOK DUPLIKAT IDENTIK (SHA-256) -->
    <div class="content-card">
      <div class="card-header-bar">
        <div class="card-title-group">
          <h2 class="card-header-title">
            <span>👥</span>
            <span>Kelompok Duplikat Identik (SHA-256 Hash)</span>
          </h2>
          <span class="count-pill" id="dupGroupsCountPill">0 kelompok</span>
        </div>
        <div style="font-size: 12px; color: var(--text-dim);">
          File dengan konten byte persis sama meskipun nama berbeda
        </div>
      </div>

      <div class="accordion-list" id="dupAccordionContainer">
        <div style="text-align: center; color: var(--text-dim); padding: 20px;">
          Tidak ada berkas duplikat yang terdeteksi.
        </div>
      </div>
    </div>

    <!-- FILE TEMPORARY (.tmp) -->
    <div class="content-card" id="tmpFilesCard" style="display: none;">
      <div class="card-header-bar">
        <div class="card-title-group">
          <h2 class="card-header-title">
            <span>🗑️</span>
            <span>File Temporary Sampah (.tmp)</span>
          </h2>
          <span class="count-pill" id="tmpCountPill">0 file</span>
        </div>
      </div>
      <div id="tmpFilesListWrap"></div>
    </div>

  </div>

  <!-- MODAL INPUT PATH -->
  <div class="modal-backdrop" id="inputPathModal">
    <div class="modal-box">
      <h3 class="modal-title">📝 Tentukan Folder Target Manual</h3>
      <p class="modal-desc">Ketik atau tempel path folder penyimpanan di harddisk Anda yang ingin dibersihkan:</p>
      <input type="text" id="manualPathInput" class="modal-input" placeholder="Contoh: C:\\Users\\...\\Downloads atau ./Bahan Latihan P12">
      
      <div style="margin-bottom: 16px;">
        <span style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Pilihan Cepat:</span>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px;">
          <button class="btn btn-rescan" style="padding: 4px 10px; font-size: 11px;" onclick="document.getElementById('manualPathInput').value = './Bahan Latihan P12'">Bahan Latihan P12</button>
          <button class="btn btn-rescan" style="padding: 4px 10px; font-size: 11px;" onclick="document.getElementById('manualPathInput').value = '.'">Workspace Saat Ini</button>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-rescan" onclick="closeInputPathModal()">Batal</button>
        <button class="btn btn-browse-os" onclick="applyManualPath()">Terapkan & Pindai</button>
      </div>
    </div>
  </div>

  <!-- MODAL KONFIRMASI PEMBERSIHAN -->
  <div class="modal-backdrop" id="cleanConfirmModal">
    <div class="modal-box">
      <h3 class="modal-title" style="color: #f43f5e;">⚠️ Konfirmasi Pembersihan In-Place</h3>
      <p class="modal-desc">
        Pembersihan dilakukan langsung pada folder harddisk:
        <br><strong id="cleanTargetDisplay" style="color: #38bdf8; font-family: monospace;"></strong>
      </p>

      <div style="background: rgba(255,255,255,0.04); border-radius: 8px; padding: 12px; margin-bottom: 16px; font-size: 13px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span>File Duplikat Redundant:</span>
          <strong id="cleanDupCount" style="color: #f87171;">0</strong>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span>File Sampah (.tmp):</span>
          <strong id="cleanTmpCount" style="color: #fbbf24;">0</strong>
        </div>
        <div style="display: flex; justify-content: space-between; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 6px;">
          <span>Kapasitas Dibebaskan:</span>
          <strong id="cleanFreedSize" style="color: #4ade80;">0 B</strong>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-rescan" onclick="closeCleanModal()">Batalkan</button>
        <button id="btnExecCleanModal" class="btn btn-clean-primary" onclick="executeCleanNow()">
          Konfirmasi Hapus Sekarang
        </button>
      </div>
    </div>
  </div>

  <!-- TOAST CONTAINER -->
  <div class="toast-container" id="toastBox"></div>

  <script>
    let currentAuditData = null;
    let currentTargetPath = './Bahan Latihan P12';
    let giantFilesCache = [];

    // Helper Toast
    function showToast(message, type = 'info') {
      const container = document.getElementById('toastBox');
      const toast = document.createElement('div');
      toast.className = 'toast-pill toast-' + type;
      toast.innerHTML = '<span>' + message + '</span>';
      container.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
      }, 4000);
    }

    // 1. CARA 1: Browse Folder (Dialog OS) via PowerShell STA
    async function browseFolderOSDialog() {
      const btn = document.getElementById('btnBrowseOS');
      const text = document.getElementById('browseOSText');
      btn.disabled = true;
      text.innerHTML = '<span class="spinner"></span> Membuka Dialog OS...';

      showToast('ℹ️ Membuka jendela dialog pemilih folder Windows...', 'info');

      try {
        const response = await fetch('/api/browse-native', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initialDirectory: currentTargetPath })
        });
        const data = await response.json();

        if (data.success && data.folderPath) {
          currentTargetPath = data.folderPath;
          showToast('✅ Berhasil terhubung langsung ke harddisk: ' + data.folderPath, 'success');
          await triggerScan();
        } else if (data.cancelled) {
          showToast('Pemilihan folder dibatalkan.', 'info');
        } else {
          // Fallback jika tidak muncul
          openInputPathModal();
        }
      } catch (err) {
        showToast('Gagal memanggil Dialog OS: ' + err.message, 'error');
        openInputPathModal();
      } finally {
        btn.disabled = false;
        text.innerText = 'Browse Folder (Dialog OS)';
      }
    }

    // 2. CARA 2: Pilih / Upload Folder (Browser Native Directory Picker)
    function triggerBrowserFolderPicker() {
      const input = document.getElementById('browserFolderPickerInput');
      input.value = '';
      input.click();
    }

    async function onBrowserFolderSelected(event) {
      const files = event.target.files;
      if (!files || files.length === 0) return;

      const firstRelPath = files[0].webkitRelativePath || '';
      const rootFolderName = firstRelPath.split('/')[0] || '';

      if (!rootFolderName) return;

      showToast("ℹ️ Mencari lokasi fisik folder '" + rootFolderName + "' di harddisk...", 'info');

      try {
        const res = await fetch('/api/resolve-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderName: rootFolderName })
        });
        const data = await res.json();

        if (data.success && data.resolvedPath) {
          currentTargetPath = data.resolvedPath;
          showToast('✅ Berhasil terhubung langsung ke harddisk: ' + data.resolvedPath, 'success');
          await triggerScan();
        } else {
          showToast("Folder '" + rootFolderName + "' terdeteksi. Silakan verifikasi path fisik.", 'info');
          document.getElementById('manualPathInput').value = rootFolderName;
          openInputPathModal();
        }
      } catch (e) {
        showToast('Error resolver: ' + e.message, 'error');
      }
    }

    // 3. CARA 3: Input Path Manual
    function openInputPathModal() {
      document.getElementById('manualPathInput').value = currentTargetPath;
      document.getElementById('inputPathModal').classList.add('show');
    }

    function closeInputPathModal() {
      document.getElementById('inputPathModal').classList.remove('show');
    }

    function applyManualPath() {
      const val = document.getElementById('manualPathInput').value.trim();
      if (!val) {
        showToast('Path folder tidak boleh kosong.', 'error');
        return;
      }
      currentTargetPath = val;
      closeInputPathModal();
      showToast('✅ Berhasil terhubung langsung ke harddisk: ' + val, 'success');
      triggerScan();
    }

    // Pindai Target Folder
    async function triggerScan() {
      const btn = document.getElementById('btnPindaiUlang');
      const btnText = document.getElementById('btnPindaiText');
      btn.disabled = true;
      btnText.innerHTML = '<span class="spinner"></span> Memindai...';

      try {
        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderPath: currentTargetPath })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Gagal memindai folder.');

        currentAuditData = data;
        currentTargetPath = data.rootPath;
        renderDashboard(data);
        showToast('Pemindaian selesai: ' + data.metrics.totalFiles + ' file diperbarui.', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btnText.innerText = 'Pindai Ulang';
      }
    }

    function renderDashboard(data) {
      // Update Target Bar
      document.getElementById('activeHarddiskPath').innerText = data.rootPath;
      document.getElementById('activeHarddiskPath').title = data.rootPath;

      // Update 4 Cards
      document.getElementById('valTotalFiles').innerText = data.metrics.totalFiles.toLocaleString();
      document.getElementById('valTotalKapasitas').innerText = data.metrics.totalFormatted;
      document.getElementById('valGiantFiles').innerText = data.metrics.giantFilesCount.toLocaleString();
      document.getElementById('valPotensiHemat').innerText = data.metrics.potentialSavingFormatted;

      document.getElementById('btnCleanAction').disabled = data.metrics.potentialSavingBytes <= 0;

      // Render Giant Table
      giantFilesCache = data.top15GiantFiles || [];
      document.getElementById('giantFilesCountPill').innerText = giantFilesCache.length + ' file';
      renderGiantTable(giantFilesCache);

      // Render Duplicates
      renderDuplicates(data.top20DuplicateGroups || []);

      // Render Tmp
      const tmpWrap = document.getElementById('tmpFilesCard');
      if (data.tmpFiles && data.tmpFiles.length > 0) {
        tmpWrap.style.display = 'block';
        document.getElementById('tmpCountPill').innerText = data.tmpFiles.length + ' file';
        document.getElementById('tmpFilesListWrap').innerHTML = data.tmpFiles.map(t => {
          return '<div class="file-row-dup">' +
            '<div><strong>' + escapeHtml(t.fileName) + '</strong> <span style="color:var(--text-dim);">(' + escapeHtml(t.relativePath) + ')</span></div>' +
            '<span style="color: #fbbf24; font-family: monospace;">' + t.sizeFormatted + '</span>' +
          '</div>';
        }).join('');
      } else {
        tmpWrap.style.display = 'none';
      }
    }

    function renderGiantTable(files) {
      const tbody = document.getElementById('giantTableBody');
      if (!files || files.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-dim); padding: 30px;">Tidak ada file raksasa (≥ 2 MB) di folder ini.</td></tr>';
        return;
      }

      tbody.innerHTML = files.map(f => {
        let icon = '📄';
        if (f.format === 'PDF') icon = '📕';
        else if (f.format === 'ZIP' || f.format === 'RAR') icon = '📦';
        else if (f.format === 'PPTX' || f.format === 'PPT') icon = '📙';
        else if (f.format === 'MP4' || f.format === 'MKV') icon = '🎬';
        else if (f.format === 'SQL' || f.format === 'DB') icon = '💾';

        return '<tr>' +
          '<td>' +
            '<div class="file-name-container">' +
              '<span class="file-icon">' + icon + '</span>' +
              '<span>' + escapeHtml(f.fileName) + '</span>' +
            '</div>' +
          '</td>' +
          '<td><div class="file-path-col" title="' + escapeHtml(f.absolutePath) + '">' + escapeHtml(f.absolutePath) + '</div></td>' +
          '<td><span class="file-size-col">' + f.sizeFormatted + '</span></td>' +
          '<td style="text-align: center;"><span class="format-pill">' + f.format + '</span></td>' +
        '</tr>';
      }).join('');
    }

    function filterGiantTable() {
      const q = document.getElementById('giantSearchInput').value.toLowerCase().trim();
      if (!q) {
        renderGiantTable(giantFilesCache);
      } else {
        const filtered = giantFilesCache.filter(f => f.fileName.toLowerCase().includes(q) || f.relativePath.toLowerCase().includes(q));
        renderGiantTable(filtered);
      }
    }

    function renderDuplicates(groups) {
      const container = document.getElementById('dupAccordionContainer');
      document.getElementById('dupGroupsCountPill').innerText = groups.length + ' kelompok';

      if (!groups || groups.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-dim); padding: 20px;">Tidak ada berkas duplikat yang terdeteksi.</div>';
        return;
      }

      container.innerHTML = groups.map((g, idx) => {
        return '<div class="accordion-item ' + (idx === 0 ? 'active' : '') + '" id="acc-' + idx + '">' +
          '<div class="accordion-header" onclick="toggleAcc(' + idx + ')">' +
            '<div>' +
              '<strong>#' + (idx + 1) + ' ' + escapeHtml(g.originalFile.fileName) + '</strong>' +
              '<span style="font-size: 12px; color: var(--text-muted); margin-left: 8px;">(' + g.count + ' file identik)</span>' +
            '</div>' +
            '<div style="display: flex; align-items: center; gap: 10px;">' +
              '<span style="font-size: 12px; color: #fbbf24; font-weight: 700;">Hemat: ' + g.wastedFormatted + '</span>' +
              '<span>▼</span>' +
            '</div>' +
          '</div>' +
          '<div class="accordion-body">' +
            '<div class="file-row-dup" style="border-left: 3px solid #10b981;">' +
              '<div><span style="color:#34d399; font-weight:700;">[ASLI]</span> ' + escapeHtml(g.originalFile.fileName) + ' <span style="color:var(--text-dim); font-size:11px;">(' + escapeHtml(g.originalFile.relativePath) + ')</span></div>' +
              '<span style="color:var(--text-muted);">' + g.originalFile.sizeFormatted + '</span>' +
            '</div>' +
            g.duplicateFiles.map(d => {
              return '<div class="file-row-dup" style="border-left: 3px solid #f43f5e;">' +
                '<div><span style="color:#f87171; font-weight:700;">[DUPLIKAT]</span> ' + escapeHtml(d.fileName) + ' <span style="color:var(--text-dim); font-size:11px;">(' + escapeHtml(d.relativePath) + ')</span></div>' +
                '<span style="color:#f87171;">' + d.sizeFormatted + '</span>' +
              '</div>';
            }).join('') +
          '</div>' +
        '</div>';
      }).join('');
    }

    function toggleAcc(idx) {
      const el = document.getElementById('acc-' + idx);
      if (el) el.classList.toggle('active');
    }

    // Modal Pembersihan
    function openCleanModal() {
      if (!currentAuditData) return;
      document.getElementById('cleanTargetDisplay').innerText = currentAuditData.rootPath;

      const dupCount = (currentAuditData.top20DuplicateGroups || []).reduce((acc, g) => acc + g.duplicateFiles.length, 0);
      const tmpCount = (currentAuditData.tmpFiles || []).length;

      document.getElementById('cleanDupCount').innerText = dupCount + ' file';
      document.getElementById('cleanTmpCount').innerText = tmpCount + ' file';
      document.getElementById('cleanFreedSize').innerText = currentAuditData.metrics.potentialSavingFormatted;

      document.getElementById('cleanConfirmModal').classList.add('show');
    }

    function closeCleanModal() {
      document.getElementById('cleanConfirmModal').classList.remove('show');
    }

    async function executeCleanNow() {
      const btn = document.getElementById('btnExecCleanModal');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Menghapus File...';

      // Kumpulkan file yang harus dihapus
      const filesToDelete = [];
      if (currentAuditData.top20DuplicateGroups) {
        currentAuditData.top20DuplicateGroups.forEach(g => {
          g.duplicateFiles.forEach(d => filesToDelete.push(d.absolutePath));
        });
      }
      if (currentAuditData.tmpFiles) {
        currentAuditData.tmpFiles.forEach(t => filesToDelete.push(t.absolutePath));
      }

      try {
        const res = await fetch('/api/clean', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            folderPath: currentTargetPath,
            filesToDelete: filesToDelete
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Pembersihan gagal.');

        closeCleanModal();
        showToast('✅ Berhasil membersihkan ' + data.freedFormatted + ' (' + data.deletedFiles.length + ' file dihapus).', 'success');
        await triggerScan();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerText = 'Konfirmasi Hapus Sekarang';
      }
    }

    function escapeHtml(text) {
      if (!text) return '';
      return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    window.addEventListener('DOMContentLoaded', () => {
      triggerScan();
    });
  </script>
</body>
</html>`;
}

// Inisialisasi HTTP Server
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Route 1: GET / -> Dashboard UI
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getDashboardHtml());
    return;
  }

  // Route 2: POST /api/browse-native -> Buka native Windows File Explorer dialog
  if (req.method === 'POST' && url.pathname === '/api/browse-native') {
    try {
      const body = await parseRequestBody(req);
      const initialDir = body.initialDirectory || '.';
      const result = await openNativeFileExplorer(initialDir);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // Route 3: POST /api/resolve-folder -> Resolver lokasi fisik folder dari upload browser
  if (req.method === 'POST' && url.pathname === '/api/resolve-folder') {
    try {
      const body = await parseRequestBody(req);
      const folderName = body.folderName;
      const resolved = resolvePhysicalFolderPath(folderName);
      if (resolved) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, resolvedPath: resolved }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Folder tidak ditemukan otomatis di lokasi standar.' }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // Route 4: POST /api/scan -> Pindai folder secara rekursif & analisis
  if (req.method === 'POST' && url.pathname === '/api/scan') {
    try {
      const body = await parseRequestBody(req);
      const targetPath = body.folderPath || DEFAULT_TARGET_FOLDER;
      const resolvedTarget = path.resolve(targetPath);

      if (!fs.existsSync(resolvedTarget)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Folder target tidak ditemukan: ${targetPath} (${resolvedTarget})` }));
        return;
      }

      const stat = fs.statSync(resolvedTarget);
      if (!stat.isDirectory()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Path yang diberikan bukan folder: ${targetPath}` }));
        return;
      }

      console.log(`[SCAN] Memindai folder target: ${resolvedTarget}`);
      const files = await scanDirectory(resolvedTarget);
      console.log(`[SCAN] Selesai: Mengumpulkan ${files.length} file dan metadata.`);

      const analysis = analyzeFiles(files, resolvedTarget);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(analysis));
    } catch (err) {
      console.error('[SCAN ERROR]', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Gagal melakukan pemindaian: ' + err.message }));
    }
    return;
  }

  // Route 5: POST /api/clean -> In-place cleaning duplikat & .tmp
  if (req.method === 'POST' && url.pathname === '/api/clean') {
    try {
      const body = await parseRequestBody(req);
      const targetPath = body.folderPath || DEFAULT_TARGET_FOLDER;
      const filesToDelete = body.filesToDelete || [];

      if (!filesToDelete || filesToDelete.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Tidak ada daftar file yang dikirim untuk dibersihkan.' }));
        return;
      }

      console.log(`[CLEAN] Mengeksekusi in-place cleanup pada: ${targetPath} (${filesToDelete.length} file)`);
      const results = executeCleanUp(targetPath, filesToDelete);
      console.log(`[CLEAN] Selesai: Dihapus ${results.deletedFiles.length} file, dibebaskan ${results.freedFormatted}.`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(results));
    } catch (err) {
      console.error('[CLEAN ERROR]', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Gagal mengeksekusi pembersihan: ' + err.message }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found');
});

// Auto-open browser cross-platform
function openBrowser(url) {
  const startCmd = process.platform === 'win32' ? `start "" "${url}"` :
                   process.platform === 'darwin' ? `open "${url}"` :
                   `xdg-open "${url}"`;
  exec(startCmd, (err) => {
    if (err) {
      console.log(`[INFO] Silakan buka manual URL berikut di browser: ${url}`);
    }
  });
}

// Start Server
function startServer(port) {
  server.listen(port, () => {
    const serverUrl = `http://localhost:${port}`;
    console.log('================================================================');
    console.log('  STORAGE AUDIT & CLEANER - DIRECT EXECUTION');
    console.log('================================================================');
    console.log(`  Target Harddisk Aktif : ${path.resolve(DEFAULT_TARGET_FOLDER)}`);
    console.log(`  Dashboard URL         : ${serverUrl}`);
    console.log(`  File Explorer Access  : Aktif (Browse Folder Dialog OS / Upload / Input)`);
    console.log('================================================================');
    console.log('Membuka browser otomatis ke dashboard...');
    openBrowser(serverUrl);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[WARN] Port ${port} sedang digunakan. Mencoba port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('[FATAL SERVER ERROR]', err);
    }
  });
}

startServer(DEFAULT_PORT);
