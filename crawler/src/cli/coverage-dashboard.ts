import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Pool } from 'pg';

const PORT = Number(process.env.COVERAGE_DASHBOARD_PORT ?? 8766);
const HOST = process.env.COVERAGE_DASHBOARD_HOST ?? '127.0.0.1';
const HISTORY_PATH = resolve(__dirname, '../../../tmp/coverage-dashboard-history.ndjson');
const HISTORY_INTERVAL_MS = 15 * 60 * 1000;
type CoverageSnapshot = { at: string; restaurants: number; dishes: number };
let history: CoverageSnapshot[] = [];
const bangkokDate = (at: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(at));
async function loadHistory(): Promise<void> {
  try {
    history = (await readFile(HISTORY_PATH, 'utf8')).split(/\r?\n/u).filter(Boolean).slice(-10000)
      .map((line) => JSON.parse(line) as CoverageSnapshot)
      .filter((row) => !Number.isNaN(Date.parse(row.at)) &&
        Number.isInteger(row.restaurants) && Number.isInteger(row.dishes));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
async function recordSnapshot(snapshot: CoverageSnapshot): Promise<void> {
  const previous = history.at(-1);
  if (previous && previous.restaurants === snapshot.restaurants &&
      previous.dishes === snapshot.dishes &&
      Date.parse(snapshot.at) - Date.parse(previous.at) < HISTORY_INTERVAL_MS) return;
  history.push(snapshot);
  await mkdir(dirname(HISTORY_PATH), { recursive: true });
  await appendFile(HISTORY_PATH, JSON.stringify(snapshot) + '\n', 'utf8');
}
const TARGETS = [
  ['phở bò', 'pho bo'],
  ['phở gà', 'pho ga'],
  ['bún bò Huế', 'bun bo hue'],
  ['bún riêu', 'bun rieu'],
  ['bún thịt nướng', 'bun thit nuong'],
  ['cơm tấm', 'com tam'],
  ['cơm gà', 'com ga'],
  ['hủ tiếu Nam Vang', 'hu tieu nam vang'],
  ['mì Quảng', 'mi quang'],
  ['lẩu bò', 'lau bo'],
  ['gà nướng', 'ga nuong'],
  ['bánh canh cua', 'banh canh cua'],
  ['bánh mì thịt', 'banh mi thit'],
  ['bánh xèo', 'banh xeo'],
  ['món chay', 'mon chay'],
  ['chè', 'che'],
] as const;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? process.env.POSTGRES_PORT ?? 5432),
  database: process.env.PGDATABASE ?? process.env.POSTGRES_DB ?? 'food_app',
  user: process.env.PGUSER ?? process.env.POSTGRES_USER ?? 'food_app',
  password: process.env.PGPASSWORD ?? process.env.POSTGRES_PASSWORD,
});
const execFileAsync = promisify(execFile);

