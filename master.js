const master = {
    signalingClient: null,
    peerConnectionByClientId: {},
    dataChannelByClientId: {},
    localStream: null,
    remoteStreams: [],
    peerConnectionStatsInterval: null,
};

async function startMaster(channel_name, localView, onStatsReport, onRemoteDataMessage) {
    //localView, remoteView, formValues, onStatsReport, onRemoteDataMessage
    master.localView = localView;
    // master.remoteView = remoteView;

    if( typeof channelARN === "undefined" || channelARN === null)
        await createSignalingChannel(channel_name);

    // Get signaling channel endpoints
    const getSignalingChannelEndpointResponse = await kinesisVideoClient
        .getSignalingChannelEndpoint({
            ChannelARN: channelARN,
            SingleMasterChannelEndpointConfiguration: {
                Protocols: ['WSS', 'HTTPS'],
                Role: KVSWebRTC.Role.MASTER,
            },
        })
        .promise();

    const endpointsByProtocol = getSignalingChannelEndpointResponse.ResourceEndpointList.reduce((endpoints, endpoint) => {
        endpoints[endpoint.Protocol] = endpoint.ResourceEndpoint;
        return endpoints;
    }, {});
    console.log('[MASTER] Endpoints: ', endpointsByProtocol);
    window.endpointsByProtocol = endpointsByProtocol;

    master.signalingClient = await createSignalingClient("master");
    createVideoSignalingChannelsClient();

    const getIceServerConfigResponse = await kinesisVideoSignalingChannelsClient
        .getIceServerConfig({
            ChannelARN: channelARN,
        })
        .promise();

    const iceServers = [];
    iceServers.push({ urls: `stun:stun.kinesisvideo.${awsConfig.region}.amazonaws.com:443` });
    getIceServerConfigResponse.IceServerList.forEach(iceServer =>
        iceServers.push({
            urls: iceServer.Uris,
            username: iceServer.Username,
            credential: iceServer.Password,
        }),
    );

    console.log('[MASTER] ICE servers: ', iceServers);

    const configuration = {
        iceServers,
        iceTransportPolicy: 'all',
    };

    // const resolution = formValues.widescreen ? { width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 640 }, height: { ideal: 480 } };
    const resolution =  { width: { ideal: 1280 }, height: { ideal: 720 } };

    const constraints = {
        video: resolution,
        audio: true,
    };

    try {
        master.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        localView.srcObject = master.localStream;
    } catch (e) {
        console.error('[MASTER] Could not find webcam');
    }
    
    master.signalingClient.on('open', async () => {
        console.log('[MASTER] Connected to signaling service');
    });

    master.signalingClient.on('sdpOffer', async (offer, remoteClientId) => {
        console.log('[MASTER] Received SDP offer from client: ' + remoteClientId);

        // Create a new peer connection using the offer from the given client
        const peerConnection = new RTCPeerConnection(configuration);
        master.peerConnectionByClientId[remoteClientId] = peerConnection;

        //create data channel to transport realtime chat messages.
        master.dataChannelByClientId[remoteClientId] = peerConnection.createDataChannel('kvsDataChannel');
        peerConnection.ondatachannel = event => {
            event.channel.onmessage = onRemoteDataMessage;
        };
        

        // Poll for connection stats 
        // modify onStatsReport function
        if (!master.peerConnectionStatsInterval) {
            master.peerConnectionStatsInterval = setInterval(() => peerConnection.getStats().then(onStatsReport), 1000);
        }

        // Send any ICE candidates to the other peer
        peerConnection.addEventListener('icecandidate', ({ candidate }) => {
            if (candidate) {
                console.log('[MASTER] Generated ICE candidate for client: ' + remoteClientId);

                // When trickle ICE is enabled, send the ICE candidates as they are generated.
                if (true) {
                    console.log('[MASTER] Sending ICE candidate to client: ' + remoteClientId);
                    master.signalingClient.sendIceCandidate(candidate, remoteClientId);
                }
            } else {
                console.log('[MASTER] All ICE candidates have been generated for client: ' + remoteClientId);

                // When trickle ICE is disabled, send the answer now that all the ICE candidates have ben generated.
                if (false) {
                    console.log('[MASTER] Sending SDP answer to client: ' + remoteClientId);
                    master.signalingClient.sendSdpAnswer(peerConnection.localDescription, remoteClientId);
                }
            }
        });

        // As remote tracks are received, add them to the remote view
        // as per requirements we dont need to show viewers stream to the streamer.
        // peerConnection.addEventListener('track', event => {
        //     console.log('[MASTER] Received remote track from client: ' + remoteClientId);
        //     if (remoteView.srcObject) {
        //         return;
        //     }
        //     remoteView.srcObject = event.streams[0];
        // });

        // If there's no video/audio, master.localStream will be null. So, we should skip adding the tracks from it.
        if (master.localStream) {
            master.localStream.getTracks().forEach(track => peerConnection.addTrack(track, master.localStream));
        }
        await peerConnection.setRemoteDescription(offer);

        // Create an SDP answer to send back to the client
        console.log('[MASTER] Creating SDP answer for client: ' + remoteClientId);
        await peerConnection.setLocalDescription(
            await peerConnection.createAnswer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
            }),
        );

        // When trickle ICE is enabled, send the answer now and then send ICE candidates as they are generated. Otherwise wait on the ICE candidates.
        if (true) {
            console.log('[MASTER] Sending SDP answer to client: ' + remoteClientId);
            master.signalingClient.sendSdpAnswer(peerConnection.localDescription, remoteClientId);
        }
        console.log('[MASTER] Generating ICE candidates for client: ' + remoteClientId);
    });

    master.signalingClient.on('iceCandidate', async (candidate, remoteClientId) => {
        console.log('[MASTER] Received ICE candidate from client: ' + remoteClientId);

        // Add the ICE candidate received from the client to the peer connection
        const peerConnection = await master.peerConnectionByClientId[remoteClientId];
        peerConnection.addIceCandidate(candidate);
    });

    master.signalingClient.on('close', () => {
        console.log('[MASTER] Disconnected from signaling channel');
    });

    master.signalingClient.on('error', () => {
        console.error('[MASTER] Signaling client error');
    });

    console.log('[MASTER] Starting master connection');
    master.signalingClient.open();
}

function stopMaster() {
    console.log('[MASTER] Stopping master connection');
    if (master.signalingClient) {
        master.signalingClient.close();
        master.signalingClient = null;
    }

    Object.keys(master.peerConnectionByClientId).forEach(clientId => {
        master.peerConnectionByClientId[clientId].close();
    });
    master.peerConnectionByClientId = [];

    if (master.localStream) {
        master.localStream.getTracks().forEach(track => track.stop());
        master.localStream = null;
    }

    master.remoteStreams.forEach(remoteStream => remoteStream.getTracks().forEach(track => track.stop()));
    master.remoteStreams = [];

    if (master.peerConnectionStatsInterval) {
        clearInterval(master.peerConnectionStatsInterval);
        master.peerConnectionStatsInterval = null;
    }

    if (master.localView) {
        master.localView.srcObject = null;
    }

    if (master.remoteView) {
        master.remoteView.srcObject = null;
    }

    if (master.dataChannelByClientId) {
        master.dataChannelByClientId = {};
    }
}

function sendMasterMessage(message) {
    Object.keys(master.dataChannelByClientId).forEach(clientId => {
        try {
            master.dataChannelByClientId[clientId].send(message);
        } catch (e) {
            console.error('[MASTER] Send DataChannel: ', e.toString());
        }
    });
}
