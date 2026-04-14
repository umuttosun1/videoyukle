// ===== DOM Elements =====
const urlInput = document.getElementById("urlInput");
const pasteBtn = document.getElementById("pasteBtn");
const fetchBtn = document.getElementById("fetchBtn");
const loadingSection = document.getElementById("loadingSection");
const errorSection = document.getElementById("errorSection");
const errorMessage = document.getElementById("errorMessage");
const errorRetryBtn = document.getElementById("errorRetryBtn");
const videoSection = document.getElementById("videoSection");
const videoThumbnail = document.getElementById("videoThumbnail");
const videoDuration = document.getElementById("videoDuration");
const videoPlatform = document.getElementById("videoPlatform");
const videoTitle = document.getElementById("videoTitle");
const videoUploader = document.getElementById("videoUploader");
const formatList = document.getElementById("formatList");
const downloadBtn = document.getElementById("downloadBtn");
const toastContainer = document.getElementById("toastContainer");
const downloadsPanel = document.getElementById("downloadsPanel");
const downloadsList = document.getElementById("downloadsList");
const downloadCount = document.getElementById("downloadCount");
const downloadsFab = document.getElementById("downloadsFab");
const downloadsBadge = document.getElementById("downloadsBadge");
const toggleDownloadsBtn = document.getElementById("toggleDownloadsBtn");
const downloadsHeader = document.getElementById("downloadsHeader");

// ===== State =====
let currentVideoInfo = null;
let selectedFormat = null;
let selectedAudioTrack = null;
let selectedSubtitle = null;
const eventSources = new Map(); // jobId -> EventSource

// ===== JobStore (localStorage-backed) =====
const JOB_KEY = "vy_downloads";

const JobStore = {
  _jobs: new Map(),

  load() {
    try {
      const raw = localStorage.getItem(JOB_KEY);
      if (raw) {
        const entries = JSON.parse(raw);
        this._jobs = new Map(entries);
      }
    } catch {
      this._jobs = new Map();
    }
  },

  save() {
    localStorage.setItem(JOB_KEY, JSON.stringify([...this._jobs]));
    updateDownloadsUI();
  },

  add(jobId, meta) {
    this._jobs.set(jobId, meta);
    this.save();
  },

  update(jobId, data) {
    const existing = this._jobs.get(jobId);
    if (existing) {
      Object.assign(existing, data);
      this.save();
    }
  },

  remove(jobId) {
    this._jobs.delete(jobId);
    this.save();
  },

  get(jobId) {
    return this._jobs.get(jobId);
  },

  getAll() {
    return [...this._jobs];
  },

  activeCount() {
    let count = 0;
    for (const [, job] of this._jobs) {
      if (job.status === "downloading" || job.status === "starting") count++;
    }
    return count;
  },
};

// ===== API Client =====
const API = {
  async getInfo(url) {
    const res = await fetch("/api/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    return res.json();
  },

  async startDownload(url, formatId, ext, audioTrackId, subtitleUrl, title) {
    const res = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, formatId, ext, audioTrackId, subtitleUrl, title }),
    });
    return res.json();
  },

  async cancelJob(jobId) {
    const res = await fetch(`/api/cancel/${jobId}`, { method: "POST" });
    return res.json();
  },

  async listJobs(jobIds) {
    const res = await fetch(`/api/jobs?ids=${jobIds.join(",")}`);
    return res.json();
  },

  getProgressUrl(jobId) {
    return `/api/progress/${jobId}`;
  },

  getFileUrl(jobId) {
    return `/api/download/${jobId}/file`;
  },
};

// ===== UI Helpers =====
function showSection(section) {
  [loadingSection, errorSection, videoSection].forEach((s) => {
    s.classList.add("hidden");
  });
  if (section) {
    section.classList.remove("hidden");
    section.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function showToast(message, type = "error") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  const icon = type === "error" ? "exclamation-circle" : "check-circle";
  toast.innerHTML = `<i class="fas fa-${icon}"></i> ${message}`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ===== Format / Audio / Subtitle Rendering =====
function renderFormats(formats) {
  formatList.innerHTML = "";
  selectedFormat = null;
  formats.forEach((fmt, index) => {
    const div = document.createElement("div");
    div.className = "format-option";
    const id = `format-${index}`;
    const checked = index === 0 ? "checked" : "";
    div.innerHTML = `
      <input type="radio" name="format" id="${id}" value="${index}" ${checked}>
      <label for="${id}">
        <span class="format-quality">${fmt.quality === "audio" ? '<i class="fas fa-music"></i> MP3' : fmt.quality}</span>
        <span class="format-size">${fmt.filesize || "?"}</span>
      </label>
    `;
    formatList.appendChild(div);
    if (index === 0) selectedFormat = fmt;
  });
  formatList.querySelectorAll('input[name="format"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      selectedFormat = formats[parseInt(e.target.value)];
    });
  });
}

