import { getTrips, updateTrip, getSettings, saveSettings } from './storage.js';
import { sendPriceDropEmail, sendTestEmail } from './email.js';

// Constants
const ALARM_NAME = 'checkAmtrakPrices';
const DEFAULT_CHECK_INTERVAL = 4; // hours

// Initialize extension on install
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Amtrak Price Tracker installed');
  await setupAlarm();
});

// Initialize on startup
chrome.runtime.onStartup.addListener(async () => {
  console.log('Amtrak Price Tracker started');
  await setupAlarm();
});

// Set up the price check alarm
async function setupAlarm() {
  const settings = await getSettings();
  const intervalHours = settings.checkInterval || DEFAULT_CHECK_INTERVAL;
  
  // Clear existing alarm
  await chrome.alarms.clear(ALARM_NAME);
  
  // Create new alarm
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1, // First check after 1 minute
    periodInMinutes: intervalHours * 60
  });
  
  console.log(`Price check alarm set for every ${intervalHours} hours`);
}

// Handle alarm trigger
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('Running scheduled price check');
    await checkAllPrices();
  }
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'checkPrices') {
    checkAllPrices().then(() => {
      sendResponse({ success: true });
    });
    return true; // Keep channel open for async response
  }
  
  if (message.action === 'updateAlarmInterval') {
    setupAlarm().then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'testEmail') {
    sendTestEmail(message.email).then(success => {
      sendResponse({ success });
    });
    return true;
  }
});

// Check prices for all tracked trips
async function checkAllPrices() {
  const trips = await getTrips();
  
  if (trips.length === 0) {
    console.log('No trips to check');
    return;
  }

  console.log(`Checking prices for ${trips.length} trips`);

  for (const trip of trips) {
    // Skip trips that have already passed
    if (new Date(trip.travelDate) < new Date()) {
      console.log(`Skipping past trip: ${trip.origin} → ${trip.destination}`);
      continue;
    }

    try {
      const currentPrice = await fetchAmtrakPrice(trip);
      
      if (currentPrice !== null) {
        const previousPrice = trip.currentPrice;
        trip.currentPrice = currentPrice;
        trip.lastChecked = new Date().toISOString();
        
        await updateTrip(trip);

        // Check if price dropped below paid price
        if (currentPrice < trip.pricePaid) {
          await notifyPriceDrop(trip, currentPrice);
        }
        
        console.log(`${trip.origin}→${trip.destination}: $${currentPrice} (paid: $${trip.pricePaid})`);
      }
    } catch (error) {
      console.error(`Error checking price for trip ${trip.id}:`, error);
    }
  }

  // Update last checked timestamp
  await saveSettings({ lastChecked: new Date().toISOString() });
  
  // Notify popup to refresh
  chrome.runtime.sendMessage({ action: 'tripsUpdated' }).catch(() => {
    // Popup might not be open, ignore error
  });
}

// Fetch price from Amtrak
// Navigates to search page and scrapes the prices from the DOM
async function fetchAmtrakPrice(trip) {
  try {
    console.log(`Fetching price for ${trip.origin}→${trip.destination}...`);
    
    // Build the search URL
    const searchUrl = `https://www.amtrak.com/tickets/departure.html?` + 
      `origin=${trip.origin}&destination=${trip.destination}&` +
      `departureDate=${trip.travelDate}&adults=1&children=0&infants=0&` +
      `seniors=0&youth=0&travelers=1`;
    
    console.log(`Navigating to: ${searchUrl}`);
    
    // Find or create an Amtrak tab
    let tab = await findOrCreateAmtrakTab();
    if (!tab) {
      console.log('Could not access Amtrak tab');
      return null;
    }

    // Navigate to the search results
    await chrome.tabs.update(tab.id, { url: searchUrl });
    
    // Wait for page to load
    await waitForTabLoad(tab.id);
    
    // Wait extra time for dynamic content to render
    console.log('Waiting for results to render...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Inject and run the scraping script
    console.log('Scraping prices from page...');
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapePricesFromDOM,
      args: [trip.trainNumber]
    });

    console.log('Scrape results:', results);

    if (results?.[0]?.result?.price) {
      const price = results[0].result.price;
      console.log(`Found price for ${trip.origin}→${trip.destination}: $${price}`);
      return price;
    } else {
      console.log(`No price found: ${results?.[0]?.result?.error || 'Unknown error'}`);
      return null;
    }

  } catch (error) {
    console.error('Failed to fetch Amtrak price:', error);
    return null;
  }
}

