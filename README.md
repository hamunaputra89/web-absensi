# Web Absensi (MVP)

Web absensi berbasis kamera (face recognition) yang otomatis sinkron ke Google Drive menggunakan Service Account.

Fitur MVP:
- Enroll pengguna (ambil foto + descriptor wajah) di browser
- Check-in via kamera (cocokkan descriptor)
- Backend Node.js menyimpan data ke SQLite
- Upload foto check-in dan file CSV harian ke Google Drive (Service Account)

Persiapan Google Drive (Service Account):
1. Buat project di Google Cloud Console.
2. Enable Google Drive API.
3. Buat Service Account di IAM & Admin.
4. Buat JSON key (download key.json).
5. Buat folder di Google Drive, lalu beri akses edit ke email service-account (lihat key.json atau console).
6. Salin folder ID dari URL folder → masukkan ke env var DRIVE_FOLDER_ID.
7. Encode key.json ke base64 dan masukkan ke env var SERVICE_ACCOUNT_KEY_BASE64.

Contoh .env (isi di file .env atau di environment):

PORT=3000
DATABASE_URL=./data/attendance.db
DRIVE_FOLDER_ID=FOLDER_ID_DI_SINI
SERVICE_ACCOUNT_KEY_BASE64=eyJ...base64...

Cara jalankan lokal:

1. Clone repo
   git clone https://github.com/hamunaputra89/web-absensi.git
   cd web-absensi
2. Install
   npm install
3. Download model face-api.js ke folder public/models (README instruksi di bawah)
4. Set .env sesuai contoh
5. Jalankan
   npm run dev

Frontend akan tersedia di http://localhost:3000

Catatan privasi:
- Sistem menyimpan descriptor wajah (vector) dan foto untuk keperluan identifikasi. Pastikan kebijakan privasi / persetujuan pengguna.

Roadmap:
- Integrasi fingerprint (membutuhkan model/SDK perangkat)
- Deployment otomatis
