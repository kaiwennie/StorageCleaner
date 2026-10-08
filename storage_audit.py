"""
============================================================================
Storage Audit & Cleaner Pro
File: storage_audit.py

Sistem Audit Penyimpanan Native Python (Zero Dependencies / Standar Library)
============================================================================
"""

import http.server
import socketserver
import os
import hashlib
import json
import webbrowser
import sys
import subprocess
from urllib.parse import urlparse
from datetime import datetime

DEFAULT_PORT = 3000
DEFAULT_TARGET_FOLDER = './Bahan Latihan P12'
GIANT_FILE_THRESHOLD = 2 * 1024 * 1024  # 2 MB

def format_bytes(b):
    if b == 0:
        return '0 B'
    sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    i = 0
    size = float(b)
    while size >= 1024 and i < len(sizes) - 1:
        size /= 1024.0
        i += 1
    return f"{size:.2f} {sizes[i]}"

def get_file_sha256(file_path):
    h = hashlib.sha256()
    try:
        with open(file_path, 'rb') as f:
            while chunk := f.read(65536):
                h.update(chunk)
        return h.hexdigest()
    except Exception as e:
        return 'ERROR_HASH'

def scan_directory(dir_path, root_path=None):
    if root_path is None:
        root_path = dir_path
    file_list = []
    
    try:
        for root, dirs, files in os.walk(dir_path):
            for file_name in files:
                full_path = os.path.join(root, file_name)
                try:
                    stat = os.stat(full_path)
                    rel_path = os.path.relpath(full_path, root_path).replace('\\', '/')
                    folder_dir = os.path.dirname(rel_path)
                    if folder_dir == '.':
                        folder_dir = ''
                    ext = os.path.splitext(file_name)[1].lower()
                    ext_clean = ext.replace('.', '').upper() or 'FILE'
                    is_tmp = (ext == '.tmp')
                    is_giant = (stat.st_size >= GIANT_FILE_THRESHOLD)
                    sha256 = get_file_sha256(full_path)

                    file_list.append({
                        'fileName': file_name,
                        'relativePath': rel_path,
                        'folderDir': folder_dir,
                        'absolutePath': os.path.abspath(full_path),
                        'sizeBytes': stat.st_size,
                        'sizeFormatted': format_bytes(stat.st_size),
                        'format': ext_clean,
                        'sha256': sha256,
                        'isTmp': is_tmp,
                        'isGiant': is_giant,
                        'mtime': datetime.fromtimestamp(stat.st_mtime).isoformat(),
                        'mtimeMs': stat.st_mtime * 1000
                    })
                except Exception as ex:
                    print(f"Gagal memproses file {full_path}: {ex}")
    except Exception as e:
        print(f"Gagal membaca folder {dir_path}: {e}")

    return file_list

def analyze_files(files, root_path):
    total_files = len(files)
    total_bytes = sum(f['sizeBytes'] for f in files)
    giant_files = [f for f in files if f['isGiant']]
    tmp_files = [f for f in files if f['isTmp']]
    subfolders_set = {f['folderDir'] for f in files if f.get('folderDir')}

    hash_map = {}
    for f in files:
        if f['sha256'] and f['sha256'] != 'ERROR_HASH':
            hash_map.setdefault(f['sha256'], []).append(f)

    duplicate_groups = []
    potential_duplicate_saving = 0

    for sha, group_files in hash_map.items():
        if len(group_files) >= 2:
            group_files.sort(key=lambda x: (x['mtimeMs'], len(x['relativePath'])))
            original = group_files[0]
            duplicates = group_files[1:]
            wasted = len(duplicates) * original['sizeBytes']
            potential_duplicate_saving += wasted

            duplicate_groups.append({
                'hash': sha,
                'count': len(group_files),
                'fileSize': original['sizeBytes'],
                'fileSizeFormatted': format_bytes(original['sizeBytes']),
                'wastedBytes': wasted,
                'wastedFormatted': format_bytes(wasted),
                'originalFile': original,
                'duplicateFiles': duplicates,
                'allFiles': group_files
            })

    duplicate_groups.sort(key=lambda x: x['wastedBytes'], reverse=True)
    top20_duplicate_groups = duplicate_groups[:20]

    giant_files.sort(key=lambda x: x['sizeBytes'], reverse=True)
    top15_giant_files = giant_files[:15]

    dup_abs_paths = {d['absolutePath'] for g in duplicate_groups for d in g['duplicateFiles']}
    potential_tmp_saving = sum(t['sizeBytes'] for t in tmp_files if t['absolutePath'] not in dup_abs_paths)
    total_potential_saving = potential_duplicate_saving + potential_tmp_saving

    giant_total_bytes = sum(f['sizeBytes'] for f in giant_files)

    return {
        'rootPath': os.path.abspath(root_path),
        'subfolders': sorted(list(subfolders_set)),
        'metrics': {
            'totalFiles': total_files,
            'totalBytes': total_bytes,
            'totalFormatted': format_bytes(total_bytes),
            'giantFilesCount': len(giant_files),
            'giantFilesTotalBytes': giant_total_bytes,
            'giantFilesTotalFormatted': format_bytes(giant_total_bytes),
            'potentialSavingBytes': total_potential_saving,
            'potentialSavingFormatted': format_bytes(total_potential_saving),
            'duplicateGroupsCount': len(duplicate_groups),
            'tmpFilesCount': len(tmp_files)
        },
        'top15GiantFiles': top15_giant_files,
        'top20DuplicateGroups': top20_duplicate_groups,
        'tmpFiles': tmp_files,
        'allFilesCount': total_files
    }