function renderAudioTracks(tracks) {
  const container = document.getElementById("audioTrackSection");
  const list = document.getElementById("audioTrackList");
  if (!tracks || tracks.length === 0) {
    container.classList.add("hidden");
    selectedAudioTrack = null;
    return;
  }
  container.classList.remove("hidden");
  list.innerHTML = "";
  selectedAudioTrack = null;
  tracks.forEach((track, index) => {
    const div = document.createElement("div");
    div.className = "format-option";
    const id = `audio-${index}`;
    const checked = index === 0 ? "checked" : "";
    div.innerHTML = `
      <input type="radio" name="audioTrack" id="${id}" value="${index}" ${checked}>
      <label for="${id}">
        <span class="format-quality"><i class="fas fa-volume-up"></i> ${track.label}</span>
      </label>
    `;
    list.appendChild(div);
    if (index === 0) selectedAudioTrack = track;
  });
  list.querySelectorAll('input[name="audioTrack"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      selectedAudioTrack = tracks[parseInt(e.target.value)];
    });
  });
}

function renderSubtitles(subs) {
  const container = document.getElementById("subtitleSection");
  const list = document.getElementById("subtitleList");
  if (!subs || subs.length === 0) {
    container.classList.add("hidden");
    selectedSubtitle = null;
    return;
  }
  container.classList.remove("hidden");
  list.innerHTML = "";
  selectedSubtitle = null;
  const noneDiv = document.createElement("div");
  noneDiv.className = "format-option";
  noneDiv.innerHTML = `
    <input type="radio" name="subtitle" id="sub-none" value="none" checked>
    <label for="sub-none">
      <span class="format-quality"><i class="fas fa-ban"></i> Altyaz\u0131 Yok</span>
    </label>
  `;
  list.appendChild(noneDiv);
  subs.forEach((sub, index) => {
    const div = document.createElement("div");
    div.className = "format-option";
    const id = `sub-${index}`;
    const icon = sub.label.toLowerCase().includes("forced") ? "fas fa-lock" : "fas fa-closed-captioning";
    div.innerHTML = `
      <input type="radio" name="subtitle" id="${id}" value="${index}">
      <label for="${id}">
        <span class="format-quality"><i class="${icon}"></i> ${sub.label}</span>
      </label>
    `;
    list.appendChild(div);
  });
  list.querySelectorAll('input[name="subtitle"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      selectedSubtitle = e.target.value === "none" ? null : subs[parseInt(e.target.value)];
    });
  });
}

function renderVideoInfo(data) {
  videoThumbnail.src = data.thumbnail || "";
  videoThumbnail.alt = data.title;
  videoThumbnail.style.display = data.thumbnail ? "block" : "none";
  videoDuration.textContent = data.durationFormatted || "";
  videoDuration.classList.toggle("hidden", !data.durationFormatted);
  videoPlatform.textContent = data.platform;
  videoTitle.textContent = data.title;
  videoUploader.textContent = data.uploader;
  renderFormats(data.formats);
  renderAudioTracks(data.audioTracks || []);
  renderSubtitles(data.subtitles || []);
  showSection(videoSection);
}

// ===== Downloads Panel =====
function updateDownloadsUI() {
  const jobs = JobStore.getAll();
  const total = jobs.length;
  const active = JobStore.activeCount();

  downloadCount.textContent = total;
  downloadsBadge.textContent = active;

  if (total > 0) {
    downloadsPanel.classList.remove("hidden");
    downloadsFab.classList.remove("hidden");
  } else {
    downloadsPanel.classList.add("hidden");
    downloadsFab.classList.add("hidden");
  }
}

