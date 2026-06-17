/**
 * Cleans the model response text by removing thinking blocks and bold markers.
 * @param {string} text - The raw response text from the model.
 * @returns {string} The cleaned plain text.
 */
export default function cleanResponse(text) {
  if (typeof text !== 'string') {
    return '';
  }
  
  // 1. Remove any <think>...</think> blocks (including multiline content)
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  // Also remove any unclosed <think> blocks at the end of the text
  cleaned = cleaned.replace(/<think>[\s\S]*$/g, '');
  
  // 2. Remove markdown bold markers (**text** -> text)
  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '$1');
  
  // 3. Return the cleaned plain text string, trimmed of excess outer whitespace
  return cleaned.trim();
}
