import { expect, test } from '@playwright/test';

const restaurant = {
  id: 'restaurant-1',
  name: 'Test Kitchen',
  location: { formattedAddress: 'District 1', latitude: 10.77, longitude: 106.7 },
  categories: [{ slug: 'noodles', name: 'Noodles' }],
  rating: 4.8,
  reviewCount: 120,
  coverImageUrl: null,
  sourceUrl: 'https://maps.google.com/?q=test-kitchen',
  distanceMeters: null,
};

// AskPage renders a responsive layout: on mobile (< lg) the results list and
// chat are kept outside the view in interactive drawers/sheets instead of being
// shown side-by-side. Helpers pick the element that is actually visible for the
// active viewport (desktop vs mobile) and open the right drawer when needed.
const isMobileProject = () => test.info().project.name === 'mobile';

async function openResultsList(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Danh sách' }).click();
}

const pickVisible = (locator: ReturnType<import('@playwright/test').Page['getByText']>) =>
  isMobileProject() ? locator.last() : locator.first();

async function mockPublicApi(
  page: import('@playwright/test').Page,
  options: { recommendations?: unknown[]; recommendationStatus?: number } = {},
) {
  await page.route('**/api/v1/auth/me', async (route) =>
    route.fulfill({ status: 401, json: { error: { message: 'Unauthenticated' } } }),
  );
  await page.route('**/api/v1/recommendations', async (route) =>
    route.fulfill({
      status: options.recommendationStatus ?? 200,
      json: { data: options.recommendations ?? [{ restaurant, explanation: 'A good match' }] },
    }),
  );
  await page.route('**/api/v1/dishes?*', async (route) => route.fulfill({ json: { data: [] } }));
  await page.route('**/api/v1/search/interpret', async (route) =>
    route.fulfill({
      json: {
        data: {
          query: 'hot soup',
          filters: { attributes: [], category: undefined, district: undefined },
        },
      },
    }),
  );
  await page.route('**/api/v1/restaurants/restaurant-1', async (route) =>
    route.fulfill({
      json: {
        data: {
          ...restaurant,
          description: 'A test restaurant',
          phone: null,
          websiteUrl: null,
          openingHours: [],
          dishes: [],
          images: [],
          reviews: [],
        },
      },
    }),
  );
  await page.route('**/api/v1/restaurants/restaurant-1/similar*', async (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.route('**/api/v1/restaurants?*', async (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.route('**/api/v1/auth/reset-password', async (route) =>
    route.fulfill({ json: { data: { reset: true } } }),
  );
}

test('visitor can ask for a recommendation and open restaurant detail', async ({ page }) => {
  await mockPublicApi(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: /Bụng đang/ })).toBeVisible();
  await page.getByPlaceholder(/Bụng đang réo gì/).fill('hot soup');
  await page.getByRole('button', { name: 'Hỏi Bếp' }).click();

  if (isMobileProject()) await openResultsList(page);
  await expect(pickVisible(page.getByText('Test Kitchen'))).toBeVisible();
  await page.getByRole('link', { name: 'Xem chi tiết' }).first().click();
  await expect(page).toHaveURL(/\/restaurants\/restaurant-1$/);
  await expect(page.getByRole('heading', { name: 'Test Kitchen' })).toBeVisible();
});

test('visitor sees a useful empty state and can start again', async ({ page }) => {
  await mockPublicApi(page, { recommendations: [] });
  const mobile = isMobileProject();
  await page.goto('/');

  await page.getByPlaceholder(/Bụng đang réo gì/).fill('unknown dish');
  await page.getByRole('button', { name: 'Hỏi Bếp' }).click();

  if (mobile) await openResultsList(page);
  await expect(pickVisible(page.getByText(/Bếp chưa thấy quán hợp gu/))).toBeVisible();
  await expect(page.getByRole('heading', { name: /Bụng đang/ })).not.toBeVisible();

  if (mobile) {
    await page.getByRole('button', { name: 'Đóng danh sách' }).click();
    await page.getByRole('button', { name: /Bếp vừa trả lời|Bếp đang nấu/ }).click();
    await page.getByRole('button', { name: 'Bắt đầu lại' }).click();
  } else {
    await page.getByRole('button', { name: /Hỏi mẻ mới/ }).click();
  }

  await expect(page.getByRole('heading', { name: /Bụng đang/ })).toBeVisible();
  await expect(page.getByPlaceholder(/Bụng đang réo gì/)).toHaveValue('');
});

test('visitor sees a backend error state without a broken results layout', async ({ page }) => {
  await mockPublicApi(page, { recommendationStatus: 500 });
  const mobile = isMobileProject();
  await page.goto('/');

  await page.getByPlaceholder(/Bụng đang réo gì/).fill('backend failure');
  await page.getByRole('button', { name: 'Hỏi Bếp' }).click();

  if (mobile) await page.getByRole('button', { name: /Bếp vừa trả lời|Bếp đang nấu/ }).click();
  await expect(pickVisible(page.getByText(/Không thể kết nối với máy chủ/))).toBeVisible();
  if (mobile) {
    await expect(page.getByRole('button', { name: 'Bắt đầu lại' })).toBeVisible();
  } else {
    await expect(page.getByRole('button', { name: /Hỏi mẻ mới/ })).toBeVisible();
  }
});

test('visitor can explore inspiration cards and hand the prompt to Bếp', async ({ page }) => {
  await page.route('**/api/v1/auth/me', async (route) =>
    route.fulfill({ status: 401, json: { error: { message: 'Unauthenticated' } } }),
  );
  await page.route('**/api/v1/recommendations', async (route) =>
    route.fulfill({ json: { data: [{ restaurant, explanation: 'A good match' }] } }),
  );
  await page.route('**/api/v1/categories', async (route) =>
    route.fulfill({
      json: {
        data: [
          {
            slug: 'noodles',
            name: 'Noodles',
            description: null,
            parentSlug: null,
            restaurantCount: 4,
          },
        ],
      },
    }),
  );
  await page.route('**/api/v1/restaurants?*', async (route) =>
    route.fulfill({ json: { data: [restaurant] } }),
  );
  await page.route('**/api/v1/dishes?*', async (route) => route.fulfill({ json: { data: [] } }));

  await page.goto('/discover');
  await expect(page.getByRole('heading', { name: /Dạo món trước khi/ })).toBeVisible();
  await page
    .getByRole('link', { name: /Hỏi Bếp về nhóm Noodles/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/?prompt=/);
  if (isMobileProject()) {
    await openResultsList(page);
    await expect(pickVisible(page.getByText(/Quán hợp bụng/))).toBeVisible();
    await page.getByRole('button', { name: 'Đóng danh sách' }).click();
    await page.getByRole('button', { name: /Bếp vừa trả lời|Bếp đang nấu/ }).click();
    await expect(page.getByRole('textbox', { name: /Bụng đang réo gì/ })).toBeVisible();
  } else {
    await expect(pickVisible(page.getByText(/Quán hợp bụng/))).toBeVisible();
    await expect(page.getByPlaceholder(/Bụng đang réo gì/)).toBeVisible();
  }
});

test('visitor can navigate between discovery routes', async ({ page }) => {
  await page.route('**/api/v1/auth/me', async (route) =>
    route.fulfill({ status: 401, json: { error: { message: 'Unauthenticated' } } }),
  );
  await page.route('**/api/v1/restaurants?*', async (route) =>
    route.fulfill({ json: { data: [restaurant] } }),
  );
  await page.route('**/api/v1/dishes?*', async (route) => route.fulfill({ json: { data: [] } }));
  await page.route('**/api/v1/categories', async (route) => route.fulfill({ json: { data: [] } }));
  await page.route('**/api/v1/map*', async (route) => route.fulfill({ json: { data: [] } }));
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 10.77, longitude: 106.7 });

  await page.goto('/');
  await page.getByRole('link', { name: 'Dạo món' }).first().click();
  await expect(page).toHaveURL(/\/discover$/);
  await expect(page.getByRole('heading', { name: /Dạo món trước khi/ })).toBeVisible();

  await page.getByRole('link', { name: 'Quanh tôi' }).first().click();
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByRole('heading', { name: 'Quán quanh bạn' })).toBeVisible();
  await expect(page.getByText('BẢN ĐỒ KÈO ĂN')).toBeVisible();
});

