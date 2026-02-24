/**
 * Content script for Amtrak Price Tracker
 * 
 * This script runs on Amtrak.com pages and can:
 * 1. Make API calls with proper session cookies
 * 2. Scrape price information from search results
 * 3. Extract booking confirmation details
 */

// Prevent double execution
if (window._amtrakPriceTrackerLoaded) {
  console.log('Amtrak Price Tracker: Already loaded, skipping');
} else {
  window._amtrakPriceTrackerLoaded = true;

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fetchPrice') {
    fetchPriceFromAPI(message.trip)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
  
  if (message.action === 'scrapePrices') {
    scrapePricesWithPagination(message.trainNumber)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ prices: [], error: error.message }));
    return true; // Keep channel open for async response
  }
  
  if (message.action === 'getPageData') {
    const data = extractPageData();
    sendResponse({ data });
  }
  
  if (message.action === 'fillAndSearch') {
    fillAndSubmitSearchForm(message.trip)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
  
  return true;
});

/**
 * Fill out the Amtrak search form and submit it
 */
async function fillAndSubmitSearchForm(trip) {
  console.log('Amtrak Price Tracker: Filling search form...', trip);
  
  try {
    // Wait for the SPA to fully load
    console.log('Waiting for page to fully load...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Fill origin using its specific ID
    const originInput = document.querySelector('#am-form-field-control-0');
    if (!originInput) {
      console.log('Could not find origin input #am-form-field-control-0');
      return { success: false, error: 'Could not find origin input' };
    }
    
    console.log('Found origin input:', originInput);
    
    // Fill origin - set value and trigger Angular change detection
    originInput.focus();
    
    // Use native setter to trigger Angular's value accessor
    const originSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    originSetter.call(originInput, trip.origin);
    originInput.dispatchEvent(new Event('input', { bubbles: true }));
    originInput.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Wait for autocomplete dropdown
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Select first autocomplete option
    let autocomplete = document.querySelector('[role="listbox"] [role="option"], mat-option, .cdk-overlay-pane [role="option"]');
    if (autocomplete) {
      console.log('Clicking autocomplete option:', autocomplete.textContent?.trim());
      autocomplete.click();
    } else {
      // Press Enter to confirm
      originInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    }
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Fill destination using its specific ID
    const destInput = document.querySelector('#am-form-field-control-2');
    if (!destInput) {
      console.log('Could not find destination input #am-form-field-control-2');
      return { success: false, error: 'Could not find destination input' };
    }
    
    console.log('Found destination input:', destInput);
    
    // Fill destination
    destInput.focus();
    
    const destSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    destSetter.call(destInput, trip.destination);
    destInput.dispatchEvent(new Event('input', { bubbles: true }));
    destInput.dispatchEvent(new Event('change', { bubbles: true }));
    
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Select first autocomplete option for destination
    autocomplete = document.querySelector('[role="listbox"] [role="option"], mat-option, .cdk-overlay-pane [role="option"]');
    if (autocomplete) {
      console.log('Clicking destination autocomplete:', autocomplete.textContent?.trim());
      autocomplete.click();
    } else {
      destInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Find and fill date input - convert YYYY-MM-DD to MM/DD/YYYY
    const dateInput = document.querySelector('#am-form-field-control-4');
    if (dateInput) {
      console.log('Found date input:', dateInput);
      
      // Convert date format from YYYY-MM-DD to MM/DD/YYYY
      const [year, month, day] = trip.travelDate.split('-');
      const formattedDate = `${month}/${day}/${year}`;
      console.log('Setting date to:', formattedDate);
      
      // Click to open the date picker
      dateInput.click();
      dateInput.focus();
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Set the value
      const dateSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      dateSetter.call(dateInput, formattedDate);
      dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
      
      // Wait for calendar popup to appear
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Look for and click the Done/Find Trains button on the calendar popup
      console.log('Looking for calendar confirmation button...');
      let calendarBtn = null;
      const buttons = document.querySelectorAll('button');
      
      // Log all buttons for debugging
      console.log('Available buttons:');
      buttons.forEach((btn, i) => {
        const text = btn.textContent?.trim() || '';
        if (text && text.length < 30) {
          console.log(`Button ${i}: "${text}"`);
        }
      });
      
      // Look for the calendar's confirm button
      for (const btn of buttons) {
        const text = btn.textContent?.trim().toLowerCase() || '';
        // Match various possible button texts
        if (text.includes('find trains') || text.includes('done') || 
            text.includes('apply') || text.includes('ok') || 
            text.includes('select') || text.includes('confirm')) {
          // Make sure it's inside a calendar/datepicker overlay, not the main form
          const isInOverlay = btn.closest('.cdk-overlay-pane') || 
                              btn.closest('[class*="calendar"]') || 
                              btn.closest('[class*="datepicker"]') ||
                              btn.closest('[class*="picker"]');
          if (isInOverlay) {
            calendarBtn = btn;
            console.log('Found calendar button:', btn.textContent?.trim());
            break;
          }
        }
      }
      
      if (calendarBtn) {
        calendarBtn.click();
        console.log('Clicked calendar button');
      } else {
        // Try clicking outside the calendar to close it
        console.log('No calendar button found, clicking outside to close');
        document.body.click();
        // Also try Escape
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    } else {
      console.log('Could not find date input');
    }
    
    // Wait longer for Angular form validation to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Find search button - look for "Find Trains" button
    let searchBtn = null;
    const allButtons = document.querySelectorAll('button');
    console.log(`Found ${allButtons.length} buttons, looking for Find Trains...`);
    
    for (const btn of allButtons) {
      const text = (btn.textContent?.trim() || '').toLowerCase();
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
      // Exclude buttons in overlays/dialogs (calendar, etc.)
      const isInOverlay = btn.closest('.cdk-overlay-pane') || btn.closest('[role="dialog"]');
      
      if ((text.includes('find trains') || ariaLabel.includes('find trains')) && !isInOverlay) {
        console.log('Candidate button:', btn.textContent?.trim(), 'aria-label:', btn.getAttribute('aria-label'), 'disabled:', btn.disabled, 'aria-disabled:', btn.getAttribute('aria-disabled'));
        searchBtn = btn;
        break;
      }
    }
    
    if (!searchBtn) {
      console.log('Could not find search button');
      return { success: false, error: 'Could not find search button' };
    }
    
    console.log('Found search button:', searchBtn.textContent?.trim());
    console.log('Button disabled property:', searchBtn.disabled);
    console.log('Button aria-disabled:', searchBtn.getAttribute('aria-disabled'));
    
    // Check both disabled property and aria-disabled attribute
    const isDisabled = searchBtn.disabled || searchBtn.getAttribute('aria-disabled') === 'true';
    
    if (isDisabled) {
      console.log('Button appears disabled - attempting to enable and click...');
      searchBtn.disabled = false;
      searchBtn.removeAttribute('disabled');
      searchBtn.setAttribute('aria-disabled', 'false');
      searchBtn.classList.remove('disabled');
    }
    
    // Click the button
    console.log('Clicking search button...');
    searchBtn.click();
    
    // Also try dispatching a click event directly
    searchBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    
    return { success: true };
    
  } catch (error) {
    console.error('Error filling search form:', error);
    return { success: false, error: error.message };
  }
}

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
 * Scrape prices with pagination support
 * Pages through results to find a specific train number
 */
async function scrapePricesWithPagination(targetTrainNumber) {
  console.log('Amtrak Price Tracker: Scraping with pagination...');
  console.log('Looking for train number:', targetTrainNumber || 'any');
  
  const maxPages = 5; // Safety limit
  let allPrices = [];
  let trainPrice = null;
  
  for (let page = 0; page < maxPages; page++) {
    console.log(`Checking page ${page + 1}...`);
    
    // Scrape current page for train cards with train numbers
    const pageResult = scrapeTrainCards(targetTrainNumber);
    console.log(`Page ${page + 1} result:`, pageResult);
    
    // Collect all prices
    allPrices = allPrices.concat(pageResult.prices);
    
    // If we found the target train, return immediately
    if (pageResult.trainPrice !== null) {
      console.log(`Found target train #${targetTrainNumber} with price $${pageResult.trainPrice}`);
      return { prices: allPrices, trainPrice: pageResult.trainPrice };
    }
    
    // If no target train specified, just return first page results
    if (!targetTrainNumber) {
      break;
    }
    
    // Look for "next" or "later" button to see more trains
    const nextButton = findNextPageButton();
    if (!nextButton) {
      console.log('No more pages available');
      break;
    }
    
    // Click next and wait for results to load
    console.log('Clicking next page button...');
    nextButton.click();
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  // Deduplicate prices
  const uniquePrices = [...new Set(allPrices)];
  console.log('Final prices found:', uniquePrices);
  
  return { prices: uniquePrices, trainPrice: null };
}

/**
 * Find the button to load more/next results
 */
function findNextPageButton() {
  // First look for the specific Amtrak pagination button with ">" text
  const pageLinks = document.querySelectorAll('button.page-link');
  for (const btn of pageLinks) {
    const text = btn.textContent?.trim() || '';
    // The "next" button contains ">" 
    if (text === '>' || text === '›' || text === '»') {
      if (!btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
        console.log('Found next page button (>)');
        return btn;
      }
    }
  }
  
  const buttons = document.querySelectorAll('button');
  
  for (const btn of buttons) {
    const text = (btn.textContent?.trim() || '').toLowerCase();
    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
    
    // Look for pagination/load more buttons
    if (text.includes('later') || text.includes('next') || 
        text.includes('more trains') || text.includes('show more') ||
        ariaLabel.includes('later') || ariaLabel.includes('next')) {
      // Make sure it's not disabled
      if (!btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
        console.log('Found next button:', btn.textContent?.trim());
        return btn;
      }
    }
  }
  
  // Also look for arrow/chevron buttons
  const arrowButtons = document.querySelectorAll('[class*="arrow"], [class*="chevron"], [class*="next"]');
  for (const btn of arrowButtons) {
    if (btn.tagName === 'BUTTON' && !btn.disabled) {
      return btn;
    }
  }
  
  return null;
}

/**
 * Scrape train cards from the current page
 * Returns prices and optionally the price for a specific train
 */
function scrapeTrainCards(targetTrainNumber) {
  const prices = [];
  let trainPrice = null;
  
  // Log page state for debugging
  console.log('Current URL:', window.location.href);
  console.log('Page title:', document.title);
  
  // Look for train result cards - these usually contain train number and price together
  const cardSelectors = [
    '[class*="journey"]',
    '[class*="train-card"]',
    '[class*="result-card"]',
    '[class*="trip-option"]',
    '[class*="segment"]',
    '[data-testid*="journey"]',
    '[data-testid*="train"]'
  ];
  
  const cards = document.querySelectorAll(cardSelectors.join(', '));
  console.log(`Found ${cards.length} train cards`);
  
  cards.forEach((card, index) => {
    const cardText = card.textContent || '';
    
    // Try to extract train number from the card
    // Amtrak trains are typically 1-4 digit numbers
    const trainMatch = cardText.match(/(?:Train|#)\s*(\d{1,4})\b/i) || 
                       cardText.match(/\b(\d{3,4})\b.*(?:Acela|Regional|Northeast|Empire)/i);
    const cardTrainNumber = trainMatch ? trainMatch[1] : null;
    
    // Extract price from the card
    const priceMatch = cardText.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
    const cardPrice = priceMatch ? parseFloat(priceMatch[1].replace(',', '')) : null;
    
    if (cardPrice && cardPrice >= 20 && cardPrice <= 2000) {
      prices.push(cardPrice);
      
      // Check if this is our target train
      if (targetTrainNumber && cardTrainNumber === targetTrainNumber) {
        console.log(`Match! Train #${cardTrainNumber} price: $${cardPrice}`);
        trainPrice = cardPrice;
      }
      
      console.log(`Card ${index}: Train #${cardTrainNumber || 'unknown'}, Price: $${cardPrice}`);
    }
  });
  
  // If no cards found, fall back to general price scraping
  if (prices.length === 0) {
    console.log('No train cards found, using general scraping...');
    const generalPrices = scrapePricesFromPage();
    return { prices: generalPrices, trainPrice: null };
  }
  
  return { prices, trainPrice };
}

/**
 * Scrape prices from Amtrak search results page
 * This function finds all prices displayed on the booking page
 */
function scrapePricesFromPage() {
  const prices = [];
  
  console.log('Amtrak Price Tracker: Scraping prices from page...');
  console.log('Current URL:', window.location.href);
  
  try {
    // Method 1: Look for specific fare/price elements
    const priceSelectors = [
      '[class*="price"]',
      '[class*="fare"]',
      '[class*="cost"]',
      '[class*="amount"]',
      '[data-test*="price"]',
      '[data-testid*="price"]',
      '[data-testid*="fare"]',
      'span[class*="dollar"]',
      '.journey-card-price',
      '.trip-price',
      '.coach-price',
      '.business-price'
    ];
    
    const priceElements = document.querySelectorAll(priceSelectors.join(', '));
    console.log(`Found ${priceElements.length} potential price elements`);
    
    priceElements.forEach(el => {
      const priceText = el.textContent.trim();
      // Match prices like $49, $149.00, $1,234
      const priceMatch = priceText.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
      if (priceMatch) {
        const price = parseFloat(priceMatch[1].replace(',', ''));
        // Filter to reasonable train prices ($20-$2000)
        if (price >= 20 && price <= 2000) {
          prices.push(price);
          console.log(`Found price: $${price} in element:`, el.className);
        }
      }
    });

    // Method 2: Broader text search if no specific elements found
    if (prices.length === 0) {
      console.log('No price elements found, searching page text...');
      const pageText = document.body.innerText;
      const allPriceMatches = pageText.match(/\$\s*(\d{2,4}(?:\.\d{2})?)/g);
      
      if (allPriceMatches) {
        allPriceMatches.forEach(match => {
          const price = parseFloat(match.replace(/[\$,\s]/g, ''));
          if (price >= 20 && price <= 2000) {
            prices.push(price);
          }
        });
        console.log(`Found ${prices.length} prices in page text`);
      }
    }

    // Remove duplicates
    const uniquePrices = [...new Set(prices)];
    console.log('Unique prices found:', uniquePrices);
    
    return uniquePrices;
    
  } catch (error) {
    console.error('Amtrak Price Tracker: Error scraping prices', error);
    return [];
  }
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

} // End of double-execution guard

