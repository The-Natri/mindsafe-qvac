import { existsSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { fileURLToPath } from 'url';
import recorder from 'node-record-lpcm16';
import fs from 'fs';
import { spawn } from 'child_process';

// Clean stale QVAC lock file on startup (FIX 1)
const lockFile = path.join(homedir(), '.qvac', '.worker.lock');
try {
  if (existsSync(lockFile)) {
    unlinkSync(lockFile);
    console.log('Cleared stale QVAC lock file');
  }
} catch(e) {
  console.log('Could not clear lock file:', e.message);
}

const RECORDING_PATH = 'C:\\MindSafe\\audio-samples\\recording.wav';
const RESPONSE_PATH = 'C:\\MindSafe\\audio-samples\\response.wav';

// Set MEDPSY_MODEL_PATH from environment or default
process.env.MEDPSY_MODEL_PATH = process.env.MEDPSY_MODEL_PATH || 'C:\\MindSafe\\models\\medpsy-1.7b-q4_k_m-imat.gguf';

// Import from parent directory index.js
import { initMindSafe, shutdownMindSafe, runConversationTurn } from '../index.js';
import { processInput } from '../agents/intake.js';
import { getCrisisUIData, triggerCall, triggerSMS } from '../agents/support.js';
import { getJournalEntries, searchJournal, exportJournal, saveMood, saveConversation, saveTrainingData, saveToTrainingFromMedical, startSession, endSession } from '../agents/memory.js';
import { extractTextFromFile, parseMedicalText, extractFromImage } from '../agents/ocr.js';
import { retrieveContext } from '../rag/index.js';
import { loadUserContext, buildContextPrompt } from '../agents/context.js';
import { generateResponse } from '../agents/reasoning.js';
import { synthesizeText } from '../audio/tts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let enginesReady = false;
let engineInitError = null;
let recordingProcess = null;
let recordingStartTime = 0;

// Helper to configure or start node-record-lpcm16 with the hardcoded SoX path
export function getRecordingConfig() {
  return {
    sampleRate: 16000,
    channels: 1,
    audioType: 'wav',
    recorder: 'sox',
    recorderPath: 'C:\\Program Files (x86)\\sox-14-4-2\\sox.exe'
  };
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false // needed for file:// audio
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    if (enginesReady) {
      mainWindow.webContents.send('engines-ready', true);
    } else if (engineInitError) {
      mainWindow.webContents.send('engines-ready', false);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

process.env.QVAC_RPC_TIMEOUT = '180000';
process.env.PATH += ';C:\\Program Files (x86)\\sox-14-4-2';

// Must be set BEFORE app.whenReady() for Chromium to apply it
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

async function initWithRetry(maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`Engine init attempt ${i + 1}...`);
      await initMindSafe();
      return true;
    } catch (err) {
      console.log(`Attempt ${i + 1} failed:`, err.message);
      if (i < maxRetries - 1) {
        const waitMs = (i + 1) * 5000;
        console.log(`Retrying in ${waitMs/1000}s...`);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
  }
  return false;
}

app.whenReady().then(async () => {
  // Start loading models in background immediately with retry (FIX 2)
  initWithRetry().then((success) => {
    enginesReady = success;
    if (success) {
      console.log('All engines ready');
      startSession();
      if (mainWindow) {
        mainWindow.webContents.send('engines-ready', true);
      }
    } else {
      console.error('Engine init failed after all retries');
      engineInitError = new Error('Engine init failed');
      if (mainWindow) {
        mainWindow.webContents.send('engines-ready', false); // (FIX 4)
      }
    }
  }).catch(err => {
    enginesReady = false;
    engineInitError = err;
    console.error('Unexpected engine init error:', err);
    if (mainWindow) {
      mainWindow.webContents.send('engines-ready', false);
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Proper cleanup on quit (FIX 3)
app.on('before-quit', async (event) => {
  event.preventDefault();
  try {
    console.log('Saving and ending active session...');
    await endSession();
    console.log('Shutting down engines...');
    await shutdownMindSafe();
    console.log('Engines shut down cleanly');
  } catch(e) {
    console.log('Shutdown error:', e.message);
  } finally {
    app.exit(0);
  }
});

// IPC Handler: run-turn
ipcMain.handle('run-turn', async (event, audioPath) => {
  if (!mainWindow) return;

  // Set status to thinking on start
  mainWindow.webContents.send('status-change', 'thinking');

  try {
    const outputPath = 'C:\\MindSafe\\audio-samples\\response.wav';
    const result = await runConversationTurn(audioPath, outputPath);

    // Verify if it is classified as crisis
    const intakeResult = await processInput(result.transcribedText);
    
    if (intakeResult.isCrisis) {
      const crisisData = getCrisisUIData();
      mainWindow.webContents.send('crisis-detected', crisisData);
      return {
        ...result,
        isCrisis: true,
        crisisData
      };
    } else {
      mainWindow.webContents.send('status-change', 'speaking');
      mainWindow.webContents.send('turn-complete', result);
    }

    return result;
  } catch (error) {
    console.error('Error in run-turn handler:', error);
    mainWindow.webContents.send('status-change', 'idle');
    throw error;
  }
});

ipcMain.handle('start-recording', async () => {
  try {
    recordingStartTime = Date.now()
    // Delete previous recording if exists
    if (fs.existsSync(RECORDING_PATH)) {
      fs.unlinkSync(RECORDING_PATH)
    }
    
    const soxPath = 'C:\\Program Files (x86)\\sox-14-4-2\\sox.exe'
    
    recordingProcess = spawn(soxPath, [
      '-t', 'waveaudio', 'default',
      '-r', '16000',
      '-c', '1', 
      '-b', '16',
      '-e', 'signed-integer',
      RECORDING_PATH,
      'gain', '12'
    ])
    
    recordingProcess.stderr.on('data', (data) => {
      console.log('SoX:', data.toString())
    })
    
    recordingProcess.on('error', (err) => {
      console.error('SoX error:', err.message)
    })
    
    console.log('Recording started')
    return { started: true }
  } catch(err) {
    return { error: err.message }
  }
})

// Detect if Whisper is hearing TTS playback
// by checking if same phrase repeats 3+ times
function isRepetitionHallucination(text) {
  if (!text || text.trim().length === 0) 
    return false
  const sentences = text.split('.')
    .map(s => s.trim())
    .filter(s => s.length > 5)
  if (sentences.length < 2) return false
  
  // Check if first sentence repeats 3+ times
  const first = sentences[0].toLowerCase()
  const repeatCount = sentences.filter(s => 
    s.toLowerCase() === first).length
  return repeatCount >= 3
}

ipcMain.handle('stop-recording', async () => {
  try {
    if (recordingProcess) {
      recordingProcess.kill('SIGTERM')
      recordingProcess = null
    }

    const durationMs = Date.now() - recordingStartTime
    console.log('Recording duration:', durationMs, 'ms')

    if (durationMs < 500) {
      try {
        fs.unlinkSync(RECORDING_PATH)
      } catch(e) {}
      
      return {
        transcribedText: '',
        responseText: "That was too short. Please try again.",
        isCrisis: false
      }
    }

    // Wait for SoX to finish writing
    await new Promise(r => setTimeout(r, 1000))
    
    // Verify new file exists and has content
    if (!fs.existsSync(RECORDING_PATH)) {
      return {
        transcribedText: '',
        responseText: "I didn't catch that. Please try again.",
        isCrisis: false
      }
    }
    
    const stats = fs.statSync(RECORDING_PATH)
    console.log('Recording size:', stats.size, 'bytes, age:', Date.now() - stats.mtimeMs, 'ms')
    
    if (stats.size < 48000) {
      try {
        fs.unlinkSync(RECORDING_PATH)
      } catch(e) {}

      return {
        transcribedText: '',
        responseText: "I didn't catch that. Please speak a bit longer.",
        isCrisis: false
      }
    }
    
    // Verify file was created AFTER recording started
    // Reject if file is older than 30 seconds
    const fileAgeMs = Date.now() - stats.mtimeMs
    if (fileAgeMs > 30000) {
      try {
        fs.unlinkSync(RECORDING_PATH)
      } catch(e) {}

      return {
        transcribedText: '',
        responseText: "I didn't catch that. Please try again.",
        isCrisis: false
      }
    }
    
    const result = await runConversationTurn(RECORDING_PATH, RESPONSE_PATH)
    
    // Delete recording file after runConversationTurn to prevent stale readings on the next turn
    try {
      fs.unlinkSync(RECORDING_PATH)
    } catch(e) {}

    if (!result.transcribedText || result.transcribedText.trim().length === 0) {
      return {
        transcribedText: '',
        responseText: "I didn't catch that. Could you speak a little louder and try again?",
        isCrisis: false
      }
    }

    if (isRepetitionHallucination(result.transcribedText)) {
      return {
        transcribedText: '',
        responseText: "I didn't catch that clearly. Could you speak again?",
        isCrisis: false
      }
    }

    // Filter known Whisper hallucinations
    const hallucinationPhrases = [
      'good night', 'goodnight', 'thank you for watching',
      'thanks for watching', 'please subscribe',
      'see you next time', 'bye bye'
    ]

    const lowerText = result.transcribedText.toLowerCase().trim()
    const sentences = lowerText
      .split(/[.!?]/)
      .map(s => s.trim().replace(/[^a-z\s]/g, '').trim())
      .filter(s => s.length > 0)

    const allHallucinations = sentences.length > 0 && 
      sentences.every(s => 
        hallucinationPhrases.some(p => s === p || s === '')
      )

    if (allHallucinations) {
      return {
        transcribedText: '',
        responseText: "I didn't catch that. Could you speak a bit longer?",
        isCrisis: false
      }
    }
    
    const { processInput } = await import('../agents/intake.js')
    const intakeCheck = await processInput(result.transcribedText)
    
    if (intakeCheck.isCrisis) {
      const crisisData = getCrisisUIData();
      mainWindow.webContents.send('crisis-detected', crisisData);
      
      return {
        transcribedText: result.transcribedText,
        responseText: intakeCheck.crisisMessage,
        isCrisis: true,
        crisisData
      }
    }
    
    return {
      transcribedText: result.transcribedText,
      responseText: result.responseText,
      isCrisis: false,
      isClosing: intakeCheck.isClosing
    }
  } catch(err) {
    try {
      fs.unlinkSync(RECORDING_PATH)
    } catch(e) {}
    return { error: err.message }
  }
})

ipcMain.handle('get-journal', async (_, limit) => {
  return await getJournalEntries(limit || 20)
})

ipcMain.handle('search-journal', async (_, query) => {
  return await searchJournal(query)
})

ipcMain.handle('export-journal', async () => {
  try {
    const journal = JSON.parse(fs.readFileSync('C:\\MindSafe\\data\\journal.json', 'utf8') || '[]')
    const dateTag = new Date().toISOString().slice(0, 10)
    const exportPath = `C:\\MindSafe\\data\\MindSafe-Journal-${dateTag}.txt`

    let text = `MindSafe Journal Export\n${'='.repeat(50)}\nExported: ${new Date().toLocaleString('en-IN')}\nTotal sessions: ${journal.length}\n${'='.repeat(50)}\n\n`

    journal.forEach((entry, i) => {
      text += `=== Session ${i + 1} — ${entry.date} at ${entry.time} ===\n`
      if (entry.summary) text += `Summary: ${entry.summary}\n`
      if (entry.mood) text += `Mood: ${['😔','😟','😐','🙂','😊'][entry.mood-1]} (${entry.mood}/5)\n`
      text += '\n'
      if (entry.messages && entry.messages.length > 0) {
        entry.messages.forEach(msg => {
          if (msg.user)      text += `You: ${msg.user}\n`
          if (msg.assistant) text += `MindSafe: ${msg.assistant}\n`
          text += '\n'
        })
      }
      text += `${'-'.repeat(50)}\n\n`
    })

    fs.writeFileSync(exportPath, text, 'utf8')
    await shell.openPath(exportPath)
    return { success: true, path: exportPath }
  } catch(e) {
    console.error('export-journal error:', e.message)
    return { success: false, error: e.message }
  }
})

ipcMain.handle('save-mood', async (_, score, note) => {
  await saveMood(score, note)
  return { success: true }
})

ipcMain.handle('trigger-call', async (_, phone) => {
  await triggerCall(phone)
  return { success: true }
})

ipcMain.handle('trigger-sms', async (_, phone) => {
  await triggerSMS(phone)
  return { success: true }
})

ipcMain.handle('get-crisis-data', async () => {
  return getCrisisUIData()
})

ipcMain.handle('process-text', async (_, text) => {
  try {
    const intakeResult = await processInput(text)

    if (intakeResult.isCrisis) {
      const crisisData = getCrisisUIData()
      mainWindow.webContents.send('crisis-detected', crisisData)
      try { await synthesizeText(intakeResult.crisisMessage, RESPONSE_PATH) } catch(e) {}
      return { transcribedText: text, responseText: intakeResult.crisisMessage, isCrisis: true }
    }

    const [ragContext, userContext] = await Promise.all([
      retrieveContext(text),
      loadUserContext()
    ])

    const contextPrompt = buildContextPrompt(userContext)
    const messages = [
      { role: 'system', content: contextPrompt },
      { role: 'user', content: text }
    ];
    console.log('=== FULL PROMPT TO MEDPSY ===')
    console.log(JSON.stringify(messages, null, 2).slice(0, 1000))
    console.log('=== END PROMPT ===')
    const response = await generateResponse(text, ragContext, contextPrompt)
    await synthesizeText(response.text, RESPONSE_PATH)

    Promise.all([
      saveConversation({ transcribedText: text, responseText: response.text, timestamp: Date.now(), isCrisis: false }),
      saveTrainingData({ input: text, output: response.text, timestamp: Date.now() })
    ]).catch(e => console.log('Memory error:', e))

    return { transcribedText: text, responseText: response.text, isCrisis: false, isClosing: intakeResult.isClosing }
  } catch(err) {
    return { error: err.message }
  }
})

ipcMain.handle('save-temp-medical-file', async (_, { base64, mimeType }) => {
  try {
    let ext = '.pdf';
    if (mimeType === 'image/jpeg') ext = '.jpg';
    else if (mimeType === 'image/png') ext = '.png';
    else if (mimeType === 'image/webp') ext = '.webp';
    else if (mimeType === 'application/pdf') ext = '.pdf';

    const tempDir = 'C:\\MindSafe\\data';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const tempPath = path.join(tempDir, `temp-medical-upload${ext}`);
    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync(tempPath, buffer);
    console.log(`Saved temp medical file to ${tempPath}`);
    return { success: true, filePath: tempPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('extract-medical', async (_, { filePath }) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    let rawText;
    if (['.jpg', '.jpeg', '.png', '.webp', '.bmp'].includes(ext)) {
      rawText = await extractFromImage(filePath);
    } else {
      rawText = await extractTextFromFile(filePath);
    }
    const parsed = parseMedicalText(rawText);
    return { success: true, ...parsed };
  } catch(err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-medical', async () => {
  try {
    const data = fs.readFileSync('C:\\MindSafe\\data\\medical.json', 'utf8')
    return JSON.parse(data)
  } catch {
    return { conditions: '', medications: '', notes: '', lastUpdated: null }
  }
})

ipcMain.handle('save-medical', async (_, data) => {
  let existing = {}
  try {
    existing = JSON.parse(fs.readFileSync('C:\\MindSafe\\data\\medical.json', 'utf8'))
  } catch(e) {}
  const merged = { ...existing, ...data }
  merged.lastUpdated = new Date().toISOString()
  fs.writeFileSync('C:\\MindSafe\\data\\medical.json', JSON.stringify(merged, null, 2))
  try {
    await saveToTrainingFromMedical(merged);
  } catch (err) {
    console.error('Could not save medical to training data:', err.message);
  }
  return { success: true }
})

ipcMain.handle('clear-medical', async () => {
  const empty = { conditions: '', medications: '', notes: '', lastUpdated: null }
  fs.writeFileSync('C:\\MindSafe\\data\\medical.json', JSON.stringify(empty, null, 2))
  return { success: true }
})

ipcMain.handle('end-session', async () => {
  await endSession()
  return { success: true }
})

ipcMain.handle('start-new-session', async () => {
  await startSession()
  return { success: true }
})

// Profile
ipcMain.handle('get-profile', async () => {
  try {
    return JSON.parse(fs.readFileSync('C:\\MindSafe\\data\\profile.json', 'utf8'))
  } catch { return {} }
})

ipcMain.handle('save-profile', async (_, data) => {
  fs.writeFileSync('C:\\MindSafe\\data\\profile.json', JSON.stringify(data, null, 2))
  return { success: true }
})

// Journal management
ipcMain.handle('update-journal-entry', async (_, id, updates) => {
  try {
    const entries = JSON.parse(fs.readFileSync('C:\\MindSafe\\data\\journal.json', 'utf8'))
    const idx = entries.findIndex(e => e.id === id)
    if (idx !== -1) {
      entries[idx] = { ...entries[idx], ...updates }
      fs.writeFileSync('C:\\MindSafe\\data\\journal.json', JSON.stringify(entries, null, 2))
    }
    return { success: true }
  } catch(e) { return { success: false } }
})

ipcMain.handle('delete-journal-entry', async (_, id) => {
  try {
    let entries = JSON.parse(fs.readFileSync('C:\\MindSafe\\data\\journal.json', 'utf8'))
    entries = entries.filter(e => e.id !== id)
    fs.writeFileSync('C:\\MindSafe\\data\\journal.json', JSON.stringify(entries, null, 2))
    return { success: true }
  } catch(e) { return { success: false } }
})

ipcMain.handle('export-analysis', async () => {
  try {
    const journal = JSON.parse(fs.readFileSync('C:\\MindSafe\\data\\journal.json', 'utf8') || '[]')
    const mood = JSON.parse(fs.readFileSync('C:\\MindSafe\\data\\mood.json', 'utf8') || '[]')
    const dateTag = new Date().toISOString().slice(0, 10)
    const exportPath = `C:\\MindSafe\\data\\MindSafe-Analysis-${dateTag}.txt`

    const avg = mood.length ? (mood.reduce((s,m) => s+m.score,0)/mood.length).toFixed(1) : 'N/A'
    const STOP = new Set(['i','you','the','a','an','and','or','but','is','was','are','were','to','of','in','it','my','me','we'])
    const topWords = (text) => {
      const freq = {}
      text.toLowerCase().replace(/[^\w\s]/g,'').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)).forEach(w => { freq[w] = (freq[w]||0)+1 })
      return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([w])=>w).join(', ')
    }

    let text = `MindSafe Analysis Report\n${'='.repeat(50)}\nGenerated: ${new Date().toLocaleString('en-IN')}\n\n`
    text += `Total sessions: ${journal.length}\nAverage mood: ${avg}/5\n\n`
    text += `${'='.repeat(50)}\nSession Breakdown\n${'='.repeat(50)}\n\n`

    journal.forEach((entry, i) => {
      const msgs = entry.messages || []
      const transcript = msgs.map(m => `${m.user||''} ${m.assistant||''}`).join(' ')
      const keywords = transcript ? topWords(transcript) : 'none'
      const moodStr = entry.mood ? `${entry.mood}/5` : 'not rated'
      text += `${entry.date}: ${msgs.length} message${msgs.length===1?'':'s'}. Mood: ${moodStr}. Keywords: ${keywords}\n`
    })

    if (mood.length > 0) {
      text += `\n${'='.repeat(50)}\nMood History (last 30)\n${'='.repeat(50)}\n`
      mood.slice(-30).forEach(m => {
        text += `${m.date}: ${'●'.repeat(m.score)}${'○'.repeat(5-m.score)} (${m.score}/5)\n`
      })
    }

    fs.writeFileSync(exportPath, text, 'utf8')
    await shell.openPath(exportPath)
    return { success: true, path: exportPath }
  } catch(e) {
    console.error('export-analysis error:', e.message)
    return { success: false, error: e.message }
  }
})

ipcMain.handle('export-therapist-report', async () => {
  try {
    const profile  = JSON.parse(fs.readFileSync('C:\\MindSafe\\data\\profile.json', 'utf8') || '{}')
    const medical  = JSON.parse(fs.readFileSync('C:\\MindSafe\\data\\medical.json', 'utf8') || '{}')
    const mood     = JSON.parse(fs.readFileSync('C:\\MindSafe\\data\\mood.json', 'utf8') || '[]')
    const journal  = JSON.parse(fs.readFileSync('C:\\MindSafe\\data\\journal.json', 'utf8') || '[]')

    const dateTag = new Date().toISOString().slice(0, 10)
    const exportPath = `C:\\MindSafe\\data\\MindSafe-TherapistReport-${dateTag}.txt`
    const avg = mood.length ? (mood.reduce((s,m) => s+m.score,0)/mood.length).toFixed(1) : 'N/A'

    // Crisis keyword scan
    const crisisRegex = /\b(suicide|suicidal|self[\s-]?harm|kill(ing)?\s+myself|end(ing)?\s+(my\s+life|it\s+all)|hurt(ing)?\s+myself|don'?t\s+want\s+to\s+live|want(s)?\s+to\s+die|no\s+reason\s+to\s+live|cut(ting)?\s+myself)\b/i
    const positiveRegex = /\b(thank you|helpful|better|calm|relieved|grateful|happy|good|improving|hopeful|peace|relaxed)\b/i
    let crisisCount = 0
    const crisisDates = []
    const positiveFound = new Set()

    // Streak (consecutive days)
    const sessionDates = [...new Set(
      journal.filter(e => e.timestamp)
             .map(e => new Date(e.timestamp).toLocaleDateString('en-IN'))
    )].sort().reverse()
    let streak = 0
    for (let i = 0; i < 365; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      if (sessionDates.includes(d.toLocaleDateString('en-IN'))) streak++
      else if (i > 0) break
    }

    journal.forEach(entry => {
      const msgs = entry.messages || []
      msgs.forEach(msg => {
        const combined = `${msg.user||''} ${msg.assistant||''}`
        if (crisisRegex.test(combined)) {
          crisisCount++
          if (entry.date && !crisisDates.includes(entry.date)) crisisDates.push(entry.date)
        }
        const posMatch = combined.match(new RegExp(positiveRegex.source, 'gi'))
        if (posMatch) posMatch.forEach(p => positiveFound.add(p.toLowerCase()))
      })
    })

    let text = `THERAPIST SUMMARY — MindSafe\n${'='.repeat(50)}\nGenerated: ${new Date().toLocaleString('en-IN')}\n\n`
    text += `Patient: ${profile.name || 'Anonymous'} | Age: ${profile.age || 'N/A'}\n`
    text += `Goals: ${profile.goals || 'N/A'}\n\n`
    text += `Conditions:  ${Array.isArray(medical.conditions)  ? medical.conditions.join(', ')  : (medical.conditions  || 'None')}\n`
    text += `Medications: ${Array.isArray(medical.medications) ? medical.medications.join(', ') : (medical.medications || 'None')}\n`
    text += `Allergies:   ${medical.allergies || 'None'}\n\n`
    text += `${'='.repeat(50)}\n`
    text += `Total sessions:                ${journal.length}\n`
    text += `Average mood:                  ${avg}/5\n`
    text += `Current streak:                ${streak} day${streak===1?'':'s'}\n`
    text += `Crisis expressions detected:   ${crisisCount} time${crisisCount===1?'':'s'}\n`
    if (crisisDates.length) text += `Dates of concern:              ${crisisDates.join(', ')}\n`
    text += `Positive indicators:           ${positiveFound.size ? [...positiveFound].slice(0,8).join(', ') : 'none detected'}\n`
    text += `${'='.repeat(50)}\n\nRecent sessions:\n`
    journal.slice(0, 5).forEach((e, i) => {
      text += `  ${i+1}. ${e.date} at ${e.time} — ${(e.messages||[]).length} messages. Mood: ${e.mood||'not rated'}.\n`
    })

    fs.writeFileSync(exportPath, text, 'utf8')
    await shell.openPath(exportPath)
    return { success: true, path: exportPath }
  } catch(e) {
    console.error('export-therapist-report error:', e.message)
    return { success: false, error: e.message }
  }
})

ipcMain.handle('clear-all-data', async () => {
  const files = ['journal.json','mood.json','training.json','gratitude.json']
  files.forEach(f => {
    try { fs.writeFileSync(`C:\\MindSafe\\data\\${f}`, '[]') } catch {}
  })
  ;['medical.json','profile.json'].forEach(f => {
    try { fs.writeFileSync(`C:\\MindSafe\\data\\${f}`, '{}') } catch {}
  })
  return { success: true }
})

ipcMain.handle('set-region', async (_, region) => {
  process.env.MINDSAFE_REGION = region
  return { success: true }
})

// Set language from profile
ipcMain.handle('set-language', async (_, language) => {
  process.env.MINDSAFE_LANGUAGE = language
  return { success: true }
})

// Generate analysis
ipcMain.handle('generate-analysis', async (_, data) => {
  try {
    const count = data.sessionCount || 0
    const avg = data.avgMood ? parseFloat(data.avgMood) : null
    const streak = data.streak || 0
    const moods = data.recentMoods || []

    let insights = ''
    if (count === 0) {
      insights = 'Start your first session to begin tracking your mental wellness journey.'
    } else if (count < 3) {
      insights = `You have completed ${count} session${count > 1 ? 's' : ''} so far. Keep going — consistency is the foundation of mental wellness.`
    } else {
      const trend = moods.length >= 2
        ? moods[moods.length - 1] > moods[0] ? 'improving' : 'stable'
        : 'building'
      insights = `You have completed ${count} sessions with a ${trend} mood trend. ${
        streak > 1
          ? `Your ${streak}-day streak shows real commitment.`
          : 'Each session is a step forward.'
      } ${
        avg && avg >= 4
          ? 'Your mood scores reflect genuine progress.'
          : avg && avg >= 3
          ? 'You are showing steady resilience.'
          : 'Every session matters, even the hard ones.'
      }`
    }

    const affirmations = [
      'You are stronger than you think.',
      'Every step forward counts, no matter how small.',
      'You deserve peace and gentleness today.',
      'Showing up for yourself is an act of courage.',
      'Your feelings are valid. You are not alone.'
    ]
    const affirmation = affirmations[count % affirmations.length]

    return { insights, affirmation }
  } catch (e) {
    return {
      insights: 'Keep showing up — every session is a step forward.',
      affirmation: 'You are doing better than you know.'
    }
  }
})

ipcMain.handle('get-mood-history', async () => {
  try {
    return JSON.parse(fs.readFileSync('C:\\MindSafe\\data\\mood.json', 'utf8') || '[]')
  } catch { return [] }
})

// Gratitude note
ipcMain.handle('save-gratitude-note', async (_, { prompt, text }) => {
  try {
    let notes = []
    try { notes = JSON.parse(fs.readFileSync('C:\\MindSafe\\data\\gratitude.json', 'utf8')) } catch {}
    notes.push({ prompt, text, date: new Date().toLocaleDateString('en-IN'), timestamp: Date.now() })
    fs.writeFileSync('C:\\MindSafe\\data\\gratitude.json', JSON.stringify(notes, null, 2))
    return { success: true }
  } catch(e) { return { success: false } }
})

ipcMain.handle('play-affirmation', async () => {
  try {
    const affirmations = [
      'You are stronger than you think.',
      'This moment will pass. You are safe.',
      'You deserve peace and gentleness.',
      'Your feelings are valid. You are not alone.',
      'You are doing better than you know.'
    ]
    const text = affirmations[Math.floor(Math.random() * affirmations.length)]
    await synthesizeText(text, RESPONSE_PATH)
    return { success: true }
  } catch(e) { return { success: false } }
})

ipcMain.handle('speak-text', async (_, text) => {
  try {
    await synthesizeText(String(text).slice(0, 200), RESPONSE_PATH)
    return { success: true, audioPath: RESPONSE_PATH }
  } catch(e) {
    console.error('speak-text error:', e.message)
    return { success: false, error: e.message }
  }
})

