const http = require('http');
const { Server } = require('socket.io');
const config = require('./config');
const { createApp } = require('./app');
const { initSockets } = require('./sockets');

const app = createApp();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

initSockets(io);

function startServer(port = config.port) {
  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`Freetime Team Scheduler & Chat server running at http://localhost:${port}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, server, io, startServer };

