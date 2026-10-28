import { Pool } from 'pg';
import { isProgressiveHallucination } from '../enrichment/menu-image-extractor';

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const rows = await pool.query<{ extraction_id: string; restaurant_image_id: string; raw_ocr_text: string | null }>(
      `SELECT id AS extraction_id, restaurant_image_id, raw_ocr_text
       FROM menu_image_extraction
       WHERE status = 'completed' AND model LIKE 'minicpm-v%'`,
    );
    let quarantined = 0;
    for (const row of rows.rows) {
      if (!isProgressiveHallucination(row.raw_ocr_text ?? '')) continue;
      await pool.query('BEGIN');
      try {
        await pool.query(
          `UPDATE menu_image_extraction
           SET status = 'not_menu', error_message = 'quarantined: progressive OCR hallucination', updated_at = now()
           WHERE id = $1`,
          [row.extraction_id],
        );
        await pool.query(
          `UPDATE dish d
           SET status = 'unavailable', confidence = LEAST(COALESCE(d.confidence, 0), 0.1)
           WHERE d.status = 'available'
             AND EXISTS (
               SELECT 1 FROM dish_evidence de
               WHERE de.dish_id = d.id AND de.restaurant_image_id = $1 AND de.evidence_type = 'menu_image'
             )
             AND NOT EXISTS (
               SELECT 1
               FROM dish_evidence clean_de
               JOIN menu_image_extraction clean_mie ON clean_mie.restaurant_image_id = clean_de.restaurant_image_id
               WHERE clean_de.dish_id = d.id AND clean_de.evidence_type = 'menu_image'
                 AND clean_mie.status = 'completed'
                 AND clean_mie.error_message IS DISTINCT FROM 'quarantined: progressive OCR hallucination'
                 AND COALESCE(clean_mie.raw_ocr_text, '') NOT ILIKE 'food_photo:%'
             )`,
          [row.restaurant_image_id],
        );
        await pool.query('COMMIT');
        quarantined += 1;
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    }
    console.log(JSON.stringify({ event: 'menu_ocr_quarantine_complete', scanned: rows.rowCount ?? 0, quarantined }));
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({ event: 'menu_ocr_quarantine_failed', message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
