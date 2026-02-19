// modules/corpus/record.js

let mediaRecorder;
let audioChunks = [];

export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

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
      const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
      console.log("Recording stopped");
      resolve(audioBlob);
    };

    mediaRecorder.stop();
  });
}
