<!-- Custom instructions for Amtrak Price Tracker extension -->

## Project Overview
This is a Chrome browser extension (Manifest V3) for tracking Amtrak train prices.

## Tech Stack
- Vanilla JavaScript (ES modules)
- Chrome Extension APIs (storage, alarms, notifications)
- HTML/CSS for popup UI

## Key Files
- `manifest.json` - Extension configuration
- `background.js` - Service worker for price checking
- `popup.js` - Popup UI logic
- `storage.js` - Chrome storage utilities
- `content.js` - Content script for Amtrak pages

## Development Guidelines
- Use ES modules for code organization
- Use Chrome Storage API for persistence (not localStorage)
- Handle async operations with async/await
- Log errors to console for debugging

## Testing
1. Load unpacked extension in Chrome
2. Use simulated prices for development
3. Test notifications with browser notifications enabled
