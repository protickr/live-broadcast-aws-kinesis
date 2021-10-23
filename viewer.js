const viewer = {};

async function startViewer(channel_name, streamerView, onStatsReport, onRemoteDataMessage) {
    // viewer.localView = localView;
    viewer.remoteView = streamerView;

    // Create KVS client
    await createKVSClient();

    // Get signaling channel ARN
    const describeSignalingChannelResponse = await kinesisVideoClient
        .describeSignalingChannel({
            ChannelName: channel_name,
        })
        .promise();
    const channelARN = describeSignalingChannelResponse.ChannelInfo.ChannelARN;
    window.channelARN = channelARN;
    console.log('[VIEWER] Channel ARN: ', channelARN);

    // Get signaling channel endpoints
    const getSignalingChannelEndpointResponse = await kinesisVideoClient
        .getSignalingChannelEndpoint({
            ChannelARN: channelARN,
            SingleMasterChannelEndpointConfiguration: {
                Protocols: ['WSS', 'HTTPS'],
                Role: KVSWebRTC.Role.VIEWER,
            },
        })
        .promise();

    const endpointsByProtocol = getSignalingChannelEndpointResponse.ResourceEndpointList.reduce((endpoints, endpoint) => {
        endpoints[endpoint.Protocol] = endpoint.ResourceEndpoint;
        return endpoints;
    }, {});

    window.endpointsByProtocol = endpointsByProtocol;
    console.log('[VIEWER] Endpoints: ', endpointsByProtocol);

    await createVideoSignalingChannelsClient();

    // Get ICE server configuration
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

    // Create Signaling Client
    viewer.signalingClient = await createSignalingClient("viewer");

    //as per requirement we dont need viewer's stream
    // const resolution =  { width: { ideal: 1280 }, height: { ideal: 720 } };
    // const constraints = {
    //     video: formValues.sendVideo ? resolution : false,
    //     audio: formValues.sendAudio,
    // };

    const configuration = {
        iceServers,
        iceTransportPolicy: 'all',
    };

    viewer.peerConnection = new RTCPeerConnection(configuration);
    viewer.dataChannel = viewer.peerConnection.createDataChannel('kvsDataChannel');
    viewer.peerConnection.ondatachannel = event => {
        event.channel.onmessage = onRemoteDataMessage;
    };


    // Poll for connection stats
    // modify onStatsReport
    viewer.peerConnectionStatsInterval = setInterval(() => viewer.peerConnection.getStats().then(onStatsReport), 1000);

    viewer.signalingClient.on('open', async () => {
        console.log('[VIEWER] Connected to signaling service');

        // Get a stream from the webcam, add it to the peer connection, and display it in the local view.
        // If no video/audio needed, no need to request for the sources. 
        // Otherwise, the browser will throw an error saying that either video or audio has to be enabled.
        // if (formValues.sendVideo || formValues.sendAudio) {
        //     try {
        //         viewer.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        //         viewer.localStream.getTracks().forEach(track => viewer.peerConnection.addTrack(track, viewer.localStream));
        //         localView.srcObject = viewer.localStream;
        //     } catch (e) {
        //         console.error('[VIEWER] Could not find webcam');
        //         return;
        //     }
        // }

        // Create an SDP offer to send to the master
        console.log('[VIEWER] Creating SDP offer');
        await viewer.peerConnection.setLocalDescription(
            await viewer.peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
            }),
        );

        // When trickle ICE is enabled, send the offer now and then send ICE candidates as they are generated. Otherwise wait on the ICE candidates.
        if (true) {
            console.log('[VIEWER] Sending SDP offer');
            viewer.signalingClient.sendSdpOffer(viewer.peerConnection.localDescription);
        }
        console.log('[VIEWER] Generating ICE candidates');
    });

    viewer.signalingClient.on('sdpAnswer', async answer => {
        // Add the SDP answer to the peer connection
        console.log('[VIEWER] Received SDP answer');
        await viewer.peerConnection.setRemoteDescription(answer);
    });

    viewer.signalingClient.on('iceCandidate', candidate => {
        // Add the ICE candidate received from the MASTER to the peer connection
        console.log('[VIEWER] Received ICE candidate');
        viewer.peerConnection.addIceCandidate(candidate);
    });

    viewer.signalingClient.on('close', () => {
        console.log('[VIEWER] Disconnected from signaling channel');
    });

    viewer.signalingClient.on('error', error => {
        console.error('[VIEWER] Signaling client error: ', error);
    });

    // Send any ICE candidates to the other peer
    viewer.peerConnection.addEventListener('icecandidate', ({ candidate }) => {
        if (candidate) {
            console.log('[VIEWER] Generated ICE candidate');

            // When trickle ICE is enabled, send the ICE candidates as they are generated.
            if (true) {
                console.log('[VIEWER] Sending ICE candidate');
                viewer.signalingClient.sendIceCandidate(candidate);
            }
        } else {
            console.log('[VIEWER] All ICE candidates have been generated');

            // When trickle ICE is disabled, send the offer now that all the ICE candidates have ben generated.
            if (false) {
                console.log('[VIEWER] Sending SDP offer');
                viewer.signalingClient.sendSdpOffer(viewer.peerConnection.localDescription);
            }
        }
    });

    // As remote tracks are received, add them to the remote view
    viewer.peerConnection.addEventListener('track', event => {
        console.log('[VIEWER] Received remote track');
        if ( streamerView.srcObject) {
            return;
        }
        viewer.remoteStream = event.streams[0];
        streamerView.srcObject = viewer.remoteStream;
    });

    console.log('[VIEWER] Starting viewer connection');
    viewer.signalingClient.open();
}


function stopViewer() {
    console.log('[VIEWER] Stopping viewer connection');
    if (viewer.signalingClient) {
        viewer.signalingClient.close();
        viewer.signalingClient = null;
    }

    if (viewer.peerConnection) {
        viewer.peerConnection.close();
        viewer.peerConnection = null;
    }

    if (viewer.localStream) {
        viewer.localStream.getTracks().forEach(track => track.stop());
        viewer.localStream = null;
    }

    if (viewer.remoteStream) {
        viewer.remoteStream.getTracks().forEach(track => track.stop());
        viewer.remoteStream = null;
    }

    if (viewer.peerConnectionStatsInterval) {
        clearInterval(viewer.peerConnectionStatsInterval);
        viewer.peerConnectionStatsInterval = null;
    }

    if (viewer.localView) {
        viewer.localView.srcObject = null;
    }

    if (viewer.remoteView) {
        viewer.remoteView.srcObject = null;
    }

    if (viewer.dataChannel) {
        viewer.dataChannel = null;
    }
}

function sendViewerMessage(message) {
    if (viewer.dataChannel) {
        try {
            viewer.dataChannel.send(message);
        } catch (e) {
            console.error('[VIEWER] Send DataChannel: ', e.toString());
        }
    }
}