// This function runs in the page context to scrape prices
function scrapePricesFromDOM(trainNumber) {
  try {
    console.log('Amtrak Price Tracker: Looking for prices, train number:', trainNumber || 'any');
    
    // Find all train result rows/cards
    // Amtrak typically shows each train as a card/row with train number and prices
    const trainCards = document.querySelectorAll(
      '[class*="train-card"], [class*="journey-option"], [class*="trip-option"], ' +
      '[class*="result-card"], [data-testid*="journey"], [class*="JourneyCard"], ' +
      'mat-expansion-panel, [class*="expansion-panel"]'
    );
    
    console.log(`Found ${trainCards.length} train cards`);
    
    const results = [];
    
    // Process each train card
    trainCards.forEach((card, index) => {
      const cardText = card.innerText;
      
      // Try to extract train number from the card
      // Patterns: "Train 123", "123", "#123", "Northeast Regional 123"
      const trainNumMatch = cardText.match(/(?:Train\s*#?\s*|#)(\d{1,4})\b/i) ||
                           cardText.match(/(?:Regional|Acela|Silver|Cardinal|Crescent|Palmetto|Carolinian|Piedmont|Vermonter|Downeaster|Keystone|Empire)\s+(\d{1,4})/i) ||
                           cardText.match(/\b(\d{2,4})\b.*(?:Departs|Arrives|AM|PM)/i);
      
      const cardTrainNumber = trainNumMatch ? trainNumMatch[1] : null;
      
      // Find prices in this card
      const priceMatches = cardText.match(/\$(\d{2,3}(?:\.\d{2})?)/g);
      const prices = priceMatches ? priceMatches.map(p => parseFloat(p.replace('$', ''))) : [];
      
      // Filter to reasonable prices
      const validPrices = prices.filter(p => p >= 20 && p <= 1000);
      
      if (validPrices.length > 0) {
        const lowestPrice = Math.min(...validPrices);
        results.push({
          trainNumber: cardTrainNumber,
          price: lowestPrice,
          allPrices: validPrices
        });
        console.log(`Card ${index}: Train ${cardTrainNumber || 'unknown'}, prices: ${validPrices.join(', ')}`);
      }
    });
    
    // If no cards found, try a broader search
    if (results.length === 0) {
      console.log('No train cards found, trying broader search...');
      
      // Look for any price-like elements
      const pageText = document.body.innerText;
      const priceMatches = pageText.match(/\$(\d{2,3}(?:\.\d{2})?)/g);
      
      if (priceMatches) {
        const prices = priceMatches
          .map(p => parseFloat(p.replace('$', '')))
          .filter(p => p >= 20 && p <= 1000);
        
        if (prices.length > 0) {
          console.log('Found prices in page text:', prices);
          return { 
            price: Math.min(...prices), 
            allPrices: prices,
            matchedTrain: null,
            note: 'Could not identify specific trains'
          };
        }
      }
      
      return { price: null, error: 'No prices found on page' };
    }
    
    // If user specified a train number, find that specific train
    if (trainNumber) {
      const matchingTrain = results.find(r => r.trainNumber === trainNumber);
      
      if (matchingTrain) {
        console.log(`Found matching train ${trainNumber}: $${matchingTrain.price}`);
        return { 
          price: matchingTrain.price, 
          allPrices: matchingTrain.allPrices,
          matchedTrain: trainNumber
        };
      } else {
        console.log(`Train ${trainNumber} not found. Available trains:`, results.map(r => r.trainNumber));
        // Fall back to lowest price but note the mismatch
        const lowestResult = results.reduce((min, r) => r.price < min.price ? r : min, results[0]);
        return { 
          price: lowestResult.price, 
          allPrices: lowestResult.allPrices,
          matchedTrain: lowestResult.trainNumber,
          note: `Train ${trainNumber} not found, showing train ${lowestResult.trainNumber || 'unknown'}`
        };
      }
    }
    
    // No specific train requested - return the lowest price overall
    const lowestResult = results.reduce((min, r) => r.price < min.price ? r : min, results[0]);
    console.log(`Returning lowest price: $${lowestResult.price} from train ${lowestResult.trainNumber || 'unknown'}`);
    
    return { 
      price: lowestResult.price, 
      allPrices: results.map(r => r.price),
      matchedTrain: lowestResult.trainNumber,
      allTrains: results.map(r => ({ train: r.trainNumber, price: r.price }))
    };

  } catch (error) {
    console.error('Amtrak Price Tracker: Scraping error:', error);
    return { price: null, error: error.message };
  }
}

// Wait for a tab to finish loading
function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    
    // Timeout after 20 seconds
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 20000);
  });
}

// Find existing Amtrak tab or create a new one
async function findOrCreateAmtrakTab() {
  // First, look for an existing Amtrak tab
  const tabs = await chrome.tabs.query({ url: 'https://www.amtrak.com/*' });
  
  if (tabs.length > 0) {
    console.log('Found existing Amtrak tab');
    return tabs[0];
  }

  // Create a new tab
  console.log('Creating new Amtrak tab...');
  try {
    const tab = await chrome.tabs.create({
      url: 'https://www.amtrak.com/',
      active: false
    });

    await waitForTabLoad(tab.id);
    return tab;
  } catch (error) {
    console.error('Failed to create Amtrak tab:', error);
    return null;
  }
}

// Build Amtrak search URL (for reference)
function buildAmtrakSearchUrl(trip) {
  // Amtrak booking URL structure:
  // https://www.amtrak.com/tickets/departure.html?origin=NYP&destination=WAS&date=2026-03-15
  const params = new URLSearchParams({
    origin: trip.origin,
    destination: trip.destination,
    date: trip.travelDate,
    adult: '1'
  });
  
  return `https://www.amtrak.com/tickets/departure.html?${params.toString()}`;
}

// Send notification for price drop
async function notifyPriceDrop(trip, currentPrice) {
  const savings = trip.pricePaid - currentPrice;
  
  // Browser notification
  await chrome.notifications.create(`price-drop-${trip.id}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: '🚂 Amtrak Price Drop!',
    message: `${trip.origin} → ${trip.destination} on ${formatDate(trip.travelDate)}\nNow: $${currentPrice.toFixed(2)} (save $${savings.toFixed(2)})`,
    priority: 2
  });

  // Email notification (if configured)
  const settings = await getSettings();
  if (settings.emailNotifications && settings.notificationEmail) {
    await sendPriceDropEmail(trip, currentPrice, settings.notificationEmail);
  }
}

// Format date for notifications
function formatDate(dateString) {
  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric'
  });
}

// Handle notification click
chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId.startsWith('price-drop-')) {
    const tripId = notificationId.replace('price-drop-', '');
    const trips = await getTrips();
    const trip = trips.find(t => t.id === tripId);
    
    if (trip) {
      // Open Amtrak booking page
      const bookingUrl = buildAmtrakSearchUrl(trip);
      chrome.tabs.create({ url: bookingUrl });
    }
  }
});
