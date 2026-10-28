import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'crawler' / 'artifacts' / 'menu-review' / 'manifest.json'
OUT = ROOT / 'crawler' / 'artifacts' / 'menu-review'
STORAGE = ROOT / 'storage' / 'restaurant-images'

manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
font = ImageFont.load_default()
thumb_w, thumb_h = 300, 250
cols = 4
rows_per_sheet = 5
per_sheet = cols * rows_per_sheet

for dish in manifest['dishes']:
    items = [item for item in manifest['images'] if dish in item['dishes']]
    for page in range(math.ceil(len(items) / per_sheet)):
        page_items = items[page * per_sheet:(page + 1) * per_sheet]
        sheet = Image.new('RGB', (cols * thumb_w, rows_per_sheet * thumb_h), 'white')
        draw = ImageDraw.Draw(sheet)
        for index, item in enumerate(page_items):
            path = STORAGE / item['cachedObjectKey']
            try:
                image = Image.open(path).convert('RGB')
                image = ImageOps.contain(image, (thumb_w - 12, 190))
            except Exception:
                image = Image.new('RGB', (thumb_w - 12, 190), '#dddddd')
            x = (index % cols) * thumb_w + 6
            y = (index // cols) * thumb_h + 6
            sheet.paste(image, (x + (thumb_w - 12 - image.width) // 2, y))
            label = f"{item['restaurantName'][:34]}\n{item['imageId']}"
            draw.multiline_text((x, y + 194), label, fill='black', font=font, spacing=3)
        filename = f"sheet-{dish.replace(' ', '-').replace('/', '-')}-{page + 1}.png"
        sheet.save(OUT / filename, optimize=True)
print('generated', len(list(OUT.glob('sheet-*.png'))), 'sheets')
