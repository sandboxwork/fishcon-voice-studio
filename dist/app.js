import { TTS_ENDPOINT, buildRequest, readAudioResponse, decodeAudio, finalCutWav, copyAudio, clipboardMode, saveBlob, formatBytes } from './audio.js';

const $ = id => document.getElementById(id);
const form = $('studio-form');
const script = $('script');
const isExtension = location.protocol === 'chrome-extension:';
let current = null;
let active = null;
let sequence = 0;
let exporting = false;
let copying = false;

function status(message, type = '') {
  $('status').textContent = message;
  $('status').className = `status ${type}`;
  $('status').hidden = !message;
}

function refreshScript() {
  $('character-count').textContent = script.value.length.toLocaleString('ko-KR');
  $('insert-example').disabled = Boolean(script.value) || Boolean(active);
}

function busy(value) {
  $('settings-fields').disabled = value;
  script.disabled = value;
  $('generate').disabled = value;
  $('generate').textContent = value ? '음성을 생성하고 있어요…' : '◈  음성 생성하기';
  $('cancel').hidden = !value;
  $('result-badge').textContent = value ? '생성 중' : current ? '생성 완료' : '준비';
  refreshScript();
}

function drawWaveform() {
  const canvas = $('waveform');
  if (!current?.decoded || canvas.hidden) return;
  const width = canvas.clientWidth;
  if (!width) return;
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = 90 * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, 90);
  const samples = current.decoded.getChannelData(0);
  const count = Math.max(1, Math.floor((width - 32) / 5));
  const step = Math.max(1, Math.floor(samples.length / count));
  const played = current.decoded.duration ? $('player').currentTime / current.decoded.duration : 0;
  for (let i = 0; i < count; i++) {
    let peak = 0;
    const start = i * step;
    const end = Math.min(start + step, samples.length);
    // Sample at most 200 points per bar to keep long recordings responsive.
    for (let j = start; j < end; j += Math.max(1, Math.floor(step / 200))) peak = Math.max(peak, Math.abs(samples[j]));
    const height = Math.max(3, Math.sqrt(peak) * 66);
    ctx.fillStyle = i / count <= played ? '#394bea' : '#a7b3ee';
    ctx.fillRect(16 + i * 5, (90 - height) / 2, 3, height);
  }
}

function showClip(clip) {
  $('player').pause();
  const previous = current;
  current = clip;
  $('player').src = clip.url;
  if (previous) URL.revokeObjectURL(previous.url);
  $('empty-state').hidden = true;
  $('audio-result').hidden = false;
  $('clip-name').textContent = clip.name;
  const duration = clip.decoded ? `${clip.decoded.duration.toFixed(1)}초 · ` : '';
  $('clip-meta').textContent = `${duration}${formatBytes(clip.blob.size)} · ${clip.format.toUpperCase()} · ${clip.model}`;
  $('waveform').hidden = !clip.decoded;
  $('decode-help').hidden = Boolean(clip.decoded);
  $('decode-help').textContent = '이 브라우저에서 음성 변환을 하지 못했습니다. 원본 파일은 다운로드할 수 있습니다.';
  $('export-finalcut').disabled = !clip.decoded || exporting;
  const mode = clipboardMode(clip.blob.type);
  $('copy-audio').disabled = mode === 'unavailable' || copying;
  $('clipboard-help').textContent = {
    audio: '음성 바이너리를 복사합니다. 붙여넣기 대상 앱의 지원이 필요하며 Final Cut 직접 붙여넣기는 지원하지 않습니다.',
    web: '브라우저 전용 음성 바이너리를 복사합니다. 이 형식을 지원하는 웹앱에서 사용할 수 있으며 Final Cut에는 붙여넣을 수 없습니다.',
    base64: '이 브라우저에서는 음성을 Base64 데이터 URL 텍스트로 복사합니다. Final Cut에는 붙여넣을 수 없습니다.',
    unavailable: '이 환경에서는 클립보드 접근이 지원되지 않습니다. 음성 다운로드를 사용하세요.',
  }[mode];
  drawWaveform();
}

