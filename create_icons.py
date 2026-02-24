from PIL import Image, ImageDraw, ImageFont
import platform

def create_base_emoji():
    """Create the base emoji image at a size that works"""
    render_size = 48
    font_size = 40  # This worked before
    
    img = Image.new('RGBA', (render_size, render_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    try:
        if platform.system() == 'Darwin':
            font = ImageFont.truetype('/System/Library/Fonts/Apple Color Emoji.ttc', font_size)
        else:
            font = ImageFont.truetype('seguiemj.ttf', font_size)
    except:
        font = ImageFont.load_default()
    
    text = '🚂'
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    x = (render_size - text_width) // 2 - bbox[0]
    y = (render_size - text_height) // 2 - bbox[1]
    draw.text((x, y), text, font=font, embedded_color=True)
    
    return img

# Create base emoji once
base_img = create_base_emoji()

# Save at different sizes
for size, filename in [(16, 'icons/icon16.png'), (48, 'icons/icon48.png'), (128, 'icons/icon128.png')]:
    if size == 48:
        img = base_img.copy()
    else:
        img = base_img.resize((size, size), Image.Resampling.LANCZOS)
    img.save(filename, 'PNG')
    print(f'Created {filename}')

print('Done!')
