#!/usr/bin/env python3
"""Generate a multi-resolution Windows ICO from the canonical Mathorium SVG raster."""
from pathlib import Path
from PIL import Image

root=Path(__file__).resolve().parents[1]
source=root/"public"/"icon-512.png"
target=root/"public"/"mathorium.ico"
if not source.is_file():
    raise SystemExit(f"Missing canonical Mathorium icon: {source}")
with Image.open(source) as image:
    image=image.convert("RGBA")
    image.save(target,format="ICO",sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
if not target.is_file() or target.stat().st_size<1000:
    raise SystemExit("Windows icon generation failed.")
print(f"Created {target.relative_to(root)} ({target.stat().st_size:,} bytes)")