const PAGE = `<!doctype html><html lang="vi"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Food coverage dashboard</title><style>
body{font:15px system-ui,sans-serif;background:#f7f7f5;color:#222;margin:0;padding:24px}
main{max-width:1100px;margin:auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px}
.card,section{background:white;border:1px solid #ddd;border-radius:12px;padding:16px;box-shadow:0 1px 3px #0000000d}
.value{font-size:28px;font-weight:700;margin-top:6px}.muted{color:#666;font-size:13px}h1{margin:0 0 4px}h2{font-size:18px;margin:0 0 12px}section{margin-top:18px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 7px;border-bottom:1px solid #eee}th{font-size:13px;color:#666}.bar{height:8px;background:#eee;border-radius:99px;overflow:hidden}.fill{height:100%;background:#287a55}.warn{color:#a25b00}.ok{color:#287a55}.error{color:#a22}.status{float:right}.small{font-size:12px}
</style></head><body><main><div class="status muted" id="status">Đang tải…</div>
<h1>Food coverage</h1><div class="muted">Dữ liệu local · Tự cập nhật mỗi 15 giây · Lưu mốc khi số liệu đổi hoặc mỗi 15 phút</div><div class="grid" id="cards"></div>
<section><h2>Thay đổi hôm nay</h2><div id="progressHint" class="muted"></div><table><thead><tr><th>Thời gian</th><th>Quán có menu</th><th>Món có menu</th><th>Thay đổi</th></tr></thead><tbody id="history"></tbody></table></section>
<section><h2>16 nhóm món ưu tiên</h2><div class="muted">Mốc 5 quán là mục tiêu theo dõi, không phải tỷ lệ mọi câu hỏi sẽ được trả lời. Dòng món chay tính menu xác minh tại quán thuộc nhóm Vegetarian; các dòng khác dựa vào tên món.</div><table><thead><tr><th>Món</th><th>Quán verified</th><th>Tên món verified</th><th>Mốc quán / 5</th></tr></thead><tbody id="targets"></tbody></table></section>
<section><h2>Category</h2><table><thead><tr><th>Category</th><th>Số quán</th></tr></thead><tbody id="categories"></tbody></table></section>
<section><h2>OCR / cache</h2><div id="pipeline" class="muted"></div></section>
<section><h2>Worker runtime</h2><div class="grid" id="workers"></div></section>
</main><script>
const fmt=n=>new Intl.NumberFormat('vi-VN').format(n??0);
const signed=n=>(n>0?'+':'')+fmt(n);
async function load(){try{const d=await fetch('/api/status',{cache:'no-store'}).then(r=>r.json());
document.querySelector('#status').textContent='Cập nhật: '+new Date(d.generatedAt).toLocaleString('vi-VN');
document.querySelector('#cards').innerHTML=[['Quán đang hoạt động',fmt(d.restaurants.active)],['Quán có menu xác minh',fmt(d.trusted.restaurants)],['Tỷ lệ quán có menu',((d.trusted.restaurants/d.restaurants.active)*100).toFixed(1)+'%'],['Món có menu xác minh',fmt(d.trusted.dishes)],['Tên món phân biệt',fmt(d.trusted.uniqueNames)],['Món thêm hôm nay',signed(d.progress.deltaDishes)]].map(x=>'<div class="card"><div class="muted">'+x[0]+'</div><div class="value">'+x[1]+'</div></div>').join('');
document.querySelector('#progressHint').textContent=d.progress.baseline?'So với mốc '+new Date(d.progress.baseline.at).toLocaleString('vi-VN')+': '+signed(d.progress.deltaRestaurants)+' quán, '+signed(d.progress.deltaDishes)+' món. Số có thể giảm khi loại bằng chứng sai.':'Đang ghi mốc ban đầu để theo dõi thay đổi.';
document.querySelector('#history').innerHTML=d.progress.recent.map((x,i,a)=>'<tr><td>'+new Date(x.at).toLocaleString('vi-VN')+'</td><td>'+fmt(x.restaurants)+'</td><td>'+fmt(x.dishes)+'</td><td>'+(i?signed(x.dishes-a[i-1].dishes):'Mốc đầu')+'</td></tr>').join('');
document.querySelector('#targets').innerHTML=d.targets.map(x=>{const pct=Math.min(100,x.restaurants/5*100);return '<tr><td>'+x.name+'</td><td>'+fmt(x.restaurants)+'</td><td>'+fmt(x.uniqueNames)+'</td><td><div class="bar"><div class="fill" style="width:'+pct+'%"></div></div><span class="small '+(x.restaurants>=5?'ok':'warn')+'">'+Math.round(pct)+'%</span></td></tr>'}).join('');
document.querySelector('#categories').innerHTML=d.categories.map(x=>'<tr><td>'+x.name+'</td><td>'+fmt(x.restaurants)+'</td></tr>').join('');
document.querySelector('#pipeline').textContent='Ảnh menu: '+fmt(d.images.menu)+' | Đã cache: '+fmt(d.images.cachedMenu)+' | Chờ cache: '+fmt(d.images.pendingCache)+' | Chờ OCR: '+fmt(d.images.pendingOcr)+' | OCR completed: '+fmt(d.ocr.completed)+' | not_menu: '+fmt(d.ocr.notMenu)+' | failed: '+fmt(d.ocr.failed);
document.querySelector('#workers').innerHTML=d.workers.map(x=>'<div class="card"><div class="muted">'+x.label+'</div><div class="value '+(x.running?'ok':'warn')+'">'+(x.running?'Đang chạy':'Đã dừng')+'</div><div class="small">Process: '+fmt(x.processes)+' | DB active: '+fmt(x.dbRuns)+' | Stale: '+fmt(x.staleRuns)+'</div></div>').join('');
}catch(e){document.querySelector('#status').textContent='Không kết nối được dashboard';}}
load();setInterval(load,15000);
</script></body></html>`;

