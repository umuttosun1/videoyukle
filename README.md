# VideoYukle

Video indirme uygulamasi. YouTube, Instagram, TikTok ve film/dizi sitelerinden video indirin.

## Ozellikler

- **1800+ site destegi** - yt-dlp destekli tum platformlar
- **Film/dizi siteleri** - filmmakinesi.to, hdfilmcehennemi.nl ve benzer siteler icin ozel resolver
  - Cloudflare bypass (curl tabanli)
  - Obfuscated JS cozumleme (eval/packer, base64, ROT13, crypto decrypt)
  - iframe/embed otomatik takibi
- **Ses dili secimi** - Turkce dublaj / Orijinal ses secenekleri
- **Altyazi secimi** - Turkce, Ingilizce vb. altyazilar otomatik bulunur ve ffmpeg ile gomulur
- **Coklu indirme** - Ayni anda birden fazla video indirin
- **Arka plan indirme** - Sayfa yenilense bile indirmeler devam eder (SSE ile reconnect)
- **Durdurma** - Aktif indirmeleri istediginiz zaman durdurun
- **Progress takibi** - Gercek zamanli ilerleme, hiz ve kalan sure bilgisi

## Kurulum

```bash
npm install
```

### Gereksinimler

- [Node.js](https://nodejs.org/) v18+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - Video indirme motoru
- [ffmpeg](https://ffmpeg.org/) - Video/ses birlestirme ve altyazi gomu

### Yapilandirma

`.env` dosyasi olusturun:

```env
YTDLP_PATH=./yt-dlp.exe
FFMPEG_DIR=C:/path/to/ffmpeg/bin
PORT=3000
```

## Calistirma

```bash
npm start
```

Tarayicinizda `http://localhost:3000` adresini acin.

## Kullanim

1. Video URL'sini yapistirin
2. "Bilgi Getir" butonuna basin
3. Format, ses dili ve altyazi secin
4. "Indir" butonuna basin
5. Indirme tamamlaninca "Kaydet" ile dosyayi tarayiciniza indirin

## API

| Endpoint | Method | Aciklama |
|----------|--------|----------|
| `/api/info` | POST | Video bilgisi getir |
| `/api/download` | POST | Indirme baslat |
| `/api/progress/:jobId` | GET | SSE progress stream |
| `/api/download/:jobId/file` | GET | Dosya indir |
| `/api/cancel/:jobId` | POST | Indirmeyi durdur |
| `/api/jobs?ids=...` | GET | Job durumlarini sorgula |

## Teknolojiler

- **Backend**: Node.js, Express.js
- **Frontend**: Vanilla JS, CSS
- **Video**: yt-dlp, ffmpeg
- **Resolver**: curl, vm (JS deobfuscation)
