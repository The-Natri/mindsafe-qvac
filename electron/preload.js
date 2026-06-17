const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  onTurnComplete: (cb) => 
    ipcRenderer.on('turn-complete', (_, data) => cb(data)),
  onCrisisDetected: (cb) => 
    ipcRenderer.on('crisis-detected', (_, data) => cb(data)),
  onStatusChange: (cb) => 
    ipcRenderer.on('status-change', (_, status) => cb(status)),
  runTurn: (audioPath) => 
    ipcRenderer.invoke('run-turn', audioPath),
  startRecording: () => 
    ipcRenderer.invoke('start-recording'),
  stopRecording: () => 
    ipcRenderer.invoke('stop-recording'),
  onEnginesReady: (cb) => 
    ipcRenderer.on('engines-ready', (_, ok) => cb(ok)),
  getJournal: (limit) => 
    ipcRenderer.invoke('get-journal', limit),
  searchJournal: (query) => 
    ipcRenderer.invoke('search-journal', query),
  exportJournal: () => 
    ipcRenderer.invoke('export-journal'),
  saveMood: (score, note) => 
    ipcRenderer.invoke('save-mood', score, note),
  triggerCall: (phone) => 
    ipcRenderer.invoke('trigger-call', phone),
  triggerSMS: (phone) => 
    ipcRenderer.invoke('trigger-sms', phone),
  processText: (text) => 
    ipcRenderer.invoke('process-text', text),
  getCrisisData: () => 
    ipcRenderer.invoke('get-crisis-data'),
  saveTempMedicalFile: (payload) => 
    ipcRenderer.invoke('save-temp-medical-file', payload),
  extractMedical: (payload) => 
    ipcRenderer.invoke('extract-medical', payload),
  getMedical: () => 
    ipcRenderer.invoke('get-medical'),
  saveMedical: (data) => 
    ipcRenderer.invoke('save-medical', data),
  clearMedical: () => 
    ipcRenderer.invoke('clear-medical'),
  endSession: () => 
    ipcRenderer.invoke('end-session'),
  startNewSession: () => 
    ipcRenderer.invoke('start-new-session'),
  getProfile: () => 
    ipcRenderer.invoke('get-profile'),
  saveProfile: (data) => 
    ipcRenderer.invoke('save-profile', data),
  updateJournalEntry: (id, updates) => 
    ipcRenderer.invoke('update-journal-entry', id, updates),
  deleteJournalEntry: (id) => 
    ipcRenderer.invoke('delete-journal-entry', id),
  exportAnalysis: () => 
    ipcRenderer.invoke('export-analysis'),
  exportTherapistReport: () => 
    ipcRenderer.invoke('export-therapist-report'),
  clearAllData: () => 
    ipcRenderer.invoke('clear-all-data'),
  setRegion: (region) => 
    ipcRenderer.invoke('set-region', region),
  setLanguage: (language) => 
    ipcRenderer.invoke('set-language', language),
  getMoodHistory: () => 
    ipcRenderer.invoke('get-mood-history'),
  generateAnalysis: (data) => 
    ipcRenderer.invoke('generate-analysis', data),
  saveGratitudeNote: (data) => 
    ipcRenderer.invoke('save-gratitude-note', data),
  playAffirmation: () => 
    ipcRenderer.invoke('play-affirmation'),
  speakText: (text) =>
    ipcRenderer.invoke('speak-text', text)
})
