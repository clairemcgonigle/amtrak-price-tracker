// Storage keys
const STORAGE_KEYS = {
  TRIPS: 'amtrak_trips',
  SETTINGS: 'amtrak_settings'
};

// Default settings
const DEFAULT_SETTINGS = {
  checkInterval: 4, // hours
  lastChecked: null,
  notificationsEnabled: true,
  emailNotifications: false,
  notificationEmail: null
};

/**
 * Get all tracked trips from storage
 * @returns {Promise<Array>} Array of trip objects
 */
export async function getTrips() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.TRIPS);
  return result[STORAGE_KEYS.TRIPS] || [];
}

/**
 * Save a new trip to storage
 * @param {Object} trip - Trip object to save
 * @returns {Promise<void>}
 */
export async function saveTrip(trip) {
  const trips = await getTrips();
  trips.push(trip);
  await chrome.storage.local.set({ [STORAGE_KEYS.TRIPS]: trips });
}

/**
 * Update an existing trip
 * @param {Object} updatedTrip - Trip object with updated values
 * @returns {Promise<void>}
 */
export async function updateTrip(updatedTrip) {
  const trips = await getTrips();
  const index = trips.findIndex(t => t.id === updatedTrip.id);
  
  if (index !== -1) {
    trips[index] = updatedTrip;
    await chrome.storage.local.set({ [STORAGE_KEYS.TRIPS]: trips });
  }
}

/**
 * Delete a trip by ID
 * @param {string} tripId - ID of the trip to delete
 * @returns {Promise<void>}
 */
export async function deleteTrip(tripId) {
  const trips = await getTrips();
  const filteredTrips = trips.filter(t => t.id !== tripId);
  await chrome.storage.local.set({ [STORAGE_KEYS.TRIPS]: filteredTrips });
}

/**
 * Get a single trip by ID
 * @param {string} tripId - ID of the trip to retrieve
 * @returns {Promise<Object|null>} Trip object or null if not found
 */
export async function getTrip(tripId) {
  const trips = await getTrips();
  return trips.find(t => t.id === tripId) || null;
}

/**
 * Get extension settings
 * @returns {Promise<Object>} Settings object
 */
export async function getSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.SETTINGS] };
}

/**
 * Save/update settings
 * @param {Object} newSettings - Settings to merge with existing
 * @returns {Promise<void>}
 */
export async function saveSettings(newSettings) {
  const currentSettings = await getSettings();
  const mergedSettings = { ...currentSettings, ...newSettings };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: mergedSettings });
}

/**
 * Clear all extension data
 * @returns {Promise<void>}
 */
export async function clearAllData() {
  await chrome.storage.local.remove([STORAGE_KEYS.TRIPS, STORAGE_KEYS.SETTINGS]);
}

/**
 * Export all data (for backup)
 * @returns {Promise<Object>} All stored data
 */
export async function exportData() {
  const trips = await getTrips();
  const settings = await getSettings();
  return {
    trips,
    settings,
    exportedAt: new Date().toISOString()
  };
}

/**
 * Import data (from backup)
 * @param {Object} data - Data object with trips and settings
 * @returns {Promise<void>}
 */
export async function importData(data) {
  if (data.trips) {
    await chrome.storage.local.set({ [STORAGE_KEYS.TRIPS]: data.trips });
  }
  if (data.settings) {
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: data.settings });
  }
}
