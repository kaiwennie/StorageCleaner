# Storage Audit & Cleaner Pro

Aplikasi utilitas audit dan pembersihan penyimpanan storage berbasis **Node.js** (dan opsional Python) dengan antarmuka **Web Dashboard interaktif responsif** di `http://localhost:3000`.

Aplikasi ini dibangun menggunakan **modul native bawaan 100% tanpa external dependencies** (`zero npm install` / `zero pip install`).

---

## 🚀 Fitur Utama Sesuai SRS

1. **Input Path Folder Dinamis di Web UI**
   - Mendukung target folder default `./Bahan Latihan P12`.
   - Pengguna dapat mengetikkan sembarang path folder lokal (relatif maupun absolut) secara dinamis langsung dari input field di Web UI tanpa hardcoding.
   - Pemindaian folder dilakukan secara rekursif hingga ke seluruh level subfolder.

2. **Pengelompokan Duplikat Identik (SHA-256 Hash)**
   - Mengelompokkan file dengan konten identik menggunakan algoritma hashing kriptografis SHA-256 secara streaming (hemat memori).
   - Mendeteksi duplikat meskipun nama filenya berbeda (contoh: `modul.pdf` dan `modul_BACKUP.pdf`).
   - Menyajikan daftar kelompok duplikat dalam format Accordion interaktif yang menampilkan file asli yang dipertahankan dan file salinan kembar yang akan dibersihkan.

3. **Deteksi File Raksasa (Ambang Batas > 10 MB)**
   - Memfilter dan menandai semua file berukuran lebih dari 10 MB.
   - Menampilkan daftar 15 file raksasa teratas dalam format tabel lengkap dengan ukuran (MB/KB), rank, dan tanggal modifikasi.

4. **Dashboard Responsif & 4 Kartu Metrik Storage**
   - **Total File**: Jumlah keseluruhan file dari folder dan subfolder terpilih.
   - **Total Kapasitas**: Total ukuran penyimpanan yang terpakai (diformat dinamis ke B/KB/MB/GB).
   - **File Raksasa**: Jumlah file > 10 MB beserta total akumulasi ukurannya.
   - **Potensi Hemat**: Estimasi kapasitas yang dapat dibebaskan dari salinan duplikat dan file `.tmp`.

5. **Pembersihan In-Place dengan Modal Konfirmasi Interaktif**
   - Tombol **"Bersihkan Duplikat & Sampah"** memicu modal konfirmasi dengan rincian file yang akan dihapus dan kapasitas yang akan dibebaskan.
   - Eksekusi dilakukan secara **in-place** langsung pada folder asal target (bukan disalin atau dipindahkan ke direktori lain).
   - Menghapus salinan duplikat (menyimpan 1 file asli per kelompok) dan file `.tmp`.
   - Kapasitas folder target langsung berkurang seketika, dan dashboard secara otomatis melakukan rescan pembaruan metrik.

---

## 💻 Cara Menjalankan

### Menggunakan Node.js (Rekomendasi Utama)
```bash
node storage_audit.js
```
Aplikasi akan langsung membuka browser ke alamat `http://localhost:3000`.

### Menggunakan Python (Opsi Pendamping / Fallback)
```bash
python storage_audit.py
```

---

## 📁 Struktur Berkas Proyek

```text
StorageCleaner/
├── Bahan Latihan P12/           # Folder sampel latihan dengan subfolder, file duplikat, .tmp & giant file
│   ├── Dokumen/
│   │   ├── modul.pdf           # File asli
│   │   ├── modul_BACKUP.pdf    # Duplikat identik (SHA-256 sama)
│   │   ├── slide_presentasi.pptx
│   │   └── word_autosave.tmp   # File temporary
│   ├── Media/
│   │   ├── foto_kegiatan.jpg
│   │   ├── foto_kegiatan_raw.jpg
│   │   └── rekaman_kuliah_p12.mp4 (12 MB - File Raksasa)
│   ├── SubFolder/Arsip/
│   │   ├── backup_database_dump.sql (15 MB - File Raksasa)
│   │   ├── foto_kegiatan_copy.jpg
│   │   └── slide_presentasi_salinan.pptx
│   └── TempFiles/
│       └── session_data.tmp
├── storage_audit.js             # Aplikasi server & web dashboard Node.js native
├── storage_audit.py             # Alternatif Python native (library standar)
└── README.md                    # Dokumentasi teknis proyek
```