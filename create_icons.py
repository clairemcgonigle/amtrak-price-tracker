from PIL import Image, ImageDraw

def create_train_icon(size, filename):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    s = size / 128
    
    # Blue circle background
    margin = int(4 * s)
    draw.ellipse([margin, margin, size-margin, size-margin], fill=(26, 82, 118, 255))
    
    # Train body
    draw.rounded_rectangle([int(18*s), int(45*s), int(100*s), int(85*s)], radius=int(8*s), fill='white')
    
    # Train front
    draw.polygon([(int(100*s), int(45*s)), (int(115*s), int(55*s)), (int(115*s), int(75*s)), (int(100*s), int(85*s))], fill='white')
    
    # Windows
    for i in range(4):
        left = int(26*s) + i * int(14*s)
        draw.rounded_rectangle([left, int(52*s), left + int(10*s), int(68*s)], radius=int(2*s), fill=(26, 82, 118, 255))
    
    # Wheels
    for wx in [35, 58, 82]:
        cx = int(wx * s)
        draw.ellipse([cx-int(7*s), int(81*s), cx+int(7*s), int(95*s)], fill=(60, 60, 60, 255))
    
    # Track
    draw.rectangle([int(10*s), int(94*s), int(118*s), int(97*s)], fill=(80, 80, 80, 255))
    
    img.save(filename, 'PNG')
    print(f'Created {filename}')

create_train_icon(16, '/Users/clairemcgonigle/Desktop/repos/amtrak-price-tracker/icons/icon16.png')
create_train_icon(48, '/Users/clairemcgonigle/Desktop/repos/amtrak-price-tracker/icons/icon48.png')
create_train_icon(128, '/Users/clairemcgonigle/Desktop/repos/amtrak-price-tracker/icons/icon128.png')
print('Done!')