async function generate() {
  if (active || !form.reportValidity()) return;
  const input = {
    apiKey: $('api-key').value, text: script.value, model: $('model').value,
    referenceId: $('voice-id').value, speed: Number($('speed').value), format: $('format').value,
  };
  let request;
  try { request = buildRequest(input); }
  catch (error) { status(error.message, 'error'); return; }
  const controller = new AbortController();
  active = controller;
  let timedOut = false;
  let received = 0;
  const start = Date.now();
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 180000);
  const update = () => status(received ? `음성을 받는 중 · ${formatBytes(received)} · ${Math.floor((Date.now() - start) / 1000)}초` : `Fish Audio에서 음성을 만드는 중 · ${Math.floor((Date.now() - start) / 1000)}초`);
  const timer = setInterval(update, 1000);
  busy(true); update();
  try {
    const response = await fetch(TTS_ENDPOINT, { ...request, signal: controller.signal });
    const blob = await readAudioResponse(response, input.format, bytes => { received = bytes; });
    status('음성을 재생할 준비를 하고 있어요…');
    let decoded = null;
    try { decoded = await decodeAudio(blob); } catch { /* Original audio remains downloadable. */ }
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
    const name = `fishcon-${stamp}-${String(++sequence).padStart(2, '0')}`;
    showClip({ blob, decoded, url: URL.createObjectURL(blob), name, format: input.format, model: input.model });
    status('음성이 완성되었습니다. 재생 버튼을 눌러 들어보세요.', 'success');
  } catch (error) {
    if (controller.signal.aborted) status(timedOut ? '3분 안에 응답이 완료되지 않았습니다. 대본을 줄이거나 잠시 후 다시 시도하세요. 중단 전 처리한 요청은 Fish Audio에서 과금될 수 있습니다.' : '생성을 취소했습니다. 이미 처리된 요청은 Fish Audio에서 과금될 수 있습니다.', timedOut ? 'error' : '');
    else if (error instanceof TypeError) status(isExtension ? 'Fish Audio에 연결하지 못했습니다. 인터넷 연결과 확장 프로그램의 api.fish.audio 접근 권한을 확인하세요.' : 'Fish Audio에 연결하지 못했습니다. 네트워크 또는 CORS 제한일 수 있습니다. 현재 일반 웹의 CORS 사전 요청이 거부되므로 설치 안내에서 Chrome 확장판을 이용하세요.', 'error');
    else status(error.message || '음성 생성에 실패했습니다. 다시 시도하세요.', 'error');
  } finally {
    clearTimeout(timeout); clearInterval(timer);
    active = null; busy(false);
  }
}

