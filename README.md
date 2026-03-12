# Amtrak Price Tracker

A Chrome browser extension that tracks Amtrak train prices and alerts you when prices drop below what you paid.

## Features

- Track Amtrak trips
- Get notified when prices drop below your purchase price
- Automatic price checking (configurable interval)
- View price history graph of prices since you started tracking the trip
- Desktop notifications or email alert for price drops

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
   - **Train #**: Specific train number
   - **Price Paid**: The amount you paid for your ticket
3. Click "Add Trip"

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
manifest.json      # Extension configuration
popup.html         # Extension popup UI
popup.css          # Popup styles
popup.js           # Popup logic
background.js      # Service worker (price checking, alarms)
content.js         # Content script for Amtrak pages
storage.js         # Chrome storage utilities
icons/
   icon.svg       # Source icon
   icon16.png     # Toolbar icon
   icon48.png     # Extension page icon
   icon128.png    # Chrome Web Store icon
```

## Development

### Debugging

- Open `chrome://extensions/`
- Click "Service Worker" under your extension to open DevTools
- Check the Console for logs and errors
- Use the popup's DevTools (right-click popup → Inspect)

## Limitations

- Amtrak doesn't provide a public API
- Web scraping may break if Amtrak updates their website
- Extension / Chrome must be running for alarms to work


This extension is for personal use only.
