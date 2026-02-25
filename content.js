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
    if (message.action === 'scrapePrices') {
      scrapePricesWithPagination(message.trainNumber)
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

    return true;
  });

  /**
   * Fill out the Amtrak search form and submit it
   */
  async function fillAndSubmitSearchForm(trip) {
    try {
      // Wait for the SPA to fully load
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Fill origin using its specific ID
      const originInput = document.querySelector('#am-form-field-control-0');
      if (!originInput) {
        return { success: false, error: 'Could not find origin input' };
      }

      originInput.focus();

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
        console.error('Could not find destination input #am-form-field-control-2');
        return { success: false, error: 'Could not find destination input' };
      }

      destInput.focus();

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
          calendarBtn.click();
        } else {
          // Try clicking outside the calendar to close it
          document.body.click();
          // Also try Escape
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        console.error('Could not find date input');
      }

      // Wait longer for Angular form validation to complete
      await new Promise(resolve => setTimeout(resolve, 2000));

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
        console.error('Could not find search button');
        return { success: false, error: 'Could not find search button' };
      }

      // Check both disabled property and aria-disabled attribute
      const isDisabled = searchBtn.disabled || searchBtn.getAttribute('aria-disabled') === 'true';

      if (isDisabled) {
        searchBtn.disabled = false;
        searchBtn.removeAttribute('disabled');
        searchBtn.setAttribute('aria-disabled', 'false');
        searchBtn.classList.remove('disabled');
      }

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
      // Scrape current page for train cards with train numbers
      const pageResult = scrapeTrainCards(targetTrainNumber);

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
        break;
      }

      nextButton.click();
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // Deduplicate prices
    const uniquePrices = [...new Set(allPrices)];

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
    
    // Normalize target train number to string for comparison
    const targetStr = targetTrainNumber ? String(targetTrainNumber) : null;

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
      }
    });

    // If no cards found, fall back to general price scraping
    if (prices.length === 0) {
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
      console.error('Amtrak Price Tracker: Error scraping prices', error);
      return [];
    }
  }

} // End of double-execution guard

