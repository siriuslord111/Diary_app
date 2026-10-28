from PIL import Image, ImageDraw, ImageFont
import os

def create_calculator_icon(size, is_maskable=False):
    # Base image with dark background
    bg_color = (30, 31, 34) # #1e1f22
    img = Image.new("RGBA", (size, size), bg_color)
    draw = ImageDraw.Draw(img)
    
    # Scale factor
    s = size / 512.0
    
    if not is_maskable:
        # Subtle rounded squircle for standard icon
        # In Android, standard icons often have rounded corners or circular shape
        pass

    # Draw calculator body
    # Center bounds within safe zone
    # Safe zone for maskable icons is central 80% (diameter 410px on 512)
    calc_w = int(280 * s)
    calc_h = int(380 * s)
    x0 = int((size - calc_w) / 2)
    y0 = int((size - calc_h) / 2)
    x1 = x0 + calc_w
    y1 = y0 + calc_h
    corner_r = int(36 * s)

    # Calculator chassis
    chassis_color = (42, 44, 48) # #2a2c30
    draw.rounded_rectangle([x0, y0, x1, y1], radius=corner_r, fill=chassis_color, outline=(60, 64, 68), width=max(1, int(3 * s)))

    # Calculator screen / display
    disp_margin = int(24 * s)
    disp_h = int(76 * s)
    disp_x0 = x0 + disp_margin
    disp_y0 = y0 + disp_margin
    disp_x1 = x1 - disp_margin
    disp_y1 = disp_y0 + disp_h
    disp_r = int(16 * s)
    draw.rounded_rectangle([disp_x0, disp_y0, disp_x1, disp_y1], radius=disp_r, fill=(24, 25, 27)) # #18191b

    # Display indicator line/digits (accent blue #a8c7fa)
    accent_blue = (168, 199, 250)
    line_h = max(2, int(6 * s))
    draw.rounded_rectangle([disp_x1 - int(70 * s), disp_y1 - int(24 * s), disp_x1 - int(14 * s), disp_y1 - int(24 * s) + line_h], radius=int(3 * s), fill=accent_blue)
    draw.rounded_rectangle([disp_x1 - int(120 * s), disp_y1 - int(24 * s), disp_x1 - int(84 * s), disp_y1 - int(24 * s) + line_h], radius=int(3 * s), fill=(120, 124, 130))

    # Buttons grid (3 columns x 4 rows)
    grid_y0 = disp_y1 + int(24 * s)
    btn_gap = int(14 * s)
    cols = 3
    rows = 4
    btn_w = (calc_w - 2 * disp_margin - (cols - 1) * btn_gap) // cols
    btn_h = (y1 - disp_margin - grid_y0 - (rows - 1) * btn_gap) // rows
    btn_r = int(14 * s)

    for r in range(rows):
        for c in range(cols):
            bx0 = disp_x0 + c * (btn_w + btn_gap)
            by0 = grid_y0 + r * (btn_h + btn_gap)
            bx1 = bx0 + btn_w
            by1 = by0 + btn_h

            # Distinguish button colors
            if r == 3 and c == 2:
                # Equals button (Accent)
                btn_fill = (0, 74, 119) # Deep blue accent
                btn_out = (168, 199, 250)
            elif c == 2 or r == 0:
                # Function/operator buttons
                btn_fill = (59, 63, 67) # #3b3f43
                btn_out = (75, 80, 85)
            else:
                # Digit buttons
                btn_fill = (45, 47, 49) # #2d2f31
                btn_out = (55, 58, 62)

            draw.rounded_rectangle([bx0, by0, bx1, by1], radius=btn_r, fill=btn_fill)

            # Draw symbol on equals button
            if r == 3 and c == 2:
                # Equal sign lines
                eq_w = int(btn_w * 0.45)
                eq_h = max(2, int(4 * s))
                eq_cx = (bx0 + bx1) // 2
                eq_cy = (by0 + by1) // 2
                draw.rounded_rectangle([eq_cx - eq_w // 2, eq_cy - int(6 * s), eq_cx + eq_w // 2, eq_cy - int(6 * s) + eq_h], radius=1, fill=accent_blue)
                draw.rounded_rectangle([eq_cx - eq_w // 2, eq_cy + int(4 * s), eq_cx + eq_w // 2, eq_cy + int(4 * s) + eq_h], radius=1, fill=accent_blue)

    return img

os.makedirs("icons", exist_ok=True)
create_calculator_icon(192, is_maskable=False).save("icons/icon-192.png")
create_calculator_icon(512, is_maskable=False).save("icons/icon-512.png")
create_calculator_icon(192, is_maskable=True).save("icons/icon-maskable-192.png")
create_calculator_icon(512, is_maskable=True).save("icons/icon-maskable-512.png")
print("Icons generated successfully!")
