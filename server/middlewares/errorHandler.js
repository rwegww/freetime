function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error('Unhandled API Error:', err);
  }
  res.status(status).json({
    error: err.message || 'Lỗi máy chủ nội bộ.'
  });
}

module.exports = { errorHandler };

