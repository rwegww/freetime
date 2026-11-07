function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error('Unhandled API Error:', err);
  }
  const payload = {
    error: err.message || 'Lỗi máy chủ nội bộ.'
  };
  if (err.code) payload.code = err.code;
  if (err.currentRoom) payload.currentRoom = err.currentRoom;
  res.status(status).json(payload);
}

module.exports = { errorHandler };

