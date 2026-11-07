const express = require('express');
const path = require('path');
const apiRoutes = require('./routes');
const { errorHandler } = require('./middlewares/errorHandler');

function createApp() {
  const app = express();

  app.use(express.json({ limit: '2mb' }));

  // Trên môi trường Serverless (Vercel) không có Socket.IO server gắn trên HTTP,
  // trả về shim JS nhẹ để frontend tự động chuyển sang đồng bộ REST thời gian thực mà không bị lỗi 404
  app.get('/socket.io/socket.io.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send('window.__FREETIME_SERVERLESS__ = true;\n');
  });

  app.use(express.static(path.join(__dirname, '../public')));
  app.use('/api', apiRoutes);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };

