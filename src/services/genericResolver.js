/**
 * Generic Video Resolver
 * Herhangi bir siteden video URL'si çıkarır.
 */

const { execFileSync } = require("child_process");
const vm = require("vm");

const CURL_TIMEOUT = 30;
const MAX_IFRAME_DEPTH = 3;

// ─── Page Fetching ───

function curlFetch(url, referer) {
  const args = [
    "-s", "-L", "--max-time", String(CURL_TIMEOUT),
    "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "-H", "Accept-Language: tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
  ];
  if (referer) args.push("-H", "Referer: " + referer);
  args.push(url);
  try {
    return execFileSync("curl", args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 35000,
    }).toString("utf8");
  } catch {
    return null;
  }
}

// ─── JS Unpacker ───

function unpackEvalPacker(html) {
  const results = [];
  let searchFrom = 0;
  while (true) {
    const evalIndex = html.indexOf("eval(function(p,a,c,k,e,d)", searchFrom);
    if (evalIndex === -1) break;

    const start = evalIndex + 5;
    let depth = 0;
    let end = start;
    for (let i = start; i < html.length; i++) {
      if (html[i] === "(") depth++;
      else if (html[i] === ")") {
        if (depth === 0) { end = i; break; }
        depth--;
      }
    }

    const packerCode = html.substring(start, end);
    searchFrom = end + 1;

    try {
      const sandbox = {};
      vm.runInNewContext("result = (" + packerCode + ")", sandbox, { timeout: 5000 });
      if (typeof sandbox.result === "string") {
        results.push(sandbox.result);
      }
    } catch {}
  }
  return results;
}

// ─── Crypto Decrypt ───

