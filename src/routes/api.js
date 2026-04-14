const express = require("express");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const { validateUrl } = require("../middleware/validator");
const { getInfo, startDownload } = require("../services/ytdlp");

const router = express.Router();

// In-memory job storage
const jobs = new Map();

// Cleanup interval: remove old jobs and files every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [jobId, job] of jobs) {
      const age = now - job.createdAt;
      // Remove completed jobs after 1 hour, failed after 10 min
      const maxAge = job.status === "complete" ? 60 * 60 * 1000 : 10 * 60 * 1000;
      if (
        (job.status === "complete" || job.status === "error") &&
        age > maxAge
      ) {
        // Sadece job kaydını sil, dosyayı silme
        jobs.delete(jobId);
      }
      // Kill stuck downloads after 35 min
      if (job.status === "downloading" && age > 35 * 60 * 1000) {
        if (job.process) {
          try {
            job.process.kill("SIGTERM");
          } catch {}
        }
        job.status = "error";
        job.error = "İndirme zaman aşımına uğradı.";
      }
    }
  },
  5 * 60 * 1000,
);

// POST /api/info - Get video information
router.post("/info", validateUrl, async (req, res) => {
  try {
    const info = await getInfo(req.body.url);
    res.json({ success: true, data: info });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/download - Start a download
router.post("/download", validateUrl, (req, res) => {
  const { url, formatId, ext, audioTrackId, subtitleUrl, title } = req.body;
  const jobId = uuidv4();

  const job = {
    id: jobId,
    title: title || "Video",
    status: "starting",
    percent: 0,
    speed: null,
    eta: null,
    filename: null,
    filePath: null,
    createdAt: Date.now(),
    process: null,
    sseClients: [],
  };

  jobs.set(jobId, job);

  const proc = startDownload(
    url,
    formatId || "best",
    ext || "mp4",
    jobId,
    audioTrackId || null,
    subtitleUrl || null,
    // onProgress
    (progress) => {
      job.status = "downloading";
      job.percent = progress.percent;
      job.speed = progress.speed;
      job.eta = progress.eta;
      job.totalSize = progress.totalSize;
      notifyClients(job);
    },
    // onComplete
    (filePath) => {
      job.status = "complete";
      job.percent = 100;
      job.filePath = filePath;
      job.filename = path.basename(filePath);
      notifyClients(job);
    },
    // onError
    (errorMsg) => {
      job.status = "error";
      job.error = errorMsg;
      notifyClients(job);
    },
  );

  job.process = proc;
  job.status = "downloading";

  res.json({ success: true, jobId });
});

// POST /api/cancel/:jobId - Cancel/stop a download
router.post("/cancel/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: "İş bulunamadı." });
  }
  if (job.status !== "downloading" && job.status !== "starting") {
    return res.json({ success: true, message: "İndirme zaten durmuş." });
  }

  // Kill the yt-dlp process
  if (job.process) {
    try {
      job.process.kill("SIGTERM");
    } catch {}
  }

  job.status = "cancelled";
  job.error = "İndirme kullanıcı tarafından durduruldu.";
  notifyClients(job);

  // Clean up partial files
  if (job.filePath && fs.existsSync(job.filePath)) {
    try { fs.unlinkSync(job.filePath); } catch {}
  }
  // Clean up partial yt-dlp files
  const downloadsDir = path.join(__dirname, "..", "..", "downloads");
  try {
    const files = fs.readdirSync(downloadsDir);
    for (const f of files) {
      if (f.startsWith(req.params.jobId)) {
        try { fs.unlinkSync(path.join(downloadsDir, f)); } catch {}
      }
    }
  } catch {}

  res.json({ success: true });
});

// GET /api/progress/:jobId - SSE progress stream
router.get("/progress/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: "İş bulunamadı." });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // Send current state immediately
  const data = getJobData(job);
  res.write(`data: ${JSON.stringify(data)}\n\n`);

  // Register client for updates
  job.sseClients.push(res);

  req.on("close", () => {
    job.sseClients = job.sseClients.filter((c) => c !== res);
  });
});

// GET /api/download/:jobId/file - Download the file
router.get("/download/:jobId/file", (req, res) => {
  const jobId = req.params.jobId;
  const job = jobs.get(jobId);

  let filePath = null;
  let filename = null;

  if (job && job.status === "complete" && job.filePath) {
    // Job still in memory
    filePath = job.filePath;
    filename = job.filename;
  } else {
    // Job expired from memory — search downloads folder by jobId
    const downloadsDir = path.join(__dirname, "..", "..", "downloads");
    try {
      const files = fs.readdirSync(downloadsDir);
      const match = files.find((f) => f.startsWith(jobId) && !f.endsWith(".vtt"));
      if (match) {
        filePath = path.join(downloadsDir, match);
        filename = match;
      }
    } catch {}
  }

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      error: "Dosya bulunamadı. Süresi dolmuş olabilir.",
    });
  }

  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${encodeURIComponent(filename || "video.mp4")}"`,
  );
  res.setHeader("Content-Type", "application/octet-stream");

  const stat = fs.statSync(filePath);
  res.setHeader("Content-Length", stat.size);

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
});

// GET /api/jobs - Get multiple job statuses (for reconnection after page refresh)
router.get("/jobs", (req, res) => {
  const ids = (req.query.ids || "").split(",").filter(Boolean);
  const result = {};
  for (const id of ids) {
    const job = jobs.get(id);
    result[id] = job ? getJobData(job) : null;
  }
  res.json({ jobs: result });
});

function getJobData(job) {
  return {
    status: job.status,
    percent: job.percent || 0,
    speed: job.speed,
    eta: job.eta,
    totalSize: job.totalSize,
    filename: job.filename,
    title: job.title,
    error: job.error,
  };
}

function notifyClients(job) {
  const data = getJobData(job);
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of job.sseClients) {
    try {
      client.write(message);
    } catch {}
  }
  // Close SSE connections on completion, error, or cancel
  if (job.status === "complete" || job.status === "error" || job.status === "cancelled") {
    for (const client of job.sseClients) {
      try {
        client.end();
      } catch {}
    }
    job.sseClients = [];
  }
}

module.exports = router;
