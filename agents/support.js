import { shell } from 'electron';
import fs from 'fs';

const HELPLINES = {
  IN: {
    name: "iCall",
    phone: "9152987821",
    sms: "9152987821",
    backup: {
      name: "Vandrevala Foundation",
      phone: "18602662345"
    },
    display: "iCall — 9152987821 (India)"
  },
  US: {
    name: "988 Suicide & Crisis Lifeline",
    phone: "988",
    sms: "988",
    display: "988 Suicide & Crisis Lifeline (US)"
  },
  UK: {
    name: "Samaritans",
    phone: "116123",
    sms: null,
    display: "Samaritans — 116123 (UK)"
  },
  AU: {
    name: "Lifeline Australia",
    phone: "131114",
    sms: "0477131114",
    display: "Lifeline — 13 11 14 (Australia)"
  },
  DEFAULT: {
    name: "International Association for Suicide Prevention",
    phone: null,
    sms: null,
    website: "https://www.iasp.info/resources/Crisis_Centres/",
    display: "Find your local crisis line"
  }
};

/**
 * Detects the user's region based on profile settings, environment variables, or timezone.
 * @returns {string} Two-letter region code
 */
export function detectRegion() {
  if (process.env.MINDSAFE_REGION) {
    return process.env.MINDSAFE_REGION.toUpperCase().trim();
  }
  try {
    const PROFILE_PATH = 'C:\\MindSafe\\data\\profile.json';
    if (fs.existsSync(PROFILE_PATH)) {
      const profile = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8') || '{}');
      const region = (profile.region || profile.country || '').toUpperCase().trim();
      if (region) {
        if (region.includes('INDIA') || region === 'IN') return 'IN';
        if (region.includes('UK') || region.includes('UNITED KINGDOM') || region === 'GB') return 'UK';
        if (region.includes('AUSTRALIA') || region === 'AU') return 'AU';
        if (region.includes('US') || region.includes('UNITED STATES') || region === 'USA') return 'US';
        return region;
      }
    }
  } catch (e) {
    console.error('Error reading region from profile:', e);
  }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') {
      return 'IN';
    }
    if (tz.startsWith('America/')) {
      return 'US';
    }
    if (tz === 'Europe/London') {
      return 'UK';
    }
    if (tz.startsWith('Australia/')) {
      return 'AU';
    }
  } catch (e) {
    console.error('Error detecting region:', e);
  }
  return 'IN'; // default fallback for India
}

/**
 * Retrieves the crisis helpline object matching the given region.
 * @param {string|null} region - Optional region code
 * @returns {Object} Helpline configurations
 */
export function getCrisisHelpline(region = null) {
  const reg = region || detectRegion();
  return HELPLINES[reg] || HELPLINES.DEFAULT;
}

/**
 * Uses Electron shell to open the system's phone dialer.
 * @param {string} phone - Phone number
 */
export async function triggerCall(phone) {
  if (!phone) return;
  await shell.openExternal(`tel:${phone}`);
}

/**
 * Uses Electron shell to open the system's SMS composer.
 * @param {string} phone - Phone number
 * @param {string} message - Message body
 */
export async function triggerSMS(phone, message = "") {
  if (!phone) return;
  const smsMessage = message || "I need support right now.";
  await shell.openExternal(`sms:${phone}?body=${encodeURIComponent(smsMessage)}`);
}

/**
 * Formats a localized text crisis message.
 * @param {string|null} region - Optional region code
 * @returns {string} Hardcoded crisis text message
 */
export function getCrisisMessage(region = null) {
  const helpline = getCrisisHelpline(region);
  return `You are not alone. Please reach out right now. \n${helpline.display} is available 24/7, \nfree and confidential.`;
}

/**
 * Formats crisis UI dataset for renderer consumption.
 * @param {string|null} region - Optional region code
 * @returns {Object} Dataset containing title, texts, numbers, and boolean capabilities
 */
export function getCrisisUIData(region = null) {
  const reg = region || detectRegion();
  const helpline = getCrisisHelpline(reg);
  return {
    headline: "You are not alone.",
    subtext: "We are here with you right now.",
    helpline: helpline.name,
    phone: helpline.phone,
    sms: helpline.sms,
    displayText: helpline.display,
    canCall: !!helpline.phone,
    canSMS: !!helpline.sms,
    region: reg
  };
}
