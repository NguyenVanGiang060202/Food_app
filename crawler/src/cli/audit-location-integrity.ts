import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Pool } from 'pg';

type LocationIssue = {
  id: string;
  name: string;
  district: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceFromDistrictMedianMeters: number | null;
  suggestedDistrict: string | null;
  distanceToSuggestedDistrictMeters: number | null;
  distanceToRecordedDistrictMeters: number | null;
  priority: 'P0' | 'P1' | 'P2';
  issue: string;
};

type SummaryRow = {
  active: number;
  with_coordinates: number;
  missing_district: number;
  outside_hcm_bounds: number;
  address_district_mismatch: number;
  coordinate_outliers: number;
  district_geo_conflicts: number;
};

// Approximate district reference points are used only to produce a review
// queue. They are deliberately not used to rewrite location records. The
// median heuristic catches local outliers; these references catch the more
// serious case where an entire imported batch was assigned to the wrong
// district (for example Cần Giờ records whose coordinates are in the inner
// city).
const DISTRICT_REFERENCE_VALUES = `
  ('Quận 1', 10.7757, 106.7004),
  ('Quận 2', 10.7870, 106.7490),
  ('Quận 3', 10.7830, 106.6840),
  ('Quận 4', 10.7610, 106.7050),
  ('Quận 5', 10.7550, 106.6670),
  ('Quận 6', 10.7460, 106.6350),
  ('Quận 7', 10.7330, 106.7220),
  ('Quận 8', 10.7250, 106.6770),
  ('Quận 9', 10.8300, 106.7900),
  ('Quận 10', 10.7730, 106.6670),
  ('Quận 11', 10.7630, 106.6480),
  ('Quận 12', 10.8620, 106.6500),
  ('Bình Tân', 10.7470, 106.6050),
  ('Bình Thạnh', 10.8120, 106.7080),
  ('Gò Vấp', 10.8380, 106.6650),
  ('Phú Nhuận', 10.7990, 106.6800),
  ('Tân Bình', 10.8020, 106.6500),
  ('Tân Phú', 10.7900, 106.6300),
  ('Thủ Đức', 10.8500, 106.7800),
  ('Hóc Môn', 10.8900, 106.5950),
  ('Củ Chi', 11.0200, 106.5100),
  ('Bình Chánh', 10.7000, 106.6000),
  ('Nhà Bè', 10.6800, 106.7300),
  ('Cần Giờ', 10.4100, 106.9500)
`;

const GEO_CONFLICT_SQL = `
  nearest_reference_distance IS NOT NULL
  AND recorded_reference_distance IS NOT NULL
  AND suggested_district IS NOT NULL
  AND suggested_district <> district
  AND nearest_reference_distance + 5000 < recorded_reference_distance
  AND recorded_reference_distance > CASE
    WHEN district IN ('Cần Giờ','Củ Chi','Hóc Môn','Bình Chánh','Nhà Bè') THEN 25000
    ELSE 12000
  END
`;

function parseOutput(argv: string[]): string {
  const index = argv.indexOf('--output');
  return resolve(index >= 0 && argv[index + 1] ? argv[index + 1] : 'tmp/location-integrity-audit.json');
}

