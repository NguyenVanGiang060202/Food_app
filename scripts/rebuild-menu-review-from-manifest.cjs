const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'crawler', 'artifacts', 'menu-review');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const cards = manifest.images.map((item) => {
  const relativeImage = `../../../storage/restaurant-images/${item.cachedObjectKey}`;
  const mapsQuery = encodeURIComponent(`${item.restaurantName} ${item.address ?? ''}`);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;
  return `<article class="card" data-search="${esc(`${item.restaurantName} ${item.address ?? ''} ${item.dishes.join(' ')}`)}">
    <label><input type="checkbox" value="${esc(item.imageId)}"> Chọn làm ứng viên menu</label>
    <img loading="lazy" src="${esc(relativeImage)}" alt="${esc(item.restaurantName)}">
    <div class="name">${esc(item.restaurantName)}</div>
    <div class="meta">Món mục tiêu: ${esc(item.dishes.join(', '))}</div>
    <div class="meta">${esc(item.address ?? 'Không có địa chỉ')}</div>
    <div class="status">Ứng viên từ gallery cache. Chưa được xác minh là menu của quán.</div>
    <a href="${mapsUrl}" target="_blank" rel="noreferrer">Mở tìm quán trên Google Maps</a>
    <code>${esc(item.imageId)}</code>
  </article>`;
}).join('\n');
const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Menu review</title>
<style>body{font-family:system-ui;margin:20px;background:#f5f5f5;color:#171717}.toolbar{position:sticky;top:0;background:white;padding:12px;z-index:2;border-bottom:1px solid #ddd}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}.card{background:white;padding:10px;border-radius:10px;box-shadow:0 1px 4px #0002}.card img{width:100%;height:230px;object-fit:contain;background:#eee;margin-top:8px}.name{font-weight:700;margin-top:8px}.meta,.status{font-size:12px;color:#555;margin-top:4px}.status{color:#9a3412;font-weight:600}a{display:inline-block;margin-top:7px;font-size:13px}code{display:block;font-size:10px;word-break:break-all;margin-top:7px}.selected{outline:3px solid #16a34a}</style></head>
<body><h1>Menu review</h1><p><b>Cách kiểm tra:</b> ảnh phải có nhiều tên món và giá rõ ràng; mở link Google Maps để xác nhận đúng quán/địa chỉ. Không chọn ảnh món ăn, mặt tiền hoặc bảng hiệu.</p>
<p>Ảnh được đọc từ cache local, nên không cần backend/Docker chạy.</p><div class="toolbar"><input id="filter" placeholder="lọc quán, địa chỉ hoặc món" style="width:300px;padding:8px"><button id="export">Xuất selected-menu-image-ids.txt</button> <span id="count"></span></div>
<main class="grid">${cards}</main><script>
const cards=[...document.querySelectorAll('.card')], filter=document.querySelector('#filter'), count=document.querySelector('#count');
function refresh(){const q=filter.value.toLowerCase();let n=0;cards.forEach(c=>{c.style.display=!q||c.dataset.search.toLowerCase().includes(q)?'':'none';const cb=c.querySelector('input');c.classList.toggle('selected',cb.checked);if(cb.checked)n++});count.textContent=n+' ảnh đã chọn'}
document.querySelectorAll('input[type=checkbox]').forEach(x=>x.addEventListener('change',refresh));filter.addEventListener('input',refresh);refresh();
document.querySelector('#export').addEventListener('click',()=>{const ids=[...document.querySelectorAll('input[type=checkbox]:checked')].map(x=>x.value);const blob=new Blob(['# Selected menu image IDs\\n',...ids.map(x=>x+'\\n')],{type:'text/plain'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='selected-menu-image-ids.txt';a.click()});
</script></body></html>`;
fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
console.log(`rebuilt ${manifest.images.length} cards`);
