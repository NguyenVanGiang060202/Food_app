-- Menu-image extraction is kept separate from canonical dishes so every
-- claimed menu item remains auditable against the original restaurant image.

BEGIN;

CREATE TABLE IF NOT EXISTS menu_image_extraction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_image_id uuid NOT NULL REFERENCES restaurant_image(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  model text,
  confidence numeric(4,3),
  raw_ocr_text text,
  error_message text,
  extracted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_image_extraction_status_chk
    CHECK (status IN ('pending', 'completed', 'not_menu', 'failed')),
  CONSTRAINT menu_image_extraction_confidence_chk
    CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  UNIQUE (restaurant_image_id)
);

CREATE TABLE IF NOT EXISTS dish_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id uuid NOT NULL REFERENCES dish(id) ON DELETE CASCADE,
  restaurant_image_id uuid REFERENCES restaurant_image(id) ON DELETE CASCADE,
  evidence_type text NOT NULL,
  raw_name text,
  raw_price text,
  confidence numeric(4,3) NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dish_evidence_type_chk CHECK (evidence_type IN ('menu_image')),
  CONSTRAINT dish_evidence_confidence_chk CHECK (confidence BETWEEN 0 AND 1),
  UNIQUE (dish_id, restaurant_image_id, evidence_type)
);

CREATE INDEX IF NOT EXISTS menu_image_extraction_status_idx
  ON menu_image_extraction (status, extracted_at DESC);
CREATE INDEX IF NOT EXISTS dish_evidence_dish_type_idx
  ON dish_evidence (dish_id, evidence_type);

COMMENT ON TABLE menu_image_extraction IS
  'Vision/OCR result for one restaurant image. A completed row means the image was identified as a menu.';
COMMENT ON TABLE dish_evidence IS
  'Auditable source evidence for a dish. Menu-image evidence is suitable for hard dish retrieval.';

COMMIT;
