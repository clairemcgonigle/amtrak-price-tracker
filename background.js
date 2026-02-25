import { getTrips, updateTrip, getSettings, saveSettings } from './storage.js';
import { sendPriceDropEmail, sendTestEmail } from './email.js';

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

  await chrome.alarms.clear(ALARM_NAME);

  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
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
      const priceResult = await fetchAmtrakPrice(trip);

      // Always update lastChecked so we know a check was attempted
      trip.lastChecked = new Date().toISOString();

      if (priceResult !== null) {
        const wasTrainNotFound = trip.trainNotFound;

        // Handle both old format (just a number) and new format (object)
        if (typeof priceResult === 'object') {
          trip.currentPrice = priceResult.price;
          trip.trainNotFound = !priceResult.trainFound && trip.trainNumber;
        } else {
          trip.currentPrice = priceResult;
          trip.trainNotFound = false;
        }

        // Check if price dropped below paid price
        if (trip.currentPrice < trip.pricePaid) {
          await notifyPriceDrop(trip, trip.currentPrice);
        }

        // Notify if train was not found (only first time)
        if (trip.trainNotFound && !wasTrainNotFound) {
          await notifyTrainNotFound(trip);
        }

        console.log(`${trip.origin}→${trip.destination}: $${trip.currentPrice} (paid: $${trip.pricePaid})${trip.trainNotFound ? ' [train not found]' : ''}`);
      } else {
        console.log(`${trip.origin}→${trip.destination}: Price unavailable`);
      }

      await updateTrip(trip);
    } catch (error) {
      console.error(`Error checking price for trip ${trip.id}:`, error);
      // Still update lastChecked on error so UI shows "Unavailable" not "Checking..."
      trip.lastChecked = new Date().toISOString();
      await updateTrip(trip);
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
// Navigates to homepage and automates the search form
async function fetchAmtrakPrice(trip) {
  try {
    console.log(`Fetching price for ${trip.origin}→${trip.destination}...`);

    // Find or create an Amtrak tab
    let tab = await findOrCreateAmtrakTab();
    if (!tab) {
      console.log('Could not access Amtrak tab');
      return null;
    }

    // Navigate to homepage
    console.log('Navigating to Amtrak homepage...');
    await chrome.tabs.update(tab.id, { url: 'https://www.amtrak.com/' });
    await waitForTabLoad(tab.id);

    // Wait longer for SPA to fully load and render booking form
    console.log('Waiting for page to fully load...');
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Inject content script
    console.log('Injecting content script...');
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (injectError) {
      console.log('Content script note:', injectError.message);
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    // Tell content script to fill form and search
    // Note: This may throw if the page navigates (which means form was submitted)
    console.log('Filling search form...');
    let fillResult;
    try {
      fillResult = await chrome.tabs.sendMessage(tab.id, {
        action: 'fillAndSearch',
        trip: {
          origin: trip.origin,
          destination: trip.destination,
          travelDate: trip.travelDate
        }
      });
    } catch (err) {
      // "message channel closed" error means page navigated (form submitted successfully)
      if (err.message?.includes('message channel closed') || err.message?.includes('Receiving end does not exist')) {
        console.log('Form submitted (page navigated)');
        fillResult = { success: true };
      } else {
        throw err;
      }
    }

    if (!fillResult?.success) {
      console.log('Failed to fill search form:', fillResult?.error);
      return null;
    }

    // Wait for results page to load (form submission navigates to new page)
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Re-inject content script on the results page (old script was destroyed by navigation)
    console.log('Re-injecting content script on results page...');
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (injectError) {
      console.log('Content script re-injection note:', injectError.message);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Scrape prices from results, passing train number to find specific train
    let result;
    try {
      result = await chrome.tabs.sendMessage(tab.id, {
        action: 'scrapePrices',
        trainNumber: trip.trainNumber || null
      });
    } catch (err) {
      console.log('Failed to scrape prices:', err.message);
      return null;
    }

    console.log('Scrape result:', result);

    // If we found a specific train match, use that price
    if (result?.trainPrice !== undefined && result.trainPrice !== null) {
      console.log(`Found price for train #${trip.trainNumber}: $${result.trainPrice}`);
      return { price: result.trainPrice, trainFound: true };
    }

    // Fallback: use lowest price from any train
    if (result?.prices && result.prices.length > 0) {
      const validPrices = result.prices
        .map(p => typeof p === 'number' ? p : p.price)
        .filter(p => p >= 20 && p <= 2000);

      if (validPrices.length > 0) {
        const lowestPrice = Math.min(...validPrices);
        console.log(`Train #${trip.trainNumber} not found, lowest price: $${lowestPrice}`);
        // Return with trainFound: false if user specified a train but we didn't find it
        return { price: lowestPrice, trainFound: !trip.trainNumber };
      }
    }

    console.log('No prices found on page');
    return null;

  } catch (error) {
    console.error('Failed to fetch Amtrak price:', error);
    return null;
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

// Send notification when train is not found
async function notifyTrainNotFound(trip) {
  await chrome.notifications.create(`train-not-found-${trip.id}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: '⚠️ Train Not Found',
    message: `We couldn't find Train ${trip.trainNumber} from ${trip.origin} to ${trip.destination} on ${formatDate(trip.travelDate)}. Please check your train details and update your train information to track this trip.`,
    priority: 1
  });
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
