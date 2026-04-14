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
const progressSection = document.getElementById("progressSection");
const progressBar = document.getElementById("progressBar");
const progressPercent = document.getElementById("progressPercent");
const progressSpeed = document.getElementById("progressSpeed");
const progressEta = document.getElementById("progressEta");
const progressComplete = document.getElementById("progressComplete");
const saveFileBtn = document.getElementById("saveFileBtn");
const toastContainer = document.getElementById("toastContainer");

// ===== State =====
let currentVideoInfo = null;
let selectedFormat = null;
let currentJobId = null;
let eventSource = null;

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

  async startDownload(url, formatId, ext) {
    const res = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, formatId, ext }),
    });
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
  [loadingSection, errorSection, videoSection, progressSection].forEach((s) => {
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

    if (index === 0) {
      selectedFormat = fmt;
    }
  });

  // Listen for format changes
  formatList.querySelectorAll('input[name="format"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      selectedFormat = formats[parseInt(e.target.value)];
    });
  });
}

function renderVideoInfo(data) {
  videoThumbnail.src = data.thumbnail || "";
  videoThumbnail.alt = data.title;
  videoDuration.textContent = data.durationFormatted || "";
  videoDuration.classList.toggle("hidden", !data.durationFormatted);
  videoPlatform.textContent = data.platform;
  videoTitle.textContent = data.title;
  videoUploader.textContent = data.uploader;

  renderFormats(data.formats);
  showSection(videoSection);
}

function resetProgress() {
  progressBar.style.width = "0%";
  progressPercent.textContent = "%0";
  progressSpeed.textContent = "";
  progressEta.textContent = "";
  progressComplete.classList.add("hidden");
  document.querySelector(".progress-header h3").textContent = "İndiriliyor...";
  document.querySelector(".progress-header i").className =
    "fas fa-download fa-bounce";
}

function updateProgress(data) {
  const percent = Math.min(Math.round(data.percent || 0), 100);
  progressBar.style.width = `${percent}%`;
  progressPercent.textContent = `%${percent}`;

  if (data.speed) {
    progressSpeed.textContent = data.speed;
  }
  if (data.eta) {
    progressEta.textContent = `Kalan: ${data.eta}`;
  }
}

// ===== Event Handlers =====
async function handleFetchInfo() {
  const url = urlInput.value.trim();
  if (!url) {
    showToast("Lütfen bir video URL'si girin.");
    urlInput.focus();
    return;
  }

  // Basic URL validation
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      showToast("Geçersiz URL. http veya https ile başlamalıdır.");
      return;
    }
  } catch {
    showToast("Geçersiz URL formatı.");
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
      errorMessage.textContent = result.error || "Video bilgisi alınamadı.";
      showSection(errorSection);
    }
  } catch (err) {
    errorMessage.textContent = "Bağlantı hatası. Lütfen tekrar deneyin.";
    showSection(errorSection);
  } finally {
    fetchBtn.disabled = false;
  }
}

async function handleDownload() {
  if (!currentVideoInfo || !selectedFormat) {
    showToast("Lütfen önce bir video ve format seçin.");
    return;
  }

  downloadBtn.disabled = true;
  resetProgress();
  showSection(progressSection);

  try {
    const result = await API.startDownload(
      urlInput.value.trim(),
      selectedFormat.formatId,
      selectedFormat.ext,
    );

    if (result.success) {
      currentJobId = result.jobId;
      trackProgress(result.jobId);
    } else {
      showToast(result.error || "İndirme başlatılamadı.");
      showSection(videoSection);
      downloadBtn.disabled = false;
    }
  } catch (err) {
    showToast("Bağlantı hatası. Lütfen tekrar deneyin.");
    showSection(videoSection);
    downloadBtn.disabled = false;
  }
}

function trackProgress(jobId) {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(API.getProgressUrl(jobId));

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.status === "downloading") {
        updateProgress(data);
      } else if (data.status === "complete") {
        progressBar.style.width = "100%";
        progressPercent.textContent = "%100";
        progressSpeed.textContent = "";
        progressEta.textContent = "";
        document.querySelector(".progress-header h3").textContent =
          "Tamamlandı!";
        document.querySelector(".progress-header i").className =
          "fas fa-check-circle";
        progressComplete.classList.remove("hidden");
        currentJobId = jobId;
        eventSource.close();
        downloadBtn.disabled = false;
      } else if (data.status === "error") {
        showToast(data.error || "İndirme sırasında hata oluştu.");
        showSection(videoSection);
        downloadBtn.disabled = false;
        eventSource.close();
      }
    } catch {}
  };

  eventSource.onerror = () => {
    eventSource.close();
    // Don't show error if download already completed
    if (!progressComplete.classList.contains("hidden")) return;
    showToast("Bağlantı kesildi.");
    downloadBtn.disabled = false;
  };
}

function handleSaveFile() {
  if (!currentJobId) return;
  const link = document.createElement("a");
  link.href = API.getFileUrl(currentJobId);
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
    showToast("Panoya erişilemedi. Lütfen URL'yi manuel yapıştırın.");
  }
}

// ===== Event Listeners =====
fetchBtn.addEventListener("click", handleFetchInfo);
downloadBtn.addEventListener("click", handleDownload);
saveFileBtn.addEventListener("click", handleSaveFile);
pasteBtn.addEventListener("click", handlePaste);
errorRetryBtn.addEventListener("click", () => {
  showSection(null);
  urlInput.focus();
});

// Enter key triggers fetch
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    handleFetchInfo();
  }
});

// Auto-detect pasted URLs
urlInput.addEventListener("paste", () => {
  setTimeout(() => {
    const val = urlInput.value.trim();
    if (val && val.startsWith("http")) {
      handleFetchInfo();
    }
  }, 100);
});