async function status() {
  const [restaurants, dishes, trusted, targets, categories, images, ocr, crawlRuns] = await Promise.all([
    pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status='active')::int AS active FROM restaurant`),
    pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status='available')::int AS available, count(DISTINCT normalized_name)::int AS "uniqueNames", count(DISTINCT restaurant_id) FILTER (WHERE status='available')::int AS "restaurantsWithDishes" FROM dish`),
    pool.query(`SELECT count(DISTINCT d.restaurant_id)::int AS restaurants, count(DISTINCT d.normalized_name)::int AS "uniqueNames", count(DISTINCT d.id)::int AS dishes FROM dish d JOIN dish_evidence de ON de.dish_id=d.id AND de.evidence_type='menu_image' AND de.confidence >= .65 JOIN menu_image_extraction mie ON mie.restaurant_image_id=de.restaurant_image_id AND mie.status='completed' AND mie.model IN ('website:menu:v1','website:menu-image-curated:v1','google_maps:menu-curated:v1') WHERE d.status='available' AND d.source IN ('menu_image:curated','website:menu:v1') AND COALESCE(mie.raw_ocr_text,'') NOT ILIKE 'food_photo:%' AND COALESCE(mie.raw_ocr_text,'') NOT ILIKE '%dish_name%' AND COALESCE(mie.raw_ocr_text,'') NOT ILIKE '%price_vnd%'`),
    pool.query(`WITH trusted AS (SELECT DISTINCT d.restaurant_id,d.id,d.normalized_name,lower(unaccent(coalesce(cd.normalized_name,d.normalized_name))) AS canonical_name FROM dish d JOIN dish_evidence de ON de.dish_id=d.id AND de.evidence_type='menu_image' AND de.confidence >= .65 JOIN menu_image_extraction mie ON mie.restaurant_image_id=de.restaurant_image_id AND mie.status='completed' AND mie.model IN ('website:menu:v1','website:menu-image-curated:v1','google_maps:menu-curated:v1') LEFT JOIN canonical_dish cd ON cd.id=d.canonical_dish_id WHERE d.status='available' AND d.source IN ('menu_image:curated','website:menu:v1') AND COALESCE(mie.raw_ocr_text,'') NOT ILIKE 'food_photo:%' AND COALESCE(mie.raw_ocr_text,'') NOT ILIKE '%dish_name%' AND COALESCE(mie.raw_ocr_text,'') NOT ILIKE '%price_vnd%') SELECT t.name,t.normalized,count(DISTINCT trusted.restaurant_id)::int AS restaurants,count(DISTINCT trusted.normalized_name)::int AS "uniqueNames" FROM (VALUES ${TARGETS.map((_, i) => `($${i * 2 + 1}::text,$${i * 2 + 2}::text)`).join(',')}) AS t(name,normalized) LEFT JOIN trusted ON (trusted.canonical_name=t.normalized OR trusted.canonical_name LIKE t.normalized || ' %' OR lower(unaccent(trusted.normalized_name))=t.normalized OR lower(unaccent(trusted.normalized_name)) LIKE t.normalized || ' %' OR (t.normalized='mon chay' AND EXISTS (SELECT 1 FROM restaurant_category rc JOIN category c ON c.id=rc.category_id WHERE rc.restaurant_id=trusted.restaurant_id AND c.slug='vegetarian'))) GROUP BY t.name,t.normalized ORDER BY t.name`, TARGETS.flat()),
    pool.query(`SELECT c.name,count(DISTINCT rc.restaurant_id)::int AS restaurants FROM category c LEFT JOIN restaurant_category rc ON rc.category_id=c.id WHERE c.is_active GROUP BY c.id ORDER BY restaurants DESC,c.name`),
    pool.query(`SELECT count(*) FILTER (WHERE alt_text ILIKE '%menu%')::int AS menu,count(*) FILTER (WHERE alt_text ILIKE '%menu%' AND cached_object_key IS NOT NULL)::int AS "cachedMenu",count(*) FILTER (WHERE alt_text ILIKE '%menu%' AND cache_status='pending')::int AS "pendingCache",count(*) FILTER (WHERE alt_text ILIKE '%menu%' AND cached_object_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM menu_image_extraction m WHERE m.restaurant_image_id=restaurant_image.id))::int AS "pendingOcr" FROM restaurant_image`),
    pool.query(`SELECT count(*) FILTER (WHERE status='completed')::int AS completed,count(*) FILTER (WHERE status='not_menu')::int AS "notMenu",count(*) FILTER (WHERE status='failed')::int AS failed FROM menu_image_extraction`),
    pool.query(`SELECT count(*) FILTER (WHERE status='running' AND started_at >= now() - interval '30 minutes')::int AS running, count(*) FILTER (WHERE status='running' AND started_at < now() - interval '30 minutes')::int AS stale FROM crawl_run`),
  ]);
  const processSnapshot = await workerProcesses();
  const crawlDbRuns = Number(crawlRuns.rows[0]?.running ?? 0);
  const crawlStaleRuns = Number(crawlRuns.rows[0]?.stale ?? 0);
  const generatedAt = new Date().toISOString();
  const trustedRow = trusted.rows[0];
  await recordSnapshot({ at: generatedAt, restaurants: trustedRow.restaurants, dishes: trustedRow.dishes });
  const today = bangkokDate(generatedAt);
  const todayHistory = history.filter((row) => bangkokDate(row.at) === today);
  const baseline = todayHistory[0] ?? null;
  const recent = history.filter((row, index) => index === 0 ||
    row.restaurants !== history[index - 1].restaurants || row.dishes !== history[index - 1].dishes).slice(-8);
  return { generatedAt, restaurants: restaurants.rows[0], dishes: dishes.rows[0], trusted: trustedRow, targets: targets.rows, categories: categories.rows, images: images.rows[0], ocr: ocr.rows[0], progress: {
    baseline, deltaRestaurants: baseline ? trustedRow.restaurants - baseline.restaurants : 0,
    deltaDishes: baseline ? trustedRow.dishes - baseline.dishes : 0, recent,
  }, workers: [
    { label: 'Crawl Google Maps', running: processSnapshot.crawl, processes: processSnapshot.crawlCount, dbRuns: crawlDbRuns, staleRuns: crawlStaleRuns },
    { label: 'OCR menu / Ollama', running: processSnapshot.ocr, processes: processSnapshot.ocrCount, dbRuns: Number(images.rows[0]?.pendingOcr ?? 0), staleRuns: 0 },
    { label: 'Menu refresh', running: processSnapshot.menuRefresh, processes: processSnapshot.menuRefreshCount, dbRuns: 0, staleRuns: 0 },
    { label: 'Image cache', running: processSnapshot.cache, processes: processSnapshot.cacheCount, dbRuns: Number(images.rows[0]?.pendingCache ?? 0), staleRuns: 0 },
    { label: 'Profile / embedding sync', running: processSnapshot.profileSync, processes: processSnapshot.profileSyncCount, dbRuns: 0, staleRuns: 0 },
  ] };
}

