-- Reference data only. Canonical restaurants are populated by a real crawler
-- or an explicit data-import job, never by database initialization.
INSERT INTO data_source (code, name, base_url)
VALUES ('google_maps_playwright', 'Google Maps (Playwright)', 'https://www.google.com/maps')
ON CONFLICT (code) DO NOTHING;

INSERT INTO category (name, slug, description)
VALUES
  ('Vietnamese', 'vietnamese', 'Vietnamese cuisine'),
  ('Coffee Shop', 'coffee-shop', 'Coffee, tea and light refreshments'),
  ('Vegetarian', 'vegetarian', 'Vegetarian food and beverages'),
  ('Noodle', 'noodle', 'Noodle-focused dishes'),
  ('Dessert', 'dessert', 'Sweet dishes and desserts'),
  ('Bún', 'bun', 'Bún and Vietnamese rice vermicelli dishes'),
  ('Cơm', 'rice', 'Rice dishes and everyday meals'),
  ('Ăn vặt', 'snack', 'Street snacks and small bites'),
  ('Đồ uống', 'beverage', 'Drinks, tea and refreshments')
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name, description = EXCLUDED.description;
