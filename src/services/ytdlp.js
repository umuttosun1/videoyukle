const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const {
  curateFormats,
  formatDuration,
  detectPlatform,
} = require("./formatHelper");
const { resolve: resolveVideo, canResolve } = require("./genericResolver");

const YTDLP_PATH = process.env.YTDLP_PATH || "yt-dlp";
const FFMPEG_DIR = process.env.FFMPEG_DIR || "";
const DOWNLOADS_DIR = path.join(__dirname, "..", "..", "downloads");
const MAX_FILESIZE = "5G";
const PROCESS_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// ─── Info ───

async function getInfo(url) {
  // Known streaming sites → use generic resolver directly
  if (canResolve(url)) {
    return getResolvedInfo(url);
  }

  // Try yt-dlp first
  try {
    return await getYtdlpInfo(url);
  } catch (err) {
    // If yt-dlp fails with 403/unsupported, try generic resolver as fallback
    if (
      err.message.includes("desteklenmiyor") ||
      err.message.includes("erişilemedi") ||
      err.message.includes("alınamadı")
    ) {
      try {
        return getResolvedInfo(url);
      } catch {
        throw err;
      }
    }
    throw err;
  }
}

function getYtdlpInfo(url) {
  return new Promise((resolve, reject) => {
    const args = [
      "--dump-json",
      "--no-download",
      "--no-warnings",
      "--no-playlist",
      "--max-filesize",
      MAX_FILESIZE,
    ];

    if (FFMPEG_DIR) {
      args.push("--ffmpeg-location", FFMPEG_DIR);
    }

    args.push(url);

    const proc = spawn(YTDLP_PATH, args, {
      timeout: 60000,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(parseError(stderr)));
      }
      try {
        const info = JSON.parse(stdout);
        const formats = curateFormats(info.formats);
        const platform = detectPlatform(url);
        resolve({
          id: info.id || "unknown",
          title: info.title || "Bilinmeyen Video",
          thumbnail: info.thumbnail || null,
          duration: info.duration || 0,
          durationFormatted: formatDuration(info.duration),
          uploader: info.uploader || info.channel || "Bilinmeyen",
          platform,
          formats,
        });
      } catch {
        reject(new Error("Video bilgisi ayrıştırılamadı."));
      }
    });

    proc.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(new Error("yt-dlp bulunamadı. Lütfen kurulum yapın: pip3 install yt-dlp"));
      } else {
        reject(new Error("Video bilgisi alınırken bir hata oluştu."));
      }
    });
  });
}

function getResolvedInfo(url) {
  const resolved = resolveVideo(url);
  const hostname = new URL(url).hostname.replace(/^www\./, "");

  // Get formats and audio tracks from HLS stream
  const hlsInfo = getHlsFormats(resolved.videoUrl, resolved.referer);

  return {
    id: "resolved",
    title: resolved.title || "Video",
    thumbnail: resolved.thumbnail || null,
    duration: 0,
    durationFormatted: null,
    uploader: hostname,
    platform: detectPlatform(url),
    formats: hlsInfo.formats,
    audioTracks: hlsInfo.audioTracks,
    subtitles: resolved.subtitles || [],
    _resolved: resolved,
  };
}

function getHlsFormats(videoUrl, referer) {
  const fallback = {
    formats: [{
      formatId: "best",
      label: "En İyi Kalite (MP4)",
      quality: "best",
      ext: "mp4",
      filesize: null,
      filesizeBytes: 0,
      hasVideo: true,
      hasAudio: true,
    }],
    audioTracks: [],
  };

  try {
    const output = require("child_process").execFileSync(YTDLP_PATH, [
      "--no-check-certificates",
      "--no-download",
      "-F",
      "--referer", referer || "",
      ...(FFMPEG_DIR ? ["--ffmpeg-location", FFMPEG_DIR] : []),
      videoUrl,
    ], { timeout: 30000, encoding: "utf8" });

    const formats = [];
    const audioTracks = [];

    for (const line of output.split("\n")) {
      // Audio tracks: group_closedual-Turkish  mp4 audio only | m3u8 | audio only unknown Turkish
      if (/audio only/i.test(line) && !/video only/i.test(line)) {
        const id = line.trim().split(/\s+/)[0];
        const label = line.replace(/.*audio only\s+unknown\s+/i, "").trim() || id;
        audioTracks.push({ id, label });
        continue;
      }

      // Video formats: 4280  mp4 1920x1080 | ~5.89GiB 4281k m3u8 | avc1.640028 4281k video only
      const videoMatch = line.match(/^(\S+)\s+\S+\s+(\d+)x(\d+)\s+\|.*?~?([\d.]+\s*\S+iB)?/);
      if (videoMatch) {
        const id = videoMatch[1];
        const width = parseInt(videoMatch[2]);
        const height = parseInt(videoMatch[3]);
        const filesize = videoMatch[4]?.trim() || null;

        let quality;
        if (height >= 2160) quality = "4K";
        else if (height >= 1440) quality = "1440p";
        else if (height >= 1080) quality = "1080p";
        else if (height >= 720) quality = "720p";
        else if (height >= 480) quality = "480p";
        else quality = `${height}p`;

        formats.push({
          formatId: id,
          label: `${quality} MP4`,
          quality,
          ext: "mp4",
          filesize,
          filesizeBytes: 0,
          hasVideo: true,
          hasAudio: false,
        });
      }
    }

    if (formats.length === 0) return fallback;

    // Sort by resolution descending
    formats.sort((a, b) => {
      const order = { "4K": 5, "1440p": 4, "1080p": 3, "720p": 2, "480p": 1 };
      return (order[b.quality] || 0) - (order[a.quality] || 0);
    });

    return { formats, audioTracks };
  } catch {
    return fallback;
  }
}

