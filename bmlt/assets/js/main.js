import { transliterate } from '../../modules/ime/transliterator.js';

const inputArea = document.getElementById('input');
const saveBtn = document.getElementById('saveBtn');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');

inputArea.addEventListener('input', () => {
  const cursorPos = inputArea.selectionStart;
  const text = inputArea.value;

  // Trigger on space or punctuation
  const lastChar = text[cursorPos - 1];
  if (lastChar === ' ' || /[.,!?;:]/.test(lastChar)) {

    // Split into words and spaces/punctuation
    const regex = /(\S+|\s+|[.,!?;:])/g;
    let match;
    const tokens = [];
    let tokenEnd = 0;

    while ((match = regex.exec(text)) !== null) {
      tokens.push(match[0]);
      tokenEnd = regex.lastIndex;
    }

    // Find last non-space, non-punctuation token before cursor
    let lastWordIndex = tokens.length - 2;
    while (lastWordIndex >= 0 && /^\s*$/.test(tokens[lastWordIndex] || '') || /^[.,!?;:]$/.test(tokens[lastWordIndex] || '')) {
      lastWordIndex--;
    }

    if (lastWordIndex >= 0) {
      const lastWord = tokens[lastWordIndex];
      const transliterated = transliterate(lastWord);
      tokens[lastWordIndex] = transliterated;

      // Rebuild text
      const newText = tokens.join('');
      inputArea.value = newText;

      // Preserve cursor immediately after typed character
      const charsUpToCursor = text.slice(0, cursorPos);
      let newCursor = transliterateCursorPosition(lastWordIndex, tokens, charsUpToCursor);
      inputArea.selectionStart = inputArea.selectionEnd = newCursor;
    }
  }
});

// Helper function to calculate cursor after replacement
function transliterateCursorPosition(lastWordIndex, tokens, originalTextUpToCursor) {
  let charCount = 0;
  for (let i = 0; i <= lastWordIndex; i++) {
    charCount += tokens[i].length;
  }
  // If user typed punctuation, add it to cursor
  const remaining = originalTextUpToCursor.length - charCount;
  return charCount + Math.max(0, remaining);
}

// Save to local storage
saveBtn.addEventListener('click', () => {
  localStorage.setItem('bishnupriya_doc', inputArea.value);
  alert('Document saved locally!');
});

// Export as text file
exportBtn.addEventListener('click', () => {
  const blob = new Blob([inputArea.value], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bishnupriya_text.txt';
  a.click();
  URL.revokeObjectURL(url);
});

// Clear input
clearBtn.addEventListener('click', () => {
  inputArea.value = '';
});

// Load saved text on page load
window.addEventListener('load', () => {
  const saved = localStorage.getItem('bishnupriya_doc');
  if (saved) inputArea.value = saved;
});

// PWA: register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js')
    .then(() => console.log('Service Worker registered'))
    .catch(err => console.error('SW registration failed:', err));
}

