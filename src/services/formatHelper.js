const QUALITY_ORDER = [
  "2160",
  "1440",
  "1080",
  "720",
  "480",
  "360",
  "240",
  "144",
];

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024)
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function curateFormats(rawFormats) {
  if (!rawFormats || !Array.isArray(rawFormats)) return [];

  const videoFormats = new Map();
  let bestAudio = null;

  for (const f of rawFormats) {
    const height = f.height;
    const hasVideo = f.vcodec && f.vcodec !== "none";
    const hasAudio = f.acodec && f.acodec !== "none";

    // Best audio track
    if (hasAudio && !hasVideo) {
      const abr = f.abr || f.tbr || 0;
      if (!bestAudio || abr > (bestAudio.abr || bestAudio.tbr || 0)) {
        bestAudio = f;
      }
    }

    // Video formats
    if (hasVideo && height) {
      const key = String(height);
      const existing = videoFormats.get(key);
      const filesize = f.filesize || f.filesize_approx || 0;

      // Prefer mp4 > webm, and higher bitrate
      const isBetter =
        !existing ||
        (f.ext === "mp4" && existing.ext !== "mp4") ||
        (f.ext === existing.ext && (f.tbr || 0) > (existing.tbr || 0));

      if (isBetter) {
        videoFormats.set(key, {
          ...f,
          _hasAudio: hasAudio,
          _filesize: filesize,
        });
      }
    }
  }

  const result = [];

  // Sort by quality (highest first)
  const sortedHeights = [...videoFormats.keys()].sort(
    (a, b) => parseInt(b) - parseInt(a),
  );

  for (const height of sortedHeights) {
    const f = videoFormats.get(height);
    const h = parseInt(height);

    let qualityLabel;
    if (h >= 2160) qualityLabel = "4K";
    else if (h >= 1440) qualityLabel = "1440p";
    else if (h >= 1080) qualityLabel = "1080p";
    else if (h >= 720) qualityLabel = "720p";
    else if (h >= 480) qualityLabel = "480p";
    else if (h >= 360) qualityLabel = "360p";
    else if (h >= 240) qualityLabel = "240p";
    else qualityLabel = `${h}p`;

    // If format has both video and audio, use it directly
    // Otherwise, combine with best audio
    let formatId;
    if (f._hasAudio) {
      formatId = f.format_id;
    } else if (bestAudio) {
      formatId = `${f.format_id}+${bestAudio.format_id}`;
    } else {
      formatId = f.format_id;
    }

    // Estimate combined filesize
    let filesize = f._filesize;
    if (!f._hasAudio && bestAudio) {
      filesize += bestAudio.filesize || bestAudio.filesize_approx || 0;
    }

    result.push({
      formatId,
      label: `${qualityLabel} MP4`,
      quality: qualityLabel,
      ext: "mp4",
      filesize: formatFileSize(filesize),
      filesizeBytes: filesize,
      hasVideo: true,
      hasAudio: true,
    });
  }

  // Add audio-only option
  if (bestAudio) {
    const audioSize = bestAudio.filesize || bestAudio.filesize_approx || 0;
    result.push({
      formatId: bestAudio.format_id,
      label: "Sadece Ses (MP3)",
      quality: "audio",
      ext: "mp3",
      filesize: formatFileSize(audioSize),
      filesizeBytes: audioSize,
      hasVideo: false,
      hasAudio: true,
    });
  }

  // If no formats found, add a "best" fallback
  if (result.length === 0) {
    result.push({
      formatId: "best",
      label: "En İyi Kalite",
      quality: "best",
      ext: "mp4",
      filesize: null,
      filesizeBytes: 0,
      hasVideo: true,
      hasAudio: true,
    });
  }

  return result;
}

function detectPlatform(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname.includes("youtube") || hostname.includes("youtu.be"))
    return "YouTube";
  if (hostname.includes("instagram")) return "Instagram";
  if (hostname.includes("tiktok")) return "TikTok";
  if (hostname.includes("twitter") || hostname.includes("x.com"))
    return "Twitter/X";
  if (hostname.includes("facebook") || hostname.includes("fb.watch"))
    return "Facebook";
  if (hostname.includes("dailymotion")) return "Dailymotion";
  if (hostname.includes("vimeo")) return "Vimeo";
  if (hostname.includes("reddit")) return "Reddit";
  if (hostname.includes("twitch")) return "Twitch";
  if (hostname.includes("filmmakinesi")) return "Filmmakinesi";
  if (hostname.includes("hdfilmcehennemi")) return "HDFilmCehennemi";
  if (hostname.includes("dizipal") || hostname.includes("dizibox")) return "Dizi";
  if (hostname.includes("fullhdfilmizlesene") || hostname.includes("filmizlesene")) return "Filmizlesene";
  if (hostname.includes("jetfilmizle")) return "Jetfilmizle";
  return "Diğer";
}

module.exports = {
  curateFormats,
  formatDuration,
  formatFileSize,
  detectPlatform,
};
