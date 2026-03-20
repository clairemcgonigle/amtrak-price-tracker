import { saveTrip, getTrips, deleteTrip, getSettings, saveSettings } from './storage.js';

const tripForm = document.getElementById('trip-form');
const tripsList = document.getElementById('trips-list');
const checkNowBtn = document.getElementById('check-now');
const checkIntervalSelect = document.getElementById('check-interval');
const lastCheckedSpan = document.getElementById('last-checked');
const emailNotificationsCheckbox = document.getElementById('email-notifications');
const emailInputGroup = document.getElementById('email-input-group');
const notificationEmailInput = document.getElementById('notification-email');
const saveEmailBtn = document.getElementById('save-email');
const testEmailBtn = document.getElementById('test-email');
const refreshBtn = document.getElementById('refresh-trips');
const settingsToggle = document.getElementById('settings-toggle');
const settingsSection = document.getElementById('settings-section');

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadTrips();
  await loadSettings();
  updateLastChecked();
});

// Settings accordion toggle
settingsToggle.addEventListener('click', () => {
  settingsSection.classList.toggle('collapsed');
});

// Refresh button
refreshBtn.addEventListener('click', async () => {
  refreshBtn.classList.add('spinning');
  await loadTrips();
  updateLastChecked();
  setTimeout(() => refreshBtn.classList.remove('spinning'), 500);
});

// Form submission - Add new trip
tripForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const trip = {
    id: generateId(),
    origin: document.getElementById('origin').value.toUpperCase().trim(),
    destination: document.getElementById('destination').value.toUpperCase().trim(),
    travelDate: document.getElementById('travel-date').value,
    trainNumber: document.getElementById('train-number').value.trim() || null,
    pricePaid: parseFloat(document.getElementById('price-paid').value),
    ticketClass: document.getElementById('ticket-class').value || null,
    currentPrice: null,
    lastChecked: null,
    priceHistory: [],
    createdAt: new Date().toISOString()
  };

  await saveTrip(trip);
  tripForm.reset();
  await loadTrips();

  // Trigger a price check for the new trip
  chrome.runtime.sendMessage({ action: 'checkPrices' });
});

// Load and display trips
async function loadTrips() {
  const trips = await getTrips();

  if (trips.length === 0) {
    tripsList.innerHTML = '<p class="empty-state">No trips being tracked yet.</p>';
    return;
  }

  tripsList.innerHTML = trips.map(trip => createTripCard(trip)).join('');

  // Add delete button listeners
  tripsList.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const button = e.currentTarget;
      const tripId = button.dataset.tripId;
      await deleteTrip(tripId);
      await loadTrips();
    });
  });

  // Draw price history charts
  drawAllCharts();

  // Add scroll listeners for pagination dots
  tripsList.querySelectorAll('.trip-card-wrapper').forEach(wrapper => {
    const container = wrapper.querySelector('.trip-card-container');
    const dots = wrapper.querySelectorAll('.pagination-dot');

    container.addEventListener('scroll', () => {
      const scrollLeft = container.scrollLeft;
      const cardWidth = container.offsetWidth;
      const activeIndex = Math.round(scrollLeft / cardWidth);
      dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === activeIndex);
      });
    });

    // Click on dots to navigate
    dots.forEach(dot => {
      dot.addEventListener('click', () => {
        const index = parseInt(dot.dataset.index);
        const cardWidth = container.offsetWidth;
        container.scrollTo({ left: index * cardWidth, behavior: 'smooth' });
      });
    });
  });
}

