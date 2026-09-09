const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static(__dirname));

let broadcasterId = null;

io.on("connection", (socket) => {
  console.log("Novo usuário conectado:", socket.id);

  socket.on("broadcaster", () => {
    broadcasterId = socket.id;
    socket.broadcast.emit("broadcaster");
  });

  socket.on("watcher", () => {
    if (broadcasterId) {
      socket.to(broadcasterId).emit("watcher", socket.id);
    }
  });

  socket.on("offer", (id, message) => {
    socket.to(id).emit("offer", socket.id, message);
  });

  socket.on("answer", (id, message) => {
    socket.to(id).emit("answer", socket.id, message);
  });

  socket.on("ice-candidate", (id, message) => {
    socket.to(id).emit("ice-candidate", socket.id, message);
  });

  socket.on("stop-broadcast", () => {
    if (broadcasterId !== socket.id) return;

    broadcasterId = null;
    socket.broadcast.emit("broadcaster-stopped");
  });

  socket.on("disconnect", () => {
    if (broadcasterId === socket.id) {
      broadcasterId = null;
      socket.broadcast.emit("broadcaster-stopped");
    }

    socket.broadcast.emit("disconnectPeer", socket.id);
  });
});

http.listen(3000, () => {
  console.log("Servidor de sinalização rodando em http://localhost:3000");
});
