import { test, expect } from '@playwright/test';

const key = 'fishcon:studio:v1';

test('API key, voice settings and script survive reopening, with restored labels and a masked key', async ({ page, context }) => {
  await page.goto('/');
  await page.locator('#api-key').fill('saved-test-key');
  await page.locator('#model').selectOption('s2-pro');
  await page.locator('#voice-id').fill('voice-for-test');
  await page.locator('#speed').fill('1.35');
  await page.locator('#format').selectOption('mp3');
  await page.locator('#script').fill('다시 열어도 남는 대본');
  await page.getByRole('button', { name: 'API 키 표시', exact: true }).click();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).toEqual({
    apiKey: 'saved-test-key', model: 's2-pro', referenceId: 'voice-for-test', speed: 1.35, format: 'mp3', text: '다시 열어도 남는 대본',
  });
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/');
  await expect(reopened.locator('#api-key')).toHaveValue('saved-test-key');
  await expect(reopened.locator('#api-key')).toHaveAttribute('type', 'password');
  await expect(reopened.locator('#model')).toHaveValue('s2-pro');
  await expect(reopened.locator('#voice-id')).toHaveValue('voice-for-test');
  await expect(reopened.locator('#speed')).toHaveValue('1.35');
  await expect(reopened.locator('#speed-value')).toHaveText('1.35×');
  await expect(reopened.locator('#format')).toHaveValue('mp3');
  await expect(reopened.locator('#format-help')).toContainText('192 kbps');
  await expect(reopened.locator('#script')).toHaveValue('다시 열어도 남는 대본');
  await expect(reopened.locator('#character-count')).toHaveText('12');
  await expect(reopened.locator('#insert-example')).toBeDisabled();
  await expect(reopened.locator('#storage-status')).toContainText('불러왔습니다');
});

test('clear removes only Fishcon settings and restores the defaults without resaving on exit', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('another-app', 'leave this alone'));
  await page.locator('#api-key').fill('key-to-clear');
  await page.locator('#model').selectOption('s1');
  await page.locator('#speed').fill('1.5');
  await page.locator('#format').selectOption('mp3');
  await page.locator('#voice-id').fill('voice-to-clear');
  await page.getByRole('button', { name: '예시 넣기', exact: true }).click();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).text.length, key)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '저장된 설정 삭제', exact: true }).click();
  await expect(page.locator('#storage-status')).toContainText('삭제했습니다');
  await page.reload();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('another-app'))).toBe('leave this alone');
  await expect(page.locator('#api-key')).toHaveValue('');
  await expect(page.locator('#voice-id')).toHaveValue('');
  await expect(page.locator('#model')).toHaveValue('s2.1-pro');
  await expect(page.locator('#speed')).toHaveValue('1');
  await expect(page.locator('#speed-value')).toHaveText('1.00×');
  await expect(page.locator('#format')).toHaveValue('wav');
  await expect(page.locator('#format-help')).toContainText('16-bit PCM');
  await expect(page.locator('#script')).toHaveValue('');
});

test('corrupt settings and unsupported saved values do not break the form', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(key => localStorage.setItem(key, '{broken'), key);
  await page.reload();
  await expect(page.locator('#storage-status')).toContainText('불러오지 못했습니다');
  await page.locator('#api-key').fill('valid-new-key');
  await expect(page.locator('#storage-status')).toContainText('저장했습니다');
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ apiKey: 42, referenceId: {}, model: 'no-such-model', format: 'invalid', speed: 9, text: 'valid saved text' })), key);
  await page.reload();
  await expect(page.locator('#api-key')).toHaveValue('');
  await expect(page.locator('#model')).toHaveValue('s2.1-pro');
  await expect(page.locator('#format')).toHaveValue('wav');
  await expect(page.locator('#speed')).toHaveValue('1');
  await expect(page.locator('#script')).toHaveValue('valid saved text');
});

test('blocked browser storage is reported while text entry remains usable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#storage-status')).toContainText('불러오지 못했습니다');
  await page.locator('#script').fill('저장 없이도 입력');
  await expect(page.locator('#storage-status')).toContainText('저장하지 못했습니다');
  await expect(page.locator('#script')).toHaveValue('저장 없이도 입력');
  await page.getByRole('button', { name: '저장된 설정 삭제', exact: true }).click();
  await expect(page.locator('#storage-status')).toContainText('삭제하지 못했습니다');
  expect(errors).toEqual([]);
});
