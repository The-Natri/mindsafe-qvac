import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const JOURNAL_PATH = 'C:\\MindSafe\\data\\journal.json';
const MOOD_PATH = 'C:\\MindSafe\\data\\mood.json';
const TRAINING_PATH = 'C:\\MindSafe\\data\\training.json';

// Initialize templates synchronously on startup to guarantee paths exist
try {
  const DATA_DIR = 'C:\\MindSafe\\data';
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(JOURNAL_PATH)) {
    fs.writeFileSync(JOURNAL_PATH, JSON.stringify([], null, 2), 'utf8');
  }
  if (!fs.existsSync(MOOD_PATH)) {
    fs.writeFileSync(MOOD_PATH, JSON.stringify([], null, 2), 'utf8');
  }
  if (!fs.existsSync(TRAINING_PATH)) {
    fs.writeFileSync(TRAINING_PATH, JSON.stringify([], null, 2), 'utf8');
  }
} catch (err) {
  console.error('Error initializing memory templates:', err);
}

let currentSession = null;

/**
 * Simple extractive summary — no AI call needed:
 * - Take first 80 chars of userText
 * - Add "..." if longer
 * @param {string} userText - The transcribed user text
 * @param {string} aiText - The assistant response text
 * @returns {string} Summary string
 */
export function generateSummary(userText, aiText) {
  if (typeof userText !== 'string') return '';
  const trimmed = userText.trim();
  if (trimmed.length > 80) {
    return trimmed.slice(0, 80) + '...';
  }
  return trimmed;
}

/**
 * Saves a conversation turn into journal.json asynchronously.
 * @param {Object} turnData - The data of the conversation turn
 */
export async function saveConversation(turnData) {
  if (!turnData) return;
  const { transcribedText = '', responseText = '', moodScore, isCrisis = false } = turnData;

  try {
    // Guard against duplicate userMessage within 5000ms
    if (transcribedText) {
      const now = Date.now();
      if (currentSession && currentSession.messages && currentSession.messages.length > 0) {
        const lastMsg = currentSession.messages[currentSession.messages.length - 1];
        if (lastMsg.user === transcribedText && (now - lastMsg.timestamp) < 5000) {
          console.log('Skipping duplicate save in active session');
          return;
        }
      }
      if (fs.existsSync(JOURNAL_PATH)) {
        try {
          const fileContent = fs.readFileSync(JOURNAL_PATH, 'utf8');
          const journal = JSON.parse(fileContent);
          if (Array.isArray(journal) && journal.length > 0) {
            const lastSession = journal[journal.length - 1];
            if (lastSession && lastSession.messages && lastSession.messages.length > 0) {
              const lastMsg = lastSession.messages[lastSession.messages.length - 1];
              if (lastMsg.user === transcribedText && (now - lastMsg.timestamp) < 5000) {
                console.log('Skipping duplicate save in journal.json');
                return;
              }
            }
          }
        } catch (err) {
          console.error('Error checking duplicate in journal.json:', err);
        }
      }
    }

    if (!currentSession) {
      startSession();
    }

    currentSession.messages.push({
      user: transcribedText,
      assistant: responseText,
      timestamp: Date.now()
    });

    if (moodScore) {
      currentSession.mood = moodScore;
    }

    if (isCrisis) {
      currentSession.isCrisis = true;
    }

    if (!currentSession.summary && transcribedText) {
      const summaryText = transcribedText.trim();
      currentSession.summary = summaryText.length > 80 ? summaryText.slice(0, 80) + '...' : summaryText;
    }
  } catch (error) {
    console.error('Error saving conversation to journal session:', error);
  }
}

/**
 * Saves mood score and optional note asynchronously into mood.json.
 * @param {number} score - 1-5 integer mood score
 * @param {string} note - Optional note
 */
