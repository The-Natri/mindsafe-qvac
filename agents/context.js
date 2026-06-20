import fs from 'fs';
import path from 'path';

const JOURNAL_PATH = 'C:\\MindSafe\\data\\journal.json';
const MEDICAL_PATH = 'C:\\MindSafe\\data\\medical.json';
const MOOD_PATH = 'C:\\MindSafe\\data\\mood.json';
const PROFILE_PATH = 'C:\\MindSafe\\data\\profile.json';

// Create C:\MindSafe\data\ directory if not exists.
// Create empty template files if they don't exist
const DATA_DIR = 'C:\\MindSafe\\data';
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(JOURNAL_PATH)) {
    fs.writeFileSync(JOURNAL_PATH, JSON.stringify([], null, 2), 'utf8');
  }
  if (!fs.existsSync(MEDICAL_PATH)) {
    fs.writeFileSync(MEDICAL_PATH, JSON.stringify({
      conditions: [],
      medications: [],
      allergies: [],
      notes: ""
    }, null, 2), 'utf8');
  }
  if (!fs.existsSync(MOOD_PATH)) {
    fs.writeFileSync(MOOD_PATH, JSON.stringify([], null, 2), 'utf8');
  }
} catch (err) {
  console.error('Error initializing context templates:', err);
}

/**
 * Analyzes the mood entries to produce a short descriptive string of the trend.
 * @param {Array} moodTrend - Last 7 mood entries
 * @returns {string} Trend description
 */
function getMoodTrendDescription(moodTrend) {
  if (!Array.isArray(moodTrend) || moodTrend.length === 0) {
    return "";
  }

  // Attempt to extract numeric values representing the moods
  const values = moodTrend.map(item => {
    if (typeof item === 'number') return item;
    if (item && typeof item === 'object') {
      const val = item.score ?? item.value ?? item.mood ?? item.level ?? item.rating;
      if (typeof val === 'number') return val;
      if (typeof val === 'string') {
        const parsed = parseFloat(val);
        if (!isNaN(parsed)) return parsed;
      }
    }
    if (typeof item === 'string') {
      const parsed = parseFloat(item);
      if (!isNaN(parsed)) return parsed;
    }
    return null;
  }).filter(v => v !== null);

  if (values.length < 2) {
    // If not enough numbers, look for string descriptions
    const textMoods = moodTrend.map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && typeof item.mood === 'string') return item.mood;
      return null;
    }).filter(Boolean);

    if (textMoods.length > 0) {
      return `User moods have included: ${textMoods.join(', ')}`;
    }
    return "Not enough data to determine a trend.";
  }

  const len = values.length;
  // If the last 3 days show a strict trend, return that specifically
  if (len >= 3) {
    const last3 = values.slice(-3);
    if (last3[2] < last3[1] && last3[1] < last3[0]) {
      return "User mood has been declining over past 3 days";
    }
    if (last3[2] > last3[1] && last3[1] > last3[0]) {
      return "User mood has been improving over past 3 days";
    }
  }

  // General trend over all available numbers
  const firstVal = values[0];
  const lastVal = values[len - 1];
  const diff = lastVal - firstVal;

  if (diff < -0.5) {
    return "User mood has shown a declining trend recently";
  } else if (diff > 0.5) {
    return "User mood has shown an improving trend recently";
  } else {
    return "User mood has been stable recently";
  }
}

/**
 * Loads the user context details from the files.
 * @returns {Object} Combined context object
 */
export function loadUserContext() {
  let recentHistory = [];
  try {
    if (fs.existsSync(JOURNAL_PATH)) {
      const content = fs.readFileSync(JOURNAL_PATH, 'utf8');
      const journal = JSON.parse(content);
      if (Array.isArray(journal)) {
        // Deduplicate consecutive identical sessions based on their summary text
        const dedupedJournal = [];
        for (const session of journal) {
          if (dedupedJournal.length === 0) {
            dedupedJournal.push(session);
          } else {
            const currentSummary = (session.summary || '').trim();
            const lastSummary = (dedupedJournal[dedupedJournal.length - 1].summary || '').trim();
            if (currentSummary !== lastSummary) {
              dedupedJournal.push(session);
            }
          }
        }
        recentHistory = dedupedJournal.slice(-5);
      }
    }
  } catch (e) {
    console.error('Error loading journal.json:', e);
  }

  let medicalData = null;
  try {
    if (fs.existsSync(MEDICAL_PATH)) {
      const content = fs.readFileSync(MEDICAL_PATH, 'utf8');
      medicalData = JSON.parse(content);
    }
  } catch (e) {
    console.error('Error loading medical.json:', e);
  }

  let moodTrend = [];
  try {
    if (fs.existsSync(MOOD_PATH)) {
      const content = fs.readFileSync(MOOD_PATH, 'utf8');
      const mood = JSON.parse(content);
      if (Array.isArray(mood)) {
        moodTrend = mood.slice(-7);
      }
    }
  } catch (e) {
    console.error('Error loading mood.json:', e);
  }

  let profileData = null;
  try {
    if (fs.existsSync(PROFILE_PATH)) {
      const content = fs.readFileSync(PROFILE_PATH, 'utf8');
      profileData = JSON.parse(content);
    }
  } catch (e) {
    console.error('Error loading profile.json:', e);
  }

  const hasHistory = recentHistory.length > 0;
  const hasMedical = medicalData !== null;
  const hasProfile = profileData !== null && (profileData.name || profileData.age || profileData.goals);

  let medicalContext = null;
  if (medicalData) {
    medicalContext = {
      conditions: Array.isArray(medicalData.conditions) ? medicalData.conditions : [],
      medications: Array.isArray(medicalData.medications) ? medicalData.medications : [],
      allergies: medicalData.allergies || '',
      notes: medicalData.notes || ''
    };
  }

  return {
    recentHistory,
    medicalContext,
    moodTrend,
    profileData,
    hasHistory,
    hasMedical,
    hasProfile
  };
}

