/**
 * Email notification service using EmailJS
 * 
 * SETUP REQUIRED:
 * 1. Create a free account at https://www.emailjs.com/
 * 2. Create an email service (connect your Gmail, Outlook, etc.)
 * 3. Create an email template with these variables:
 *    - {{to_email}} - recipient email
 *    - {{route}} - e.g., "NYP → WAS"
 *    - {{travel_date}} - e.g., "Mar 15, 2026"
 *    - {{original_price}} - e.g., "$89.00"
 *    - {{current_price}} - e.g., "$72.00"
 *    - {{savings}} - e.g., "$17.00"
 *    - {{booking_url}} - link to Amtrak
 * 4. Copy your Service ID, Template ID, and Public Key below
 */

// ⚠️ REPLACE THESE WITH YOUR EMAILJS CREDENTIALS
const EMAILJS_CONFIG = {
  serviceId: 'YOUR_SERVICE_ID',      // e.g., 'service_abc123'
  templateId: 'YOUR_TEMPLATE_ID',    // e.g., 'template_xyz789'
  publicKey: 'YOUR_PUBLIC_KEY'       // e.g., 'AbCdEfGhIjKlMnOp'
};

/**
 * Send email notification for a price drop
 * @param {Object} trip - The trip object
 * @param {number} currentPrice - Current price
 * @param {string} toEmail - Recipient email address
 * @returns {Promise<boolean>} - Success status
 */
export async function sendPriceDropEmail(trip, currentPrice, toEmail) {
  if (!toEmail) {
    console.log('No email configured, skipping email notification');
    return false;
  }

  // Check if EmailJS is configured
  if (EMAILJS_CONFIG.serviceId === 'YOUR_SERVICE_ID') {
    console.warn('EmailJS not configured. See email.js for setup instructions.');
    return false;
  }

  const savings = trip.pricePaid - currentPrice;
  const bookingUrl = buildBookingUrl(trip);
  
  const templateParams = {
    to_email: toEmail,
    route: `${trip.origin} → ${trip.destination}`,
    travel_date: formatDate(trip.travelDate),
    original_price: `$${trip.pricePaid.toFixed(2)}`,
    current_price: `$${currentPrice.toFixed(2)}`,
    savings: `$${savings.toFixed(2)}`,
    booking_url: bookingUrl
  };

  try {
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        service_id: EMAILJS_CONFIG.serviceId,
        template_id: EMAILJS_CONFIG.templateId,
        user_id: EMAILJS_CONFIG.publicKey,
        template_params: templateParams
      })
    });

    if (response.ok) {
      console.log(`Email sent successfully to ${toEmail}`);
      return true;
    } else {
      const errorText = await response.text();
      console.error('EmailJS error:', errorText);
      return false;
    }
  } catch (error) {
    console.error('Failed to send email:', error);
    return false;
  }
}

/**
 * Test email configuration
 * @param {string} toEmail - Email to send test to
 * @returns {Promise<boolean>}
 */
export async function sendTestEmail(toEmail) {
  const testTrip = {
    origin: 'NYP',
    destination: 'WAS',
    travelDate: '2026-03-15',
    pricePaid: 89.00
  };
  
  return sendPriceDropEmail(testTrip, 72.00, toEmail);
}

// Helper functions
function buildBookingUrl(trip) {
  const params = new URLSearchParams({
    origin: trip.origin,
    destination: trip.destination,
    date: trip.travelDate,
    adult: '1'
  });
  return `https://www.amtrak.com/tickets/departure.html?${params.toString()}`;
}

function formatDate(dateString) {
  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: 'numeric'
  });
}
