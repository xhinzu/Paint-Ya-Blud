/* Paint Ya Blud - WebRTC PeerConnection & DataChannel Manager */

(function () {
  let peerConnection = null;
  let dataChannel = null;

  // Free Open Relay Project TURN / STUN credentials
  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      {
        urls: 'openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ]
  };

  window.initWebRTC = async function (localStream, targetPeerId, socket) {
    peerConnection = new RTCPeerConnection(iceServers);

    // Add local tracks to P2P connection
    if (localStream) {
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });
    }

    // Remote Track Handler
    peerConnection.ontrack = (event) => {
      const peerVideo = document.getElementById('peerVideo');
      if (peerVideo && event.streams[0]) {
        peerVideo.srcObject = event.streams[0];
      }
    };

    // ICE Candidate Exchange
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('signal', {
          targetId: targetPeerId,
          signalData: { type: 'candidate', candidate: event.candidate }
        });
      }
    };

    // Setup DataChannel for instant drawing strokes
    dataChannel = peerConnection.createDataChannel('drawingStrokes');
    setupDataChannelEvents(dataChannel);

    peerConnection.ondatachannel = (event) => {
      setupDataChannelEvents(event.channel);
    };

    return peerConnection;
  };

  function setupDataChannelEvents(channel) {
    channel.onmessage = (event) => {
      try {
        const strokeData = JSON.parse(event.data);
        if (window.renderRemoteStroke) {
          window.renderRemoteStroke(strokeData);
        }
      } catch (e) {
        console.error('DataChannel stroke parse error:', e);
      }
    };
  }

  window.sendRemoteStroke = function (strokeData) {
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(JSON.stringify(strokeData));
    }
  };

  window.handleIncomingSignal = async function (signalData, senderId, socket) {
    if (!peerConnection) return;

    if (signalData.type === 'offer') {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(signalData.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      socket.emit('signal', {
        targetId: senderId,
        signalData: { type: 'answer', answer }
      });
    } else if (signalData.type === 'answer') {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(signalData.answer));
    } else if (signalData.type === 'candidate') {
      await peerConnection.addIceCandidate(new RTCIceCandidate(signalData.candidate));
    }
  };
})();
