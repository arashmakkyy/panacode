#!/usr/bin/env python3
"""Rasterise a brand pack's 1024px icon into every desktop channel and the web app's favicons.
Usage: python3 script/panacode-brand-icons.py <pack-dir>   (called by panacode-brand-apply.ts; needs Pillow)"""
import os, sys, shutil
from PIL import Image

pack = sys.argv[1]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = Image.open(os.path.join(pack, "assets", "icon-1024.png")).convert("RGBA")

def sized(n):
    return src.resize((n, n), Image.LANCZOS)

desktop_pngs = {
    "32x32.png": 32, "64x64.png": 64, "128x128.png": 128, "128x128@2x.png": 256, "icon.png": 512, "dock.png": 256,
    "Square30x30Logo.png": 30, "Square44x44Logo.png": 44, "Square71x71Logo.png": 71, "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107, "Square142x142Logo.png": 142, "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284, "Square310x310Logo.png": 310, "StoreLogo.png": 50,
}
for channel in ("dev", "beta", "prod"):
    d = os.path.join(root, "packages", "desktop", "icons", channel)
    if not os.path.isdir(d):
        continue
    for name, n in desktop_pngs.items():
        sized(n).save(os.path.join(d, name))
    src.save(os.path.join(d, "icon.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    src.save(os.path.join(d, "icon.icns"))
    print("icons:", channel)

pub = os.path.join(root, "packages", "app", "public")
for name, n in {"favicon-96x96.png": 96, "favicon-96x96-v3.png": 96, "apple-touch-icon.png": 180, "apple-touch-icon-v3.png": 180,
                "web-app-manifest-192x192.png": 192, "web-app-manifest-512x512.png": 512}.items():
    sized(n).save(os.path.join(pub, name))
for name in ("favicon.ico", "favicon-v3.ico"):
    src.save(os.path.join(pub, name), sizes=[(16, 16), (32, 32), (48, 48)])
for name in ("favicon.svg", "favicon-v3.svg"):
    shutil.copy(os.path.join(pack, "assets", "mark.svg"), os.path.join(pub, name))
src.resize((256, 256), Image.LANCZOS).save(os.path.join(pack, "assets", "icon-256.png"))
print("favicons: packages/app/public")