// Create HTML for a trip card
function createTripCard(trip) {
  const priceDiff = trip.currentPrice !== null ? trip.pricePaid - trip.currentPrice : null;
  const isPriceLower = priceDiff !== null && priceDiff > 0;
  const isPriceHigher = priceDiff !== null && priceDiff < 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tripHasPassed = new Date(trip.travelDate + 'T00:00:00') < today;

  let currentPriceClass = tripHasPassed ? 'unavailable' : (isPriceLower ? 'lower' : (isPriceHigher ? 'higher' : 'current'));

  const formattedDate = formatDate(trip.travelDate);
  const trainWarning = trip.trainNotFound ? ' ⚠️' : '';
  const trainInfo = trip.trainNumber ? ` • Train #${trip.trainNumber}${trainWarning}` : '';

  // Build price display section based on train found status
  let priceSection;
  const ticketClassText = "Ticket class: " + (trip.ticketClass ? trip.ticketClass.charAt(0).toUpperCase() + trip.ticketClass.slice(1) : 'Not specified');

  if (trip.trainNotFound) {
    // Train not found - show warning message
    const formattedPriceDate = formatDate(trip.travelDate);
    priceSection = `
      <div class="price-row-compact">
        <span class="ticket-class-inline">${ticketClassText}</span>
        <span class="price-divider">|</span>
        <span class="price-label">Paid:</span>
        <span class="price-value">$${trip.pricePaid.toFixed(2)}</span>
      </div>
      <div class="train-not-found-row">
        <span class="train-not-found">Train not found. Lowest train price from ${trip.origin} to ${trip.destination} on ${formattedPriceDate}: $${trip.currentPrice.toFixed(2)}</span>
      </div>
    `;
  } else {
    // Train found or no train specified
    let currentPriceDisplay;
    if (tripHasPassed) {
      currentPriceClass = 'unavailable';
      currentPriceDisplay = 'Trip Passed';
    } else if (trip.currentPrice !== null) {
      currentPriceDisplay = `$${trip.currentPrice.toFixed(2)}`;
    } else if (trip.lastChecked) {
      currentPriceClass = 'unavailable';
      currentPriceDisplay = 'Unavailable';
    } else {
      currentPriceDisplay = 'Checking...';
    }

    const priceBadge = isPriceLower
      ? `<span class="price-divider">|</span><span class="price-drop-badge">↓$${priceDiff.toFixed(2)} savings!</span>`
      : '';

    priceSection = `
      <div class="price-row-compact">
        <span class="ticket-class-inline">${ticketClassText}</span>
        <span class="price-divider">|</span>
        <span class="price-label">Paid:</span>
        <span class="price-value">$${trip.pricePaid.toFixed(2)}</span>
      </div>
      <div class="price-row-compact">
        <span class="price-label">Current:</span>
        <span class="price-value ${currentPriceClass}">${currentPriceDisplay}</span>
        ${priceBadge}
      </div>
    `;
  }

  // Serialize price history for the chart
  // Backfill from currentPrice if no history exists but we have a price
  let priceHistory = trip.priceHistory || [];
  if (priceHistory.length === 0 && trip.currentPrice !== null) {
    priceHistory = [{ price: trip.currentPrice, timestamp: trip.lastChecked || new Date().toISOString() }];
  }
  const priceHistoryData = JSON.stringify(priceHistory);

  const passedClass = tripHasPassed ? 'trip-passed' : '';
  const passedBadge = tripHasPassed ? '<span class="trip-passed-badge">Trip Passed</span>' : '';

  return `
    <div class="trip-card-wrapper ${passedClass}">
      <div class="trip-card-container">
        <div class="trip-card-scroller" data-trip-id="${trip.id}">
          <div class="trip-card trip-card-info" data-trip-id="${trip.id}">
          ${passedBadge}
            <div class="trip-header">
              <span class="trip-route">${trip.origin} → ${trip.destination}</span>
              <span class="trip-date">${formattedDate}${trainInfo}</span>
            </div>
            <div class="trip-prices">
              ${priceSection}
            </div>
            <div class="trip-actions">
              <button class="btn-delete" data-trip-id="${trip.id}" title="Remove trip">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
              </button>
            </div>
          </div>
          <div class="trip-card trip-card-chart">
            <div class="chart-header">
              <span class="chart-title">Price History</span>
              <span class="chart-subtitle">${trip.origin} → ${trip.destination}</span>
            </div>
            <canvas class="price-chart" data-history='${priceHistoryData}' data-paid="${trip.pricePaid}"></canvas>
            <div class="chart-legend">
              <span class="legend-paid">— Paid: $${trip.pricePaid.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="card-pagination">
        <span class="pagination-dot active" data-index="0"></span>
        <span class="pagination-dot" data-index="1"></span>
      </div>
    </div>
  `;
}

