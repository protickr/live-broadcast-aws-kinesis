const awsConfig = {
    region: "", 
    accessKeyId: "", 
    secretAccessKey: "", 
    correctClockSkew: true,
    sessionToken: "",
}

// Create KVS client
async function createKVSClient(){
    const kinesisVideoClient = new AWS.KinesisVideo({
        region: awsConfig.region,
        accessKeyId: awsConfig.accessKeyId,
        secretAccessKey: awsConfig.secretAccessKey,
        correctClockSkew: awsConfig.correctClockSkew,
        // sessionToken: formValues.sessionToken,
        // endpoint: formValues.endpoint,
    });
    window.kinesisVideoClient = kinesisVideoClient;
}

async function createSignalingChannel(generatedChannelName) {
    if( typeof kinesisVideoClient === "undefined" || kinesisVideoClient === null ){
        await createKVSClient();
    }

    // Get signaling channel ARN
    await kinesisVideoClient
        .createSignalingChannel({
            ChannelName: generatedChannelName,
        })
        .promise();

    // Get signaling channel ARN
    const describeSignalingChannelResponse = await kinesisVideoClient
        .describeSignalingChannel({
            ChannelName: generatedChannelName,
        })
        .promise();

    const channelARN = describeSignalingChannelResponse.ChannelInfo.ChannelARN;
    window.channelARN = channelARN;

    console.log('[CREATE_SIGNALING_CHANNEL] Channel ARN: ', channelARN);
    $("#callInput").val(generatedChannelName).change();
}

// Create Signaling Client
async function createSignalingClient(role){
    return await new KVSWebRTC.SignalingClient({
        channelARN,
        channelEndpoint: endpointsByProtocol.WSS,
        role: role == "master" ? "MASTER" : "VIEWER",
        region: awsConfig.region,
        credentials: {
            accessKeyId: awsConfig.accessKeyId,
            secretAccessKey: awsConfig.secretAccessKey,
            // sessionToken: formValues.sessionToken,
        },
        clientId: role == "master" ? null : Math.random().toString(36).substring(2).toUpperCase(),
        systemClockOffset: kinesisVideoClient.config.systemClockOffset,
    });
}

async function createVideoSignalingChannelsClient(){
    const kinesisVideoSignalingChannelsClient = new AWS.KinesisVideoSignalingChannels({
        region: awsConfig.region,
        accessKeyId: awsConfig.accessKeyId,
        secretAccessKey: awsConfig.secretAccessKey,
        correctClockSkew: awsConfig.correctClockSkew,
        endpoint: endpointsByProtocol.HTTPS,
        // sessionToken: awsConfig.sessionToken,
    });
    window.kinesisVideoSignalingChannelsClient = kinesisVideoSignalingChannelsClient;
}