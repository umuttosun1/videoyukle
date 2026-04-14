#!/bin/bash
echo "=== VideoYukle Kurulum ==="

# yt-dlp kurulumu
echo "[1/3] yt-dlp kuruluyor..."
pip3 install --user yt-dlp
echo "yt-dlp versiyon: $(yt-dlp --version)"

# ffmpeg kontrolu
echo "[2/3] ffmpeg kontrol ediliyor..."
if command -v ffmpeg &> /dev/null; then
    echo "ffmpeg mevcut: $(ffmpeg -version | head -1)"
else
    echo "ffmpeg bulunamadi. Kurmak icin: sudo apt install ffmpeg"
fi

# npm bagimliliklari
echo "[3/3] npm bagimliliklari kuruluyor..."
npm install

echo ""
echo "=== Kurulum tamamlandi ==="
echo "Baslatmak icin: npm run dev"