// ─── Download ───

function startDownload(url, formatId, ext, jobId, audioTrackId, subtitleUrl, onProgress, onComplete, onError) {
  if (canResolve(url)) {
    return startResolvedDownload(url, formatId, jobId, audioTrackId, subtitleUrl, onProgress, onComplete, onError);
  }

  return startYtdlpDownload(url, formatId, ext, jobId, onProgress, onComplete, onError);
}

function startYtdlpDownload(url, formatId, ext, jobId, onProgress, onComplete, onError) {
  const outputPath = path.join(DOWNLOADS_DIR, `${jobId}.%(ext)s`);
  const args = ["--newline", "--no-playlist", "--max-filesize", MAX_FILESIZE];

  if (FFMPEG_DIR) {
    args.push("--ffmpeg-location", FFMPEG_DIR);
  }

  if (ext === "mp3") {
    args.push("-x", "--audio-format", "mp3");
  } else {
    if (formatId && formatId !== "best") {
      args.push("-f", formatId);
    }
    args.push("--merge-output-format", ext || "mp4");
  }

  args.push("-o", outputPath, url);

  const proc = spawn(YTDLP_PATH, args, {
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });

  const timeout = setTimeout(() => {
    proc.kill("SIGTERM");
    onError("İndirme zaman aşımına uğradı (30 dakika limiti).");
  }, PROCESS_TIMEOUT);

  let lastFilename = null;

  proc.stdout.on("data", (data) => {
    for (const line of data.toString().split("\n")) {
      const progress = parseProgress(line);
      if (progress) onProgress(progress);
      const destMatch = line.match(/\[(?:Merger|download)\].*?Destination:\s*(.+)/);
      if (destMatch) lastFilename = destMatch[1].trim();
      const mergeMatch = line.match(/\[Merger\].*?Merging formats into "(.+?)"/);
      if (mergeMatch) lastFilename = mergeMatch[1].trim();
    }
  });

  proc.stderr.on("data", (data) => {
    for (const line of data.toString().split("\n")) {
      const progress = parseProgress(line);
      if (progress) onProgress(progress);
      const destMatch = line.match(/Destination:\s*(.+)/);
      if (destMatch) lastFilename = destMatch[1].trim();
      const mergeMatch = line.match(/Merging formats into "(.+?)"/);
      if (mergeMatch) lastFilename = mergeMatch[1].trim();
      const alreadyMatch = line.match(/\[download\]\s+(.+?)\s+has already been downloaded/);
      if (alreadyMatch) lastFilename = alreadyMatch[1].trim();
    }
  });

  proc.on("close", (code) => {
    clearTimeout(timeout);
    if (code === 0) {
      if (lastFilename && fs.existsSync(lastFilename)) {
        onComplete(lastFilename);
      } else {
        const files = fs.readdirSync(DOWNLOADS_DIR);
        const match = files.find((f) => f.startsWith(jobId));
        if (match) {
          onComplete(path.join(DOWNLOADS_DIR, match));
        } else {
          onError("İndirme tamamlandı ancak dosya bulunamadı.");
        }
      }
    } else {
      onError("İndirme sırasında bir hata oluştu.");
    }
  });

  proc.on("error", (err) => {
    clearTimeout(timeout);
    onError("İndirme başlatılamadı: " + err.message);
  });

  return proc;
}

