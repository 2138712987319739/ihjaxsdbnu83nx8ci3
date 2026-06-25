import { expect, test } from '@playwright/test';

test('loads dashboard, renders controls, and draws the scene', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Fracture MC FriendConnect/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Main/ })).toBeVisible();
  await expect(page.getByText(/Current players/)).toBeVisible();

  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const dataUrlLength = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL('image/png').length);
  expect(dataUrlLength).toBeGreaterThan(1000);
});

test('shows developer tabs and safe fix controls', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Developer/ }).click();
  await expect(page.getByRole('tab', { name: 'Console' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Fixes' })).toBeVisible();
  await page.getByRole('tab', { name: 'Fixes' }).click();
  await expect(page.getByRole('button', { name: /run diagnostics/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Security' }).click();
  await expect(page.getByRole('button', { name: /enable lockdown/ })).toBeVisible();
  await expect(page.getByPlaceholder('XUID')).toBeVisible();
  await page.getByRole('tab', { name: 'Admin Users' }).click();
  await expect(page.getByText('Invite Admin')).toBeVisible();
  await expect(page.getByPlaceholder('operator@fracturemc.com')).toBeVisible();
});
