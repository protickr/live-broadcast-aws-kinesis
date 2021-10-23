$(document).ready(function(e){
    ROLE = "";

    let streamerVideo =  document.getElementById("webcamVideo");
    let viewerVideo =  document.getElementById("remoteVideo"); 
    let answerButton =  document.getElementById("answerButton");
    let hangupButton =  document.getElementById("hangupButton");

    function onStatsReport(){
      //console.log("what to do");
        ;
    }

    function onRemoteDataMessage(msg){
    //   console.log("received message", msg);
        ;
    }

    $("#goLiveButton").click(function(e){
        let channel_name = Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 10);
        startMaster(channel_name, streamerVideo, onStatsReport, onRemoteDataMessage);
        ROLE = "master";
    });

    $("#answerButton").click(function(e){
        let channelName = $("#callInput").val();
        startViewer(channelName, streamerVideo, onStatsReport, onRemoteDataMessage);
        ROLE = "viewer"
    });

    
    function onStop() {
        if (!ROLE) {
            return;
        }

        if (ROLE === "master") {
            stopMaster();
        } else {
            stopViewer();
        }
        ROLE = null;
    }

    window.addEventListener("beforeunload", onStop);

    window.addEventListener("error", function (event) {
        console.error(event.message);
        event.preventDefault();
    });

    window.addEventListener("unhandledrejection", function (event) {
        console.error(event.reason.toString());
        event.preventDefault();
    });

    $('#hangupButton').click(onStop);

    $('#master .send-message').click(async () => {
        const masterLocalMessage = $('#master .local-message')[0];
        sendMasterMessage(masterLocalMessage.value);
    });
    
    $('#viewer .send-message').click(async () => {
        const viewerLocalMessage = $('#viewer .local-message')[0];
        sendViewerMessage(viewerLocalMessage.value);
    });
  });