async function main(): Promise<void> {
  const output = parseOutput(process.argv.slice(2));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // This is intentionally an audit-only command. It uses broad geographic
    // bounds plus a district-median distance heuristic to surface bad imports,
    // but it never rewrites a location without external evidence.
    const summary = await pool.query<SummaryRow>(`
      WITH active AS (
        SELECT r.id, l.district, l.formatted_address, l.coordinates,
               lower(unaccent(coalesce(l.district, ''))) AS district_norm,
               lower(unaccent(coalesce(l.formatted_address, ''))) AS address_norm
        FROM restaurant r
        JOIN location l ON l.id = r.location_id
        WHERE r.status = 'active'
      ), medians AS (
        SELECT district,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY ST_Y(coordinates::geometry)) AS median_lat,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY ST_X(coordinates::geometry)) AS median_lon
        FROM active
        WHERE coordinates IS NOT NULL AND district IS NOT NULL
        GROUP BY district
      ), scored AS (
        SELECT a.*,
               CASE WHEN a.coordinates IS NOT NULL AND m.median_lat IS NOT NULL
                    THEN ST_Distance(
                      a.coordinates,
                      ST_SetSRID(ST_MakePoint(m.median_lon, m.median_lat), 4326)::geography
                    )
                    ELSE NULL END AS median_distance
        FROM active a
        LEFT JOIN medians m ON m.district = a.district
      ), district_refs(district, latitude, longitude) AS (
        VALUES ${DISTRICT_REFERENCE_VALUES}
      ), reference_scored AS (
        SELECT s.*,
               nearest.district AS suggested_district,
               nearest.distance_meters AS nearest_reference_distance,
               recorded.distance_meters AS recorded_reference_distance
        FROM scored s
        LEFT JOIN LATERAL (
          SELECT ref.district,
                 ST_Distance(s.coordinates, ST_SetSRID(ST_MakePoint(ref.longitude, ref.latitude), 4326)::geography) AS distance_meters
          FROM district_refs ref
          WHERE s.coordinates IS NOT NULL
          ORDER BY s.coordinates <-> ST_SetSRID(ST_MakePoint(ref.longitude, ref.latitude), 4326)::geography
          LIMIT 1
        ) nearest ON true
        LEFT JOIN LATERAL (
          SELECT ST_Distance(s.coordinates, ST_SetSRID(ST_MakePoint(ref.longitude, ref.latitude), 4326)::geography) AS distance_meters
          FROM district_refs ref
          WHERE ref.district = s.district AND s.coordinates IS NOT NULL
          LIMIT 1
        ) recorded ON true
      ), scored_with_reference AS (
        SELECT * FROM reference_scored
      )
      SELECT
        count(*)::int AS active,
        count(*) FILTER (WHERE coordinates IS NOT NULL)::int AS with_coordinates,
        count(*) FILTER (WHERE district IS NULL OR trim(district) = '')::int AS missing_district,
        count(*) FILTER (WHERE coordinates IS NOT NULL AND (
          ST_Y(coordinates::geometry) < 10.25 OR ST_Y(coordinates::geometry) > 11.25 OR
          ST_X(coordinates::geometry) < 106.25 OR ST_X(coordinates::geometry) > 107.25
        ))::int AS outside_hcm_bounds,
        count(*) FILTER (WHERE district_norm LIKE 'quan %' AND address_norm ~ 'quan [0-9]+'
          AND address_norm !~ ('quan ' || regexp_replace(district_norm, '^quan ', '')))::int
          AS address_district_mismatch,
        count(*) FILTER (WHERE median_distance IS NOT NULL AND median_distance > CASE
          WHEN district IN ('Quận 1','Quận 2','Quận 3','Quận 4','Quận 5','Quận 6','Quận 7','Quận 8','Quận 9','Quận 10','Quận 11','Quận 12','Bình Tân','Bình Thạnh','Gò Vấp','Phú Nhuận','Tân Bình','Tân Phú') THEN 10000
          WHEN district = 'Thủ Đức' THEN 18000
          ELSE 30000
        END)::int AS coordinate_outliers,
        count(*) FILTER (WHERE ${GEO_CONFLICT_SQL})::int AS district_geo_conflicts
      FROM scored_with_reference
    `);

    const issues = await pool.query<LocationIssue>(`
      WITH active AS (
        SELECT r.id, r.name, l.district, l.formatted_address AS address, l.coordinates,
               lower(unaccent(coalesce(l.district, ''))) AS district_norm,
               lower(unaccent(coalesce(l.formatted_address, ''))) AS address_norm
        FROM restaurant r
        JOIN location l ON l.id = r.location_id
        WHERE r.status = 'active'
      ), medians AS (
        SELECT district,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY ST_Y(coordinates::geometry)) AS median_lat,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY ST_X(coordinates::geometry)) AS median_lon
        FROM active
        WHERE coordinates IS NOT NULL AND district IS NOT NULL
        GROUP BY district
      ), scored AS (
        SELECT a.*, CASE WHEN a.coordinates IS NOT NULL AND m.median_lat IS NOT NULL
          THEN ST_Distance(a.coordinates, ST_SetSRID(ST_MakePoint(m.median_lon, m.median_lat), 4326)::geography)
          ELSE NULL END AS median_distance
        FROM active a LEFT JOIN medians m ON m.district = a.district
      ), district_refs(district, latitude, longitude) AS (
        VALUES ${DISTRICT_REFERENCE_VALUES}
      ), reference_scored AS (
        SELECT s.*,
               nearest.district AS suggested_district,
               nearest.distance_meters AS nearest_reference_distance,
               recorded.distance_meters AS recorded_reference_distance
        FROM scored s
        LEFT JOIN LATERAL (
          SELECT ref.district,
                 ST_Distance(s.coordinates, ST_SetSRID(ST_MakePoint(ref.longitude, ref.latitude), 4326)::geography) AS distance_meters
          FROM district_refs ref
          WHERE s.coordinates IS NOT NULL
          ORDER BY s.coordinates <-> ST_SetSRID(ST_MakePoint(ref.longitude, ref.latitude), 4326)::geography
          LIMIT 1
        ) nearest ON true
        LEFT JOIN LATERAL (
          SELECT ST_Distance(s.coordinates, ST_SetSRID(ST_MakePoint(ref.longitude, ref.latitude), 4326)::geography) AS distance_meters
          FROM district_refs ref
          WHERE ref.district = s.district AND s.coordinates IS NOT NULL
          LIMIT 1
        ) recorded ON true
      )
      SELECT id, name, district, address,
             ST_Y(coordinates::geometry)::float8 AS latitude,
             ST_X(coordinates::geometry)::float8 AS longitude,
             median_distance::float8 AS "distanceFromDistrictMedianMeters",
             suggested_district AS "suggestedDistrict",
             nearest_reference_distance::float8 AS "distanceToSuggestedDistrictMeters",
             recorded_reference_distance::float8 AS "distanceToRecordedDistrictMeters",
             CASE
               WHEN coordinates IS NULL OR coordinates::geometry IS NULL THEN 'P0'
               WHEN ST_Y(coordinates::geometry) < 10.25 OR ST_Y(coordinates::geometry) > 11.25 OR
                    ST_X(coordinates::geometry) < 106.25 OR ST_X(coordinates::geometry) > 107.25 THEN 'P0'
               WHEN ${GEO_CONFLICT_SQL} THEN 'P0'
               WHEN district IS NULL OR trim(district) = '' THEN 'P1'
               ELSE 'P2'
             END AS priority,
             CASE
               WHEN coordinates IS NULL OR coordinates::geometry IS NULL THEN 'missing_coordinates'
               WHEN coordinates IS NOT NULL AND (
                 ST_Y(coordinates::geometry) < 10.25 OR ST_Y(coordinates::geometry) > 11.25 OR
                 ST_X(coordinates::geometry) < 106.25 OR ST_X(coordinates::geometry) > 107.25
               ) THEN 'outside_hcm_bounds'
               WHEN district_norm LIKE 'quan %' AND address_norm ~ 'quan [0-9]+'
                 AND address_norm !~ ('quan ' || regexp_replace(district_norm, '^quan ', '')) THEN 'address_district_mismatch'
               WHEN ${GEO_CONFLICT_SQL} THEN 'district_geo_conflict'
               WHEN median_distance IS NOT NULL AND median_distance > CASE
                 WHEN district IN ('Quận 1','Quận 2','Quận 3','Quận 4','Quận 5','Quận 6','Quận 7','Quận 8','Quận 9','Quận 10','Quận 11','Quận 12','Bình Tân','Bình Thạnh','Gò Vấp','Phú Nhuận','Tân Bình','Tân Phú') THEN 10000
                 WHEN district = 'Thủ Đức' THEN 18000
                 ELSE 30000
               END THEN 'coordinate_outlier'
               WHEN district IS NULL OR trim(district) = '' THEN 'missing_district'
               ELSE 'unknown'
             END AS issue
      FROM reference_scored
      WHERE coordinates IS NULL OR (
        ST_Y(coordinates::geometry) < 10.25 OR ST_Y(coordinates::geometry) > 11.25 OR
        ST_X(coordinates::geometry) < 106.25 OR ST_X(coordinates::geometry) > 107.25 OR
        (district_norm LIKE 'quan %' AND address_norm ~ 'quan [0-9]+'
          AND address_norm !~ ('quan ' || regexp_replace(district_norm, '^quan ', ''))) OR
        (median_distance IS NOT NULL AND median_distance > CASE
          WHEN district IN ('Quận 1','Quận 2','Quận 3','Quận 4','Quận 5','Quận 6','Quận 7','Quận 8','Quận 9','Quận 10','Quận 11','Quận 12','Bình Tân','Bình Thạnh','Gò Vấp','Phú Nhuận','Tân Bình','Tân Phú') THEN 10000
          WHEN district = 'Thủ Đức' THEN 18000
          ELSE 30000
        END) OR ${GEO_CONFLICT_SQL} OR district IS NULL OR trim(district) = ''
      )
      ORDER BY priority, issue, district NULLS LAST, name
      LIMIT 1000
    `);

    const report = {
      generatedAt: new Date().toISOString(),
      method: {
        hcmBounds: { minLatitude: 10.25, maxLatitude: 11.25, minLongitude: 106.25, maxLongitude: 107.25 },
        innerDistrictMedianThresholdMeters: 10000,
        ThuDucMedianThresholdMeters: 18000,
        outerDistrictMedianThresholdMeters: 30000,
        districtReferenceConflict: {
          innerDistrictMinimumRecordedDistanceMeters: 12000,
          outerDistrictMinimumRecordedDistanceMeters: 25000,
          nearestDistrictMustBeAtLeastMetersCloser: 5000,
          note: 'Reference points are only a triage heuristic; review before changing DB values.',
        },
        note: 'Audit only; no location records were modified.',
      },
      summary: summary.rows[0],
      issues: issues.rows,
    };
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ event: 'location_integrity_audit_complete', output, summary: report.summary, issueCount: report.issues.length }, null, 2));
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
