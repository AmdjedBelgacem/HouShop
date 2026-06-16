import struct, zlib, os

def create_rgba_png(width, height, r, g, b):
    """Create a valid RGBA PNG file."""
    def make_chunk(chunk_type, data):
        chunk = chunk_type + data
        return struct.pack('>I', len(data)) + chunk + struct.pack('>I', zlib.crc32(chunk) & 0xFFFFFFFF)

    # PNG signature
    signature = b'\x89PNG\r\n\x1a\n'

    # IHDR chunk - color type 6 = RGBA
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr = make_chunk(b'IHDR', ihdr_data)

    # IDAT chunk - raw image data
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00'  # filter byte (none)
        for x in range(width):
            raw_data += bytes([r, g, b, 255])  # RGBA pixel

    compressed = zlib.compress(raw_data, 9)
    idat = make_chunk(b'IDAT', compressed)

    # IEND chunk
    iend = make_chunk(b'IEND', b'')

    return signature + ihdr + idat + iend

icons_dir = os.path.dirname(os.path.abspath(__file__))

# Blue color icons (primary-600: #2563eb)
specs = [
    ('32x32.png', 32, 32),
    ('128x128.png', 128, 128),
    ('128x128@2x.png', 256, 256),
    ('icon.png', 512, 512),
]

for filename, w, h in specs:
    png_data = create_rgba_png(w, h, 37, 99, 235)
    filepath = os.path.join(icons_dir, filename)
    with open(filepath, 'wb') as f:
        f.write(png_data)
    print(f"Created {filename} ({w}x{h})")

print("All icons generated successfully!")
