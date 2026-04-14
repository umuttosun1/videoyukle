function validateUrl(req, res, next) {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'URL gerekli. Lütfen bir video bağlantısı girin.'
    });
  }

  const trimmed = url.trim();

  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({
        success: false,
        error: 'Geçersiz URL. Sadece http ve https bağlantıları desteklenir.'
      });
    }
  } catch {
    return res.status(400).json({
      success: false,
      error: 'Geçersiz URL formatı. Lütfen geçerli bir video bağlantısı girin.'
    });
  }

  req.body.url = trimmed;
  next();
}

module.exports = { validateUrl };
