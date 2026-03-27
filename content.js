/**
 * Content script for Amtrak Price Tracker
 * 
 * This script runs on Amtrak.com pages and can
 * scrape price information from search results
 */

// Helper to send logs to service worker (persists across page navigation)
function workerLog(...args) {
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  console.log('[Content]', ...args);
  try {
    chrome.runtime.sendMessage({ action: 'log', message: `[Content] ${message}` });
  } catch (e) {
  }
}

// Prevent multiple listener registrations
// Use a unique key per page context to handle SPA routing properly
if (window._amtrakPriceTrackerLoaded) {
  workerLog('Already loaded, skipping listener registration');
} else {
  window._amtrakPriceTrackerLoaded = true;
  workerLog('Initializing content script on', window.location.href);

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'log') return;
    workerLog('Received message:', message.action);
    if (message.action === 'scrapePrices') {
      scrapePricesWithPagination(message.trainNumber, message.ticketClass)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ prices: [], error: error.message }));
      return true; // Keep channel open for async response
    }

    if (message.action === 'fillAndSearch') {
      fillAndSubmitSearchForm(message.trip)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Keep channel open for async response
    }

    if (message.action === 'checkResultsReady') {
      // Check if train results are visible on the page
      const selectTrain = document.querySelector('.select-train');
      const journeyCards = document.querySelectorAll('am-journey-card');
      const isReady = !!(selectTrain || journeyCards.length > 0);
      workerLog('Results ready check:', isReady, '(select-train:', !!selectTrain, ', journey-cards:', journeyCards.length, ')');
      sendResponse({ ready: isReady });
      return true;
    }

    return true;
  });

  /**
   * Fill out the Amtrak search form and submit it
   */
  async function fillAndSubmitSearchForm(trip) {
    try {
      workerLog(' fillAndSubmitSearchForm called with:', JSON.stringify(trip));

      await new Promise(resolve => setTimeout(resolve, 3000));

      // Clear any existing form values first
      const allInputs = document.querySelectorAll('#am-form-field-control-0, #am-form-field-control-2, #am-form-field-control-4');
      for (const input of allInputs) {
        if (input) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, '');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500));

      // Fill origin using its specific ID
      const originInput = document.querySelector('#am-form-field-control-0');
      if (!originInput) {
        return { success: false, error: 'Could not find origin input' };
      }

      originInput.focus();
      workerLog(' Setting origin to:', trip.origin);

      const originSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      originSetter.call(originInput, trip.origin);
      originInput.dispatchEvent(new Event('input', { bubbles: true }));
      originInput.dispatchEvent(new Event('change', { bubbles: true }));

      // Wait for autocomplete dropdown
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Select first autocomplete option
      let autocomplete = document.querySelector('[role="listbox"] [role="option"], mat-option, .cdk-overlay-pane [role="option"]');
      if (autocomplete) {
        autocomplete.click();
      } else {
        originInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      }
      await new Promise(resolve => setTimeout(resolve, 800));

      // Fill destination using its specific ID
      const destInput = document.querySelector('#am-form-field-control-2');
      if (!destInput) {
        workerLog('ERROR: Could not find destination input #am-form-field-control-2');
        return { success: false, error: 'Could not find destination input' };
      }

      destInput.focus();
      workerLog(' Setting destination to:', trip.destination);

      const destSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      destSetter.call(destInput, trip.destination);
      destInput.dispatchEvent(new Event('input', { bubbles: true }));
      destInput.dispatchEvent(new Event('change', { bubbles: true }));

      await new Promise(resolve => setTimeout(resolve, 1500));

      // Select first autocomplete option for destination
      autocomplete = document.querySelector('[role="listbox"] [role="option"], mat-option, .cdk-overlay-pane [role="option"]');
      if (autocomplete) {
        autocomplete.click();
      } else {
        destInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      }
      await new Promise(resolve => setTimeout(resolve, 500));

      // Find and fill date input
      const dateInput = document.querySelector('#am-form-field-control-4');
      if (dateInput) {
        workerLog(' Found date input, attempting to fill date:', trip.travelDate);
        workerLog(' Full trip data for verification:', trip.origin, '->', trip.destination, 'on', trip.travelDate);
        const [year, month, day] = trip.travelDate.split('-');
        const formattedDate = `${month}/${day}/${year}`;

        dateInput.click();
        dateInput.focus();
        await new Promise(resolve => setTimeout(resolve, 500));

        const dateSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        dateSetter.call(dateInput, formattedDate);
        dateInput.dispatchEvent(new Event('input', { bubbles: true }));
        dateInput.dispatchEvent(new Event('change', { bubbles: true }));

        // Wait for calendar popup to appear
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Look for and click the Done/Find Trains button on the calendar popup
        let calendarBtn = null;
        const buttons = document.querySelectorAll('button');

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
              break;
            }
          }
        }

        if (calendarBtn) {
          workerLog(' Found calendar button, clicking it');
          calendarBtn.click();
        } else {
          // Try clicking outside the calendar to close it
          workerLog(' No calendar button found, clicking outside to close');
          document.body.click();
          // Also try Escape
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        // Verify date was set
        const dateValue = dateInput.value;
        workerLog(' Date input value after setting:', dateValue);
        if (!dateValue || dateValue.trim() === '') {
          workerLog('ERROR: WARNING - Date field is empty!');
        }
      } else {
        workerLog('ERROR: Could not find date input');
        return { success: false, error: 'Could not find date input field' };
      }

      // Wait longer for Angular form validation to complete
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify all form values before submitting
      const originValue = document.querySelector('#am-form-field-control-0')?.value || '';
      const destValue = document.querySelector('#am-form-field-control-2')?.value || '';
      const dateValue = dateInput?.value || '';
      workerLog(' Form values before submit:');
      workerLog('  Origin:', originValue, '(expected:', trip.origin, ')');
      workerLog('  Destination:', destValue, '(expected:', trip.destination, ')');
      workerLog('  Date:', dateValue, '(expected:', trip.travelDate, ')');

      // Find search button - look for "Find Trains" button
      let searchBtn = null;
      const allButtons = document.querySelectorAll('button');

      for (const btn of allButtons) {
        const text = (btn.textContent?.trim() || '').toLowerCase();
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
        // Exclude buttons in overlays/dialogs (calendar, etc.)
        const isInOverlay = btn.closest('.cdk-overlay-pane') || btn.closest('[role="dialog"]');

        if ((text.includes('find trains') || ariaLabel.includes('find trains')) && !isInOverlay) {
          searchBtn = btn;
          break;
        }
      }

      if (!searchBtn) {
        workerLog('ERROR: Could not find search button');
        return { success: false, error: 'Could not find search button' };
      }

      // Check both disabled property and aria-disabled attribute
      const isDisabled = searchBtn.disabled || searchBtn.getAttribute('aria-disabled') === 'true';

      if (isDisabled) {
        workerLog('Search button was disabled, enabling it');
        searchBtn.disabled = false;
        searchBtn.removeAttribute('disabled');
        searchBtn.setAttribute('aria-disabled', 'false');
        searchBtn.classList.remove('disabled');
      }

      workerLog('Clicking search button...');
      searchBtn.click();

      // Also try dispatching a click event directly
      searchBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      workerLog('Search button clicked, form submitted');
      return { success: true };

    } catch (error) {
      workerLog('ERROR: Error filling search form:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Scrape prices with pagination support
   * Pages through results to find a specific train number
   */
  async function scrapePricesWithPagination(targetTrainNumber, targetClass) {
    workerLog(' Scraping with pagination...');
    workerLog('Looking for train number:', targetTrainNumber || 'any');
    workerLog('Looking for class:', targetClass || 'any (lowest)');

    const maxPages = 5; // Safety limit
    let allPrices = [];
    let allTrains = [];
    let trainPrice = null;

    let previousDomSignature = null;

    for (let page = 0; page < maxPages; page++) {
      // Scrape current page for train cards with train numbers
      const pageResult = scrapeTrainCards(targetTrainNumber, targetClass);
      const currentDomSignature = getCurrentResultsSignature();

      // If we keep seeing the same page signature, pagination is not advancing.
      if (page > 0 && previousDomSignature && currentDomSignature === previousDomSignature) {
        workerLog('Pagination did not advance (same results signature), stopping');
        break;
      }
      previousDomSignature = currentDomSignature;

      // Collect all prices and trains
      allPrices = allPrices.concat(pageResult.prices);
      allTrains = allTrains.concat(pageResult.trains || []);

      // If we found the target train, return immediately
      if (pageResult.trainPrice !== null) {
        workerLog(`Found target train #${targetTrainNumber} with price $${pageResult.trainPrice}`);
        return { prices: allPrices, trains: allTrains, trainPrice: pageResult.trainPrice };
      }

      // If no target train specified, just return first page results
      if (!targetTrainNumber) {
        break;
      }

      // Look for "next" or "later" button to see more trains
      const nextButton = findNextPageButton();
      if (!nextButton) {
        workerLog('No next-page button found, stopping pagination');
        break;
      }

      const clicked = clickButtonSafely(nextButton);
      if (!clicked) {
        workerLog('Could not click next-page button, stopping pagination');
        break;
      }

      const changed = await waitForResultsChange(currentDomSignature, 8000);
      if (!changed) {
        workerLog('Clicked next-page button but results did not change, stopping pagination');
        break;
      }

      const activePage = getActiveResultsPage();
      workerLog(`Moved to next results page (${activePage || page + 2})`);
    }

    // Deduplicate prices
    const uniquePrices = [...new Set(allPrices)];

    return { prices: uniquePrices, trains: allTrains, trainPrice: null };
  }

  /**
   * Find the button to load more/next results
   */
  function findNextPageButton() {
    const explicitNext = document.querySelector('li.pagination-next[aria-disabled="false"] a.page-link, li.pagination-next:not([aria-disabled="true"]) a.page-link');
    if (explicitNext && isControlEnabled(explicitNext)) {
      return explicitNext;
    }

    const pageLinks = document.querySelectorAll('a.page-link, button.page-link');
    for (const btn of pageLinks) {
      if (!isControlEnabled(btn)) continue;

      const text = (btn.textContent?.trim() || '').toLowerCase();
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
      const title = (btn.getAttribute('title') || '').toLowerCase();
      const rel = (btn.getAttribute('rel') || '').toLowerCase();

      const looksLikeNext =
        text === '>' || text === '›' || text === '»' ||
        text.includes('next') || text.includes('later') ||
        ariaLabel.includes('next') || ariaLabel.includes('later') ||
        title.includes('next') || title.includes('later') ||
        rel === 'next';

      if (looksLikeNext) {
        return btn;
      }
    }

    return null;
  }

  function isControlEnabled(btn) {
    if (!btn) return false;
    const isDisabled =
      (typeof btn.disabled === 'boolean' && btn.disabled) ||
      btn.getAttribute('disabled') !== null ||
      btn.getAttribute('aria-disabled') === 'true' ||
      btn.closest('[aria-disabled="true"], .disabled, .is-disabled, [class*="disabled"]');
    return !isDisabled;
  }

  function clickButtonSafely(btn) {
    try {
      btn.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
      btn.focus();
      btn.click();
      return true;
    } catch (error) {
      workerLog('ERROR: Failed to click next-page button:', error.message);
      return false;
    }
  }

  function getActiveResultsPage() {
    const activePageEl = document.querySelector('[aria-current="page"], .active .page-link, .page-item.active .page-link');
    const activeText = (activePageEl?.textContent || '').trim();
    const pageMatch = activeText.match(/\d+/);
    return pageMatch ? Number(pageMatch[0]) : null;
  }

  function getCurrentResultsSignature() {
    const cards = document.querySelectorAll('am-journey-card');
    const firstTrainNums = [];

    for (const card of cards) {
      const trainNameEl = card.querySelector('.train-name span');
      const trainText = (trainNameEl?.textContent || '').trim();
      const trainMatch = trainText.match(/\d{1,4}/);
      if (trainMatch) {
        firstTrainNums.push(trainMatch[0]);
      }
      if (firstTrainNums.length >= 5) break;
    }

    const activePage = getActiveResultsPage();

    return JSON.stringify({
      activePage,
      firstTrainNums
    });
  }

  async function waitForResultsChange(previousDomSignature, timeoutMs = 8000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 500));

      const domSignature = getCurrentResultsSignature();
      if (domSignature !== previousDomSignature) {
        return true;
      }
    }

    return false;
  }

  /**
   * Scrape train cards from the current page
   * Returns prices and optionally the price for a specific train and class
   */
  function scrapeTrainCards(targetTrainNumber, targetClass) {
    const prices = [];
    const trains = [];  // Array to store train details
    let trainPrice = null;

    // Normalize target train number to string for comparison
    const targetStr = targetTrainNumber ? String(targetTrainNumber) : null;
    // Normalize target class to lowercase for comparison
    const targetClassLower = targetClass ? targetClass.toLowerCase() : null;

    // Look for am-journey-card elements (Amtrak's Angular component)
    let cards = document.querySelectorAll('am-journey-card');

    // Fallback to broader selectors if no journey cards found
    if (cards.length === 0) {
      cards = document.querySelectorAll('[data-testid*="journey-card"], [class*="journey-card"]');
    }

    workerLog(`Found ${cards.length} am-journey-card elements`);

    cards.forEach((card, index) => {
      // Extract train number from .train-name element
      const trainNameEl = card.querySelector('.train-name');
      let cardTrainNumber = null;

      if (trainNameEl) {
        // Get the first span which contains the train number
        const trainNumberSpan = trainNameEl.querySelector('span');
        if (trainNumberSpan) {
          const trainText = trainNumberSpan.textContent.trim();
          const trainMatch = trainText.match(/^\d{1,4}$/);
          if (trainMatch) {
            cardTrainNumber = trainMatch[0];
          }
        }
      }

      // Fallback: try regex on full card text
      if (!cardTrainNumber) {
        const cardText = card.textContent || '';
        const trainMatch = cardText.match(/(?:Train|#)\s*(\d{1,4})\b/i);
        cardTrainNumber = trainMatch ? trainMatch[1] : null;
      }

      // Debug: if this might be our target train, log more details
      if (targetStr && String(cardTrainNumber) === targetStr) {
        workerLog(`  FOUND TARGET - Card ${index + 1}: Train #${cardTrainNumber}`);
      } else if (cardTrainNumber) {
        workerLog(`  Card ${index + 1}: Train #${cardTrainNumber}`);
      }

      // Look for class-fare buttons within this card
      const fareButtons = card.querySelectorAll('.class-fare');
      let classPricesMap = new Map(); // Use Map to dedupe by class+price

      // Debug: log button count for target train
      if (targetStr && String(cardTrainNumber) === targetStr) {
        workerLog(`  Scanning ${fareButtons.length} .class-fare buttons for Train #${cardTrainNumber}:`);
      }

      fareButtons.forEach(btn => {
        // Get class title (Coach, Business, First)
        const classTitleEl = btn.querySelector('.class-title');
        const classTitle = classTitleEl ? classTitleEl.textContent.trim().toLowerCase() : null;

        // Get price from .price-tag element
        const priceTagEl = btn.querySelector('.price-tag');
        let price = null;

        if (priceTagEl) {
          const priceText = priceTagEl.textContent.trim().replace(',', '');
          price = parseFloat(priceText);
        }

        // Check for "Not Offered" or unavailable
        const isUnavailable = btn.classList.contains('class-unavailable') ||
          btn.querySelector('.unavailable-text, .not-available-text');

        if (price && price >= 20 && price <= 2000 && !isUnavailable) {
          // Debug: log for target train
          if (targetStr && String(cardTrainNumber) === targetStr) {
            workerLog(`    Found: ${classTitle} $${price}`);
          }

          // Determine normalized class name
          let className = null;
          if (classTitle?.includes('coach')) className = 'coach';
          else if (classTitle?.includes('business')) className = 'business';
          else if (classTitle?.includes('first')) className = 'first';

          // Use class+price as key to deduplicate
          const key = `${className}-${price}`;
          if (!classPricesMap.has(key)) {
            classPricesMap.set(key, { price, className, fareType: 'standard' });
          }
        }
      });

      // Fallback: try the old method if no prices found with new selectors
      if (classPricesMap.size === 0) {
        const classButtons = card.querySelectorAll('button, [class*="fare"], [class*="price"]');
        classButtons.forEach(btn => {
          const btnText = (btn.textContent || '').toLowerCase();
          const priceMatch = btnText.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
          if (priceMatch) {
            const price = parseFloat(priceMatch[1].replace(',', ''));
            if (price >= 20 && price <= 2000) {
              let className = null;
              if (btnText.includes('coach')) className = 'coach';
              else if (btnText.includes('business')) className = 'business';
              else if (btnText.includes('first')) className = 'first';

              const key = `${className}-${price}`;
              if (!classPricesMap.has(key)) {
                classPricesMap.set(key, { price, className, fareType: 'standard' });
              }
            }
          }
        });
      }

      const classPrices = Array.from(classPricesMap.values());

      // If we found class-specific prices
      if (classPrices.length > 0) {
        classPrices.forEach(cp => prices.push(cp.price));

        // Add train details to trains array
        if (cardTrainNumber) {
          workerLog(`    Train #${cardTrainNumber} fares:`, classPrices.map(cp =>
            `${cp.className || 'unknown'}${cp.fareType !== 'standard' ? ` (${cp.fareType})` : ''}: $${cp.price}`
          ).join(', '));

          trains.push({
            trainNumber: cardTrainNumber,
            prices: classPrices
          });
        }

        // Check if this is our target train
        if (targetStr && String(cardTrainNumber) === targetStr) {
          // Look for the target class price
          if (targetClassLower) {
            const classMatch = classPrices.find(cp => cp.className === targetClassLower);

            if (classMatch) {
              workerLog(`Match! Train #${cardTrainNumber} ${targetClassLower} price: $${classMatch.price}`);
              trainPrice = classMatch.price;
            } else {
              // Class not found on this train, use lowest as fallback
              const lowestPrice = Math.min(...classPrices.map(cp => cp.price));
              workerLog(`Train #${cardTrainNumber} found but ${targetClassLower} class not available. Lowest: $${lowestPrice}`);
              trainPrice = lowestPrice;
            }
          } else {
            // No target class specified, use lowest price
            trainPrice = Math.min(...classPrices.map(cp => cp.price));
            workerLog(`Match! Train #${cardTrainNumber} lowest price: $${trainPrice}`);
          }
        }
      } else {
        // Fallback: extract any price from the card text
        const priceMatch = cardText.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
        const cardPrice = priceMatch ? parseFloat(priceMatch[1].replace(',', '')) : null;

        if (cardPrice && cardPrice >= 20 && cardPrice <= 2000) {
          prices.push(cardPrice);

          // Check if this is our target train
          if (targetStr && String(cardTrainNumber) === targetStr) {
            workerLog(`Match! Train #${cardTrainNumber} price: $${cardPrice}`);
            trainPrice = cardPrice;
          }
        }
      }
    });

    // If no cards found, fall back to general price scraping
    if (prices.length === 0) {
      workerLog(' No train cards with prices found, using fallback scraper');
      const generalPrices = scrapePricesFromPage();
      return { prices: generalPrices, trainPrice: null };
    }

    if (targetTrainNumber && trainPrice === null) {
      workerLog(`Train #${targetTrainNumber} not found on this page`);
    }

    workerLog(`Found ${prices.length} prices on page, ${trains.length} trains identified`);
    return { prices, trains, trainPrice };
  }

  /**
   * Scrape prices from Amtrak search results page
   * This function finds all prices displayed on the booking page
   */
  function scrapePricesFromPage() {
    const prices = [];
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

      priceElements.forEach(el => {
        const priceText = el.textContent.trim();
        // Match prices like $49, $149.00, $1,234
        const priceMatch = priceText.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
        if (priceMatch) {
          const price = parseFloat(priceMatch[1].replace(',', ''));
          // Filter to reasonable train prices ($20-$2000)
          if (price >= 20 && price <= 2000) {
            prices.push(price);
          }
        }
      });

      // Method 2: Broader text search if no specific elements found
      if (prices.length === 0) {
        const pageText = document.body.innerText;
        const allPriceMatches = pageText.match(/\$\s*(\d{2,4}(?:\.\d{2})?)/g);

        if (allPriceMatches) {
          allPriceMatches.forEach(match => {
            const price = parseFloat(match.replace(/[\$,\s]/g, ''));
            if (price >= 20 && price <= 2000) {
              prices.push(price);
            }
          });
        }
      }

      // Remove duplicates
      const uniquePrices = [...new Set(prices)];
      return uniquePrices;
    } catch (error) {
      workerLog('ERROR: Error scraping prices', error.message);
      return [];
    }
  }

} // End of double-execution guard