form.addEventListener('submit', event => { event.preventDefault(); void generate(); });
$('cancel').addEventListener('click', () => active?.abort());
$('toggle-key').addEventListener('click', () => {
  const show = $('api-key').type === 'password';
  $('api-key').type = show ? 'text' : 'password';
  $('toggle-key').textContent = show ? '숨김' : '보기';
  $('toggle-key').setAttribute('aria-label', show ? 'API 키 숨기기' : 'API 키 표시');
  $('toggle-key').setAttribute('aria-pressed', String(show));
});
script.addEventListener('input', refreshScript);
$('insert-example').addEventListener('click', () => {
  if (script.value) return;
  script.value = '오늘도 당신의 이야기는 계속됩니다. 작은 생각 하나가 새로운 시작이 되고, 익숙한 풍경은 또 다른 영감이 됩니다. 이제, 당신만의 목소리로 이야기를 들려주세요.';
  refreshScript(); script.focus();
});
$('speed').addEventListener('input', () => { $('speed-value').textContent = `${Number($('speed').value).toFixed(2)}×`; });
$('format').addEventListener('change', () => { $('format-help').textContent = $('format').value === 'wav' ? '· 16-bit PCM' : '· 192 kbps'; });
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !$('setup-dialog').open) {
    event.preventDefault(); void generate();
  }
});
$('download').addEventListener('click', () => { if (current) saveBlob(current.blob, `${current.name}.${current.format}`); });
$('export-finalcut').addEventListener('click', async () => {
  if (!current?.decoded || exporting) return;
  const clip = current;
  exporting = true;
  $('export-finalcut').disabled = true;
  $('export-finalcut').textContent = 'WAV 변환 중…';
  try {
    const wav = await finalCutWav(clip.decoded);
    saveBlob(wav, `${clip.name}-finalcut-48k.wav`);
    status('48 kHz WAV 저장을 시작했습니다. 다운로드한 파일을 Finder에서 Final Cut 타임라인으로 드래그하세요.', 'success');
  } catch (error) { status(error.message || 'WAV 변환에 실패했습니다. 원본 다운로드를 사용하세요.', 'error'); }
  finally { exporting = false; $('export-finalcut').disabled = !current?.decoded; $('export-finalcut').textContent = 'Final Cut용 WAV 저장'; }
});
$('copy-audio').addEventListener('click', async () => {
  if (!current || copying) return;
  copying = true; $('copy-audio').disabled = true;
  try {
    const mode = await copyAudio(current.blob);
    status(mode === 'base64' ? '음성을 Base64 데이터 URL 텍스트로 복사했습니다. Final Cut에는 WAV 파일을 가져오세요.' : '음성 데이터를 복사했습니다. 이 클립보드 형식을 지원하는 앱에서 사용할 수 있습니다. Final Cut에는 WAV 파일을 가져오세요.', 'success');
  } catch (error) {
    status(error.name === 'NotAllowedError' ? '클립보드 쓰기 권한이 거부되었습니다. 브라우저 권한을 확인하거나 음성을 다운로드하세요.' : '이 브라우저에서 음성 데이터 복사에 실패했습니다. 음성 다운로드를 사용하세요.', 'error');
  } finally { copying = false; $('copy-audio').disabled = !current || clipboardMode(current.blob.type) === 'unavailable'; }
});
$('player').addEventListener('timeupdate', drawWaveform);
$('player').addEventListener('error', () => { if (current) status('브라우저에서 음성을 재생하지 못했습니다. 원본 파일을 다운로드해 확인하세요.', 'error'); });
new ResizeObserver(drawWaveform).observe($('waveform'));
document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => $(button.dataset.open).showModal()));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
if (isExtension) { $('mode-badge').textContent = '확장판 · 직접 연결'; $('connection-notice').hidden = true; }

// A preparatory tool only: never exposes the API key or starts a potentially billable request.
const lifecycle = new AbortController();
if (document.modelContext?.registerTool) {
  try {
    Promise.resolve(document.modelContext.registerTool({
      name: 'stage_speech_text', title: '음성 대본 입력',
      description: '대본을 화면에 입력합니다. 음성을 생성하거나 API 키를 읽지 않습니다. 사용자가 생성 버튼을 눌러야 합니다.',
      inputSchema: { type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength: 10000 } }, required: ['text'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 10000 || Object.keys(input).some(key => key !== 'text')) throw new Error('1~10,000자 대본만 입력하세요.');
        if (active) throw new Error('음성 생성이 끝난 뒤 대본을 변경하세요.');
        script.value = input.text; refreshScript();
        return { staged: true, characters: script.value.length, generated: false };
      },
    }, { signal: lifecycle.signal })).catch(() => {});
  } catch { /* WebMCP is optional. */ }
}
window.addEventListener('pagehide', event => {
  active?.abort(); $('api-key').value = ''; $('api-key').type = 'password';
  $('toggle-key').textContent = '보기'; $('toggle-key').setAttribute('aria-pressed', 'false');
  $('toggle-key').setAttribute('aria-label', 'API 키 표시');
  if (!event.persisted) { lifecycle.abort(); if (current) URL.revokeObjectURL(current.url); }
});
refreshScript();
