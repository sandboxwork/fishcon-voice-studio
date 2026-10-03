export const TTS_ENDPOINT = 'https://api.fish.audio/v1/tts';
export const MAX_AUDIO_BYTES = 80 * 1024 * 1024;
export const MODELS = ['s2.1-pro', 's2.1-pro-free', 's2-pro', 's1'];

export function buildRequest({ apiKey, text, model, referenceId, speed, format }) {
  const key = apiKey.trim().replace(/^Bearer\s+/i, '');
  if (!key || /[^\x21-\x7e]/.test(key)) throw new Error('공백이나 줄바꿈 없이 올바른 API 키를 입력하세요.');
  if (!text.trim() || text.length > 10000) throw new Error('대본을 1~10,000자 이내로 입력하세요.');
  if (!MODELS.includes(model) || !['wav', 'mp3'].includes(format)) throw new Error('올바른 모델과 파일 형식을 선택하세요.');
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new Error('말하기 속도를 0.5~2.0 사이로 설정하세요.');
  const body = {
    text: text.trim(), format, sample_rate: 44100,
    prosody: { speed, volume: 0 }, latency: 'normal', normalize: true,
  };
  if (referenceId.trim()) body.reference_id = referenceId.trim();
  if (format === 'mp3') body.mp3_bitrate = 192;
  return {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', model },
    body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
  };
}

export function httpError(status) {
  const messages = {
    400: '요청 설정을 확인하세요. 대본이나 보이스 ID가 유효하지 않을 수 있습니다.',
    401: 'API 키가 유효하지 않습니다. Fish Audio에서 발급한 키를 확인하세요.',
    402: 'Fish Audio 잔액 또는 이용 한도가 부족합니다. 계정을 확인하세요.',
    403: '이 모델 또는 보이스를 사용할 권한이 없습니다.',
    404: '요청한 모델이나 보이스를 찾을 수 없습니다.',
    413: '대본이 너무 깁니다. 여러 부분으로 나누어 생성하세요.',
    422: '입력 형식을 확인하세요. 대본이나 보이스 ID를 변경해 다시 시도하세요.',
    429: '요청 한도에 도달했습니다. 잠시 후 다시 시도하세요.',
    500: 'Fish Audio에서 오류가 발생했습니다. 잠시 후 다시 시도하세요.',
    502: 'Fish Audio 연결이 일시적으로 불안정합니다. 잠시 후 다시 시도하세요.',
    503: 'Fish Audio 모델이 현재 이용 불가 상태입니다. 잠시 후 다시 시도하세요.',
  };
  return new Error(`${messages[status] || 'Fish Audio가 요청을 처리하지 못했습니다.'} (HTTP ${status})`);
}

export async function readAudioResponse(response, format, onProgress = () => {}) {
  if (!response.ok) {
    // Do not display an upstream response body: it might contain request data or credentials.
    await response.body?.cancel();
    throw httpError(response.status);
  }
  if (/json|text\//i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel();
    throw new Error('Fish Audio가 음성 대신 오류 메시지를 반환했습니다. 설정을 확인하세요.');
  }
  if (!response.body) throw new Error('음성 데이터가 없습니다. 다시 시도하세요.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUDIO_BYTES) {
        await reader.cancel();
        throw new Error('이 앱의 음성 처리 한도(80 MB)를 초과했습니다. 대본을 나누어 생성하세요.');
      }
      chunks.push(value);
      onProgress(size);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new Error('빈 음성 파일이 반환되었습니다. 다시 시도하세요.');
  const blob = new Blob(chunks, { type: format === 'wav' ? 'audio/wav' : 'audio/mpeg' });
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const ascii = (start, end) => String.fromCharCode(...header.slice(start, end));
  const valid = format === 'wav'
    ? ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE'
    : ascii(0, 3) === 'ID3' || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0);
  if (!valid) throw new Error('응답이 유효한 음성 파일이 아닙니다. Fish Audio 설정을 확인하세요.');
  return blob;
}

export async function decodeAudio(blob) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) throw new Error('이 브라우저에서 음성 변환을 지원하지 않습니다.');
  const context = new Context({ sampleRate: 44100 });
  try { return await context.decodeAudioData(await blob.arrayBuffer()); }
  finally { await context.close(); }
}

export function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const dataBytes = buffer.length * channels * 2;
  const view = new DataView(new ArrayBuffer(44 + dataBytes));
  const writeText = (offset, text) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  writeText(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); writeText(8, 'WAVE');
  writeText(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true); writeText(36, 'data'); view.setUint32(40, dataBytes, true);
  const planes = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, planes[channel][i]));
      view.setInt16(offset, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      offset += 2;
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}

export async function finalCutWav(buffer) {
  const Context = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Context) throw new Error('48 kHz 변환을 지원하지 않습니다. 원본 WAV를 다운로드해 사용하세요.');
  const offline = new Context(buffer.numberOfChannels, Math.ceil(buffer.duration * 48000), 48000);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  return encodeWav(await offline.startRendering());
}

export function clipboardMode(mime) {
  if (!globalThis.isSecureContext || !globalThis.navigator?.clipboard) return 'unavailable';
  if (globalThis.ClipboardItem?.supports?.(mime)) return 'audio';
  if (globalThis.ClipboardItem?.supports?.(`web ${mime}`)) return 'web';
  return typeof navigator.clipboard.writeText === 'function' ? 'base64' : 'unavailable';
}

function asDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('음성 데이터를 읽지 못했습니다.'));
    reader.readAsDataURL(blob);
  });
}

export async function copyAudio(blob) {
  const mode = clipboardMode(blob.type);
  if (mode === 'unavailable') throw new Error('클립보드를 사용할 수 없습니다. HTTPS 또는 localhost에서 열거나 음성을 다운로드하세요.');
  if (mode === 'audio' || mode === 'web') {
    const type = mode === 'web' ? `web ${blob.type}` : blob.type;
    await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
  } else if (globalThis.ClipboardItem && navigator.clipboard.write) {
    // Start the write during the click gesture; Safari loses activation after awaiting FileReader.
    await navigator.clipboard.write([new ClipboardItem({
      'text/plain': asDataUrl(blob).then(data => new Blob([data], { type: 'text/plain' })),
    })]);
  } else {
    await navigator.clipboard.writeText(await asDataUrl(blob));
  }
  return mode;
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function formatBytes(size) {
  return size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}
