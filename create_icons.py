from PIL import Image, ImageDraw, ImageFont
import platform

def create_train_emoji_icon(size, filename):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Try to use Apple Color Emoji font for proper emoji rendering
    font_size = int(size * 0.85)
    try:
        if platform.system() == 'Darwin':
            font = ImageFont.truetype('/System/Library/Fonts/Apple Color Emoji.ttc', font_size)
        else:
            font = ImageFont.truetype('seguiemj.ttf', font_size)  # Windows
    except:
        font = ImageFont.load_default()
    
    # Draw the train emoji centered
    text = '🚂'
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    x = (size - text_width) // 2 - bbox[0]
    y = (size - text_height) // 2 - bbox[1]
    draw.text((x, y), text, font=font, embedded_color=True)
    
    img.save(filename, 'PNG')
    print(f'Created {filename}')

create_train_emoji_icon(16, '/Users/clairemcgonigle/Desktop/Repos/amtrak-price-tracker/icons/icon16.png')
create_train_emoji_icon(48, '/Users/clairemcgonigle/Desktop/Repos/amtrak-price-tracker/icons/icon48.png')
create_train_emoji_icon(128, '/Users/clairemcgonigle/Desktop/Repos/amtrak-price-tracker/icons/icon128.png')
print('Done!')
