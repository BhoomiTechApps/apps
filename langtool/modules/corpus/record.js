// modules/corpus/record.js

let mediaRecorder = null;
let audioChunks = [];
let stream = null;

export async function initMicrophone() {
  if (stream) return; // already initialized

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log("Microphone initialized");
  } catch (err) {
    console.error("Microphone permission denied", err);
    throw new Error("Microphone access denied");
  }
}

export function startRecording() {
  if (!stream) {
    throw new Error("Microphone not initialized");
  }

  mediaRecorder = new MediaRecorder(stream);
  audioChunks = [];

  mediaRecorder.ondataavailable = (event) => {
    audioChunks.push(event.data);
  };

  mediaRecorder.start();
  console.log("Recording started");
}

export function stopRecording() {
  return new Promise((resolve) => {
    mediaRecorder.onstop = () => {

      const audioBlob = new Blob(audioChunks, {
        type: mediaRecorder.mimeType
      });

      console.log("Recording stopped");
      console.log("Blob type:", audioBlob.type);
      console.log("Blob size:", audioBlob.size);

      resolve(audioBlob);
    };

    mediaRecorder.stop();
  });
}