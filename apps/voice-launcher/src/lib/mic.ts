export interface MicSession {
  analyser: AnalyserNode;
  stop: () => void;
}

export async function startMicAnalyser(): Promise<MicSession> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 128;
  source.connect(analyser);
  return {
    analyser,
    stop: () => {
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    }
  };
}