async function workerProcesses(): Promise<Record<string, boolean | number>> {
  const empty = { crawl: false, crawlCount: 0, ocr: false, ocrCount: 0, menuRefresh: false, menuRefreshCount: 0, cache: false, cacheCount: 0, profileSync: false, profileSyncCount: 0 };
  if (process.platform !== 'win32') return empty;
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine } | Where-Object { $_ } | ConvertTo-Json -Compress'], { timeout: 2500, windowsHide: true });
    const parsed = JSON.parse(stdout.trim() || '[]') as string | string[];
    const commands = (Array.isArray(parsed) ? parsed : [parsed])
      .map((value) => value.toLowerCase())
      // The inspection PowerShell command itself contains the worker
      // patterns, and Codex's native shell wrapper can also echo them in its
      // command line. Exclude those false positives before counting workers.
      .filter((command) => !/get-ciminstance win32_process|coverage-dashboard|codex-primary-runtime/.test(command));
    const count = (pattern: RegExp) => commands.filter((command) => pattern.test(command)).length;
    // Match the worker's actual mode argument or its npm entry point. Broad
    // substring matching falsely counted the supervisor itself because its
    // worker list contains words such as "ocr" and "menu-refresh".
    const crawlCount = count(/crawl:playwright:batch|(?:-|\s)mode\s+['"]?crawl\b|run-crawl-loop/);
    const ocrCount = count(/enrich:menu-images|enrich-menu-images|run-ocr-loop|run-targeted-menu-coverage.*mode\s+['"]?ocr\b|(?:-|\s)mode\s+['"]?ocr\b/);
    const menuRefreshCount = count(/menu-refresh\.ts|refresh:menu|run-targeted-menu-coverage.*mode\s+['"]?refresh\b|(?:-|\s)mode\s+['"]?menu-refresh\b|run-menu-refresh-loop/);
    const cacheCount = count(/cache-restaurant-images|cache:images|run-cache-loop|(?:-|\s)mode\s+['"]?cache\b/);
    const profileSyncCount = count(/sync-recommendation-derived|(?:-|\s)mode\s+['"]?profile-sync\b/);
    return { crawl: crawlCount > 0, crawlCount, ocr: ocrCount > 0, ocrCount, menuRefresh: menuRefreshCount > 0, menuRefreshCount, cache: cacheCount > 0, cacheCount, profileSync: profileSyncCount > 0, profileSyncCount };
  } catch { return empty; }
}

const server = createServer(async (req, res) => {
  try {
    if (req.url === '/api/status') { res.setHeader('content-type','application/json'); res.end(JSON.stringify(await status())); return; }
    if (req.url === '/' || req.url === '/index.html') { res.setHeader('content-type','text/html; charset=utf-8'); res.end(PAGE); return; }
    res.statusCode=404;res.end('Not found');
  } catch (error) { res.statusCode=500;res.end(JSON.stringify({error:String(error)})); }
});
loadHistory().then(() => server.listen(PORT, HOST, () => {
  console.log(`coverage_dashboard=http://${HOST}:${PORT}/`);
  // Keep trend snapshots advancing even when nobody has the page open.
  setInterval(() => { void status().catch((error) => console.error('coverage_snapshot_failed', error)); }, HISTORY_INTERVAL_MS);
}));
process.on('SIGINT', async () => { await pool.end(); server.close(); });
