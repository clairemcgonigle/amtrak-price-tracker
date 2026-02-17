/**
 * Content script for Amtrak Price Tracker
 * 
 * This script runs on Amtrak.com pages and can:
 * 1. Make API calls with proper session cookies
 * 2. Scrape price information from search results
 * 3. Extract booking confirmation details
 */

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fetchPrice') {
    fetchPriceFromAPI(message.trip)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
  
  if (message.action === 'scrapePrices') {
    const prices = scrapePricesFromPage();
    sendResponse({ prices });
  }
  
  if (message.action === 'getPageData') {
    const data = extractPageData();
    sendResponse({ data });
  }
  
  return true;
});

/**
 * Fetch price from Amtrak's API (runs in page context with cookies)
 */
async function fetchPriceFromAPI(trip) {
  const apiUrl = 'https://www.amtrak.com/dotcom/journey-solution-option';
  
  const payload = {
    journeyRequest: {
      customer: {
        tierStatus: "Member"
      },
      fare: {
        pricingUnit: "DOLLARS"
      },
      journeyLegRequests: [
        {
          destination: {
            code: trip.destination,
            schedule: {
              arrivalDateTime: "NA"
            }
          },
          origin: {
            code: trip.origin,
            schedule: {
              departureDateTime: `${trip.travelDate}T00:00:00`
            }
          },
          passengers: [
            {
              id: "P1",
              isDiscounted: false,
              isModified: false,
              type: "F"
            }
          ]
        }
      ],
      type: "One-Way",
      isPassRider: false,
      additionalAccoms: false,
      tripTags: false,
      alternateDayOption: false,
      includeTrainsCloseToDeparture: false,
      priceAllRBD: false,
      cascadesWSDOTFilter: false,
      singleAdultFare: true,
      segmentPrice: false,
      includeRestricted: false,
      includeDeparted: false
    }
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*'
      },
      credentials: 'include',  // Include cookies!
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    
    if (!data.success || !data.data?.journeySolutionOption?.journeyLegs?.[0]) {
      return { success: false, error: 'No journey data in response' };
    }

    // Parse response to find lowest price
    const journeyLeg = data.data.journeySolutionOption.journeyLegs[0];
    const journeyOptions = journeyLeg.journeyLegOptions || [];
    
    let lowestPrice = null;
    let matchedTrain = null;
    
    for (const option of journeyOptions) {
      const trainNumber = option.travelLegs?.[0]?.travelService?.number;
      
      // If user specified train number, filter to that train
      if (trip.trainNumber && trainNumber !== trip.trainNumber) {
        continue;
      }
      
      const accommodations = option.reservableAccommodations || [];
      
      // Look for Coach Value fare first (cheapest)
      for (const accom of accommodations) {
        if (accom.travelClass === 'Coach' && accom.fareFamily === 'VLU') {
          const price = parseFloat(accom.accommodationFare?.dollarsAmount?.total);
          if (!isNaN(price) && (lowestPrice === null || price < lowestPrice)) {
            lowestPrice = price;
            matchedTrain = trainNumber;
          }
        }
      }
      
      // Fallback to any Coach fare
      if (lowestPrice === null) {
        for (const accom of accommodations) {
          if (accom.travelClass === 'Coach') {
            const price = parseFloat(accom.accommodationFare?.dollarsAmount?.total);
            if (!isNaN(price) && (lowestPrice === null || price < lowestPrice)) {
              lowestPrice = price;
              matchedTrain = trainNumber;
            }
          }
        }
      }
    }
    
    if (lowestPrice !== null) {
      return { 
        success: true, 
        price: lowestPrice,
        trainNumber: matchedTrain
      };
    } else {
      return { success: false, error: 'No prices found in response' };
    }
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Scrape prices from Amtrak search results page
 * This function attempts to find price elements on the booking page
 */
function scrapePricesFromPage() {
  const prices = [];
  
  // NOTE: These selectors are examples and will need to be updated
  // based on Amtrak's actual page structure. Use Chrome DevTools
  // to inspect the page and find the correct selectors.
  
  try {
    // Look for train result cards
    // Amtrak typically shows results in a list format
    const trainResults = document.querySelectorAll('[data-testid="train-result"], .train-result, .trip-result');
    
    trainResults.forEach((result, index) => {
      const trainInfo = extractTrainInfo(result);
      if (trainInfo) {
        prices.push(trainInfo);
      }
    });

    // Alternative: Look for price elements directly
    if (prices.length === 0) {
      const priceElements = document.querySelectorAll('[class*="price"], [class*="fare"], .amount');
      priceElements.forEach(el => {
        const priceText = el.textContent.trim();
        const priceMatch = priceText.match(/\$?([\d,]+\.?\d*)/);
        if (priceMatch) {
          prices.push({
            price: parseFloat(priceMatch[1].replace(',', '')),
            element: el.className
          });
        }
      });
    }
  } catch (error) {
    console.error('Amtrak Price Tracker: Error scraping prices', error);
  }

  return prices;
}

/**
 * Extract train information from a result card
 */
function extractTrainInfo(resultElement) {
  try {
    // These selectors need to match Amtrak's actual DOM structure
    const trainNumber = resultElement.querySelector('[class*="train-number"], .train-num')?.textContent?.trim();
    const departureTime = resultElement.querySelector('[class*="depart"], .departure-time')?.textContent?.trim();
    const arrivalTime = resultElement.querySelector('[class*="arrive"], .arrival-time')?.textContent?.trim();
    const priceElement = resultElement.querySelector('[class*="price"], [class*="fare"]');
    
    let price = null;
    if (priceElement) {
      const priceMatch = priceElement.textContent.match(/\$?([\d,]+\.?\d*)/);
      if (priceMatch) {
        price = parseFloat(priceMatch[1].replace(',', ''));
      }
    }

    return {
      trainNumber,
      departureTime,
      arrivalTime,
      price
    };
  } catch (error) {
    return null;
  }
}

/**
 * Extract general page data (for debugging/development)
 */
function extractPageData() {
  return {
    url: window.location.href,
    title: document.title,
    hasResults: document.querySelector('[class*="result"], [class*="train"]') !== null
  };
}

/**
 * Observer to detect when search results load (for dynamic pages)
 */
function setupResultsObserver(callback) {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        // Check if results have loaded
        const results = document.querySelectorAll('[class*="result"], [class*="train"]');
        if (results.length > 0) {
          callback(scrapePricesFromPage());
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  return observer;
}

/**
 * Helper to highlight a price drop on the page (for user awareness)
 */
function highlightPriceDrop(element) {
  if (element) {
    element.style.backgroundColor = '#d4edda';
    element.style.border = '2px solid #28a745';
    element.style.borderRadius = '4px';
    element.style.padding = '2px 4px';
  }
}

// Log that content script is loaded (for debugging)
console.log('Amtrak Price Tracker: Content script loaded on', window.location.href);