test('legacy search links still land on Explore', async ({ page }) => {
  await page.route('**/api/v1/auth/me', async (route) =>
    route.fulfill({ status: 401, json: { error: { message: 'Unauthenticated' } } }),
  );
  await page.route('**/api/v1/categories', async (route) => route.fulfill({ json: { data: [] } }));
  await page.route('**/api/v1/restaurants?*', async (route) =>
    route.fulfill({ json: { data: [] } }),
  );

  await page.goto('/search?q=noodles&category=noodles');
  await expect(page.getByRole('heading', { name: 'Tìm kiếm' })).toBeVisible();
  await expect(page.getByText('Kết quả thật cho "noodles"')).toBeVisible();
});

test('visitor sees the saved-place sign-in state', async ({ page }) => {
  await page.route('**/api/v1/auth/me', async (route) =>
    route.fulfill({ status: 401, json: { error: { message: 'Unauthenticated' } } }),
  );

  await page.goto('/saved');
  await expect(page.getByRole('heading', { name: 'Cất quán cần có sổ gu' })).toBeVisible();
  await expect(page.getByText('Vào Bếp để lưu lại những quán muốn thử.')).toBeVisible();
  await page.getByRole('link', { name: 'Vào Bếp' }).last().click();
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByRole('heading', { name: 'Mở cửa vào Bếp' })).toBeVisible();
});

