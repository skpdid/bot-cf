<div align="center">

# 🤖 Cloudflare Domain Manager Bot

**Kelola domain, DNS, dan Worker custom domain Cloudflare langsung dari Telegram.**

Multi-akun · Auto webhook · Tanpa CLI · 100% via dashboard

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare D1](https://img.shields.io/badge/Cloudflare-D1-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![Telegram Bot](https://img.shields.io/badge/Telegram-Bot%20API-26A5E4?logo=telegram&logoColor=white)](https://core.telegram.org/bots/api)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

[Tutorial Deploy](#-tutorial-deploy) · [Cara Penggunaan](#-cara-penggunaan) · [Troubleshooting](#-troubleshooting)

</div>

---

## ✨ Fitur

| Fitur | Deskripsi |
|-------|-----------|
| 🔑 **Multi Akun** | Kelola banyak API Key Cloudflare dari satu bot |
| 🌐 **Zones** | List semua domain + Zone ID |
| 📋 **DNS Records** | Lihat, tambah, hapus record |
| ⚙️ **Worker Domains** | Attach / detach custom domain |
| 🤖 **Telegram Bot** | Semua operasi via chat, tanpa dashboard |
| 🔁 **Auto Webhook** | Daftar sendiri saat request pertama |
| 🔒 **Secret Verified** | Verifikasi header dari Telegram |
| 🚦 **Whitelist User** | Hanya ID Telegram tertentu yang bisa akses |

---

## 📋 Yang Dibutuhkan

| Item | Cara Dapat |
|------|------------|
| Akun Cloudflare | [dash.cloudflare.com](https://dash.cloudflare.com) (gratis) |
| Cloudflare API Token | Buat di [API Tokens](https://dash.cloudflare.com/profile/api-tokens) |
| Telegram Bot Token | Buat via [@BotFather](https://t.me/BotFather) |
| Telegram User ID | Cek via [@userinfobot](https://t.me/userinfobot) |

---

## 🚀 Tutorial Deploy

### Langkah 1 — Buat Database D1

1. Buka [Cloudflare Dashboard](https://dash.cloudflare.com) → sidebar **Storage & Databases** → **D1 SQL Database** → **Create**.
2. Nama database: `cf-manager-db` → **Create**.
3. Buka database → tab **Console**.
4. Paste SQL berikut → klik **Execute**:

```sql
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL UNIQUE,
  api_token TEXT NOT NULL,
  account_id TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

5. Pastikan muncul **"Query executed successfully"**. ✅

---

### Langkah 2 — Buat Cloudflare API Token

1. Buka [API Tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token**.
2. Pilih **Custom token**.
3. Isi permission berikut:

| Scope | Resource | Level |
|-------|----------|-------|
| Zone | DNS | **Edit** |
| Zone | Zone | **Read** |
| Account | Workers Scripts | **Edit** |

4. **Zone Resources**: pilih `All zones` (atau zone tertentu jika ingin dibatasi).
5. **Account Resources**: pilih akun Anda.
6. Klik **Continue → Create Token**.
7. **Salin token** — hanya ditampilkan sekali. Simpan dulu.

> 💡 Kalau punya beberapa akun Cloudflare, buat token terpisah untuk masing-masing. Nanti didaftarkan dengan label berbeda.

---

### Langkah 3 — Buat Bot Telegram

1. Chat [@BotFather](https://t.me/BotFather) → kirim `/newbot`.
2. Ikuti instruksi: beri nama bot, lalu username (harus diakhiri `bot`, mis. `my_cf_manager_bot`).
3. Salin **HTTP API Token** yang diberikan BotFather.

**Catat juga User ID Anda:** chat [@userinfobot](https://t.me/userinfobot) → bot akan membalas dengan `Id: 123456789`.

---

### Langkah 4 — Buat Worker

1. Sidebar **Workers & Pages** → **Create** → **Create Worker**.
2. Nama: `cf-domain-manager` → **Deploy** (pakai kode default dulu, tidak apa-apa).
3. Klik **Edit code**.
4. **Hapus semua kode default**, lalu **paste** seluruh isi [`worker.js`](./worker.js).
5. **Jangan klik Deploy dulu** — lanjut ke Langkah 5.

---

### Langkah 5 — Bind Database ke Worker

Tanpa binding ini, bot tidak bisa menyimpan API key.

1. Masih di halaman Worker, buka tab **Settings** → **Bindings**.
2. Klik **Add binding** → pilih **D1 database**.
3. Isi:
   - **Variable name**: `DB` **(harus persis, huruf besar)**
   - **D1 database**: pilih `cf-manager-db`
4. Klik **Add**.

---

### Langkah 6 — Set Secrets

Buka **Settings** → **Variables and Secrets** → **Add**. Tambahkan satu per satu:

| Nama | Nilai | Wajib? |
|------|-------|--------|
| `TELEGRAM_BOT_TOKEN` | Token dari BotFather (Langkah 3) | ✅ Wajib |
| `ADMIN_TOKEN` | String random panjang (mis. dari `openssl rand -hex 32` atau password manager) | ✅ Wajib |
| `TELEGRAM_ALLOWED_IDS` | User ID Telegram Anda, misal `123456789`. Pisah koma jika lebih dari 1 | ⚠️ Sangat disarankan |
| `WEBHOOK_SECRET` | String random panjang | 🔒 Opsional (disarankan) |

> 🚨 **Jangan skip `TELEGRAM_ALLOWED_IDS`!** Tanpa ini, siapa pun yang menemukan username bot Anda bisa menghapus DNS domain Anda.

> 💡 Pilih tipe **Secret** (bukan "Text") untuk semua nilai di atas — supaya tidak terlihat setelah disimpan.

---

### Langkah 7 — Deploy

Klik **Save and Deploy**. Catat URL Worker Anda, misalnya:

```
https://cf-domain-manager.username.workers.dev
```

---

### Langkah 8 — Aktifkan Bot

**Buka URL Worker Anda di browser** (sekali saja):

```
https://cf-manager-domain.username.workers.dev/telegram/setup?token=<ADMIN_TOKEN>
```

Webhook Telegram akan **otomatis terdaftar** di background. Tidak perlu setup manual.

**Cek berhasil:** buka di browser:

```
https://api.telegram.org/bot<TOKEN_BOTFATHER>/getWebhookInfo
```

Kalau muncul `"url": "https://cf-domain-manager.username.workers.dev/telegram/webhook"` → berhasil. ✅

---

### Langkah 9 — Daftarkan API Key Cloudflare

Buka bot Anda di Telegram, lalu:

1. Kirim `/start` — bot harus membalas dengan daftar command.
2. Kirim:
   ```
   /addkey main <CLOUDFLARE_API_TOKEN>
   ```
   > `main` adalah label bebas. Ganti sesuai keinginan. `account_id` akan terdeteksi otomatis.

3. Cek berhasil:
   ```
   /keys
   ```

Kalau key muncul dengan ✅ → siap.

---

### Langkah 10 — Uji Coba

```
/zones main
```

Kalau muncul daftar domain beserta Zone ID → **selesai!** 🎉

---

## 🎮 Cara Penggunaan

Semua operasi dilakukan via chat Telegram. Format: `/command argumen1 argumen2 ...`

### 🔑 Manajemen API Key

| Command | Fungsi |
|---------|--------|
| `/keys` | Lihat semua API key |
| `/addkey <label> <token> [account_id]` | Tambah key |
| `/delkey <label>` | Hapus key |

**Contoh menambah akun kedua:**
```
/addkey client2 <TOKEN_CLIENT2>
```

Kalau token tidak punya zone (akun baru), tambahkan `account_id` manual:
```
/addkey client2 <TOKEN> 1a2b3c4d5e6f7890abcdef1234567890
```

> 💡 `account_id` bisa dilihat di URL dashboard Cloudflare: `dash.cloudflare.com/<ACCOUNT_ID>/...`

---

### 🌐 Melihat Daftar Domain (Zones)

```
/zones <label>
```

**Contoh:**
```
/zones main
```

**Output contoh:**
```
🌐 2 zone:
• example.com [active]
  023e105f4ecef8ad9ca31a8372d0c353
• myapp.net [active]
  593c9c94de529bbbfaac7c53ced0447d
```

> Angka hex panjang di bawah nama domain adalah **Zone ID**. Simpan — dibutuhkan untuk operasi DNS.

---

### 📋 Mengelola DNS Record

**Lihat DNS:**
```
/dns <label> <zone_id>
```
Contoh: `/dns main 023e105f4ecef8ad9ca31a8372d0c353`

**Tambah DNS:**
```
/adddns <label> <zone_id> <type> <name> <content> [proxied]
```

| Parameter | Contoh | Keterangan |
|-----------|--------|------------|
| `type` | `A`, `AAAA`, `CNAME`, `TXT`, `MX` | Tipe record |
| `name` | `sub` atau `sub.example.com` | Nama/subdomain |
| `content` | `1.2.3.4` | Nilai record |
| `proxied` | `true` / `false` | Default: `true` untuk A/CNAME |

**Contoh tambah record A:**
```
/adddns main 023e105f4ecef8ad9ca31a8372d0c353 A sub 1.2.3.4 true
```

Bot membalas dengan ID record — simpan untuk keperluan hapus.

**Hapus DNS:**
```
/deldns <label> <zone_id> <record_id>
```

---

### ⚙️ Mengelola Worker Custom Domain

**Lihat semua custom domain:**
```
/workers <label>
```

**Attach domain ke Worker:**
```
/attach <label> <hostname> <service> <zone_id> <zone_name>
```

| Parameter | Contoh | Keterangan |
|-----------|--------|------------|
| `hostname` | `app.example.com` | Domain yang mau di-attach |
| `service` | `my-worker` | Nama Worker target |
| `zone_id` | `023e105f...` | Zone ID hostname |
| `zone_name` | `example.com` | Nama zone |

**Contoh:**
```
/attach main app.example.com my-worker 023e105f4ecef8ad9ca31a8372d0c353 example.com
```

> ⚠️ DNS record untuk `app.example.com` harus sudah dibuat dulu (A/AAAA/CNAME ke Worker). Kalau belum, attach tetap berhasil tapi domain tidak resolve.

**Detach domain dari Worker:**
```
/detach <label> <domain_id>
```

`domain_id` didapat dari hasil `/workers`.

---

## 🧩 Skenario Lengkap

Alur kerja tipikal untuk mendeploy Worker baru ke subdomain:

**1. Cek zone ID domain Anda**
```
/zones main
```
→ Dapat `zone_id`: misal `023e105f4ecef8ad9ca31a8372d0c353` untuk `example.com`.

**2. Buat DNS record untuk subdomain**
```
/adddns main 023e105f4ecef8ad9ca31a8372d0c353 A app 192.0.2.1 true
```
→ Bot balas `record_id`.

**3. Attach ke Worker**
```
/attach main app.example.com my-worker 023e105f4ecef8ad9ca31a8372d0c353 example.com
```
→ Bot balas `domain_id`.

**4. Verifikasi**
```
/workers main
```
→ `app.example.com` harus muncul.

**5. (Kalau perlu lepas)**
```
/detach main <domain_id>
/deldns main 023e105f4ecef8ad9ca31a8372d0c353 <record_id>
```

---

## 🌍 Multi-Akun

Setiap API Token mewakili satu akun Cloudflare. Beri label berbeda:

```
/addkey personal <TOKEN_AKUN_PERSONAL>
/addkey clientA  <TOKEN_AKUN_CLIENT_A>
/addkey clientB  <TOKEN_AKUN_CLIENT_B>
```

Gunakan label sesuai akun:

```
/zones personal
/zones clientA
/dns clientB <zone_id>
```

Cek semua akun terdaftar dengan `/keys`.

---

## 🔧 Troubleshooting

### Bot tidak merespons sama sekali

1. Cek webhook:
   ```
   https://api.telegram.org/bot<TOKEN>/getWebhookInfo
   ```
   Kalau `"url":""` → buka URL Worker di browser untuk re-register.
2. Cek log Worker: Dashboard → Worker → **Logs**.

### Muncul `D1_ERROR` atau `env.DB is undefined`

Binding D1 belum terpasang atau salah nama.  
**Fix:** Settings → Bindings → pastikan nama variable persis `DB`.

### Bot balas `⛔ Unauthorized`

`TELEGRAM_ALLOWED_IDS` tidak berisi ID Anda.  
**Fix:** Cek User ID via [@userinfobot](https://t.me/userinfobot), update secret, redeploy.

### `/addkey` error `CF API ...`

Token Cloudflare kurang permission.  
**Fix:** Pastikan token punya `Zone → DNS → Edit`, `Zone → Zone → Read`, `Account → Workers Scripts → Edit`.

### `API key "..." tidak ditemukan / nonaktif`

Label salah atau key sudah dihapus.  
**Fix:** Cek `/keys`, atau daftar ulang dengan `/addkey`.

### DNS sudah dibuat tapi website belum bisa diakses

- Untuk A/CNAME, pastikan `proxied = true` (isi argumen `true` di `/adddns`).
- Propagasi DNS global butuh 30 detik – 5 menit.

### Webhook tiba-tiba berhenti

Telegram otomatis menonaktifkan webhook jika Worker sering membalas error 5xx.  
**Fix:** Cek log Worker → perbaiki → force re-register via:
```
https://<worker-url>/telegram/setup?token=<ADMIN_TOKEN>
```

### Lupa `ADMIN_TOKEN` atau ingin ganti secret

Dashboard → Worker → **Settings** → **Variables and Secrets** → edit / hapus → tambah baru → **Save and Deploy**.

---

## 📌 Tips

- **Label case-sensitive**: `main` ≠ `Main` ≠ `MAIN`.
- **Zone ID selalu 32 karakter hex**, didapat dari `/zones`.
- **Record ID** didapat dari `/dns`.
- **Domain ID** (worker) didapat dari `/workers`.
- **Backup label & account_id** di catatan aman — kalau Worker bermasalah, setidaknya Anda tahu key mana yang harus dipasang ulang.
- **Jangan share screenshot** yang menampilkan Zone ID / token di grup publik.
- **Rotasi API Token Cloudflare** secara berkala (tiap 3–6 bulan) lewat dashboard Cloudflare → `/delkey` → `/addkey` baru di bot.

---

## ✅ Checklist Setup

- [ ] D1 database dibuat + SQL dijalankan
- [ ] Cloudflare API Token dibuat dengan 3 permission
- [ ] Bot Telegram dibuat via BotFather
- [ ] Worker dibuat + `worker.js` di-paste
- [ ] Binding `DB` → `cf-manager-db`
- [ ] Secret `TELEGRAM_BOT_TOKEN` diisi
- [ ] Secret `ADMIN_TOKEN` diisi
- [ ] Secret `TELEGRAM_ALLOWED_IDS` diisi
- [ ] Secret `WEBHOOK_SECRET` diisi (opsional)
- [ ] Save & Deploy
- [ ] URL Worker dibuka di browser (trigger webhook)
- [ ] `/start` di bot → respons OK
- [ ] `/addkey` → `/keys` → `/zones` berhasil

Kalau semua ✅ → bot siap dipakai. 🎉

---

## 📁 Struktur Repo

```
.
├── worker.js       # Kode Worker (paste ke dashboard)
├── README.md       # File ini
├── DOCS.md         # Dokumentasi teknis lengkap
└── LICENSE         # MIT
```

---

## 🔒 Keamanan

- Semua credential disimpan sebagai **Secret** di Cloudflare, tidak di source code.
- **Wajib** isi `TELEGRAM_ALLOWED_IDS` sebelum dipakai produksi.
- Gunakan **API Token** Cloudflare dengan scope minimal, bukan Global API Key.
- `WEBHOOK_SECRET` mencegah orang lain mengirim update palsu ke webhook Anda.
- Token Cloudflare di D1 tersimpan plaintext — batasi akses akun Cloudflare yang bisa melihat Worker & D1.

---

## 📜 Lisensi

[MIT](./LICENSE) — bebas digunakan, dimodifikasi, dan didistribusikan.

---

<div align="center">

**⭐ Kalau project ini bermanfaat, beri bintang di GitHub!**

</div>