function startResolvedDownload(url, formatId, jobId, audioTrackId, subtitleUrl, onProgress, onComplete, onError) {
  let resolved;
  try {
    resolved = resolveVideo(url);
  } catch (err) {
    onError("Video kaynağı çözümlenemedi: " + err.message);
    return { kill: () => {} };
  }

  // Use user-selected subtitle, or fallback to resolved subtitles
  const selectedSubUrl = subtitleUrl || null;
  const fallbackSubs = subtitleUrl ? [] : resolved.subtitles;

  {
      const outputPath = path.join(DOWNLOADS_DIR, `${jobId}.%(ext)s`);
      const args = [
        "--newline",
        "--no-playlist",
        "--no-check-certificates",
        "--referer", resolved.referer || url,
      ];

      // Format + Audio track selection
      const videoFmt = (formatId && formatId !== "best") ? formatId : "bestvideo";
      if (audioTrackId) {
        args.push("-f", `${videoFmt}+${audioTrackId}`);
      } else if (formatId && formatId !== "best") {
        args.push("-f", formatId);
      }

      if (FFMPEG_DIR) {
        args.push("--ffmpeg-location", FFMPEG_DIR);
      }

      // For HLS streams, merge to mp4
      if (resolved.type === "application/x-mpegURL") {
        args.push("--merge-output-format", "mp4");
      }

      args.push("-o", outputPath, resolved.videoUrl);

      const proc = spawn(YTDLP_PATH, args, {
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });

      const timeout = setTimeout(() => {
        proc.kill("SIGTERM");
        onError("İndirme zaman aşımına uğradı (30 dakika limiti).");
      }, PROCESS_TIMEOUT);

      let lastFilename = null;

      proc.stdout.on("data", (data) => {
        for (const line of data.toString().split("\n")) {
          const progress = parseProgress(line);
          if (progress) onProgress(progress);
          const destMatch = line.match(/Destination:\s*(.+)/);
          if (destMatch) lastFilename = destMatch[1].trim();
          const mergeMatch = line.match(/Merging formats into "(.+?)"/);
          if (mergeMatch) lastFilename = mergeMatch[1].trim();
        }
      });

      proc.stderr.on("data", (data) => {
        for (const line of data.toString().split("\n")) {
          const progress = parseProgress(line);
          if (progress) onProgress(progress);
          const destMatch = line.match(/Destination:\s*(.+)/);
          if (destMatch) lastFilename = destMatch[1].trim();
          const mergeMatch = line.match(/Merging formats into "(.+?)"/);
          if (mergeMatch) lastFilename = mergeMatch[1].trim();
        }
      });

      proc.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          if (lastFilename && fs.existsSync(lastFilename)) {
            maybeEmbedSubtitles(lastFilename, selectedSubUrl, fallbackSubs, onComplete, onError);
          } else {
            const files = fs.readdirSync(DOWNLOADS_DIR);
            const match = files.find((f) => f.startsWith(jobId));
            if (match) {
              const filePath = path.join(DOWNLOADS_DIR, match);
              maybeEmbedSubtitles(filePath, selectedSubUrl, fallbackSubs, onComplete, onError);
            } else {
              onError("İndirme tamamlandı ancak dosya bulunamadı.");
            }
          }
        } else {
          onError("İndirme sırasında bir hata oluştu.");
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        onError("İndirme başlatılamadı: " + err.message);
      });
  }

  return { kill: () => {} };
}

// ─── Subtitle Embedding ───

function maybeEmbedSubtitles(videoPath, selectedSubUrl, fallbackSubs, onComplete, onError) {
  if (!FFMPEG_DIR) return onComplete(videoPath);

  let sub;
  if (selectedSubUrl) {
    // User explicitly selected a subtitle
    sub = { url: selectedSubUrl, lang: "tur", label: "Altyazi" };
  } else if (fallbackSubs && fallbackSubs.length > 0) {
    // Auto-select: prefer Turkish, then first
    const turkishSub = fallbackSubs.find(
      (s) => s.lang === "tr" || /turkish|türk/i.test(s.label)
    );
    sub = turkishSub || fallbackSubs[0];
  }
  if (!sub) return onComplete(videoPath);

  // Download subtitle
  const subPath = videoPath.replace(/\.[^.]+$/, ".vtt");
  try {
    const { execSync } = require("child_process");
    execSync(
      `curl -s -L -H "User-Agent: Mozilla/5.0" -o "${subPath}" "${sub.url}"`,
      { timeout: 15000 }
    );
  } catch {
    return onComplete(videoPath); // skip subtitle on error
  }

  if (!fs.existsSync(subPath) || fs.statSync(subPath).size < 50) {
    return onComplete(videoPath);
  }

  // Embed subtitle with ffmpeg
  const ffmpegPath = path.join(FFMPEG_DIR, "ffmpeg.exe");
  if (!fs.existsSync(ffmpegPath)) {
    return onComplete(videoPath);
  }

  const outputPath = videoPath.replace(/(\.[^.]+)$/, "-sub$1");
  const proc = spawn(ffmpegPath, [
    "-i", videoPath,
    "-i", subPath,
    "-c:v", "copy",
    "-c:a", "copy",
    "-c:s", "mov_text",
    "-metadata:s:s:0", `language=${sub.lang || "tur"}`,
    "-metadata:s:s:0", `title=${sub.label || "Altyazi"}`,
    "-disposition:s:0", "default",
    "-y", outputPath,
  ]);

  proc.on("close", (code) => {
    // Clean up
    try { fs.unlinkSync(subPath); } catch {}

    if (code === 0 && fs.existsSync(outputPath)) {
      try { fs.unlinkSync(videoPath); } catch {}
      fs.renameSync(outputPath, videoPath);
      onComplete(videoPath);
    } else {
      onComplete(videoPath); // serve without subtitle on error
    }
  });

  proc.on("error", () => {
    onComplete(videoPath);
  });
}

