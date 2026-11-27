"""Generate crisp, anti-aliased PNG icons for TimeLedger using Python stdlib."""
import math
import os
import struct
import zlib


def write_png(path, width, height, rgba_bytes):
    def chunk(tag, data):
        return (
            struct.pack("!I", len(data))
            + tag
            + data
            + struct.pack("!I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw_rows = bytearray()
    stride = width * 4
    for y in range(height):
        raw_rows.append(0)  # filter type 0
        raw_rows.extend(rgba_bytes[y * stride : (y + 1) * stride])

    ihdr = struct.pack("!IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw_rows), 9)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def mix(c1, c2, t):
    return tuple(c1[i] * (1.0 - t) + c2[i] * t for i in range(len(c1)))


def dist_segment(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def render_icon(size):
    # Supersample 4x4 for crisp edges at 16px..128px
    ss = 4
    buf = bytearray(size * size * 4)
    c_top = (14.0, 165.0, 233.0)     # #0ea5e9 sky-500
    c_bot = (37.0, 99.0, 235.0)      # #2563eb blue-600
    c_white = (255.0, 255.0, 255.0)
    c_accent = (186.0, 230.0, 253.0) # #bae6fd

    for py in range(size):
        for px in range(size):
            r_acc = g_acc = b_acc = a_acc = 0.0
            for sy in range(ss):
                for sx in range(ss):
                    x = (px + (sx + 0.5) / ss) / size
                    y = (py + (sy + 0.5) / ss) / size

                    # Rounded squircle background
                    cx, cy = abs(x - 0.5), abs(y - 0.5)
                    corner_r = 0.22
                    inner = 0.5 - corner_r
                    qx = max(cx - inner, 0.0)
                    qy = max(cy - inner, 0.0)
                    sdf_bg = math.hypot(qx, qy) - corner_r
                    bg_alpha = clamp(0.5 - sdf_bg * size)

                    if bg_alpha <= 0.0:
                        continue

                    bg = mix(c_top, c_bot, clamp(y))

                    # Clock ring
                    d_center = math.hypot(x - 0.5, y - 0.5)
                    ring_r = 0.30
                    ring_w = 0.062
                    d_ring = abs(d_center - ring_r) - ring_w / 2.0
                    ring_alpha = clamp(0.5 - d_ring * size)

                    # Clock hands: 12 o'clock and ~4 o'clock (hour + minute)
                    hand_w = 0.055
                    d_hand1 = dist_segment(x, y, 0.5, 0.5, 0.5, 0.31) - hand_w / 2.0
                    d_hand2 = dist_segment(x, y, 0.5, 0.5, 0.63, 0.59) - hand_w / 2.0
                    d_dot = d_center - 0.045
                    fg_alpha = max(
                        ring_alpha,
                        clamp(0.5 - d_hand1 * size),
                        clamp(0.5 - d_hand2 * size),
                        clamp(0.5 - d_dot * size),
                    )

                    # Subtle highlight arc on top-left of ring
                    rgb = mix(bg, c_white if d_hand2 > 0.005 else c_accent, fg_alpha)
                    r_acc += rgb[0] * bg_alpha
                    g_acc += rgb[1] * bg_alpha
                    b_acc += rgb[2] * bg_alpha
                    a_acc += bg_alpha

            samples = ss * ss
            a = a_acc / samples
            idx = (py * size + px) * 4
            if a > 0.0:
                buf[idx] = int(clamp(r_acc / a_acc, 0, 255))
                buf[idx + 1] = int(clamp(g_acc / a_acc, 0, 255))
                buf[idx + 2] = int(clamp(b_acc / a_acc, 0, 255))
                buf[idx + 3] = int(clamp(a * 255.0, 0, 255))
    return bytes(buf)


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "..", "icons")
    os.makedirs(out_dir, exist_ok=True)
    for size in (16, 32, 48, 128):
        out_path = os.path.join(out_dir, f"icon{size}.png")
        write_png(out_path, size, size, render_icon(size))
        print(f"Generated {out_path}")


if __name__ == "__main__":
    main()
