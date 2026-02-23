import { saveTrip, getTrips, deleteTrip, getSettings, saveSettings } from './storage.js';

// DOM Elements
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

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadTrips();
  await loadSettings();
  updateLastChecked();
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
    currentPrice: null,
    lastChecked: null,
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
      const tripId = e.target.dataset.tripId;
      await deleteTrip(tripId);
      await loadTrips();
    });
  });
}

// Create HTML for a trip card
function createTripCard(trip) {
  const priceDiff = trip.currentPrice !== null ? trip.pricePaid - trip.currentPrice : null;
  const isPriceLower = priceDiff !== null && priceDiff > 0;
  const isPriceHigher = priceDiff !== null && priceDiff < 0;

  const currentPriceClass = isPriceLower ? 'lower' : (isPriceHigher ? 'higher' : 'current');
  // Show different status based on whether we've checked yet
  let currentPriceDisplay;
  if (trip.currentPrice !== null) {
    currentPriceDisplay = `$${trip.currentPrice.toFixed(2)}`;
  } else if (trip.lastChecked) {
    currentPriceDisplay = 'Unavailable';
  } else {
    currentPriceDisplay = 'Checking...';
  }

  const priceBadge = isPriceLower 
    ? `<span class="price-drop-badge">↓ $${priceDiff.toFixed(2)} savings!</span>` 
    : '';

  const formattedDate = formatDate(trip.travelDate);
  const trainInfo = trip.trainNumber ? ` • Train #${trip.trainNumber}` : '';

  return `
    <div class="trip-card" data-trip-id="${trip.id}">
      <div class="trip-header">
        <span class="trip-route">${trip.origin} → ${trip.destination}</span>
        <span class="trip-date">${formattedDate}${trainInfo}</span>
      </div>
      <div class="trip-prices">
        <div class="price-info">
          <span class="price-label">Paid: </span>
          <span class="price-value">$${trip.pricePaid.toFixed(2)}</span>
        </div>
        <div class="price-info">
          <span class="price-label">Current: </span>
          <span class="price-value ${currentPriceClass}">${currentPriceDisplay}</span>
        </div>
        ${priceBadge}
      </div>
      <div class="trip-actions">
        <button class="btn-danger btn-delete" data-trip-id="${trip.id}">Remove</button>
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
