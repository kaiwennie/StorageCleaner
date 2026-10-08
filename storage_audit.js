/**
 * ============================================================================
 * Storage Audit & Cleaner Pro
 * File: storage_audit.js
 * 
 * Sistem Audit Penyimpanan Native Node.js (Zero Dependencies / Tanpa npm install)
 * Menggunakan modul native: http, fs, path, crypto, child_process.
 * ============================================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

const DEFAULT_PORT = 3000;
const DEFAULT_TARGET_FOLDER = './Bahan Latihan P12';
const GIANT_FILE_THRESHOLD = 10 * 1024 * 1024; // 10 MB dalam bytes

// Helper format ukuran file
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Fungsi hashing SHA-256 berbasis streaming untuk efisiensi memori
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
        const ext = path.extname(entry.name).toLowerCase();
        const isTmp = ext === '.tmp';
        const isGiant = stats.size > GIANT_FILE_THRESHOLD;

        // Hitung SHA-256
        let sha256 = '';
        try {
          sha256 = await getFileSha256(fullPath);
        } catch (hashErr) {
          console.warn(`Gagal menghitung SHA-256 untuk ${fullPath}:`, hashErr.message);
          sha256 = 'ERROR_HASH';
        }

        fileList.push({
          fileName: entry.name,
          relativePath: relPath,
          absolutePath: path.resolve(fullPath),
          sizeBytes: stats.size,
          sizeFormatted: formatBytes(stats.size),
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

  for (const file of files) {
    totalBytes += file.sizeBytes;

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

  // Filter kelompok duplikat: minimal 2 file dengan SHA-256 identik
  const duplicateGroups = [];
  let potentialDuplicateSavingBytes = 0;

  for (const [hash, groupFiles] of hashMap.entries()) {
    if (groupFiles.length >= 2) {
      // Urutkan file dalam kelompok: file dengan path terpendek atau tanggal terlama dianggap Asli (Original)
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

  // Urutkan grup duplikat berdasarkan pemborosan storage terbesar
  duplicateGroups.sort((a, b) => b.wastedBytes - a.wastedBytes);

  // Ambil hingga 20 grup duplikat teratas sesuai SRS
  const top20DuplicateGroups = duplicateGroups.slice(0, 20);

  // Urutkan file raksasa dari ukuran terbesar
  giantFiles.sort((a, b) => b.sizeBytes - a.sizeBytes);
  // Ambil hingga 15 file raksasa teratas sesuai SRS
  const top15GiantFiles = giantFiles.slice(0, 15);

  // Hitung potensi hemat dari file .tmp yang bukan merupakan salinan duplikat yang sudah dihitung
  let potentialTmpSavingBytes = 0;
  const duplicateAbsolutePaths = new Set();
  duplicateGroups.forEach(g => g.duplicateFiles.forEach(f => duplicateAbsolutePaths.add(f.absolutePath)));

  for (const tmp of tmpFiles) {
    if (!duplicateAbsolutePaths.has(tmp.absolutePath)) {
      potentialTmpSavingBytes += tmp.sizeBytes;
    }
  }

  const totalPotentialSavingBytes = potentialDuplicateSavingBytes + potentialTmpSavingBytes;

  return {
    rootPath: rootPath,
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

// In-place Cleaner: Menghapus salinan kembar dan file .tmp langsung pada folder target
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

  // Jika daftar file tidak disediakan spesifik, scan dan bersihkan semua duplikat redundant + .tmp
  // Kumpulkan file yang harus dihapus
  let pathsToDelete = [];

  if (Array.isArray(filePathsToDelete) && filePathsToDelete.length > 0) {
    pathsToDelete = filePathsToDelete;
  }

  for (const itemPath of pathsToDelete) {
    const resolvedItem = path.resolve(itemPath);

    // Keamanan: pastikan file berada di dalam folder target agar tidak menghapus file di luar lingkup
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
        // In-place direct unlinking
        fs.unlinkSync(resolvedItem);
        results.freedBytes += size;
        results.deletedFiles.push({
          path: resolvedItem,
          relativePath: relative,
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
  <title>Storage Audit & Cleaner Pro</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #080c14;
      --bg-surface: #0f172a;
      --bg-surface-elevated: #1e293b;
      --bg-card: rgba(17, 24, 39, 0.7);
      --border-color: rgba(255, 255, 255, 0.08);
      --border-hover: rgba(59, 130, 246, 0.35);
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      
      --accent-blue: #3b82f6;
      --accent-indigo: #6366f1;
      --accent-emerald: #10b981;
      --accent-amber: #f59e0b;
      --accent-rose: #f43f5e;
      --accent-cyan: #06b6d4;
      --accent-purple: #a855f7;

      --radius-sm: 8px;
      --radius-md: 12px;
      --radius-lg: 16px;
      --radius-xl: 20px;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: var(--bg-dark);
      color: var(--text-main);
      min-height: 100vh;
      line-height: 1.5;
      overflow-x: hidden;
      background-image: 
        radial-gradient(circle at 15% 10%, rgba(59, 130, 246, 0.12) 0%, transparent 40%),
        radial-gradient(circle at 85% 30%, rgba(168, 85, 247, 0.10) 0%, transparent 45%),
        radial-gradient(circle at 50% 90%, rgba(16, 185, 129, 0.08) 0%, transparent 50%);
    }

    .container {
      max-width: 1280px;
      margin: 0 auto;
      padding: 24px 20px 60px 20px;
    }

    /* Header & Branding */
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 28px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border-color);
      flex-wrap: wrap;
      gap: 16px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .brand-icon {
      width: 44px;
      height: 44px;
      border-radius: var(--radius-md);
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 8px 20px rgba(59, 130, 246, 0.3);
    }

    .brand-title {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.02em;
      background: linear-gradient(to right, #ffffff, #cbd5e1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .brand-subtitle {
      font-size: 13px;
      color: var(--text-muted);
      font-weight: 500;
    }

    .header-badges {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .badge-runtime {
      background: rgba(34, 197, 94, 0.12);
      color: #4ade80;
      border: 1px solid rgba(34, 197, 94, 0.25);
      padding: 6px 12px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .badge-runtime::before {
      content: '';
      width: 7px;
      height: 7px;
      background-color: #22c55e;
      border-radius: 50%;
      box-shadow: 0 0 8px #22c55e;
    }

    /* Target Path Toolbar */
    .toolbar-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      padding: 20px 24px;
      margin-bottom: 28px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(12px);
    }

    .toolbar-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .path-input-group {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .path-input-wrapper {
      position: relative;
      flex: 1;
      min-width: 280px;
    }

    .path-icon {
      position: absolute;
      left: 14px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-dim);
      pointer-events: none;
    }

    .path-input {
      width: 100%;
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: var(--radius-md);
      padding: 12px 16px 12px 42px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      color: #fff;
      transition: all 0.2s;
    }

    .path-input:focus {
      outline: none;
      border-color: var(--accent-blue);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25);
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 20px;
      border-radius: var(--radius-md);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      border: none;
      text-decoration: none;
    }

    .btn-primary {
      background: linear-gradient(135deg, #2563eb, #3b82f6);
      color: #ffffff;
      box-shadow: 0 4px 15px rgba(37, 99, 235, 0.35);
    }

    .btn-primary:hover {
      background: linear-gradient(135deg, #1d4ed8, #2563eb);
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(37, 99, 235, 0.45);
    }

    .btn-clean {
      background: linear-gradient(135deg, #e11d48, #f43f5e);
      color: #ffffff;
      box-shadow: 0 4px 15px rgba(225, 29, 72, 0.35);
    }

    .btn-clean:hover:not(:disabled) {
      background: linear-gradient(135deg, #be123c, #e11d48);
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(225, 29, 72, 0.45);
    }

    .btn-clean:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      filter: grayscale(0.8);
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.07);
      color: var(--text-main);
      border: 1px solid var(--border-color);
    }

    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.12);
    }

    /* Metric Cards Grid */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 18px;
      margin-bottom: 32px;
    }

    .metric-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      padding: 22px;
      position: relative;
      overflow: hidden;
      transition: transform 0.2s, border-color 0.2s;
    }

    .metric-card:hover {
      transform: translateY(-2px);
      border-color: var(--border-hover);
    }

    .metric-card::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
    }

    .metric-card.blue::after { background: linear-gradient(90deg, #3b82f6, #60a5fa); }
    .metric-card.indigo::after { background: linear-gradient(90deg, #6366f1, #818cf8); }
    .metric-card.amber::after { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
    .metric-card.emerald::after { background: linear-gradient(90deg, #10b981, #34d399); }

    .metric-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .metric-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .metric-icon-box {
      width: 36px;
      height: 36px;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .metric-icon-box.blue { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
    .metric-icon-box.indigo { background: rgba(99, 102, 241, 0.15); color: #818cf8; }
    .metric-icon-box.amber { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
    .metric-icon-box.emerald { background: rgba(16, 185, 129, 0.15); color: #34d399; }

    .metric-value {
      font-size: 28px;
      font-weight: 800;
      color: #fff;
      line-height: 1.1;
      margin-bottom: 6px;
      font-feature-settings: "tnum";
    }

    .metric-sub {
      font-size: 12px;
      color: var(--text-dim);
    }

    /* Content Layout */
    .dashboard-sections {
      display: flex;
      flex-direction: column;
      gap: 32px;
    }

    .section-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      padding: 24px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      flex-wrap: wrap;
      gap: 12px;
    }

    .section-title-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .section-title {
      font-size: 18px;
      font-weight: 700;
      color: #fff;
    }

    .section-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 9999px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .badge-amber {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .badge-purple {
      background: rgba(168, 85, 247, 0.15);
      color: #c084fc;
      border: 1px solid rgba(168, 85, 247, 0.3);
    }

    /* Table Styles */
    .table-container {
      overflow-x: auto;
      border-radius: var(--radius-md);
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }

    th {
      background: rgba(15, 23, 42, 0.95);
      color: var(--text-muted);
      font-weight: 600;
      padding: 14px 16px;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.05em;
      border-bottom: 1px solid var(--border-color);
      white-space: nowrap;
    }

    td {
      padding: 14px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: var(--text-main);
      vertical-align: middle;
    }

    tr:last-child td {
      border-bottom: none;
    }

    tr:hover td {
      background: rgba(255, 255, 255, 0.02);
    }

    .rank-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.08);
      font-weight: 700;
      font-size: 11px;
      color: #cbd5e1;
    }

    .rank-top1 { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); }
    .rank-top2 { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); }
    .rank-top3 { background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); }

    .file-name-cell {
      font-weight: 600;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .file-path-text {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: var(--text-dim);
      max-width: 380px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .size-pill {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-weight: 700;
      font-size: 12px;
    }

    .size-pill-giant {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    .size-pill-wasted {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    /* Accordion Styles */
    .accordion-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .accordion-item {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      overflow: hidden;
      transition: all 0.2s;
    }

    .accordion-item.active {
      border-color: rgba(99, 102, 241, 0.4);
      background: rgba(15, 23, 42, 0.9);
    }

    .accordion-header {
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
      gap: 14px;
    }

    .accordion-header:hover {
      background: rgba(255, 255, 255, 0.02);
    }

    .accordion-left {
      display: flex;
      align-items: center;
      gap: 14px;
      flex: 1;
      min-width: 0;
    }

    .group-num {
      font-weight: 800;
      font-size: 13px;
      color: var(--text-dim);
      min-width: 24px;
    }

    .group-info {
      min-width: 0;
      flex: 1;
    }

    .group-title {
      font-size: 14px;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .hash-tag {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: var(--text-dim);
      background: rgba(255, 255, 255, 0.05);
      padding: 2px 6px;
      border-radius: 4px;
      margin-top: 4px;
      display: inline-block;
    }

    .accordion-right {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .chevron-icon {
      transition: transform 0.2s;
      color: var(--text-dim);
    }

    .accordion-item.active .chevron-icon {
      transform: rotate(180deg);
      color: #818cf8;
    }

    .accordion-body {
      padding: 0 20px 18px 20px;
      display: none;
      border-top: 1px solid rgba(255, 255, 255, 0.04);
    }

    .accordion-item.active .accordion-body {
      display: block;
    }

    .files-list-in-group {
      margin-top: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .file-item-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-radius: var(--radius-sm);
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.03);
      gap: 12px;
      flex-wrap: wrap;
    }

    .file-item-left {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      flex: 1;
    }

    .status-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      white-space: nowrap;
    }

    .status-keep {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .status-delete {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    .status-tmp {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    /* Modal */
    .modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(8px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 20px;
    }

    .modal-backdrop.show {
      display: flex;
    }

    .modal-card {
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: var(--radius-xl);
      max-width: 650px;
      width: 100%;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
      animation: modalFadeIn 0.25s ease-out;
    }

    @keyframes modalFadeIn {
      from { opacity: 0; transform: scale(0.96); }
      to { opacity: 1; transform: scale(1); }
    }

    .modal-header {
      padding: 24px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .modal-icon-alert {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .modal-body {
      padding: 24px;
      overflow-y: auto;
      flex: 1;
    }

    .modal-footer {
      padding: 20px 24px;
      border-top: 1px solid var(--border-color);
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      background: rgba(0, 0, 0, 0.2);
      border-bottom-left-radius: var(--radius-xl);
      border-bottom-right-radius: var(--radius-xl);
    }

    .confirm-box-warning {
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.25);
      border-radius: var(--radius-md);
      padding: 14px 16px;
      margin-bottom: 18px;
      font-size: 13px;
      color: #fca5a5;
      line-height: 1.5;
    }

    .delete-summary-pill {
      display: flex;
      justify-content: space-between;
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.03);
      border-radius: var(--radius-sm);
      margin-bottom: 14px;
      font-size: 13px;
    }

    .delete-list-preview {
      background: rgba(0, 0, 0, 0.4);
      border-radius: var(--radius-md);
      padding: 12px;
      max-height: 220px;
      overflow-y: auto;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
    }

    .delete-item-row {
      padding: 6px 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      display: flex;
      justify-content: space-between;
      color: #cbd5e1;
    }

    .delete-item-row:last-child {
      border-bottom: none;
    }

    /* Toast Notification */
    .toast-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2000;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .toast {
      background: #1e293b;
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 14px 20px;
      border-radius: var(--radius-md);
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 14px;
      animation: toastSlide 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      max-width: 420px;
    }

    .toast-success { border-color: rgba(16, 185, 129, 0.4); background: #064e3b; color: #a7f3d0; }
    .toast-error { border-color: rgba(239, 68, 68, 0.4); background: #7f1d1d; color: #fecaca; }

    @keyframes toastSlide {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    /* Empty state */
    .empty-state {
      padding: 40px 20px;
      text-align: center;
      color: var(--text-dim);
    }

    .spinner {
      width: 18px;
      height: 18px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      border-top-color: #fff;
      animation: spin 0.8s linear infinite;
      display: inline-block;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Responsive */
    @media (max-width: 768px) {
      .container { padding: 16px 12px; }
      .path-input-group { flex-direction: column; }
      .btn { width: 100%; }
      .accordion-header { flex-direction: column; align-items: flex-start; gap: 8px; }
      .accordion-right { width: 100%; justify-content: space-between; }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <header>
      <div class="brand">
        <div class="brand-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
            <line x1="12" y1="22.08" x2="12" y2="12"></line>
          </svg>
        </div>
        <div>
          <h1 class="brand-title">Storage Audit & Cleaner Pro</h1>
          <p class="brand-subtitle">Sistem Pemindai Direktori & In-place Purge (Native Node.js / Zero Dependency)</p>
        </div>
      </div>
      <div class="header-badges">
        <div class="badge-runtime">Runtime: Node.js (Active)</div>
      </div>
    </header>

    <!-- Toolbar: Target Folder Input & Actions -->
    <div class="toolbar-card">
      <div class="toolbar-label">
        <span>Target Folder Input (Dinamis Tanpa Hardcoded)</span>
        <span id="scanStatusText">Siap Memindai</span>
      </div>
      <div class="path-input-group">
        <div class="path-input-wrapper">
          <svg class="path-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <input type="text" id="targetFolderPath" class="path-input" value="./Bahan Latihan P12" placeholder="Masukkan path folder (contoh: ./Bahan Latihan P12 atau C:\\path\\folder)">
        </div>
        <button id="btnScan" class="btn btn-primary" onclick="triggerScan()">
          <svg id="scanIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <span id="scanBtnText">Pindai Folder</span>
        </button>
        <button id="btnCleanModal" class="btn btn-clean" onclick="openCleanModal()" disabled>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
          <span>Bersihkan Duplikat & Sampah</span>
        </button>
      </div>
    </div>

    <!-- 4 Kartu Metrik Storage -->
    <div class="metrics-grid">
      <!-- 1. Total File -->
      <div class="metric-card blue">
        <div class="metric-header">
          <span class="metric-title">Total File</span>
          <div class="metric-icon-box blue">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
          </div>
        </div>
        <div class="metric-value" id="valTotalFiles">0</div>
        <div class="metric-sub" id="subTotalFiles">Termasuk semua subfolder</div>
      </div>

      <!-- 2. Total Kapasitas -->
      <div class="metric-card indigo">
        <div class="metric-header">
          <span class="metric-title">Total Kapasitas</span>
          <div class="metric-icon-box indigo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
            </svg>
          </div>
        </div>
        <div class="metric-value" id="valTotalSize">0 B</div>
        <div class="metric-sub" id="subTotalBytes">0 bytes terpakai</div>
      </div>

      <!-- 3. File Raksasa -->
      <div class="metric-card amber">
        <div class="metric-header">
          <span class="metric-title">File Raksasa (> 10 MB)</span>
          <div class="metric-icon-box amber">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
          </div>
        </div>
        <div class="metric-value" id="valGiantFiles">0</div>
        <div class="metric-sub" id="subGiantSize">Total bobot: 0 B</div>
      </div>

      <!-- 4. Potensi Hemat -->
      <div class="metric-card emerald">
        <div class="metric-header">
          <span class="metric-title">Potensi Hemat</span>
          <div class="metric-icon-box emerald">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
            </svg>
          </div>
        </div>
        <div class="metric-value" id="valPotentialSaving">0 B</div>
        <div class="metric-sub" id="subPotentialSaving">Duplikat & file sampah (.tmp)</div>
      </div>
    </div>

    <!-- Main Content Sections -->
    <div class="dashboard-sections">
      
      <!-- Tabel File Raksasa (> 10 MB) -->
      <div class="section-card">
        <div class="section-header">
          <div class="section-title-wrap">
            <h2 class="section-title">Daftar File Raksasa (Ambang Batas > 10 MB)</h2>
            <span class="section-badge badge-purple" id="giantBadge">0 File Terdeteksi</span>
          </div>
          <div style="font-size: 12px; color: var(--text-dim);">
            Maksimal 15 file raksasa teratas diurutkan berdasarkan ukuran
          </div>
        </div>

        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th style="width: 50px;">Rank</th>
                <th>Nama File</th>
                <th>Path Lengkap</th>
                <th style="width: 140px;">Ukuran File</th>
                <th style="width: 160px;">Terakhir Dimodifikasi</th>
              </tr>
            </thead>
            <tbody id="giantFilesTableBody">
              <tr>
                <td colspan="5" class="empty-state">
                  Belum ada data. Silakan tekan tombol "Pindai Folder".
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Accordion Kelompok Duplikat Identik (SHA-256) -->
      <div class="section-card">
        <div class="section-header">
          <div class="section-title-wrap">
            <h2 class="section-title">Kelompok Duplikat Identik (SHA-256 Hash)</h2>
            <span class="section-badge badge-amber" id="dupBadge">0 Kelompok</span>
          </div>
          <div style="font-size: 12px; color: var(--text-dim);">
            Maksimal 20 kelompok duplikat teratas (isi persis sama meski nama berbeda)
          </div>
        </div>

        <div id="duplicateAccordionList" class="accordion-list">
          <div class="empty-state">
            Belum ada data kelompok duplikat.
          </div>
        </div>
      </div>

      <!-- File Temporary (.tmp) Section -->
      <div class="section-card" id="tmpSection" style="display: none;">
        <div class="section-header">
          <div class="section-title-wrap">
            <h2 class="section-title">File Temporary Sampah (.tmp)</h2>
            <span class="section-badge badge-amber" id="tmpBadge">0 File</span>
          </div>
        </div>
        <div class="files-list-in-group" id="tmpFilesList"></div>
      </div>

    </div>
  </div>

  <!-- Interactive Confirmation Modal -->
  <div class="modal-backdrop" id="confirmModal">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-icon-alert">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </div>
        <div>
          <h3 style="font-size: 18px; font-weight: 700;">Konfirmasi Pembersihan In-Place</h3>
          <p style="font-size: 12px; color: var(--text-muted);">Pembersihan berdampak langsung pada folder target asal</p>
        </div>
      </div>

      <div class="modal-body">
        <div class="confirm-box-warning">
          <strong>PERHATIAN SISTEM:</strong> Tindakan pembersihan ini akan <u>menghapus file secara permanen langsung di tempat (in-place)</u> pada folder target.
          <br>Hanya file salinan duplikat redundant dan file sampah (.tmp) yang akan dihapus. Satu file asli per kelompok duplikat akan <strong>dipertahankan</strong>.
        </div>

        <div class="delete-summary-pill">
          <span>Total File Salinan Duplikat:</span>
          <strong id="modalDupCount" style="color: #f87171;">0</strong>
        </div>
        <div class="delete-summary-pill">
          <span>Total File Sampah (.tmp):</span>
          <strong id="modalTmpCount" style="color: #fbbf24;">0</strong>
        </div>
        <div class="delete-summary-pill" style="border: 1px solid rgba(16, 185, 129, 0.3); background: rgba(16, 185, 129, 0.08);">
          <span>Estimasi Kapasitas yang Akan Dibebaskan:</span>
          <strong id="modalFreedSize" style="color: #34d399; font-size: 15px;">0 B</strong>
        </div>

        <div style="margin-top: 16px; margin-bottom: 8px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">
          Daftar File yang Akan Dihapus (<span id="modalTotalDeleteCount">0</span> file):
        </div>
        <div class="delete-list-preview" id="modalFileListPreview"></div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeCleanModal()">Batalkan</button>
        <button id="btnExecuteClean" class="btn btn-clean" onclick="executeCleanNow()">
          <span id="cleanBtnText">Konfirmasi Hapus Sekarang</span>
        </button>
      </div>
    </div>
  </div>

  <!-- Toast Notification Container -->
  <div class="toast-container" id="toastContainer"></div>

  <script>
    let currentAuditData = null;
    let filesTargetedForDeletion = [];

    // Helper Toast
    function showToast(message, type = 'success') {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = 'toast toast-' + type;
      toast.innerHTML = \`
        <span>\${message}</span>
      \`;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
      }, 4000);
    }

    // Pemicu Scan Folder
    async function triggerScan() {
      const folderPath = document.getElementById('targetFolderPath').value.trim();
      if (!folderPath) {
        showToast('Masukkan path folder target terlebih dahulu.', 'error');
        return;
      }

      const btnScan = document.getElementById('btnScan');
      const scanBtnText = document.getElementById('scanBtnText');
      const scanStatusText = document.getElementById('scanStatusText');

      btnScan.disabled = true;
      scanBtnText.innerHTML = '<span class="spinner"></span> Memindai...';
      scanStatusText.innerText = 'Sedang memindai folder dan menghitung SHA-256...';

      try {
        const response = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderPath })
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || 'Gagal memindai folder.');
        }

        currentAuditData = result;
        renderDashboard(result);
        showToast(\`Pemindaian selesai: \${result.metrics.totalFiles} file ditemukan.\`, 'success');
        scanStatusText.innerText = 'Pemindaian Selesai (' + new Date().toLocaleTimeString() + ')';
      } catch (err) {
        showToast(err.message, 'error');
        scanStatusText.innerText = 'Error: ' + err.message;
      } finally {
        btnScan.disabled = false;
        scanBtnText.innerText = 'Pindai Folder';
      }
    }

    // Render Data ke Seluruh Komponen Dashboard
    function renderDashboard(data) {
      const metrics = data.metrics;

      // 1. Metric Cards
      document.getElementById('valTotalFiles').innerText = metrics.totalFiles.toLocaleString();
      document.getElementById('subTotalFiles').innerText = \`Total dari folder: \${data.rootPath}\`;

      document.getElementById('valTotalSize').innerText = metrics.totalFormatted;
      document.getElementById('subTotalBytes').innerText = \`\${metrics.totalBytes.toLocaleString()} bytes\`;

      document.getElementById('valGiantFiles').innerText = metrics.giantFilesCount.toLocaleString();
      document.getElementById('subGiantSize').innerText = \`Total bobot: \${metrics.giantFilesTotalFormatted}\`;

      document.getElementById('valPotentialSaving').innerText = metrics.potentialSavingFormatted;
      document.getElementById('subPotentialSaving').innerText = \`\${metrics.duplicateGroupsCount} grup duplikat, \${metrics.tmpFilesCount} file .tmp\`;

      // Status tombol bersihkan
      const btnCleanModal = document.getElementById('btnCleanModal');
      btnCleanModal.disabled = metrics.potentialSavingBytes <= 0;

      // 2. Render Tabel File Raksasa
      const giantTableBody = document.getElementById('giantFilesTableBody');
      const giantBadge = document.getElementById('giantBadge');
      giantBadge.innerText = \`\${data.top15GiantFiles.length} File Terdeteksi\`;

      if (data.top15GiantFiles.length === 0) {
        giantTableBody.innerHTML = \`
          <tr>
            <td colspan="5" class="empty-state">
              Tidak ditemukan file dengan ukuran melebihi ambang batas 10 MB.
            </td>
          </tr>
        \`;
      } else {
        giantTableBody.innerHTML = data.top15GiantFiles.map((file, idx) => {
          let rankClass = '';
          if (idx === 0) rankClass = 'rank-top1';
          else if (idx === 1) rankClass = 'rank-top2';
          else if (idx === 2) rankClass = 'rank-top3';

          const modDate = new Date(file.mtime).toLocaleString();

          return \`
            <tr>
              <td><span class="rank-badge \${rankClass}">#\${idx + 1}</span></td>
              <td>
                <div class="file-name-cell">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                    <polyline points="13 2 13 9 20 9"></polyline>
                  </svg>
                  <span>\${escapeHtml(file.fileName)}</span>
                </div>
              </td>
              <td>
                <div class="file-path-text" title="\${escapeHtml(file.absolutePath)}">\${escapeHtml(file.relativePath)}</div>
              </td>
              <td>
                <span class="size-pill size-pill-giant">\${file.sizeFormatted}</span>
              </td>
              <td style="color: var(--text-dim); font-size: 12px;">\${modDate}</td>
            </tr>
          \`;
        }).join('');
      }

      // 3. Render Accordion Kelompok Duplikat
      const dupContainer = document.getElementById('duplicateAccordionList');
      const dupBadge = document.getElementById('dupBadge');
      dupBadge.innerText = \`\${data.top20DuplicateGroups.length} Kelompok (Maks 20 Ditampilkan)\`;

      if (data.top20DuplicateGroups.length === 0) {
        dupContainer.innerHTML = \`
          <div class="empty-state">
            Tidak ditemukan file dengan hash SHA-256 identik (0 duplikat).
          </div>
        \`;
      } else {
        dupContainer.innerHTML = data.top20DuplicateGroups.map((group, gIdx) => {
          const original = group.originalFile;
          const duplicates = group.duplicateFiles;

          return \`
            <div class="accordion-item \${gIdx === 0 ? 'active' : ''}" id="accordion-group-\${gIdx}">
              <div class="accordion-header" onclick="toggleAccordion(\${gIdx})">
                <div class="accordion-left">
                  <span class="group-num">#\${gIdx + 1}</span>
                  <div class="group-info">
                    <div class="group-title">
                      <span>\${escapeHtml(original.fileName)}</span>
                      <span style="font-size: 12px; color: var(--text-muted); font-weight: 500;">
                        (\${group.count} file identik)
                      </span>
                    </div>
                    <span class="hash-tag">SHA-256: \${group.hash.substring(0, 16)}...</span>
                  </div>
                </div>
                <div class="accordion-right">
                  <span class="size-pill size-pill-wasted" title="Ruang yang terbuang oleh salinan redundant">
                    Hemat: \${group.wastedFormatted}
                  </span>
                  <svg class="chevron-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </div>
              </div>
              <div class="accordion-body">
                <div class="files-list-in-group">
                  <!-- File Asli (Dipertahankan) -->
                  <div class="file-item-row" style="border-left: 3px solid #10b981;">
                    <div class="file-item-left">
                      <span class="status-badge status-keep">Asli (Disimpan)</span>
                      <div>
                        <strong style="color: #fff; font-size: 13px;">\${escapeHtml(original.fileName)}</strong>
                        <div class="file-path-text" title="\${escapeHtml(original.absolutePath)}">\${escapeHtml(original.relativePath)}</div>
                      </div>
                    </div>
                    <span style="font-family: 'JetBrains Mono'; font-size: 12px; color: var(--text-muted);">
                      \${original.sizeFormatted}
                    </span>
                  </div>

                  <!-- File Duplikat Redundant (Kandidat Hapus) -->
                  \${duplicates.map(dup => \`
                    <div class="file-item-row" style="border-left: 3px solid #f43f5e;">
                      <div class="file-item-left">
                        <span class="status-badge status-delete">Duplikat (Dihapus)</span>
                        <div>
                          <strong style="color: #cbd5e1; font-size: 13px;">\${escapeHtml(dup.fileName)}</strong>
                          <div class="file-path-text" title="\${escapeHtml(dup.absolutePath)}">\${escapeHtml(dup.relativePath)}</div>
                        </div>
                      </div>
                      <span style="font-family: 'JetBrains Mono'; font-size: 12px; color: #f87171;">
                        \${dup.sizeFormatted}
                      </span>
                    </div>
                  \`).join('')}
                </div>
              </div>
            </div>
          \`;
        }).join('');
      }

      // 4. Render Temp Files section jika ada
      const tmpSection = document.getElementById('tmpSection');
      const tmpBadge = document.getElementById('tmpBadge');
      const tmpList = document.getElementById('tmpFilesList');

      if (data.tmpFiles && data.tmpFiles.length > 0) {
        tmpSection.style.display = 'block';
        tmpBadge.innerText = \`\${data.tmpFiles.length} File .tmp\`;
        tmpList.innerHTML = data.tmpFiles.map(tmp => \`
          <div class="file-item-row" style="border-left: 3px solid #f59e0b;">
            <div class="file-item-left">
              <span class="status-badge status-tmp">Sampah (.tmp)</span>
              <div>
                <strong style="color: #cbd5e1; font-size: 13px;">\${escapeHtml(tmp.fileName)}</strong>
                <div class="file-path-text" title="\${escapeHtml(tmp.absolutePath)}">\${escapeHtml(tmp.relativePath)}</div>
              </div>
            </div>
            <span style="font-family: 'JetBrains Mono'; font-size: 12px; color: #fbbf24;">
              \${tmp.sizeFormatted}
            </span>
          </div>
        \`).join('');
      } else {
        tmpSection.style.display = 'none';
      }

      // Siapkan daftar file yang menjadi target penghapusan
      prepareDeletionList(data);
    }

    function toggleAccordion(index) {
      const el = document.getElementById('accordion-group-' + index);
      if (el) {
        el.classList.toggle('active');
      }
    }

    // Persiapan daftar file yang akan dihapus (salinan kembar dan .tmp)
    function prepareDeletionList(data) {
      filesTargetedForDeletion = [];
      const seenPaths = new Set();

      // Salinan kembar (semua duplicateFiles di setiap grup duplikat)
      if (data.top20DuplicateGroups) {
        data.top20DuplicateGroups.forEach(group => {
          group.duplicateFiles.forEach(dup => {
            if (!seenPaths.has(dup.absolutePath)) {
              seenPaths.add(dup.absolutePath);
              filesTargetedForDeletion.push({
                absolutePath: dup.absolutePath,
                relativePath: dup.relativePath,
                fileName: dup.fileName,
                sizeBytes: dup.sizeBytes,
                sizeFormatted: dup.sizeFormatted,
                type: 'Salinan Duplikat'
              });
            }
          });
        });
      }

      // File .tmp
      if (data.tmpFiles) {
        data.tmpFiles.forEach(tmp => {
          if (!seenPaths.has(tmp.absolutePath)) {
            seenPaths.add(tmp.absolutePath);
            filesTargetedForDeletion.push({
              absolutePath: tmp.absolutePath,
              relativePath: tmp.relativePath,
              fileName: tmp.fileName,
              sizeBytes: tmp.sizeBytes,
              sizeFormatted: tmp.sizeFormatted,
              type: 'File .tmp'
            });
          }
        });
      }
    }

    // Modal Konfirmasi
    function openCleanModal() {
      if (!currentAuditData || filesTargetedForDeletion.length === 0) {
        showToast('Tidak ada file duplikat atau .tmp yang dapat dibersihkan.', 'error');
        return;
      }

      const dupCount = filesTargetedForDeletion.filter(f => f.type === 'Salinan Duplikat').length;
      const tmpCount = filesTargetedForDeletion.filter(f => f.type === 'File .tmp').length;
      const totalBytes = filesTargetedForDeletion.reduce((acc, f) => acc + f.sizeBytes, 0);

      document.getElementById('modalDupCount').innerText = dupCount + ' file';
      document.getElementById('modalTmpCount').innerText = tmpCount + ' file';
      document.getElementById('modalFreedSize').innerText = currentAuditData.metrics.potentialSavingFormatted;
      document.getElementById('modalTotalDeleteCount').innerText = filesTargetedForDeletion.length;

      const previewContainer = document.getElementById('modalFileListPreview');
      previewContainer.innerHTML = filesTargetedForDeletion.map(f => \`
        <div class="delete-item-row">
          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 440px;" title="\${escapeHtml(f.absolutePath)}">
            [\${f.type}] \${escapeHtml(f.relativePath)}
          </div>
          <span style="color: #f87171;">\${f.sizeFormatted}</span>
        </div>
      \`).join('');

      document.getElementById('confirmModal').classList.add('show');
    }

    function closeCleanModal() {
      document.getElementById('confirmModal').classList.remove('show');
    }

    // Eksekusi Pembersihan Langsung Di Tempat (In-Place Execution)
    async function executeCleanNow() {
      const folderPath = document.getElementById('targetFolderPath').value.trim();
      const btnExecuteClean = document.getElementById('btnExecuteClean');
      const cleanBtnText = document.getElementById('cleanBtnText');

      btnExecuteClean.disabled = true;
      cleanBtnText.innerHTML = '<span class="spinner"></span> Menghapus File In-Place...';

      try {
        const filePaths = filesTargetedForDeletion.map(f => f.absolutePath);

        const response = await fetch('/api/clean', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            folderPath: folderPath,
            filesToDelete: filePaths
          })
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || 'Pembersihan gagal dieksekusi.');
        }

        closeCleanModal();
        showToast(\`Pembersihan berhasil! Dibebaskan \${result.freedFormatted} (\${result.deletedFiles.length} file dihapus in-place).\`, 'success');

        // Otomatis re-scan agar dashboard dan metrik langsung terupdate mencerminkan kapasitas baru
        await triggerScan();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btnExecuteClean.disabled = false;
        cleanBtnText.innerText = 'Konfirmasi Hapus Sekarang';
      }
    }

    function escapeHtml(text) {
      if (!text) return '';
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Auto-scan saat pertama kali halaman dimuat
    window.addEventListener('DOMContentLoaded', () => {
      triggerScan();
    });
  </script>
</body>
</html>`;
}

// Inisialisasi HTTP Server
const server = http.createServer(async (req, res) => {
  // CORS & Security Headers
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

  // Route 2: POST /api/scan -> Pindai folder secara rekursif & analisis
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
        res.end(JSON.stringify({ error: `Path yang diberikan bukan merupakan folder: ${targetPath}` }));
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

  // Route 3: POST /api/clean -> In-place cleaning duplikat & .tmp
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

  // 404 Not Found
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

// Start Server dengan automatic port fallback jika 3000 sedang digunakan
function startServer(port) {
  server.listen(port, () => {
    const serverUrl = `http://localhost:${port}`;
    console.log('================================================================');
    console.log('  STORAGE AUDIT & CLEANER PRO - NATIVE NODE.JS UTILITY');
    console.log('================================================================');
    console.log(`  Target Folder Default : ${path.resolve(DEFAULT_TARGET_FOLDER)}`);
    console.log(`  Dashboard URL         : ${serverUrl}`);
    console.log(`  Status                : Berjalan langsung (Zero NPM Dependencies)`);
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