// Load settings
async function loadSettings() {
  const settings = await getSettings();
  checkIntervalSelect.value = settings.checkInterval || 4;

  // Email notification settings
  emailNotificationsCheckbox.checked = settings.emailNotifications || false;
  notificationEmailInput.value = settings.notificationEmail || '';
  emailInputGroup.style.display = settings.emailNotifications ? 'block' : 'none';
}

// Save settings when changed
checkIntervalSelect.addEventListener('change', async () => {
  const interval = parseInt(checkIntervalSelect.value);
  await saveSettings({ checkInterval: interval });

  // Update the alarm interval
  chrome.runtime.sendMessage({
    action: 'updateAlarmInterval',
    interval: interval
  });
});

// Email notifications toggle
emailNotificationsCheckbox.addEventListener('change', async () => {
  const enabled = emailNotificationsCheckbox.checked;
  emailInputGroup.style.display = enabled ? 'block' : 'none';
  await saveSettings({ emailNotifications: enabled });
});

// Save email address
saveEmailBtn.addEventListener('click', async () => {
  const email = notificationEmailInput.value.trim();
  if (email && isValidEmail(email)) {
    await saveSettings({ notificationEmail: email });
    showEmailStatus('Email saved!', 'success');
  } else {
    showEmailStatus('Please enter a valid email', 'error');
  }
});

// Test email
testEmailBtn.addEventListener('click', async () => {
  const email = notificationEmailInput.value.trim();
  if (!email || !isValidEmail(email)) {
    showEmailStatus('Please enter a valid email first', 'error');
    return;
  }

  testEmailBtn.disabled = true;
  testEmailBtn.textContent = 'Sending...';

  chrome.runtime.sendMessage({ action: 'testEmail', email }, (response) => {
    testEmailBtn.disabled = false;
    testEmailBtn.textContent = 'Test';

    if (response?.success) {
      showEmailStatus('Test email sent!', 'success');
    } else {
      showEmailStatus('Failed to send. Check email.js config.', 'error');
    }
  });
});

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function showEmailStatus(message, type) {
  let statusEl = document.querySelector('.email-status');
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.className = 'email-status';
    emailInputGroup.appendChild(statusEl);
  }
  statusEl.textContent = message;
  statusEl.className = `email-status ${type}`;
  setTimeout(() => { statusEl.textContent = ''; }, 3000);
}

// Check prices now button
checkNowBtn.addEventListener('click', async () => {
  checkNowBtn.disabled = true;
  checkNowBtn.innerHTML = '<span class="spinner"></span> Checking...';

  chrome.runtime.sendMessage({ action: 'checkPrices' }, async (response) => {
    checkNowBtn.disabled = false;
    checkNowBtn.textContent = 'Check Prices Now';
    await loadTrips();
    updateLastChecked();
  });
});

// Update last checked timestamp
async function updateLastChecked() {
  const settings = await getSettings();
  if (settings.lastChecked) {
    const date = new Date(settings.lastChecked);
    lastCheckedSpan.textContent = formatDateTime(date);
  } else {
    lastCheckedSpan.textContent = 'Never';
  }
}

// Utility functions
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function formatDate(dateString) {
  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatDateTime(date) {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

// Listen for updates from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'tripsUpdated') {
    loadTrips();
    updateLastChecked();
  }
});

// Draw all price history charts
function drawAllCharts() {
  const canvases = document.querySelectorAll('.price-chart');

  canvases.forEach(canvas => {
    const historyStr = canvas.dataset.history || '[]';
    const paidPrice = parseFloat(canvas.dataset.paid) || 0;

    let history;
    try {
      history = JSON.parse(historyStr);
    } catch (e) {
      history = [];
    }

    drawPriceChart(canvas, history, paidPrice);

    // Add hover listeners for tooltips (only if not already set up)
    if (!canvas._hoverSetup) {
      setupChartHover(canvas);
      canvas._hoverSetup = true;
    }
  });
}

