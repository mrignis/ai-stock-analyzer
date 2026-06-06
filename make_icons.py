#!/usr/bin/env python3
import base64, struct, zlib, os

def make_png(size, r, g, b):
    def chunk(name, data):
        c = zlib.crc32(name + data) & 0xffffffff
        return struct.pack('>I', len(data)) + name + data + struct.pack('>I', c)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    raw = b''
    for y in range(size):
        raw += b'\x00'
        for x in range(size):
            cx, cy = x - size/2, y - size/2
            dist = (cx**2 + cy**2) ** 0.5
            if dist < size*0.42:
                if dist < size*0.38:
                    raw += bytes([r, g, b])
                else:
                    raw += bytes([max(0,r-30), max(0,g-30), max(0,b-30)])
            else:
                raw += bytes([0, 0, 0])
    idat = zlib.compress(raw)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', ihdr)
    png += chunk(b'IDAT', idat)
    png += chunk(b'IEND', b'')
    return png

os.makedirs('icons', exist_ok=True)
for size in [16, 48, 128]:
    with open(f'icons/icon{size}.png', 'wb') as f:
        f.write(make_png(size, 74, 222, 128))
print("Icons created!")
