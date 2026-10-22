/* Classic worker: MediaPipe's WASM loader uses importScripts. No frame leaves this worker/browser. */
importScripts("./mediapipe/vision_bundle.js");
let hand, pose;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      const files = await Vision.FilesetResolver.forVisionTasks(
        new URL("./mediapipe/wasm", self.location).href,
      );
      hand = await Vision.HandLandmarker.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: new URL(
            "./models/hand_landmarker.task",
            self.location,
          ).href,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
      });
      pose = await Vision.PoseLandmarker.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: new URL(
            "./models/pose_landmarker_lite.task",
            self.location,
          ).href,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.55,
        minPosePresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
      });
      self.postMessage({ type: "ready" });
    } else if (data.type === "frame") {
      try {
        const hands = hand.detectForVideo(data.bitmap, data.timestamp);
        const body = pose.detectForVideo(data.bitmap, data.timestamp);
        self.postMessage({
          type: "result",
          hands: hands.landmarks,
          handedness: hands.handedness,
          shoulders: body.landmarks[0]
            ? [body.landmarks[0][11], body.landmarks[0][12]]
            : null,
          timestamp: data.timestamp,
          aspect: data.bitmap.width / data.bitmap.height,
        });
      } finally {
        data.bitmap.close();
      }
    }
  } catch (error) {
    hand?.close();
    pose?.close();
    self.postMessage({
      type: "error",
      message: error.message || "Tracking could not start.",
    });
  }
};
