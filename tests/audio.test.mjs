import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, readAudioResponse, encodeWav, MAX_AUDIO_BYTES } from '../dist/audio.js';

const input = { apiKey: 'Bearer test-key', text: ' 안녕하세요 ', model: 's2.1-pro', referenceId: '', speed: 1, format: 'wav' };
export async function fixtureWav() {
  const sampleRate = 44100;
  const samples = Float32Array.from({ length: sampleRate }, (_, i) => Math.sin(i / sampleRate * 440 * Math.PI * 2) * .3);
  return Buffer.from(await encodeWav({ numberOfChannels: 1, length: samples.length, sampleRate, getChannelData: () => samples }).arrayBuffer());
}

test('Fish request uses documented headers and omits optional voice / MP3 parameters for WAV', () => {
  const request = buildRequest(input);
  assert.equal(request.headers.Authorization, 'Bearer test-key');
  assert.equal(request.headers.model, 's2.1-pro');
  assert.deepEqual(JSON.parse(request.body), { text: '안녕하세요', format: 'wav', sample_rate: 44100, prosody: { speed: 1, volume: 0 }, latency: 'normal', normalize: true });
  assert.equal(request.credentials, 'omit');
  assert.equal(request.redirect, 'error');
  const mp3 = JSON.parse(buildRequest({ ...input, format: 'mp3', referenceId: ' voice-1 ' }).body);
  assert.equal(mp3.reference_id, 'voice-1');
  assert.equal(mp3.mp3_bitrate, 192);
  for (const override of [{ apiKey: 'bad\nkey' }, { text: '  ' }, { text: 'x'.repeat(10001) }, { speed: NaN }, { model: 'invented' }, { format: 'bad' }]) {
    assert.throws(() => buildRequest({ ...input, ...override }));
  }
});

test('WAV header, interleaving and signed PCM16 clipping are correct', async () => {
  const planes = [Float32Array.from([-2, 0, 2]), Float32Array.from([.5, -.5, 0])];
  const blob = encodeWav({ numberOfChannels: 2, length: 3, sampleRate: 48000, getChannelData: i => planes[i] });
  const buffer = Buffer.from(await blob.arrayBuffer());
  assert.equal(buffer.subarray(0, 4).toString(), 'RIFF');
  assert.equal(buffer.subarray(8, 12).toString(), 'WAVE');
  assert.equal(buffer.readUInt32LE(4), buffer.length - 8);
  assert.equal(buffer.readUInt16LE(22), 2);
  assert.equal(buffer.readUInt32LE(24), 48000);
  assert.equal(buffer.readUInt32LE(28), 192000);
  assert.equal(buffer.readUInt32LE(40), 12);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => buffer.readInt16LE(44 + i * 2)), [-32768, 16384, 0, -16384, 32767, 0]);
});

test('chunked response preserves actual bytes and rejects errors, empty data and false audio', async () => {
  const wav = await fixtureWav();
  const chunks = [wav.subarray(0, 20), wav.subarray(20)];
  const stream = new ReadableStream({ pull(controller) { chunks.length ? controller.enqueue(chunks.shift()) : controller.close(); } });
  const counts = [];
  const result = await readAudioResponse(new Response(stream), 'wav', bytes => counts.push(bytes));
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), wav);
  assert.deepEqual(counts, [20, wav.length]);
  await assert.rejects(readAudioResponse(new Response('private key', { status: 401 }), 'wav'), /HTTP 401/);
  await assert.rejects(readAudioResponse(new Response('{}', { headers: { 'Content-Type': 'application/json' } }), 'wav'), /음성 대신/);
  await assert.rejects(readAudioResponse(new Response(new Uint8Array()), 'wav'), /빈 음성/);
  await assert.rejects(readAudioResponse(new Response(new Uint8Array([1, 2, 3])), 'wav'), /유효한 음성/);
});

test('oversized streams are cancelled before creating an audio Blob', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_AUDIO_BYTES + 1)); }, cancel() { cancelled = true; } });
  await assert.rejects(readAudioResponse(new Response(stream), 'wav'), /80 MB/);
  assert.equal(cancelled, true);
});