export async function saveMood(score, note = "") {
  try {
    let moodHistory = [];
    if (fs.existsSync(MOOD_PATH)) {
      const content = await fs.promises.readFile(MOOD_PATH, 'utf8');
      moodHistory = JSON.parse(content);
    }
    if (!Array.isArray(moodHistory)) {
      moodHistory = [];
    }

    const newMood = {
      score: score,
      note: note,
      date: new Date().toLocaleDateString('en-IN'),
      time: new Date().toLocaleTimeString('en-IN'),
      timestamp: Date.now()
    };

    moodHistory.push(newMood);

    if (moodHistory.length > 90) {
      moodHistory = moodHistory.slice(-90);
    }

    await fs.promises.writeFile(MOOD_PATH, JSON.stringify(moodHistory, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving mood:', error);
  }
}

/**
 * Saves training data for future RAG embedding asynchronously.
 * @param {Object} turnData - The data of the conversation turn
 */
export async function saveTrainingData(turnData) {
  if (!turnData) return;
  const { transcribedText = '', responseText = '' } = turnData;

  try {
    let trainingData = [];
    if (fs.existsSync(TRAINING_PATH)) {
      const content = await fs.promises.readFile(TRAINING_PATH, 'utf8');
      trainingData = JSON.parse(content);
    }
    if (!Array.isArray(trainingData)) {
      trainingData = [];
    }

    const newTraining = {
      input: transcribedText,
      output: responseText,
      timestamp: Date.now(),
      quality: "unverified"
    };

    trainingData.push(newTraining);

    if (trainingData.length > 500) {
      trainingData = trainingData.slice(-500);
    }

    await fs.promises.writeFile(TRAINING_PATH, JSON.stringify(trainingData, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving training data:', error);
  }
}

/**
 * Returns the last N entries from journal.json sorted by timestamp descending.
 * @param {number} limit - Maximum number of entries to return
 * @returns {Promise<Array>} Journal entries
 */
export async function getJournalEntries(limit = 20) {
  try {
    if (!fs.existsSync(JOURNAL_PATH)) return [];
    const content = await fs.promises.readFile(JOURNAL_PATH, 'utf8');
    const journal = JSON.parse(content);
    if (!Array.isArray(journal)) return [];

    const sorted = [...journal].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return sorted.slice(0, limit);
  } catch (e) {
    console.error('Error in getJournalEntries:', e);
    return [];
  }
}

/**
 * Performs case-insensitive keyword search over userMessage and summary fields in the journal.
 * @param {string} query - Keyword search query
 * @returns {Promise<Array>} Matching journal entries
 */
export async function searchJournal(query) {
  try {
    if (!query || typeof query !== 'string') return [];
    if (!fs.existsSync(JOURNAL_PATH)) return [];
    const content = await fs.promises.readFile(JOURNAL_PATH, 'utf8');
    const journal = JSON.parse(content);
    if (!Array.isArray(journal)) return [];

    const lowerQuery = query.toLowerCase();
    return journal.filter(entry => {
      const userMessage = (entry.userMessage || '').toLowerCase();
      const summary = (entry.summary || '').toLowerCase();
      return userMessage.includes(lowerQuery) || summary.includes(lowerQuery);
    });
  } catch (e) {
    console.error('Error in searchJournal:', e);
    return [];
  }
}

/**
 * Formats the entire journal into a readable text format.
 * @returns {Promise<string>} Formatted journal text
 */
export async function exportJournal() {
  try {
    if (!fs.existsSync(JOURNAL_PATH)) return '';
    const content = await fs.promises.readFile(JOURNAL_PATH, 'utf8');
    const journal = JSON.parse(content);
    if (!Array.isArray(journal)) return '';

    return journal.map(entry => {
      const date = entry.date || '';
      const time = entry.time || '';
      const userMessage = entry.userMessage || '';
      const aiResponse = entry.aiResponse || '';
      return `${date} ${time}\nYou: ${userMessage}\nMindSafe: ${aiResponse}\n---`;
    }).join('\n');
  } catch (e) {
    console.error('Error in exportJournal:', e);
    return '';
  }
}

/**
 * Saves medical profile data to training.json with source: "medical_records"
 * @param {Object} medicalData - The medical record data.
 */
export async function saveToTrainingFromMedical(medicalData) {
  if (!medicalData) return;
  try {
    let trainingData = [];
    if (fs.existsSync(TRAINING_PATH)) {
      const content = await fs.promises.readFile(TRAINING_PATH, 'utf8');
      trainingData = JSON.parse(content);
    }
    if (!Array.isArray(trainingData)) {
      trainingData = [];
    }

    const newTraining = {
      source: "medical_records",
      data: medicalData,
      timestamp: Date.now()
    };

    trainingData.push(newTraining);

    if (trainingData.length > 500) {
      trainingData = trainingData.slice(-500);
    }

    await fs.promises.writeFile(TRAINING_PATH, JSON.stringify(trainingData, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving medical training data:', error);
  }
}

/**
 * Starts a new conversation session.
 * @returns {Object} The newly created session object.
 */
export function startSession() {
  currentSession = {
    id: crypto.randomUUID(),
    date: new Date().toLocaleDateString('en-IN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }),
    time: new Date().toLocaleTimeString('en-IN'),
    timestamp: Date.now(),
    messages: [],
    summary: '',
    mood: null
  };
  console.log('Started new conversation session:', currentSession.id);
  return currentSession;
}

/**
 * Ends the current session and writes it as a single entry to journal.json.
 */
export async function endSession() {
  if (!currentSession) return;
  if (currentSession.messages.length === 0) {
    currentSession = null;
    return;
  }

  try {
    let journal = [];
    if (fs.existsSync(JOURNAL_PATH)) {
      const content = await fs.promises.readFile(JOURNAL_PATH, 'utf8');
      journal = JSON.parse(content);
    }
    if (!Array.isArray(journal)) {
      journal = [];
    }

    journal.push(currentSession);

    if (journal.length > 100) {
      journal = journal.slice(-100);
    }

    await fs.promises.writeFile(JOURNAL_PATH, JSON.stringify(journal, null, 2), 'utf8');
    console.log('Ended and saved conversation session:', currentSession.id);
  } catch (error) {
    console.error('Error ending conversation session:', error);
  } finally {
    currentSession = null;
  }
}

/**
 * Gets the current active session.
 * @returns {Object|null}
 */
export function getCurrentSession() {
  return currentSession;
}


