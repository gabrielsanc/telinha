const socket = io();
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const videoElement = document.getElementById("videoElement");
const screenElement = document.querySelector(".screen");
const emptyState = document.getElementById("emptyState");
const status = document.getElementById("status");
const connectionDisplay = document.getElementById("peerIdDisplay");
const resolutionSelect = document.getElementById("resolutionSelect");
const frameRateSelect = document.getElementById("frameRateSelect");
const broadcasterConnections = new Map();

let captureStream = null;
let viewerConnection = null;
let isBroadcaster = false;
const pendingViewerIceCandidates = [];

socket.on("connect", () => {
  connectionDisplay.textContent = "Conectado";
  status.textContent = "Aguardando conexão";
  socket.emit("watcher");
});

socket.on("disconnect", () => {
  connectionDisplay.textContent = "Desconectado";
  status.textContent = "Servidor desconectado";
});

socket.on("broadcaster", () => {
  if (!isBroadcaster) socket.emit("watcher");
});

socket.on("watcher", async (watcherId) => {
  if (!isBroadcaster || !captureStream) return;

  const connection = createConnection(watcherId, true);
  captureStream.getTracks().forEach((track) => {
    connection.addTrack(track, captureStream);
  });

  const offer = await connection.createOffer();
  await connection.setLocalDescription(offer);
  socket.emit("offer", watcherId, connection.localDescription);
});

socket.on("offer", async (broadcasterSocketId, offer) => {
  try {
    closeViewerConnection();
    viewerConnection = createConnection(broadcasterSocketId, false);
    await viewerConnection.setRemoteDescription(offer);
    viewerConnection.pendingIceCandidates.push(
      ...pendingViewerIceCandidates.splice(0),
    );
    await addPendingIceCandidates(viewerConnection);

    const answer = await viewerConnection.createAnswer();
    await viewerConnection.setLocalDescription(answer);
    socket.emit(
      "answer",
      broadcasterSocketId,
      viewerConnection.localDescription,
    );
    status.textContent = "Conectando à tela compartilhada";
  } catch (error) {
    console.error("Erro ao receber a oferta:", error);
    status.textContent = "Não foi possível receber a tela";
  }
});

socket.on("answer", async (watcherId, answer) => {
  const connection = broadcasterConnections.get(watcherId);
  if (!connection) {
    if (!isBroadcaster) pendingViewerIceCandidates.push(candidate);
    return;
  }

  try {
    await connection.setRemoteDescription(answer);
    await addPendingIceCandidates(connection);
  } catch (error) {
    console.error("Erro ao receber a resposta:", error);
  }
});

socket.on("ice-candidate", async (peerId, candidate) => {
  const connection = isBroadcaster
    ? broadcasterConnections.get(peerId)
    : viewerConnection;

  if (!connection) return;

  if (!connection.remoteDescription) {
    connection.pendingIceCandidates.push(candidate);
    return;
  }

  try {
    await connection.addIceCandidate(candidate);
  } catch (error) {
    console.error("Erro ao adicionar candidato ICE:", error);
  }
});

socket.on("disconnectPeer", (peerId) => {
  const connection = broadcasterConnections.get(peerId);
  connection?.close();
  broadcasterConnections.delete(peerId);

  if (viewerConnection && viewerConnection.peerId === peerId) {
    closeViewerConnection();
  }
});

socket.on("broadcaster-stopped", () => {
  closeViewerConnection();
  videoElement.srcObject = null;
  emptyState.hidden = false;
  status.textContent = "A transmissão foi encerrada";
});

startBtn.addEventListener("click", startSharing);
stopBtn.addEventListener("click", stopSharing);

fullscreenBtn.addEventListener("click", async () => {
  if (!document.fullscreenElement) {
    await screenElement.requestFullscreen();
  } else {
    await document.exitFullscreen();
  }
});

async function startSharing() {
  try {
    const videoConstraints = getVideoConstraints();
    captureStream = await navigator.mediaDevices.getDisplayMedia({
      video: Object.keys(videoConstraints).length > 0 ? videoConstraints : true,
      audio: false,
    });

    isBroadcaster = true;
    socket.emit("broadcaster");
    videoElement.srcObject = captureStream;
    emptyState.hidden = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    status.textContent = "Compartilhando sua tela";

    captureStream.getVideoTracks()[0].addEventListener("ended", stopSharing);
  } catch (error) {
    console.error("Erro ao iniciar o compartilhamento:", error);
    stopSharing();
    status.textContent = getSharingErrorMessage(error);
  }
}

function getSharingErrorMessage(error) {
  if (error.name === "NotAllowedError") {
    return "Permissão para compartilhar a tela foi negada";
  }

  if (error.name === "NotSupportedError") {
    return "Use Chrome ou Edge em um computador para compartilhar a tela";
  }

  return "Não foi possível iniciar o compartilhamento";
}

function stopSharing() {
  captureStream?.getTracks().forEach((track) => track.stop());
  captureStream = null;
  isBroadcaster = false;
  socket.emit("stop-broadcast");

  broadcasterConnections.forEach((connection) => connection.close());
  broadcasterConnections.clear();
  closeViewerConnection();

  videoElement.srcObject = null;
  emptyState.hidden = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  status.textContent = "Aguardando conexão";
}

function createConnection(peerId, broadcasterSide) {
  const connection = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  connection.peerId = peerId;
  connection.pendingIceCandidates = [];

  connection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", peerId, event.candidate);
    }
  };

  connection.ontrack = (event) => {
    if (!broadcasterSide) {
      videoElement.srcObject = event.streams[0];
      emptyState.hidden = true;
      status.textContent = "Transmitindo ao vivo";
      videoElement.play().catch((error) => {
        console.error("Não foi possível reproduzir a tela recebida:", error);
      });
    }
  };

  connection.onconnectionstatechange = () => {
    if (
      ["failed", "disconnected", "closed"].includes(connection.connectionState)
    ) {
      broadcasterConnections.delete(peerId);
    }
  };

  if (broadcasterSide) {
    broadcasterConnections.set(peerId, connection);
  }

  return connection;
}

async function addPendingIceCandidates(connection) {
  while (connection.pendingIceCandidates.length > 0) {
    await connection.addIceCandidate(connection.pendingIceCandidates.shift());
  }
}

function closeViewerConnection() {
  viewerConnection?.close();
  viewerConnection = null;
  pendingViewerIceCandidates.length = 0;
}

function getVideoConstraints() {
  const constraints = {};
  const resolution = resolutionSelect.value;
  const frameRate = frameRateSelect.value;

  if (resolution !== "auto") {
    const [width, height] = resolution.split("x").map(Number);
    constraints.width = { ideal: width };
    constraints.height = { ideal: height };
  }

  if (frameRate !== "auto") {
    constraints.frameRate = {
      ideal: Number(frameRate),
      max: Number(frameRate),
    };
  }

  return constraints;
}

document.addEventListener("fullscreenchange", () => {
  fullscreenBtn.textContent = document.fullscreenElement
    ? "Sair da tela cheia"
    : "Tela cheia";
});
