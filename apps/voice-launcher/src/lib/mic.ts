export interface MicSession {
  analyser: AnalyserNode;
  sampleVoiceActivity: () => VoiceActivitySample;
  stream: MediaStream;
  stop: () => void;
}

export interface VoiceActivitySample {
  peak: number;
  rms: number;
}

export async function startMicAnalyser(): Promise<MicSession> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const timeDomainData = new Uint8Array(analyser.fftSize);

  return {
    analyser,
    sampleVoiceActivity: () => {
      analyser.getByteTimeDomainData(timeDomainData);
      let sumSquares = 0;
      let peak = 0;
      for (const sample of timeDomainData) {
        const centered = (sample - 128) / 128;
        const amplitude = Math.abs(centered);
        peak = Math.max(peak, amplitude);
        sumSquares += centered * centered;
      }
      return {
        peak,
        rms: Math.sqrt(sumSquares / timeDomainData.length)
      };
    },
    stream,
    stop: () => {
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    }
  };
}