// Setup hover tooltip for a chart
function setupChartHover(canvas) {
  let tooltip = null;

  canvas.addEventListener('mousemove', (e) => {
    const dots = canvas._dotData;
    if (!dots || dots.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Find closest dot within 15px
    let closestDot = null;
    let closestDist = 15;

    dots.forEach(dot => {
      const dist = Math.sqrt((mouseX - dot.x) ** 2 + (mouseY - dot.y) ** 2);
      if (dist < closestDist) {
        closestDist = dist;
        closestDot = dot;
      }
    });

    if (closestDot) {
      // Create tooltip if needed
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'chart-tooltip';
        document.body.appendChild(tooltip);
      }

      // Format date
      const date = new Date(closestDot.timestamp);
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

      tooltip.innerHTML = `<strong>$${closestDot.price.toFixed(2)}</strong><br>${dateStr} ${timeStr}`;
      tooltip.style.display = 'block';
      tooltip.style.left = `${e.clientX + 10}px`;
      tooltip.style.top = `${e.clientY - 30}px`;
    } else if (tooltip) {
      tooltip.style.display = 'none';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    if (tooltip) {
      tooltip.style.display = 'none';
    }
  });
}

// Draw a single price history chart
function drawPriceChart(canvas, history, paidPrice) {
  const ctx = canvas.getContext('2d');
  const width = canvas.offsetWidth || 300;
  const height = canvas.offsetHeight || 80;

  // Set canvas resolution for retina
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  // Clear canvas
  ctx.clearRect(0, 0, width, height);

  // If no history, show placeholder
  if (!history || history.length === 0) {
    ctx.fillStyle = '#999';
    ctx.font = '12px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No price data yet', width / 2, height / 2);
    return;
  }

  const prices = history.map(h => h.price);
  const minPrice = Math.min(...prices, paidPrice) * 0.95;
  const maxPrice = Math.max(...prices, paidPrice) * 1.05;
  const priceRange = maxPrice - minPrice || 1;

  const padding = { top: 10, right: 10, bottom: 20, left: 10 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Helper to convert price to Y coordinate
  const priceToY = (price) => {
    return padding.top + chartHeight - ((price - minPrice) / priceRange) * chartHeight;
  };

  // Draw paid price line (dashed)
  ctx.beginPath();
  ctx.strokeStyle = '#1a5276';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  const paidY = priceToY(paidPrice);
  ctx.moveTo(padding.left, paidY);
  ctx.lineTo(width - padding.right, paidY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw price line
  ctx.beginPath();
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  prices.forEach((price, i) => {
    const x = padding.left + (i / (prices.length - 1 || 1)) * chartWidth;
    const y = priceToY(price);

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();

  // Draw dots at each data point
  const dotData = [];

  prices.forEach((price, i) => {
    const x = padding.left + (i / (prices.length - 1 || 1)) * chartWidth;
    const y = priceToY(price);

    // Store dot position for hover detection
    dotData.push({
      x,
      y,
      price,
      timestamp: history[i]?.timestamp || null
    });

    ctx.beginPath();
    ctx.fillStyle = price < paidPrice ? '#27ae60' : '#e74c3c';
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // Store dot data on canvas for hover events
  canvas._dotData = dotData;

  // Draw current price label
  const currentPrice = prices[prices.length - 1];
  const currentY = priceToY(currentPrice);

  // Determine label position to avoid clipping and overlap with paid line
  let yOffset = -6;  // Default: above the dot

  // If near top of chart, put label below
  if (currentY < padding.top + 15) {
    yOffset = 12;
  }
  // If label would overlap with paid price line (within 12px), adjust
  else if (Math.abs(currentY + yOffset - paidY) < 12) {
    // Put label on opposite side of dot from paid line
    yOffset = currentY > paidY ? -6 : 12;
  }

  ctx.fillStyle = '#333';
  ctx.font = 'bold 11px -apple-system, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`$${currentPrice.toFixed(0)}`, width - padding.right, currentY + yOffset);
}
