import { getTrips, updateTrip, getSettings, saveSettings } from './storage.js';
import { sendPriceDropEmail, sendTestEmail } from './email.js';

const ALARM_NAME = 'checkAmtrakPrices';
const DEFAULT_CHECK_INTERVAL = 4; // hours

// Lock to prevent concurrent price checks
let isCheckingPrices = false;

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
  // Log messages from content script to service worker
  if (message.action === 'log') {
    console.log(message.message);
    return;
  }

  if (message.action === 'checkPrices') {
    checkAllPrices().then(() => {
      sendResponse({ success: true });
    });
    return true;
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
  // Prevent concurrent runs
  if (isCheckingPrices) {
    console.log('Price check already in progress, skipping');
    return;
  }
  isCheckingPrices = true;
  console.log('=== Starting price check ===');

  try {
    const trips = await getTrips();

    if (trips.length === 0) {
      console.log('No trips to check');
      return;
    }

    console.log(`Checking prices for ${trips.length} trips`);

    for (const trip of trips) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (new Date(trip.travelDate + 'T00:00:00') < today) {
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

          // Add to price history only if the specific train was found
          if (!trip.priceHistory) {
            trip.priceHistory = [];
          }
          if (!trip.trainNotFound) {
            trip.priceHistory.push({
              price: trip.currentPrice,
              timestamp: new Date().toISOString()
            });
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

        console.log('Waiting 5 seconds before next trip...');
        await new Promise(resolve => setTimeout(resolve, 5000));
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
  } finally {
    isCheckingPrices = false;
    console.log('=== Price check complete ===');
  }
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

    // Wait for SPA to fully load and render booking form
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
    console.log('Filling search form for trip:', trip.origin, '->', trip.destination, 'on', trip.travelDate);
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
      // Check if page navigated (which would indicate form was submitted)
      const currentTab = await chrome.tabs.get(tab.id);
      const hasNavigated = !currentTab.url?.endsWith('amtrak.com/') &&
        currentTab.url !== 'https://www.amtrak.com/';

      if (hasNavigated) {
        console.log('Form submitted (page navigated to:', currentTab.url, ')');
        fillResult = { success: true };
      } else {
        console.log('Form fill failed, still on homepage:', err.message);
        return null;
      }
    }

    if (!fillResult?.success) {
      console.log('Failed to fill search form:', fillResult?.error);
      return null;
    }

    console.log('Form fill completed successfully, waiting for results page...');

    await new Promise(resolve => setTimeout(resolve, 10000));

    // Verify we're on a results page before scraping
    const currentTab = await chrome.tabs.get(tab.id);
    const isResultsPage = currentTab.url?.includes('/tickets/departure') ||
      currentTab.url?.includes('/train-routes') ||
      currentTab.url?.includes('/search') ||
      currentTab.url?.includes('/book');

    if (!isResultsPage) {
      console.log('Not on results page, URL:', currentTab.url);
      return null;
    }

    // Re-inject content script on the results page
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

    console.log('Waiting for train results to appear...');
    let resultsReady = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const readyCheck = await chrome.tabs.sendMessage(tab.id, { action: 'checkResultsReady' });
        if (readyCheck?.ready) {
          resultsReady = true;
          console.log('Train results are ready');
          break;
        }
      } catch (err) {
        console.log('Results check failed:', err.message);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (!resultsReady) {
      console.log('Train results did not appear after waiting');
      return null;
    }

    // Scrape prices from results, passing train number and class to find specific train
    let result;
    try {
      result = await chrome.tabs.sendMessage(tab.id, {
        action: 'scrapePrices',
        trainNumber: trip.trainNumber || null,
        ticketClass: trip.ticketClass || null
      });
    } catch (err) {
      console.log('Failed to scrape prices:', err.message);
      return null;
    }

    console.log('Scrape result:', result);

    // Log all trains found
    if (result?.trains && result.trains.length > 0) {
      console.log('=== All Trains Found ===');
      result.trains.forEach(train => {
        const priceList = train.prices.map(p => {
          const fareLabel = p.fareType && p.fareType !== 'standard' ? ` (${p.fareType})` : '';
          return p.className ? `${p.className}${fareLabel}: $${p.price}` : `$${p.price}`;
        }).join(', ');
        console.log(`  Train #${train.trainNumber}: ${priceList}`);
      });
      console.log('========================');
    }

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