// ─── Parsers ───

function parseProgress(line) {
  // Standard: [download]  45.2% of  52.00MiB at  2.50MiB/s ETA 00:15
  const match = line.match(
    /\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\s*\w+)\s+at\s+([\d.]+\s*\w+\/s)\s+ETA\s+([\d:]+)/
  );
  if (match) {
    return {
      percent: parseFloat(match[1]),
      totalSize: match[2].trim(),
      speed: match[3].trim(),
      eta: match[4].trim(),
    };
  }

  // HLS/fragment: [download]   0.1% of ~ 947.79MiB at  4.84KiB/s ETA Unknown (frag 5/1690)
  const hlsMatch = line.match(
    /\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\s*\w+)\s+at\s+([\d.]+\s*\w+\/s)\s+ETA\s+(\S+)(?:\s+\(frag\s+(\d+)\/(\d+)\))?/
  );
  if (hlsMatch) {
    const frag = hlsMatch[5] && hlsMatch[6] ? `${hlsMatch[5]}/${hlsMatch[6]}` : null;
    const eta = hlsMatch[4] === "Unknown" ? (frag ? `frag ${frag}` : "Hesaplanıyor...") : hlsMatch[4];
    return {
      percent: parseFloat(hlsMatch[1]),
      totalSize: hlsMatch[2].trim(),
      speed: hlsMatch[3].trim(),
      eta,
    };
  }

  // Complete: [download] 100% of 52.00MiB
  const completeMatch = line.match(/\[download\]\s+100%\s+of\s+~?([\d.]+\s*\w+)/);
  if (completeMatch) {
    return { percent: 100, totalSize: completeMatch[1].trim(), speed: null, eta: "00:00" };
  }

  // HLS downloading: [hlsnative] Total fragments: 1690
  const fragTotal = line.match(/Total fragments:\s+(\d+)/);
  if (fragTotal) {
    return { percent: 0, totalSize: `${fragTotal[1]} fragment`, speed: null, eta: "Başlatılıyor..." };
  }

  // Merger
  if (line.includes("[Merger]") || line.includes("Merging formats")) {
    return { percent: 99, totalSize: null, speed: null, eta: "Birleştiriliyor..." };
  }

  return null;
}

function parseError(stderr) {
  if (stderr.includes("is not a valid URL") || stderr.includes("Unsupported URL")) {
    return "Bu URL desteklenmiyor. Lütfen geçerli bir video bağlantısı girin.";
  }
  if (stderr.includes("Video unavailable") || stderr.includes("Private video")) {
    return "Video bulunamadı veya erişim kısıtlı.";
  }
  if (stderr.includes("Sign in to confirm") || stderr.includes("age")) {
    return "Bu video yaş kısıtlamalı ve erişilemiyor.";
  }
  if (stderr.includes("copyright")) {
    return "Bu video telif hakkı nedeniyle erişilemiyor.";
  }
  if (stderr.includes("HTTP Error 403") || stderr.includes("HTTP Error 404")) {
    return "Videoya erişilemedi. Bağlantıyı kontrol edin.";
  }
  if (stderr.includes("Unable to extract")) {
    return "Bu siteden video bilgisi alınamadı. Site desteklenmiyor olabilir.";
  }
  return "Video bilgisi alınırken bir hata oluştu. Lütfen bağlantıyı kontrol edin.";
}

module.exports = { getInfo, startDownload };