/**
 * Converts context object into a prompt string.
 * @param {Object} userContext - Context object loaded via loadUserContext
 * @returns {string} Prompt string to prepend to system prompt
 */
export function buildContextPrompt(userContext) {
  if (!userContext) return '';

  const { recentHistory, medicalContext, moodTrend, profileData, hasHistory, hasMedical, hasProfile } = userContext;

  // Build profile part first (highest priority — always include if present)
  let profilePart = '';
  if (hasProfile && profileData) {
    const parts = [
      profileData.name ? `User's name: ${profileData.name}` : '',
      profileData.age  ? `Age: ${profileData.age}` : '',
      profileData.goals ? `Goals: ${profileData.goals}` : ''
    ].filter(Boolean);
    if (parts.length) profilePart = `User profile:\n${parts.join('. ')}`;
  }

  let medicalPart = '';
  if (hasMedical && medicalContext) {
    const conditions = Array.isArray(medicalContext.conditions) ? medicalContext.conditions : [];
    const medications = Array.isArray(medicalContext.medications) ? medicalContext.medications : [];
    const notes = medicalContext.notes || '';
    medicalPart = `User medical context (treat with care):\nConditions: ${conditions.join(', ') || 'None'}\nMedications: ${medications.join(', ') || 'None'}\nNotes: ${notes || 'None'}`;
  }

  let moodPart = '';
  if (moodTrend && moodTrend.length > 0) {
    const trendDesc = getMoodTrendDescription(moodTrend);
    if (trendDesc) {
      moodPart = `Recent mood trend: ${trendDesc}`;
    }
  }

  // Helper to estimate tokens: 1 token is ~4 chars or ~0.75 words.
  // We use word count * 1.35 as a very safe tokenizer approximation.
  const estimateTokens = (text) => {
    if (!text) return 0;
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.ceil(words * 1.35);
  };

  let promptParts = [];
  let currentTokens = 0;

  // 0. Profile (always first, small)
  if (profilePart) {
    promptParts.push(profilePart);
    currentTokens += estimateTokens(profilePart);
  }

  // 1. Add Medical Context (Prioritized)
  if (medicalPart) {
    const tokens = estimateTokens(medicalPart);
    if (tokens <= 300) {
      promptParts.push(medicalPart);
      currentTokens += tokens;
    } else {
      // If medical part alone exceeds 300 tokens, truncate notes to fit
      const conditions = Array.isArray(medicalContext.conditions) ? medicalContext.conditions : [];
      const medications = Array.isArray(medicalContext.medications) ? medicalContext.medications : [];
      let notes = medicalContext.notes || '';
      
      while (notes.length > 0) {
        notes = notes.slice(0, Math.floor(notes.length * 0.9)).trim();
        const testMedicalPart = `User medical context (treat with care):\nConditions: ${conditions.join(', ') || 'None'}\nMedications: ${medications.join(', ') || 'None'}\nNotes: ${notes}...`;
        if (estimateTokens(testMedicalPart) <= 300) {
          medicalPart = testMedicalPart;
          break;
        }
      }
      promptParts.push(medicalPart);
      currentTokens = estimateTokens(medicalPart);
    }
  }

  // 2. Add Mood Trend
  if (moodPart && currentTokens < 300) {
    const separator = promptParts.length > 0 ? '\n\n' : '';
    const tempPart = separator + moodPart;
    const tokens = estimateTokens(tempPart);
    if (currentTokens + tokens <= 300) {
      promptParts.push(moodPart);
      currentTokens += tokens;
    }
  }

  // 3. Add Recent History (Drop older history summaries if we exceed budget)
  if (hasHistory && Array.isArray(recentHistory) && recentHistory.length > 0 && currentTokens < 300) {
    const formattedSummaries = recentHistory.map(item => {
      if (!item) return '';
      if (typeof item === 'object') {
        const summaryText = item.summary || item.text || '';
        const dateText = item.date || '';
        return summaryText && dateText ? `${summaryText} - ${dateText}` : (summaryText || dateText || JSON.stringify(item));
      }
      return String(item);
    }).filter(Boolean);

    let historyBlock = '';
    
    // Attempt to fit as many summaries as possible, dropping older (front of array) first
    for (let i = 0; i < formattedSummaries.length; i++) {
      const candidateSummaries = formattedSummaries.slice(i);
      const testHistoryPart = `Recent conversation history:\n${candidateSummaries.join('\n')}`;
      const separator = promptParts.length > 0 ? '\n\n' : '';
      const totalTestText = separator + testHistoryPart;
      const testTokens = estimateTokens(totalTestText);
      
      if (currentTokens + testTokens <= 300) {
        historyBlock = testHistoryPart;
        break;
      }
    }

    if (historyBlock) {
      promptParts.push(historyBlock);
    }
  }

  const contextString = promptParts.join('\n\n');
  console.log('=== CONTEXT SENT TO MEDPSY ===');
  console.log(contextString);
  console.log('=== END CONTEXT ===');
  return contextString;
}