function renderDownloadCard(jobId, data) {
  // Remove existing card if any
  const existing = document.querySelector(`[data-job-id="${jobId}"]`);
  if (existing) existing.remove();

  const card = document.createElement("div");
  card.className = "download-item";
  card.dataset.jobId = jobId;
  const isActive = data.status === "downloading" || data.status === "starting";
  const isDone = data.status === "complete";
  const isStopped = data.status === "error" || data.status === "cancelled";

  card.innerHTML = `
    <div class="download-item-info">
      <span class="download-title">${escapeHtml(data.title || "Video")}</span>
      <div class="download-progress">
        <div class="progress-bar-mini">
          <div class="progress-bar-fill" style="width: ${data.percent || 0}%"></div>
        </div>
        <span class="download-status">${getStatusText(data)}</span>
      </div>
    </div>
    <div class="download-item-actions">
      ${isActive ? `
        <button class="btn btn-outline btn-sm cancel-btn" title="Durdur">
          <i class="fas fa-stop"></i>
        </button>
      ` : ""}
      ${isDone ? `
        <button class="btn btn-success btn-sm save-btn" title="Kaydet">
          <i class="fas fa-save"></i> Kaydet
        </button>
      ` : ""}
      ${isDone || isStopped ? `
        <button class="btn btn-outline btn-sm dismiss-btn" title="Kapat">
          <i class="fas fa-times"></i>
        </button>
      ` : ""}
    </div>
  `;

  // Event listeners
  const cancelBtn = card.querySelector(".cancel-btn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => handleCancel(jobId));
  }
  const saveBtn = card.querySelector(".save-btn");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => handleSaveFile(jobId));
  }
  const dismissBtn = card.querySelector(".dismiss-btn");
  if (dismissBtn) {
    dismissBtn.addEventListener("click", () => {
      card.remove();
      JobStore.remove(jobId);
      closeEventSource(jobId);
    });
  }

  downloadsList.appendChild(card);
}

function updateDownloadCard(jobId, data) {
  const card = document.querySelector(`[data-job-id="${jobId}"]`);
  if (!card) return;

  const fill = card.querySelector(".progress-bar-fill");
  const status = card.querySelector(".download-status");
  const actions = card.querySelector(".download-item-actions");

  if (fill) fill.style.width = `${Math.min(data.percent || 0, 100)}%`;
  if (status) {
    status.textContent = getStatusText(data);
    status.className = "download-status";
    if (data.status === "complete") status.classList.add("complete");
    if (data.status === "error" || data.status === "cancelled") status.classList.add("error");
  }

  const isDone = data.status === "complete";
  const isStopped = data.status === "error" || data.status === "cancelled";
  const isActive = data.status === "downloading" || data.status === "starting";

  if (isDone || isStopped) {
    actions.innerHTML = "";
    if (isDone) {
      const saveBtn = document.createElement("button");
      saveBtn.className = "btn btn-success btn-sm save-btn";
      saveBtn.innerHTML = '<i class="fas fa-save"></i> Kaydet';
      saveBtn.addEventListener("click", () => handleSaveFile(jobId));
      actions.appendChild(saveBtn);
    }
    const dismissBtn = document.createElement("button");
    dismissBtn.className = "btn btn-outline btn-sm dismiss-btn";
    dismissBtn.innerHTML = '<i class="fas fa-times"></i>';
    dismissBtn.addEventListener("click", () => {
      card.remove();
      JobStore.remove(jobId);
      closeEventSource(jobId);
    });
    actions.appendChild(dismissBtn);

  } else if (isActive && !actions.querySelector(".cancel-btn")) {
    actions.innerHTML = `
      <button class="btn btn-outline btn-sm cancel-btn" title="Durdur">
        <i class="fas fa-stop"></i>
      </button>
    `;
    actions.querySelector(".cancel-btn").addEventListener("click", () => handleCancel(jobId));
  }
}

function getStatusText(data) {
  if (data.status === "complete") return "Tamamland\u0131! \u2014 Kaydet butonuna bas";
  if (data.status === "cancelled") return "Durduruldu";
  if (data.status === "error") return data.error || "Hata olu\u015Ftu";
  if (data.status === "downloading") {
    const parts = [];
    parts.push(`%${Math.round(data.percent || 0)}`);
    if (data.totalSize) parts.push(data.totalSize);
    if (data.speed) parts.push(data.speed);
    if (data.eta) parts.push(data.eta);
    return parts.join(" \u2022 ");
  }
  return "Ba\u015Flat\u0131l\u0131yor...";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ===== SSE Progress Tracking =====
function trackProgress(jobId) {
  closeEventSource(jobId);

  const es = new EventSource(API.getProgressUrl(jobId));
  eventSources.set(jobId, es);

  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      JobStore.update(jobId, data);
      updateDownloadCard(jobId, data);

      if (data.status === "complete" || data.status === "error" || data.status === "cancelled") {
        closeEventSource(jobId);
        if (data.status === "complete") {
          showToast("\u0130ndirme tamamland\u0131!", "success");
        }
      }
    } catch {}
  };

  es.onerror = () => {
    closeEventSource(jobId);
  };
}

function closeEventSource(jobId) {
  const es = eventSources.get(jobId);
  if (es) {
    es.close();
    eventSources.delete(jobId);
  }
}

