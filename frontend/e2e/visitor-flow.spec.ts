import { expect, test } from "@playwright/test";

const restaurant = {
  id: "restaurant-1",
  name: "Test Kitchen",
  location: { formattedAddress: "District 1", latitude: 10.77, longitude: 106.7 },
  categories: [{ slug: "noodles", name: "Noodles" }],
  rating: 4.8,
  reviewCount: 120,
  coverImageUrl: null,
  sourceUrl: "https://maps.google.com/?q=test-kitchen",
  distanceMeters: null,
};

async function mockPublicApi(page: import("@playwright/test").Page, options: { recommendations?: unknown[]; recommendationStatus?: number } = {}) {
  await page.route("**/api/v1/auth/me", async (route) => route.fulfill({ status: 401, json: { error: { message: "Unauthenticated" } } }));
  await page.route("**/api/v1/recommendations", async (route) => route.fulfill({ status: options.recommendationStatus ?? 200, json: { data: options.recommendations ?? [{ restaurant, explanation: "A good match" }] } }));
  await page.route("**/api/v1/dishes?*", async (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/search/interpret", async (route) => route.fulfill({ json: { data: { query: "hot soup", filters: { attributes: [], category: undefined, district: undefined } } } }));
  await page.route("**/api/v1/restaurants/restaurant-1", async (route) => route.fulfill({ json: { data: { ...restaurant, description: "A test restaurant", phone: null, websiteUrl: null, openingHours: [], dishes: [], images: [], reviews: [] } } }));
  await page.route("**/api/v1/restaurants/restaurant-1/similar*", async (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/restaurants?*", async (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/auth/reset-password", async (route) => route.fulfill({ json: { data: { reset: true } } }));
}

test("visitor can ask for a recommendation and open restaurant detail", async ({ page }) => {
  await mockPublicApi(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Hôm nay bạn/ })).toBeVisible();
  await page.getByPlaceholder(/Hôm nay bạn thèm gì/).fill("hot soup");
  await page.getByRole("button", { name: "Gửi câu hỏi" }).click();

  await expect(page.getByText("Test Kitchen").first()).toBeVisible();
  await page.getByRole("link", { name: "Xem chi tiết" }).first().click();
  await expect(page).toHaveURL(/\/restaurants\/restaurant-1$/);
  await expect(page.getByRole("heading", { name: "Test Kitchen" })).toBeVisible();
});

test("visitor sees a useful empty state and can start again", async ({ page }) => {
  await mockPublicApi(page, { recommendations: [] });
  await page.goto("/");

  await page.getByPlaceholder(/Hôm nay bạn thèm gì/).fill("unknown dish");
  await page.getByRole("button", { name: "Gửi câu hỏi" }).click();

  await expect(page.getByText(/Không có quán nào khớp bộ lọc hiện tại/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Hôm nay bạn/ })).not.toBeVisible();
  await page.getByRole("button", { name: /Bắt đầu lại/ }).click();
  await expect(page.getByRole("heading", { name: /Hôm nay bạn/ })).toBeVisible();
  await expect(page.getByPlaceholder(/Hôm nay bạn thèm gì/)).toHaveValue("");
});

test("visitor sees a backend error state without a broken results layout", async ({ page }) => {
  await mockPublicApi(page, { recommendationStatus: 500 });
  await page.goto("/");

  await page.getByPlaceholder(/Hôm nay bạn thèm gì/).fill("backend failure");
  await page.getByRole("button", { name: "Gửi câu hỏi" }).click();

  await expect(page.getByText(/Dịch vụ gợi ý đang không phản hồi/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Bắt đầu lại/ })).toBeVisible();
});

