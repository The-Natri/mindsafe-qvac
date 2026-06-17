import { MINDSAFE_SYSTEM_PROMPT } from './system-prompt.js';
import fs from 'fs';

const PROFILE_PATH = 'C:\\MindSafe\\data\\profile.json';

/**
 * Returns the crisis helpline string appropriate for the user's region.
 * Reads region from profile.json; defaults to US 988 if unknown.
 */
function getRegionHelpline() {
  try {
    const profile = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8') || '{}');
    const region = (profile.region || profile.country || '').toLowerCase().trim();
    if (region.includes('india') || region === 'in') {
      return 'iCall: 9152987821';
    } else if (region.includes('uk') || region.includes('united kingdom') || region === 'gb') {
      return 'Samaritans: 116 123';
    } else if (region.includes('australia') || region === 'au') {
      return 'Lifeline: 13 11 14';
    }
  } catch (_) { /* profile not found, use default */ }
  return 'Suicide & Crisis Lifeline: 988';
}

const STOP_WORDS = new Set([
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 
  'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 
  'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are', 
  'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 
  'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 
  'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 
  'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 
  'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 
  'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 
  'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now', 
  'feel', 'feeling', 'like', 'felt'
]);

/**
 * Extracts clean keywords from user text, filtering out common stop words.
 * @param {string} text - The input text.
 * @returns {string[]} Array of keywords.
 */
function extractKeywords(text) {
  if (!text) return [];
  const words = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .split(/\s+/);
  
  const keywordsSet = new Set();
  for (const word of words) {
    if (word && word.length > 2 && !STOP_WORDS.has(word)) {
      keywordsSet.add(word);
    }
  }
  return Array.from(keywordsSet);
}

/**
 * Classifies text into one of the designated MindSafe categories.
 * @param {string} text - The normalized input text.
 * @returns {string} One of: "crisis", "greeting", "practical", "emotional", "journal".
 */
function classifyText(text) {
  const normalized = text.toLowerCase();

  // 1. Crisis Check (highest priority, must run first)
  const crisisRegex = /\b(suicide|suicidal|self[\s-]?harm|kill(ing)?\s+myself|end(ing)?\s+(my\s+life|it\s+all)|harm(ing)?\s+myself|hurt(ing)?\s+myself|don['’]?t\s+want\s+to\s+live|want(s)?\s+to\s+die|no\s+reason\s+to\s+live|think(ing)?\s+about\s+(ending|killing)|cut(ting)?\s+myself|what(\s+is|['’]?s)\s+the\s+point\s+of\s+living|no\s+point\s+(in|to)\s+living|tired\s+of\s+(living|life)|end(ing)?\s+myself|gonna\s+(hurt|kill|end)\s+(my)?self|going\s+to\s+(hurt|kill|end)\s+(my)?self|want\s+to\s+end\s+myself|end\s+my\s+(life|pain|suffering)|hurt\s+my\s+self)\b/i;
  if (crisisRegex.test(normalized)) {
    return 'crisis';
  }

  // 2. Greeting Check
  const greetingRegex = /\b(hello|hi|hey|howdy|yo|greetings|good morning|good afternoon|good evening|how are you|whats up|sup)\b/i;
  // If it matches greeting terms and is relatively short, classify as greeting
  if (greetingRegex.test(normalized) && normalized.split(/\s+/).length <= 6) {
    return 'greeting';
  }

  // 3. Closing Check
  // Only treat thank you/thanks as closing if it's a short, 
  // standalone message (not embedded in a longer continuing thought)
  const closingRegex = /\b(bye|goodbye|good\s+night|i['’]?m\s+done|that['’]?s\s+all|i['’]?m\s+gonna\s+go|talk\s+later|not\s+gonna\s+waste\s+my\s+time|i\s+have\s+to\s+go)\b/i;
  const thankYouOnlyRegex = /^\s*(thank\s+you|thanks)[\s.!,]*$/i;

  if (closingRegex.test(normalized) || thankYouOnlyRegex.test(normalized)) {
    return 'closing';
  }

  // 4. Practical Check
  const practicalRegex = /\b(tips|techniques|advice|exercise|exercises|strategies|how to|steps|methods|recommendations|coping|what should i do|help me with|guided|breathe|breathing|meditate|meditation|cbt)\b/i;
  if (practicalRegex.test(normalized)) {
    return 'practical';
  }

  // 5. Emotional Check
  const emotionalRegex = /\b(sad|sadness|anxious|anxiety|stress|overwhelm|overwhelmed|depressed|depression|lonely|loneliness|fear|scared|worried|worry|panic|angry|anger|grief|frustrated|frustration|pain|hurt|grieved|grieving)\b/i;
  if (emotionalRegex.test(normalized)) {
    return 'emotional';
  }

  // 6. Journal Check (free text fallback matching journal keywords, or as general fallback)
  const journalRegex = /\b(remember|remembered|happened|today|yesterday|experienced|experience|memory|memories|recall|when i was|thought|thinking|felt|decided|went|saw|met)\b/i;
  if (journalRegex.test(normalized)) {
    return 'journal';
  }

  // Default to journal for general descriptive inputs
  return 'journal';
}

/**
 * Agent 1 of 3 (Intake Agent): Classifies incoming user messages,
 * extracts key metadata, and determines if retrieval or warning flags are required.
 *
 * @param {string} userText - Raw input text from the user.
 * @returns {Promise<Object>} Structured intake classification result.
 */
export async function processInput(userText) {
  const category = classifyText(userText || '');
  const keywords = extractKeywords(userText || '');

  const isCrisis = category === 'crisis';
  const isClosing = category === 'closing';
  const requiresRAG = ['emotional', 'practical', 'journal'].includes(category);

  const result = {
    originalText: userText,
    category,
    keywords,
    requiresRAG,
    isCrisis,
    isClosing
  };

  if (isCrisis) {
    const helpline = getRegionHelpline();
    result.crisisMessage = `If you are in immediate danger, please call ${helpline} immediately.`;
  }

  return result;
}
