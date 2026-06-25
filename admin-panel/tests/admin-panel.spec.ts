import { expect, test } from '@playwright/test';

test('locks the panel when Supabase is not configured', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Supabase Setup Required/ })).toBeVisible();
  await expect(page.getByText(/NEXT_PUBLIC_SUPABASE_URL/)).toBeVisible();
  await expect(page.getByText(/NEXT_PUBLIC_SUPABASE_ANON_KEY/)).toBeVisible();
});