def execute_clean_up(target_folder_path, file_paths_to_delete):
    resolved_target = os.path.abspath(target_folder_path)
    if not os.path.exists(resolved_target):
        raise ValueError(f"Folder target tidak ditemukan: {resolved_target}")

    results = {
        'deletedFiles': [],
        'failedFiles': [],
        'freedBytes': 0,
        'freedFormatted': '0 B'
    }

    for item_path in file_paths_to_delete:
        resolved_item = os.path.abspath(item_path)
        try:
            rel = os.path.relpath(resolved_item, resolved_target)
            if rel.startswith('..') or os.path.isabs(rel):
                results['failedFiles'].append({
                    'path': resolved_item,
                    'reason': 'File berada di luar target folder yang dipindai.'
                })
                continue

            if os.path.exists(resolved_item):
                size = os.path.getsize(resolved_item)
                os.remove(resolved_item)
                results['freedBytes'] += size
                results['deletedFiles'].append({
                    'path': resolved_item,
                    'relativePath': rel.replace('\\', '/'),
                    'sizeBytes': size,
                    'sizeFormatted': format_bytes(size)
                })
        except Exception as e:
            results['failedFiles'].append({
                'path': resolved_item,
                'reason': str(e)
            })

    results['freedFormatted'] = format_bytes(results['freedBytes'])
    return results

def resolve_physical_folder_path(folder_name):
    if not folder_name:
        return None
    user_home = os.path.expanduser('~')
    candidates = [
        os.path.abspath(folder_name),
        os.path.abspath(os.path.join('.', folder_name)),
        os.path.abspath(os.path.join('..', folder_name)),
        os.path.join(user_home, 'Desktop', folder_name),
        os.path.join(user_home, 'Documents', folder_name),
        os.path.join(user_home, 'Downloads', folder_name),
        os.path.join(user_home, 'Documents', 'StorageCleaner', folder_name),
        os.path.join(user_home, folder_name)
    ]
    for c in candidates:
        if os.path.exists(c) and os.path.isdir(c):
            return os.path.abspath(c)
    if 'bahan latihan' in folder_name.lower():
        p12 = os.path.abspath('Bahan Latihan P12')
        if os.path.exists(p12):
            return p12
    return None

def open_native_file_explorer(initial_dir=''):
    ps_script = os.path.join(os.path.dirname(__file__), 'browse_folder.ps1')
    res_initial = os.path.abspath(initial_dir) if initial_dir and os.path.exists(initial_dir) else os.path.abspath('.')
    cmd = ["powershell.exe", "-STA", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps_script, "-InitialDirectory", res_initial]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True)
        out = (res.stdout or '').strip()
        if not out or out == 'CANCELLED':
            return {'success': False, 'cancelled': True}
        return {'success': True, 'folderPath': out}
    except Exception as e:
        return {'success': False, 'error': str(e)}

def get_dashboard_html():
    js_path = os.path.join(os.path.dirname(__file__), 'storage_audit.js')
    if os.path.exists(js_path):
        with open(js_path, 'r', encoding='utf-8') as f:
            content = f.read()
            start_tag = 'function getDashboardHtml() {\n  return `'
            end_tag = '`;\n}'
            if start_tag in content and end_tag in content:
                part = content.split(start_tag)[1].split(end_tag)[0]
                return part
    return "<h1>Storage Audit & Cleaner Pro</h1>"

class AuditRequestHandler(http.server.BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(get_dashboard_html().encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        content_len = int(self.headers.get('Content-Length', 0))
        body_bytes = self.rfile.read(content_len) if content_len > 0 else b'{}'
        body = json.loads(body_bytes.decode('utf-8')) if body_bytes else {}

        if parsed.path == '/api/browse-native':
            initial_dir = body.get('initialDirectory', '.')
            res = open_native_file_explorer(initial_dir)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(res).encode('utf-8'))

        elif parsed.path == '/api/resolve-folder':
            fname = body.get('folderName', '')
            resolved = resolve_physical_folder_path(fname)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            if resolved:
                self.wfile.write(json.dumps({'success': True, 'resolvedPath': resolved}).encode('utf-8'))
            else:
                self.wfile.write(json.dumps({'success': False}).encode('utf-8'))

        elif parsed.path == '/api/scan':
            target_path = body.get('folderPath', DEFAULT_TARGET_FOLDER)
            resolved = os.path.abspath(target_path)
            if not os.path.exists(resolved) or not os.path.isdir(resolved):
                self.send_response(404)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': f'Folder tidak ditemukan: {target_path}'}).encode('utf-8'))
                return

            files = scan_directory(resolved)
            analysis = analyze_files(files, resolved)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(analysis).encode('utf-8'))

        elif parsed.path == '/api/clean':
            target_path = body.get('folderPath', DEFAULT_TARGET_FOLDER)
            files_to_delete = body.get('filesToDelete', [])
            results = execute_clean_up(target_path, files_to_delete)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(results).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

def run(port=DEFAULT_PORT):
    for p in range(port, port + 10):
        try:
            with socketserver.TCPServer(("", p), AuditRequestHandler) as httpd:
                url = f"http://localhost:{p}"
                print("================================================================")
                print("  STORAGE AUDIT & CLEANER - DIRECT EXECUTION")
                print("================================================================")
                print(f"  Target Harddisk Aktif : {os.path.abspath(DEFAULT_TARGET_FOLDER)}")
                print(f"  Dashboard URL         : {url}")
                print("================================================================")
                webbrowser.open(url)
                httpd.serve_forever()
                break
        except OSError:
            print(f"[WARN] Port {p} sedang digunakan, mencoba port berikutnya...")

if __name__ == '__main__':
    run()