test('visitor is sent to auth when trying to save a restaurant', async ({ page }) => {
  await mockPublicApi(page);
  await page.goto('/restaurants/restaurant-1');

  await expect(page.getByRole('heading', { name: 'Test Kitchen' })).toBeVisible();
  await page.getByRole('button', { name: 'Cất quán' }).click();
  await expect(page).toHaveURL(/\/auth\?returnTo=%2Frestaurants%2Frestaurant-1$/);

  await expect(page.getByRole('heading', { name: 'Mở cửa vào Bếp' })).toBeVisible();
  await page.getByRole('button', { name: 'Vào Bếp' }).click();
  await expect(page.getByText(/Nhập email của bạn/)).toBeVisible();
});

test('authenticated visitor can save a restaurant without leaving the detail page', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/me', async (route) =>
    route.fulfill({
      json: { user: { id: 'user-1', email: 'user@example.com', displayName: 'Test User' } },
    }),
  );
  await page.route('**/api/v1/restaurants/restaurant-1', async (route) =>
    route.fulfill({
      json: {
        data: {
          ...restaurant,
          description: 'A test restaurant',
          phone: null,
          websiteUrl: null,
          openingHours: [],
          dishes: [],
          images: [],
          reviews: [],
        },
      },
    }),
  );
  await page.route('**/api/v1/restaurants/restaurant-1/similar*', async (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.route('**/api/v1/saved/restaurant-1', async (route) => {
    if (route.request().method() === 'POST')
      return route.fulfill({ json: { data: { saved: true } } });
    return route.fulfill({ json: { data: { saved: false } } });
  });

  await page.goto('/restaurants/restaurant-1');
  const saveButton = page.getByRole('button', { name: 'Cất quán' });
  await expect(saveButton).toBeVisible();
  await saveButton.click();

  const savedButton = page.getByRole('button', { name: 'Bỏ khỏi sổ quán' });
  await expect(savedButton).toBeVisible();
  await expect(savedButton).toContainText('Đã cất');
  await expect(page).toHaveURL(/\/restaurants\/restaurant-1$/);
});

test('restaurant detail renders a single loaded restaurant', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/me', async (route) =>
    route.fulfill({ status: 401, json: { error: { message: 'Unauthenticated' } } }),
  );
  await page.route('**/api/v1/restaurants/restaurant-1', async (route) =>
    route.fulfill({
      json: {
        data: {
          ...restaurant,
          description: 'A test restaurant',
          phone: null,
          websiteUrl: null,
          openingHours: [],
          dishes: [],
          images: [],
          reviews: [],
        },
      },
    }),
  );

  await page.goto('/restaurants/restaurant-1');

  await expect(page.getByRole('link', { name: 'Quay lại dạo món' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Test Kitchen' })).toHaveCount(1);
});

test('visitor can switch to signup and sees password confirmation validation', async ({ page }) => {
  await mockPublicApi(page);
  await page.goto('/auth');

  await page.getByRole('button', { name: 'Lập ngay' }).click();
  await expect(page.getByRole('heading', { name: 'Nhập hội mê ăn' })).toBeVisible();
  await page.getByLabel('Email').fill('visitor@example.com');
  await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill('secret1');
  await page.getByLabel('Xác nhận mật khẩu').fill('secret2');
  await page.getByRole('button', { name: 'Lập sổ gu' }).click();

  await expect(page.getByText(/Mật khẩu xác nhận không khớp/)).toBeVisible();
});

test('visitor can switch to forgot password and sees email validation', async ({ page }) => {
  await mockPublicApi(page);
  await page.goto('/auth');

  await page.getByRole('button', { name: 'Quên chìa khóa?' }).click();
  await expect(page.getByRole('heading', { name: 'Quên chìa khóa Bếp?' })).toBeVisible();
  await page.getByRole('button', { name: 'Gửi chìa khóa' }).click();

  await expect(page.getByText(/Nhập email của bạn/)).toBeVisible();
});

test('visitor can reset a password with a valid reset token', async ({ page }) => {
  await mockPublicApi(page);
  await page.goto('/auth?resetToken=reset-token-123');

  await expect(page.getByRole('heading', { name: 'Đổi chìa khóa mới' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill('secret1');
  await page.getByLabel('Xác nhận mật khẩu').fill('secret2');
  await page.getByRole('button', { name: 'Đổi chìa khóa' }).click();
  await expect(page.getByText(/Mật khẩu xác nhận không khớp/)).toBeVisible();

  await page.getByLabel('Xác nhận mật khẩu').fill('secret1');
  await page.getByRole('button', { name: 'Đổi chìa khóa' }).click();
  await expect(page.getByText('Chìa khóa mới đã sẵn sàng')).toBeVisible();
});