// ===== Reconnect on Page Load =====
async function reconnectJobs() {
  JobStore.load();
  const allJobs = JobStore.getAll();
  if (allJobs.length === 0) return;

  const jobIds = allJobs.map(([id]) => id);

  try {
    const result = await API.listJobs(jobIds);

    for (const [jobId, localData] of allJobs) {
      const serverData = result.jobs[jobId];

      if (!serverData) {
        // Job expired on server — remove if not complete
        if (localData.status !== "complete") {
          JobStore.remove(jobId);
        } else {
          renderDownloadCard(jobId, localData);
        }
        continue;
      }

      // Update local with server state
      JobStore.update(jobId, serverData);
      const merged = { ...localData, ...serverData };
      renderDownloadCard(jobId, merged);

      // Reconnect SSE for active downloads
      if (serverData.status === "downloading" || serverData.status === "starting") {
        trackProgress(jobId);
      }
    }
  } catch {
    // Server unreachable — just render cached state
    for (const [jobId, data] of allJobs) {
      renderDownloadCard(jobId, data);
    }
  }
}

// ===== Event Handlers =====
async function handleFetchInfo() {
  const url = urlInput.value.trim();
  if (!url) {
    showToast("L\u00FCtfen bir video URL'si girin.");
    urlInput.focus();
    return;
  }
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      showToast("Ge\u00E7ersiz URL.");
      return;
    }
  } catch {
    showToast("Ge\u00E7ersiz URL format\u0131.");
    return;
  }

  fetchBtn.disabled = true;
  showSection(loadingSection);

  try {
    const result = await API.getInfo(url);
    if (result.success) {
      currentVideoInfo = result.data;
      renderVideoInfo(result.data);
    } else {
      errorMessage.textContent = result.error || "Video bilgisi al\u0131namad\u0131.";
      showSection(errorSection);
    }
  } catch {
    errorMessage.textContent = "Ba\u011Flant\u0131 hatas\u0131. L\u00FCtfen tekrar deneyin.";
    showSection(errorSection);
  } finally {
    fetchBtn.disabled = false;
  }
}

async function handleDownload() {
  if (!currentVideoInfo || !selectedFormat) {
    showToast("L\u00FCtfen \u00F6nce bir video ve format se\u00E7in.");
    return;
  }

  downloadBtn.disabled = true;

  try {
    const title = currentVideoInfo.title || "Video";
    const result = await API.startDownload(
      urlInput.value.trim(),
      selectedFormat.formatId,
      selectedFormat.ext,
      selectedAudioTrack?.id || null,
      selectedSubtitle?.url || null,
      title,
    );

    if (result.success) {
      const jobId = result.jobId;

      // Add to store and render card
      JobStore.add(jobId, {
        title,
        status: "starting",
        percent: 0,
        speed: null,
        eta: null,
      });

      renderDownloadCard(jobId, JobStore.get(jobId));
      trackProgress(jobId);

      // Show panel
      downloadsPanel.classList.remove("hidden");
      downloadsPanel.classList.remove("collapsed");
      downloadsFab.classList.remove("hidden");

      showToast("\u0130ndirme ba\u015Flat\u0131ld\u0131!", "success");
    } else {
      showToast(result.error || "\u0130ndirme ba\u015Flat\u0131lamad\u0131.");
    }
  } catch {
    showToast("Ba\u011Flant\u0131 hatas\u0131.");
  } finally {
    downloadBtn.disabled = false;
  }
}

async function handleCancel(jobId) {
  try {
    await API.cancelJob(jobId);
    closeEventSource(jobId);
    JobStore.update(jobId, { status: "cancelled" });
    updateDownloadCard(jobId, { status: "cancelled" });
    showToast("\u0130ndirme durduruldu.", "success");
  } catch {
    showToast("Durdurma ba\u015Far\u0131s\u0131z.");
  }
}

function handleSaveFile(jobId) {
  const link = document.createElement("a");
  link.href = API.getFileUrl(jobId);
  link.download = "";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function handlePaste() {
  try {
    const text = await navigator.clipboard.readText();
    urlInput.value = text;
    urlInput.focus();
  } catch {
    showToast("Panoya eri\u015Filemedi.");
  }
}

// ===== Event Listeners =====
fetchBtn.addEventListener("click", handleFetchInfo);
downloadBtn.addEventListener("click", handleDownload);
pasteBtn.addEventListener("click", handlePaste);
errorRetryBtn.addEventListener("click", () => {
  showSection(null);
  urlInput.focus();
});

urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleFetchInfo();
});

urlInput.addEventListener("paste", () => {
  setTimeout(() => {
    const val = urlInput.value.trim();
    if (val && val.startsWith("http")) handleFetchInfo();
  }, 100);
});

// Downloads panel toggle
downloadsHeader.addEventListener("click", () => {
  downloadsPanel.classList.toggle("collapsed");
});

downloadsFab.addEventListener("click", () => {
  downloadsPanel.classList.remove("hidden");
  downloadsPanel.classList.toggle("collapsed");
});

// ===== Init =====
reconnectJobs();
