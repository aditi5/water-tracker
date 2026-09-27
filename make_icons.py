from PIL import Image, ImageDraw, ImageFilter
import math
def make(size, path):
    S = size*4
    img = Image.new("RGB", (S, S))
    d = ImageDraw.Draw(img)
    top, bot = (127, 211, 255), (22, 104, 214)
    for y in range(S):
        t = y/(S-1)
        d.line([(0,y),(S,y)], fill=tuple(int(top[i]+(bot[i]-top[i])*t) for i in range(3)))
    # drop: circle bottom + pointed top
    cx, cy, r = S/2, S*0.60, S*0.24
    tip = (cx, S*0.17)
    pts = [tip]
    dist = cy - tip[1]
    phi = math.acos(r/dist)  # angle between center->tip and center->tangent
    base = -math.pi/2        # direction center->tip (up)
    right = base + phi; left = base - phi + 2*math.pi
    n = 200
    for i in range(n+1):
        th = right + (left-right)*i/n
        pts.append((cx + r*math.cos(th), cy + r*math.sin(th)))
    shadow = Image.new("L", (S,S), 0)
    ImageDraw.Draw(shadow).polygon([(x, y+S*0.02) for x,y in pts], fill=90)
    shadow = shadow.filter(ImageFilter.GaussianBlur(S*0.02))
    img.paste((10,60,120), (0,0), shadow)
    d = ImageDraw.Draw(img)
    d.polygon(pts, fill=(255,255,255))
    # highlight
    d.ellipse([cx-r*0.55, cy-r*0.35, cx-r*0.25, cy+r*0.25], fill=(200,232,255))
    img = img.resize((size,size), Image.LANCZOS)
    img.save(path, optimize=True)
make(180, "icons/apple-touch-icon.png")
make(192, "icons/icon-192.png")
make(512, "icons/icon-512.png")
print("icons done")