function tryCryptoDecrypt(code) {
  // Look for: funcName(["part1","part2",...]) pattern
  const partsMatch = code.match(/\w+\(\[((?:"[^"]*",?\s*)+)\]\)/);
  if (!partsMatch) return null;

  const parts = partsMatch[1].match(/"([^"]*)"/g);
  if (!parts) return null;
  const partValues = parts.map((s) => s.replace(/"/g, ""));

  // Look for key: (LARGE_NUMBER%(i+
  const keyMatch = code.match(/\((\d{5,})%\(i\+/);
  if (!keyMatch) return null;
  const key = parseInt(keyMatch[1]);

  // Decrypt: join -> reverse -> base64 -> rot13 -> key unmix
  try {
    let value = partValues.join("");
    value = value.split("").reverse().join("");
    value = Buffer.from(value, "base64").toString("latin1");
    value = value.replace(/[a-zA-Z]/g, (c) =>
      String.fromCharCode(
        (c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26
      )
    );
    let result = "";
    for (let i = 0; i < value.length; i++) {
      let ch = value.charCodeAt(i);
      ch = (ch - (key % (i + 5)) + 256) % 256;
      result += String.fromCharCode(ch);
    }
    if (result.startsWith("http")) return result;
  } catch {}

  return null;
}

// ─── Extractors ───

function findVideoUrls(html) {
  const urls = [];
  const patterns = [
    /["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/gi,
    /["'](https?:\/\/[^"'\s]+\.mp4[^"'\s]*)/gi,
    /["'](https?:\/\/[^"'\s]+\/master\.txt[^"'\s]*)/gi,
    /file\s*:\s*["'](https?:\/\/[^"'\s]+)/gi,
    /src\s*:\s*["'](https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*)/gi,
    /sources\s*:\s*\[\s*\{[^}]*(?:file|src)\s*:\s*["'](https?:\/\/[^"'\s]+)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const url = match[1];
      if (!/\.(js|css|png|jpg|gif|svg|ico)(\?|$)/i.test(url)) {
        urls.push(url);
      }
    }
  }

  return urls;
}

function findIframeUrls(html, pageUrl) {
  const base = new URL(pageUrl);
  const iframes = [];
  const patterns = [
    /<iframe[^>]+\bsrc=["']([^"']+)/gi,
    /<iframe[^>]+\bdata-src=["']([^"']+)/gi,
    /<embed[^>]+\bsrc=["']([^"']+)/gi,
    /<embed[^>]+\bdata-src=["']([^"']+)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      let url = match[1].trim();
      if (url.startsWith("//")) url = base.protocol + url;
      else if (url.startsWith("/")) url = base.origin + url;
      if (url.startsWith("http") && !/(?:^|\.)ads?\.|doubleclick|googlesyndication/i.test(url)) {
        iframes.push(url);
      }
    }
  }

  return [...new Set(iframes)];
}

function findSubtitles(html, pageUrl) {
  const subs = [];
  const base = new URL(pageUrl);
  // Match full <track> tags then extract attributes individually
  const tagRegex = /<track[^>]+>/gi;
  let tagMatch;
  while ((tagMatch = tagRegex.exec(html)) !== null) {
    const tag = tagMatch[0];
    const srcMatch = tag.match(/src=["']([^"']+\.vtt)/i);
    if (!srcMatch) continue;
    let url = srcMatch[1];
    if (url.startsWith("/")) url = base.origin + url;
    const langMatch = tag.match(/srclang=["']([^"']+)/i);
    const labelMatch = tag.match(/label=["']([^"']+)/i);
    const lang = langMatch ? langMatch[1] : "unknown";
    const label = labelMatch ? labelMatch[1] : lang;
    subs.push({ url, lang, label });
  }
  return subs;
}

function findTitle(html) {
  const m = html.match(/<title>([^<]+)<\/title>/i);
  if (!m) return null;
  return m[1]
    .replace(/\.mp4$/i, "")
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")  // CamelCase → spaces
    .replace(/\s+/g, " ")
    .trim();
}

function findThumbnail(html) {
  // og:image meta tag
  const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i);
  if (ogMatch) return ogMatch[1];
  // twitter:image
  const twMatch = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i);
  if (twMatch) return twMatch[1];
  return null;
}

function guessType(url) {
  if (/\.m3u8|master\.txt|playlist/i.test(url)) return "application/x-mpegURL";
  return "video/mp4";
}

// ─── Main Resolver ───

function resolveVideoUrl(url, depth, parentUrl) {
  if (depth > MAX_IFRAME_DEPTH) return null;

  const html = curlFetch(url, parentUrl || undefined);
  if (!html || html.length < 100) return null;

  // Cloudflare challenge check
  if (html.length < 3000 && /cf-mitigated|cf_chl_opt/i.test(html)) return null;

  const title = depth === 0 ? findTitle(html) : null;
  const thumbnail = depth === 0 ? findThumbnail(html) : null;
  const subtitles = findSubtitles(html, url);

  // 1. Try unpacking obfuscated JS first (highest priority - crypto decrypted URLs are most reliable)
  const unpackedBlocks = unpackEvalPacker(html);
  for (const code of unpackedBlocks) {
    const decrypted = tryCryptoDecrypt(code);
    if (decrypted) {
      return {
        videoUrl: decrypted,
        type: guessType(decrypted),
        title: title || findTitle(html),
        thumbnail,
        subtitles,
        referer: url,
      };
    }
  }

  // 2. Look for direct video URLs in HTML and unpacked JS
  const allHtml = [html, ...unpackedBlocks].join("\n");
  const directUrls = findVideoUrls(allHtml);
  // Only keep real video stream URLs, not API endpoints
  const realVideos = directUrls.filter(
    (u) => /\.(m3u8|mp4|ts)(\?|$)|master\.txt|playlist\.m3u8/i.test(u) && !/ajax|api|php/i.test(u)
  );
  if (realVideos.length > 0) {
    return {
      videoUrl: realVideos[0],
      type: guessType(realVideos[0]),
      title: title || findTitle(html),
      thumbnail,
      subtitles,
      referer: url,
    };
  }

  // 4. Follow iframes
  const iframes = findIframeUrls(html, url);
  const videoIframes = iframes.filter(
    (u) => /embed|player|video|closeload|vidmoly|filemoon|streamtape|doodstream|voe\.sx|rapid/i.test(u)
  );
  const candidates = videoIframes.length > 0 ? videoIframes : iframes;

  for (const iframeUrl of candidates) {
    if (/youtube\.com|youtu\.be/i.test(iframeUrl)) continue;
    const result = resolveVideoUrl(iframeUrl, depth + 1, url);
    if (result) {
      if (title && !result.title) result.title = title;
      if (thumbnail && !result.thumbnail) result.thumbnail = thumbnail;
      if (subtitles.length > 0 && result.subtitles.length === 0) {
        result.subtitles = subtitles;
      }
      return result;
    }
  }

  return null;
}

// ─── Public API ───

function resolve(url) {
  const result = resolveVideoUrl(url, 0, null);
  if (!result) {
    throw new Error(
      "Video kaynağı bulunamadı. Site desteklenmiyor veya Cloudflare koruması aşılamıyor olabilir."
    );
  }
  return result;
}

function canResolve(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const knownSites = [
      "filmmakinesi", "closeload", "hdfilmcehennemi", "fullhdfilmizlesene",
      "dizibox", "dizipal", "filmizlesene", "sinemia", "jetfilmizle",
      "filmgosu", "webteizle", "filmmodu", "sinefy",
    ];
    return knownSites.some((s) => hostname.includes(s));
  } catch {
    return false;
  }
}

module.exports = { resolve, canResolve };
