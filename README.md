# Amtrak Price Tracker

A Chrome browser extension that tracks Amtrak train prices and alerts you when prices drop below what you paid.

## Features

- 🚂 Track multiple Amtrak trips
- 💰 Get notified when prices drop below your purchase price
- ⏰ Automatic price checking (configurable interval)
- 📊 View current prices vs. what you paid
- 🔔 Desktop notifications for price drops

## Installation

### Load as Unpacked Extension (Development)

1. **Generate Icons** (required before loading):
   - Install ImageMagick: `brew install imagemagick`
   - Run: 
     ```bash
     cd icons
     convert -background none icon.svg -resize 16x16 icon16.png
     convert -background none icon.svg -resize 48x48 icon48.png
     convert -background none icon.svg -resize 128x128 icon128.png
     ```
   - Or use an online SVG to PNG converter

2. **Load in Chrome**:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select this project folder

3. **Pin the Extension**:
   - Click the puzzle piece icon in Chrome toolbar
   - Pin "Amtrak Price Tracker"

## Usage

### Adding a Trip

1. Click the extension icon in your toolbar
2. Fill in the trip details:
   - **Origin**: 3-letter station code (e.g., NYP for New York Penn)
   - **Destination**: 3-letter station code (e.g., WAS for Washington DC)
   - **Travel Date**: Your departure date
   - **Train #**: (Optional) Specific train number
   - **Price Paid**: The amount you paid for your ticket
3. Click "Add Trip"

### Common Amtrak Station Codes

| Station | Code |
|---------|------|
| New York Penn Station | NYP |
| Washington DC Union | WAS |
| Boston South Station | BOS |
| Philadelphia 30th St | PHL |
| Chicago Union Station | CHI |
| Los Angeles Union | LAX |

Find all station codes at [Amtrak.com](https://www.amtrak.com/stations)

### Checking Prices

- Prices are checked automatically based on your settings (default: every 4 hours)
- Click "Check Prices Now" to manually trigger a check
- When a price drops below what you paid, you'll receive a notification

### Price Drop Alerts

When the current price drops below your purchase price:
- A desktop notification will appear
- The trip card will show the savings amount
- Click the notification to open Amtrak's booking page

## Project Structure

```
amtrak-price-tracker/
├── manifest.json      # Extension configuration
├── popup.html         # Extension popup UI
├── popup.css          # Popup styles
├── popup.js           # Popup logic
├── background.js      # Service worker (price checking, alarms)
├── content.js         # Content script for Amtrak pages
├── storage.js         # Chrome storage utilities
└── icons/
    ├── icon.svg       # Source icon
    ├── icon16.png     # Toolbar icon
    ├── icon48.png     # Extension page icon
    └── icon128.png    # Chrome Web Store icon
```

## Development

### Important Notes

⚠️ **Price Fetching**: The current implementation uses simulated prices for demonstration. To make it functional:

1. **Option A - Reverse engineer Amtrak's API**:
   - Open Chrome DevTools on Amtrak.com
   - Go to Network tab
   - Search for a route and observe API calls
   - Implement the actual fetch in `background.js`

2. **Option B - Use content script scraping**:
   - Update selectors in `content.js` to match Amtrak's DOM
   - Have background script open tabs and scrape prices

### Debugging

- Open `chrome://extensions/`
- Click "Service Worker" under your extension to open DevTools
- Check the Console for logs and errors
- Use the popup's DevTools (right-click popup → Inspect)

### Testing

1. Add a trip with a known price
2. Click "Check Prices Now"
3. Observe the simulated price (will fluctuate ±20%)
4. If simulated price is lower, you'll get a notification

## Limitations

- Amtrak doesn't provide a public API
- Web scraping may break if Amtrak updates their website
- Price checking requires an internet connection
- Extension must be running for alarms to work

## Legal Notice

This extension is for personal use only. Web scraping may violate Amtrak's Terms of Service. Use at your own risk.

## Contributing

Feel free to improve the price fetching logic! The main areas that need work:
- Implementing actual Amtrak API calls in `background.js`
- Updating DOM selectors in `content.js`
- Adding support for different fare classes (Coach, Business, etc.)

## License

MIT License - Use freely for personal projects.
