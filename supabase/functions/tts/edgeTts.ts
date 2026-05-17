
export type Voice = {
  Name: string;
  ShortName: string;
  Gender: string;
  Locale: string;
  FriendlyName: string;
  SuggestedCodec: string;
  VoiceTag: {
    ContentCategories: string[];
    VoicePersonalities: string[];
  };
};

export class EdgeTts {
  private token: string;

  constructor(token?: string) {
    this.token = token ?? '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
  }

  async getVoices(): Promise<Voice[]> {
    const url = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=${this.token}`;
    const response = await fetch(url);
    const voices: Voice[] = await response.json();
    return voices;
  }

  async synthesizeSsml(ssml: string, outputFormat: string = 'audio-24khz-96kbitrate-mono-mp3'): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const url = new URL(
        `/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${this.token}`,
        'wss://speech.platform.bing.com'
      );

      const ws = new WebSocket(url.toString());
      let audioChunks: Uint8Array[] = [];

      const initialMessage = `X-Timestamp:${new Date().toUTCString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"${outputFormat}"}}}}`;

      const ssmlMessage = `X-RequestId:${this.generateRequestId()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toUTCString()}Z\r\nPath:ssml\r\n\r\n${ssml}`;

      ws.addEventListener('open', () => {
        ws.send(initialMessage);
        setTimeout(() => {
          ws.send(ssmlMessage);
        }, 100);
      });

      ws.addEventListener('message', (event) => {
        if (event.data instanceof Blob) {
          const reader = new FileReader();
          reader.onload = () => {
            if (reader.result instanceof ArrayBuffer) {
              audioChunks.push(new Uint8Array(reader.result));
            }
          };
          reader.readAsArrayBuffer(event.data);
        } else {
          const data = event.data as string;
          if (data.includes('Path:turn.end')) {
            const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const audioData = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of audioChunks) {
              audioData.set(chunk, offset);
              offset += chunk.length;
            }
            ws.close();
            resolve(audioData);
          }
        }
      });

      ws.addEventListener('error', (error) => {
        reject(error);
      });

      ws.addEventListener('close', () => {
        if (audioChunks.length === 0) {
          reject(new Error('No audio data received'));
        }
      });
    });
  }

  private generateRequestId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}
