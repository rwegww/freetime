const express = require('express');
const path = require('path');
const apiRoutes = require('./routes');
const { errorHandler } = require('./middlewares/errorHandler');

function createApp() {
  const app = express();

  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(path.join(__dirname, '../public')));
  app.use('/api', apiRoutes);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };

