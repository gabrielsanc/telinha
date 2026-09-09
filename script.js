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
const peerConnection = new RTCPeerConnection({
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
});

let captureStream = null;
let remoteDescriptionReady = false;
const pendingIceCandidates = [];

socket.on("connect", () => {
  connectionDisplay.textContent = "Conectado";
  status.textContent = "Aguardando conexão";
});

socket.on("disconnect", () => {
  connectionDisplay.textContent = "Desconectado";
  status.textContent = "Servidor desconectado";
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

peerConnection.ontrack = (event) => {
  videoElement.srcObject = event.streams[0];
  emptyState.hidden = true;
  status.textContent = "Transmitindo ao vivo";
};

peerConnection.onicecandidate = (event) => {
  if (event.candidate) socket.emit("ice-candidate", event.candidate);
};

peerConnection.onconnectionstatechange = () => {
  if (
    ["failed", "disconnected", "closed"].includes(
      peerConnection.connectionState,
    )
  ) {
    status.textContent = "Conexão encerrada";
  }
};

socket.on("offer", async (offer) => {
  try {
    await peerConnection.setRemoteDescription(offer);
    remoteDescriptionReady = true;
    await addPendingIceCandidates();

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit("answer", answer);
    status.textContent = "Conectando à tela compartilhada";
  } catch (error) {
    console.error("Erro ao receber a oferta:", error);
    status.textContent = "Não foi possível receber a tela";
  }
});

socket.on("answer", async (answer) => {
  if (peerConnection.signalingState !== "have-local-offer") return;

  try {
    await peerConnection.setRemoteDescription(answer);
    remoteDescriptionReady = true;
    await addPendingIceCandidates();
    status.textContent = "Tela compartilhada";
  } catch (error) {
    console.error("Erro ao receber a resposta:", error);
  }
});

socket.on("ice-candidate", async (candidate) => {
  if (!remoteDescriptionReady) {
    pendingIceCandidates.push(candidate);
    return;
  }

  try {
    await peerConnection.addIceCandidate(candidate);
  } catch (error) {
    console.error("Erro ao adicionar candidato ICE:", error);
  }
});

async function startSharing() {
  try {
    const videoConstraints = getVideoConstraints();
    captureStream = await navigator.mediaDevices.getDisplayMedia({
      video: Object.keys(videoConstraints).length > 0 ? videoConstraints : true,
      audio: false,
    });

    captureStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, captureStream);
    });

    videoElement.srcObject = captureStream;
    emptyState.hidden = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    status.textContent = "Compartilhando sua tela";

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("offer", offer);

    captureStream.getVideoTracks()[0].addEventListener("ended", stopSharing);
  } catch (error) {
    console.error("Erro ao iniciar o compartilhamento:", error);
    stopSharing();
    status.textContent = "Não foi possível iniciar o compartilhamento";
  }
}

function stopSharing() {
  captureStream?.getTracks().forEach((track) => track.stop());
  captureStream = null;
  videoElement.srcObject = null;
  emptyState.hidden = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  status.textContent = "Aguardando conexão";
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

async function addPendingIceCandidates() {
  while (pendingIceCandidates.length > 0) {
    await peerConnection.addIceCandidate(pendingIceCandidates.shift());
  }
}

document.addEventListener("fullscreenchange", () => {
  fullscreenBtn.textContent = document.fullscreenElement
    ? "Sair da tela cheia"
    : "Tela cheia";
});
