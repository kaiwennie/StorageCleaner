# Storage Audit & Cleaner (Direct Execution)

Aplikasi utilitas audit dan pembersihan penyimpanan storage berbasis **Node.js** (dan opsional Python) dengan antarmuka **Web Dashboard interaktif responsif** di `http://localhost:3000` dengan desain yang disesuaikan persis dengan antarmuka target.

Aplikasi ini dibangun menggunakan **modul native bawaan 100% tanpa external dependencies** (`zero npm install` / `zero pip install`).

---

## 🚀 Fitur Utama & 3 Cara Memilih Folder Target

### 1. Tiga Pilihan Fleksibel Memilih Folder Harddisk:
1. **`📁 Browse Folder (Dialog OS)`**:
   - Membuka jendela dialog **File Explorer Windows** (`FolderBrowserDialog`) langsung di layar desktop komputer Anda dengan properti *TopMost* agar langsung aktif di depan.
   - Folder apa pun yang Anda pilih di File Explorer otomatis terhubung langsung ke harddisk dan dipindai untuk dibersihkan.
2. **`⬆️ Pilih / Upload Folder`**:
   - Membuka dialog pemilih direktori peramban (*browser native directory picker*) menggunakan HTML5 `webkitdirectory`.
   - Mengambil nama folder target dan mencari lokasi fisiknya secara otomatis di komputer (`Desktop`, `Documents`, `Downloads`, atau `Workspace`), lalu menampilkan notifikasi:
     - `ℹ️ Mencari lokasi fisik folder '...' di harddisk...`
     - `✅ Berhasil terhubung langsung ke harddisk: C:\Users\...`
3. **`📝 Input Path`**:
   - Membuka jendela input untuk mengetikkan atau menempelkan (*paste*) path folder lokal secara langsung, dilengkapi tombol jalan pintas cepat ke folder umum (*Bahan Latihan P12*, *Workspace Saat Ini*, dll.).

---

### 2. Tampilan Dashboard (Persis Screenshot)
- **Header**:
  - Logo petir cyan ⚡ dengan judul **Storage Audit & Cleaner** dan badge hijau **Direct Execution**.
  - Tombol **`🔄 Pindai Ulang`** dan tombol merah **`🧹 Bersihkan Duplikat & Sampah`**.
- **Bar Target Harddisk Aktif**:
  - Ikon folder emas 📁, label `TARGET HARDDISK AKTIF:` dan teks path tebal biru monospace (`C:\Users\...`).
- **4 Kartu Metrik Storage**:
  1. **TOTAL FILE DI-SCAN**: Total file di-scan secara rekursif (`STG-01`).
  2. **TOTAL KAPASITAS FOLDER**: Ukuran data fisik asli di disk (`format B/KB/MB/GB`).
  3. **FILE RAKSASA (≥ 2 MB)**: Jumlah berkas boros kuota berukuran ≥ 2 MB (`STG-03`).
  4. **POTENSI HEMAT RUANG**: Estimasi ruang yang dapat dibebaskan dari duplikat identik & file sampah `.tmp`.
- **Daftar File Raksasa (≥ 2 MB)**:
  - Tabel berkas raksasa lengkap dengan icon tipe file, nama file, path lokasi harddisk, ukuran dalam MB/KB, dan badge format (`PDF`, `ZIP`, `PPTX`, `MP4`, dll.).
  - Kotak pencarian langsung: `Cari file raksasa...`.
- **Kelompok Duplikat Identik (SHA-256)**:
  - Accordion kelompok duplikat dengan penanda jelas antara file asli yang disimpan dan file salinan redundant yang akan dihapus.
- **File Temporary Sampah (.tmp)**:
  - Daftar file temporary cache untuk dibersihkan.

---

## 💻 Cara Menjalankan

```bash
node storage_audit.js
```
Aplikasi akan langsung membuka browser ke alamat `http://localhost:3000`.

Atau versi Python (jika terpasang Python):
```bash
python storage_audit.py
```