test("visitor can explore inspiration cards and hand the prompt to Bếp", async ({ page }) => {
  await page.route("**/api/v1/auth/me", async (route) => route.fulfill({ status: 401, json: { error: { message: "Unauthenticated" } } }));
  await page.route("**/api/v1/recommendations", async (route) => route.fulfill({ json: { data: [{ restaurant, explanation: "A good match" }] } }));
  await page.route("**/api/v1/categories", async (route) => route.fulfill({ json: { data: [{ slug: "noodles", name: "Noodles", description: null, parentSlug: null, restaurantCount: 4 }] } }));
  await page.route("**/api/v1/restaurants?*", async (route) => route.fulfill({ json: { data: [restaurant] } }));
  await page.route("**/api/v1/dishes?*", async (route) => route.fulfill({ json: { data: [] } }));

  await page.goto("/search");
  await expect(page.getByRole("heading", { name: /Hôm nay bạn muốn/ })).toBeVisible();
  await expect(page.getByText("Khám phá theo ẩm thực")).toBeVisible();
  await page.getByRole("link", { name: /Hỏi Bếp ngay/ }).first().click();
  await expect(page).toHaveURL(/\/?prompt=/);
  await expect(page.getByText("Quán gợi ý").first()).toBeVisible();
  await expect(page.getByPlaceholder(/Hôm nay bạn thèm gì/)).toBeVisible();
});

test("visitor can navigate between discovery routes", async ({ page }) => {
  await page.route("**/api/v1/auth/me", async (route) => route.fulfill({ status: 401, json: { error: { message: "Unauthenticated" } } }));
  await page.route("**/api/v1/restaurants?*", async (route) => route.fulfill({ json: { data: [restaurant] } }));
  await page.route("**/api/v1/dishes?*", async (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/categories", async (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/map*", async (route) => route.fulfill({ json: { data: [] } }));
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: 10.77, longitude: 106.7 });

  await page.goto("/");
  await page.getByRole("link", { name: "Khám phá" }).first().click();
  await expect(page).toHaveURL(/\/discover$/);
  await expect(page.getByRole("heading", { name: /Những quán thành phố/ })).toBeVisible();

  await page.getByRole("link", { name: "Bản đồ" }).first().click();
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByRole("heading", { name: "Những quán gần bạn" })).toBeVisible();
  await expect(page.getByText("BẢN ĐỒ QUÁN ĂN")).toBeVisible();
});

test("legacy search links still land on Explore", async ({ page }) => {
  await page.route("**/api/v1/auth/me", async (route) => route.fulfill({ status: 401, json: { error: { message: "Unauthenticated" } } }));
  await page.route("**/api/v1/categories", async (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/restaurants?*", async (route) => route.fulfill({ json: { data: [] } }));

  await page.goto("/search?q=noodles&category=noodles");
  await expect(page.getByRole("heading", { name: /Hôm nay bạn muốn/ })).toBeVisible();
  await expect(page.getByText("Khám phá theo cảm hứng")).toBeVisible();
});

test("visitor sees the saved-place sign-in state", async ({ page }) => {
  await page.route("**/api/v1/auth/me", async (route) => route.fulfill({ status: 401, json: { error: { message: "Unauthenticated" } } }));

  await page.goto("/saved");
  await expect(page.getByRole("heading", { name: "Đã lưu" })).toBeVisible();
  await expect(page.getByText("Lưu lại để ăn sau")).toBeVisible();
  await page.getByRole("link", { name: "Đăng nhập" }).last().click();
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByRole("heading", { name: "Chào bạn trở lại" })).toBeVisible();
});

test("visitor is sent to auth when trying to save a restaurant", async ({ page }) => {
  await mockPublicApi(page);
  await page.goto("/restaurants/restaurant-1");

  await expect(page.getByRole("heading", { name: "Test Kitchen" })).toBeVisible();
  await page.getByRole("button", { name: "Lưu quán" }).click();
  await expect(page).toHaveURL(/\/auth\?returnTo=%2Frestaurants%2Frestaurant-1$/);

  await expect(page.getByRole("heading", { name: "Chào bạn trở lại" })).toBeVisible();
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByText(/Nhập email của bạn/)).toBeVisible();
});

