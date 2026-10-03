import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { encodeWav } from '../dist/audio.js';

const samples = Float32Array.from({ length: 44100 }, (_, i) => Math.sin(i / 44100 * 880 * Math.PI) * .3);
const wav = Buffer.from(await encodeWav({ numberOfChannels: 1, length: 44100, sampleRate: 44100, getChannelData: () => samples }).arrayBuffer());
const endpoint = 'https://api.fish.audio/v1/tts';
async function fill(page) {
  await page.goto('/');
  await page.getByLabel('Fish Audio API 키', { exact: true }).fill('test-key-not-real');
  await page.getByLabel('음성으로 만들 텍스트').fill('테스트 대본입니다.');
}
async function success(page) {
  await page.route(endpoint, route => route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }));
  await fill(page);
  await page.getByRole('button', { name: '음성 생성하기' }).click();
  await expect(page.locator('#status')).toContainText('음성이 완성되었습니다');
}

test('direct request, playback, original download and actual 48 kHz PCM export', async ({ page }) => {
  let request;
  await page.route(endpoint, route => { request = route.request(); return route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }); });
  await fill(page);
  await page.getByRole('button', { name: '음성 생성하기' }).click();
  await expect(page.locator('#status')).toContainText('음성이 완성되었습니다');
  expect(request.headers().authorization).toBe('Bearer test-key-not-real');
  expect(request.headers().model).toBe('s2.1-pro');
  expect(request.postDataJSON().text).toBe('테스트 대본입니다.');
  expect(request.postDataJSON().sample_rate).toBe(44100);
  await expect(page.locator('#player')).toBeVisible();
  const playback = await page.locator('#player').evaluate(async audio => { await audio.play(); return !audio.paused && audio.duration; });
  expect(playback).toBeCloseTo(1, 1);
  const originalDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '음성 다운로드', exact: true }).click();
  const original = await readFile(await (await originalDownload).path());
  expect(original.equals(wav)).toBeTruthy();
  const exportDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Final Cut용 WAV 저장', exact: true }).click();
  const exported = await readFile(await (await exportDownload).path());
  expect(exported.readUInt32LE(24)).toBe(48000);
  expect(exported.readUInt16LE(34)).toBe(16);
  expect(exported.readUInt16LE(22)).toBe(1);
  expect(exported.readUInt32LE(40)).toBe(48000 * 2);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  await page.screenshot({ path: 'test-results/desktop-complete.png', fullPage: true });
  await page.reload();
  await expect(page.locator('#api-key')).toHaveValue('');
  await expect(page.locator('#audio-result')).toBeHidden();
});

test('clipboard copies audio bytes, and permission errors are explicit', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: async items => {
      const item = items[0];
      const type = item.types[0];
      const blob = await item.getType(type);
      window.copied = { type, size: blob.size, bytes: Array.from(new Uint8Array(await blob.arrayBuffer()).slice(0, 12)) };
    } });
  });
  await success(page);
  await page.getByRole('button', { name: '음성 데이터 복사', exact: true }).click();
  await expect(page.locator('#status')).toContainText('음성 데이터를 복사했습니다');
  const copied = await page.evaluate(() => window.copied);
  expect(copied.type).toBe('web audio/wav');
  expect(copied.size).toBe(wav.length);
  expect(copied.bytes).toEqual([...wav.subarray(0, 12)]);
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: async () => { throw new DOMException('Denied', 'NotAllowedError'); } }); });
  await page.getByRole('button', { name: '음성 데이터 복사', exact: true }).click();
  await expect(page.locator('#status')).toContainText('권한이 거부');
});

test('real Chromium clipboard round-trips the WAV binary', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await success(page);
  await page.getByRole('button', { name: '음성 데이터 복사', exact: true }).click();
  await expect(page.locator('#status')).toContainText('음성 데이터를 복사했습니다');
  const copy = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const blob = await item.getType('web audio/wav');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return { size: bytes.length, hash: Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('') };
  });
  const { createHash } = await import('node:crypto');
  expect(copy).toEqual({ size: wav.length, hash: createHash('sha256').update(wav).digest('hex') });
});

test('Base64 fallback contains the audio, and never claims Final Cut paste works', async ({ page }) => {
  await page.addInitScript(() => {
    ClipboardItem.supports = () => false;
    Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: async items => {
      window.copiedText = await (await items[0].getType('text/plain')).text();
    } });
  });
  await success(page);
  await page.getByRole('button', { name: '음성 데이터 복사', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Base64 데이터 URL 텍스트');
  const data = await page.evaluate(() => window.copiedText);
  expect(data.startsWith('data:audio/wav;base64,')).toBeTruthy();
  expect(Buffer.from(data.split(',')[1], 'base64').equals(wav)).toBeTruthy();
});

test('HTTP errors and CORS failures preserve the prior playable result', async ({ page }) => {
  await success(page);
  const originalSrc = await page.locator('#player').getAttribute('src');
  await page.route(endpoint, route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"secret-key-should-not-appear"}' }));
  await page.getByRole('button', { name: '음성 생성하기' }).click();
  await expect(page.locator('#status')).toContainText('API 키가 유효하지');
  await expect(page.locator('#status')).not.toContainText('secret-key');
  expect(await page.locator('#player').getAttribute('src')).toBe(originalSrc);
  await page.route(endpoint, route => route.abort('failed'));
  await page.getByRole('button', { name: '음성 생성하기' }).click();
  await expect(page.locator('#status')).toContainText('CORS');
  await expect(page.getByRole('button', { name: '음성 다운로드', exact: true })).toBeEnabled();
});

test('cancellation restores controls and allows a later request', async ({ page }) => {
  await page.route(endpoint, async route => { await new Promise(resolve => setTimeout(resolve, 1200)); await route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }).catch(() => {}); });
  await fill(page);
  await page.getByRole('button', { name: '음성 생성하기' }).click();
  await page.getByRole('button', { name: '생성 취소', exact: true }).click();
  await expect(page.locator('#status')).toContainText('생성을 취소');
  await expect(page.getByRole('button', { name: '음성 생성하기' })).toBeEnabled();
  await expect(page.locator('#player')).toBeHidden();
  await page.unroute(endpoint);
  await page.route(endpoint, route => route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }));
  await page.getByRole('button', { name: '음성 생성하기' }).click();
  await expect(page.locator('#status')).toContainText('음성이 완성');
});

test('empty text is prevented; layout and installation dialog work on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let calls = 0;
  await page.route(endpoint, route => { calls++; return route.abort(); });
  await page.goto('/');
  await page.getByRole('button', { name: '음성 생성하기' }).click();
  expect(calls).toBe(0);
  await page.getByRole('button', { name: '예시 넣기' }).click();
  await expect(page.getByRole('button', { name: '예시 넣기' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await page.getByRole('button', { name: '설치 안내' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('optional agent tool stages text through the same state, rejects bad input, never generates', async ({ page }) => {
  await page.addInitScript(() => { document.modelContext = { registerTool(tool) { window.stagedTool = tool; } }; });
  await page.goto('/');
  const output = await page.evaluate(() => window.stagedTool.execute({ text: '에이전트가 입력한 대본' }));
  expect(output).toEqual({ staged: true, characters: 12, generated: false });
  await expect(page.locator('#script')).toHaveValue('에이전트가 입력한 대본');
  const error = await page.evaluate(() => { try { window.stagedTool.execute({ text: ' ', apiKey: 'not-allowed' }); } catch (e) { return e.message; } });
  expect(error).toContain('10,000자');
  await expect(page.locator('#script')).toHaveValue('에이전트가 입력한 대본');
});
