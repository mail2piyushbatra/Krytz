import { test, expect } from '@playwright/test';

test('has title and can navigate to login', async ({ page }) => {
  await page.goto('/');

  // Should redirect to auth or show landing page
  await expect(page).toHaveTitle(/Krytz/);
  
  // Wait for the auth form to appear since we are not logged in
  const emailInput = page.getByPlaceholder(/Email/i);
  await expect(emailInput).toBeVisible();

  // We won't log in here because the backend DB would need a valid user,
  // but we can verify the UI renders and the basic PWA shell loads.
  await expect(page.getByRole('button', { name: /Sign In/i })).toBeVisible();
});