test("authenticated visitor can save a restaurant without leaving the detail page", async ({ page }) => {
  await page.route("**/api/v1/auth/me", async (route) => route.fulfill({ json: { user: { id: "user-1", email: "user@example.com", displayName: "Test User" } } }));
  await page.route("**/api/v1/restaurants/restaurant-1", async (route) => route.fulfill({ json: { data: { ...restaurant, description: "A test restaurant", phone: null, websiteUrl: null, openingHours: [], dishes: [], images: [], reviews: [] } } }));
  await page.route("**/api/v1/restaurants/restaurant-1/similar*", async (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/saved/restaurant-1", async (route) => {
    if (route.request().method() === "POST") return route.fulfill({ json: { data: { saved: true } } });
    return route.fulfill({ json: { data: { saved: false } } });
  });

  await page.goto("/restaurants/restaurant-1");
  const saveButton = page.getByRole("button", { name: "Lưu quán" });
  await expect(saveButton).toBeVisible();
  await saveButton.click();

  const savedButton = page.getByRole("button", { name: "Bỏ lưu quán" });
  await expect(savedButton).toBeVisible();
  await expect(savedButton).toContainText("Đã lưu");
  await expect(page).toHaveURL(/\/restaurants\/restaurant-1$/);
});

test("restaurant detail shows related places returned by the similar endpoint", async ({ page }) => {
  const relatedRestaurant = {
    ...restaurant,
    id: "restaurant-2",
    name: "Noodle House",
    location: { formattedAddress: "District 1", latitude: 10.771, longitude: 106.701 },
    categories: [{ slug: "noodles", name: "Noodles" }],
  };
  let similarRequestCount = 0;

  await page.route("**/api/v1/auth/me", async (route) => route.fulfill({ status: 401, json: { error: { message: "Unauthenticated" } } }));
  await page.route("**/api/v1/restaurants/restaurant-1", async (route) => route.fulfill({ json: { data: { ...restaurant, description: "A test restaurant", phone: null, websiteUrl: null, openingHours: [], dishes: [], images: [], reviews: [] } } }));
  await page.route("**/api/v1/restaurants/restaurant-1/similar*", async (route) => {
    similarRequestCount += 1;
    await route.fulfill({ json: { data: [relatedRestaurant] } });
  });

  await page.goto("/restaurants/restaurant-1");

  await expect(page.getByRole("heading", { name: "Quán tương tự" })).toBeVisible();
  await expect(page.getByText("Noodle House").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Test Kitchen" })).toHaveCount(1);
  expect(similarRequestCount).toBe(1);
});

test("visitor can switch to signup and sees password confirmation validation", async ({ page }) => {
  await mockPublicApi(page);
  await page.goto("/auth");

  await page.getByRole("button", { name: "Đăng ký" }).click();
  await expect(page.getByRole("heading", { name: "Tạo tài khoản Bếp" })).toBeVisible();
  await page.getByLabel("Email").fill("visitor@example.com");
  await page.getByRole("textbox", { name: "Mật khẩu", exact: true }).fill("secret1");
  await page.getByLabel("Xác nhận mật khẩu").fill("secret2");
  await page.getByRole("button", { name: "Đăng ký" }).click();

  await expect(page.getByText(/Mật khẩu xác nhận không khớp/)).toBeVisible();
});

test("visitor can switch to forgot password and sees email validation", async ({ page }) => {
  await mockPublicApi(page);
  await page.goto("/auth");

  await page.getByRole("button", { name: "Quên mật khẩu?" }).click();
  await expect(page.getByRole("heading", { name: "Quên mật khẩu" })).toBeVisible();
  await page.getByRole("button", { name: "Gửi liên kết" }).click();

  await expect(page.getByText(/Nhập email của bạn/)).toBeVisible();
});

test("visitor can reset a password with a valid reset token", async ({ page }) => {
  await mockPublicApi(page);
  await page.goto("/auth?resetToken=reset-token-123");

  await expect(page.getByRole("heading", { name: "Đặt mật khẩu mới" })).toBeVisible();
  await page.getByRole("textbox", { name: "Mật khẩu", exact: true }).fill("secret1");
  await page.getByLabel("Xác nhận mật khẩu").fill("secret2");
  await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
  await expect(page.getByText(/Mật khẩu xác nhận không khớp/)).toBeVisible();

  await page.getByLabel("Xác nhận mật khẩu").fill("secret1");
  await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
  await expect(page.getByText("Mật khẩu đã được cập nhật")).toBeVisible();
});