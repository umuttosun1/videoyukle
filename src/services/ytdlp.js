const { spawn } = require('child_process');
const path = require('path');
const { curateFormats, formatDuration, detectPlatform } = require('./formatHelper');

const YTDLP_PATH = process.env.YTDLP_PATH || 'yt-dlp';
const DOWNLOADS_DIR = path.join(__dirname, '..', '..', 'downloads');
const MAX_FILESIZE = '2G';
const PROCESS_TIMEOUT = 30 * 60 * 1000; // 30 minutes

function getInfo(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-json',
      '--no-download',
      '--no-warnings',
      '--no-playlist',
      '--max-filesize', MAX_FILESIZE,
      url
    ];

    const proc = spawn(YTDLP_PATH, args, {
      timeout: 60000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        const errorMsg = parseError(stderr);
        return reject(new Error(errorMsg));
      }

      try {
        const info = JSON.parse(stdout);
        const formats = curateFormats(info.formats);
        const platform = detectPlatform(url);

        resolve({
          id: info.id || 'unknown',
          title: info.title || 'Bilinmeyen Video',
          thumbnail: info.thumbnail || null,
          duration: info.duration || 0,
          durationFormatted: formatDuration(info.duration),
          uploader: info.uploader || info.channel || 'Bilinmeyen',
          platform,
          formats
        });
      } catch (e) {
        reject(new Error('Video bilgisi ayrıştırılamadı.'));
      }
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('yt-dlp bulunamadı. Lütfen kurulum yapın: pip3 install yt-dlp'));
      } else {
        reject(new Error('Video bilgisi alınırken bir hata oluştu.'));
      }
    });
  });
}

function startDownload(url, formatId, ext, jobId, onProgress, onComplete, onError) {
  const outputPath = path.join(DOWNLOADS_DIR, `${jobId}.%(ext)s`);

  const args = ['--newline', '--no-playlist', '--max-filesize', MAX_FILESIZE];

  if (ext === 'mp3') {
    args.push('-x', '--audio-format', 'mp3');
  } else {
    if (formatId && formatId !== 'best') {
      args.push('-f', formatId);
    }
    args.push('--merge-output-format', ext || 'mp4');
  }

  args.push('-o', outputPath, url);

  const proc = spawn(YTDLP_PATH, args, {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  });

  const timeout = setTimeout(() => {
    proc.kill('SIGTERM');
    onError('İndirme zaman aşımına uğradı (30 dakika limiti).');
  }, PROCESS_TIMEOUT);

  let lastFilename = null;

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      const progress = parseProgress(line);
      if (progress) {
        onProgress(progress);
      }
      // Capture destination filename
      const destMatch = line.match(/\[(?:Merger|download)\].*?Destination:\s*(.+)/);
      if (destMatch) {
        lastFilename = destMatch[1].trim();
      }
      const mergeMatch = line.match(/\[Merger\].*?Merging formats into "(.+?)"/);
      if (mergeMatch) {
        lastFilename = mergeMatch[1].trim();
      }
    }
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      const progress = parseProgress(line);
      if (progress) {
        onProgress(progress);
      }
      const destMatch = line.match(/Destination:\s*(.+)/);
      if (destMatch) {
        lastFilename = destMatch[1].trim();
      }
      const mergeMatch = line.match(/Merging formats into "(.+?)"/);
      if (mergeMatch) {
        lastFilename = mergeMatch[1].trim();
      }
      const alreadyMatch = line.match(/\[download\]\s+(.+?)\s+has already been downloaded/);
      if (alreadyMatch) {
        lastFilename = alreadyMatch[1].trim();
      }
    }
  });

  proc.on('close', (code) => {
    clearTimeout(timeout);

    if (code === 0) {
      // Find the actual output file
      const fs = require('fs');
      if (lastFilename && fs.existsSync(lastFilename)) {
        onComplete(lastFilename);
      } else {
        // Try to find file by jobId pattern
        const files = fs.readdirSync(DOWNLOADS_DIR);
        const match = files.find(f => f.startsWith(jobId));
        if (match) {
          onComplete(path.join(DOWNLOADS_DIR, match));
        } else {
          onError('İndirme tamamlandı ancak dosya bulunamadı.');
        }
      }
    } else {
      onError('İndirme sırasında bir hata oluştu.');
    }
  });

  proc.on('error', (err) => {
    clearTimeout(timeout);
    onError('İndirme başlatılamadı: ' + err.message);
  });

  return proc;
}

function parseProgress(line) {
  // Match: [download]  45.2% of  52.00MiB at  2.50MiB/s ETA 00:15
  const match = line.match(
    /\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\s*\w+)\s+at\s+([\d.]+\s*\w+\/s)\s+ETA\s+([\d:]+)/
  );
  if (match) {
    return {
      percent: parseFloat(match[1]),
      totalSize: match[2].trim(),
      speed: match[3].trim(),
      eta: match[4].trim()
    };
  }

  // Match: [download] 100% of 52.00MiB
  const completeMatch = line.match(/\[download\]\s+100%\s+of\s+([\d.]+\s*\w+)/);
  if (completeMatch) {
    return {
      percent: 100,
      totalSize: completeMatch[1].trim(),
      speed: null,
      eta: '00:00'
    };
  }

  // Match merge status
  if (line.includes('[Merger]') || line.includes('Merging formats')) {
    return {
      percent: 99,
      totalSize: null,
      speed: null,
      eta: 'Birleştiriliyor...'
    };
  }

  return null;
}

function parseError(stderr) {
  if (stderr.includes('is not a valid URL') || stderr.includes('Unsupported URL')) {
    return 'Bu URL desteklenmiyor. Lütfen geçerli bir video bağlantısı girin.';
  }
  if (stderr.includes('Video unavailable') || stderr.includes('Private video')) {
    return 'Video bulunamadı veya erişim kısıtlı.';
  }
  if (stderr.includes('Sign in to confirm') || stderr.includes('age')) {
    return 'Bu video yaş kısıtlamalı ve erişilemiyor.';
  }
  if (stderr.includes('copyright')) {
    return 'Bu video telif hakkı nedeniyle erişilemiyor.';
  }
  if (stderr.includes('HTTP Error 403') || stderr.includes('HTTP Error 404')) {
    return 'Videoya erişilemedi. Bağlantıyı kontrol edin.';
  }
  if (stderr.includes('Unable to extract')) {
    return 'Bu siteden video bilgisi alınamadı. Site desteklenmiyor olabilir.';
  }
  return 'Video bilgisi alınırken bir hata oluştu. Lütfen bağlantıyı kontrol edin.';
}

module.exports = { getInfo, startDownload };
