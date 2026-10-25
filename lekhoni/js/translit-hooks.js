/**
 * TRANSLIT HOOKS - Pre and Loop stage hooks for accurate transliteration
 * Based on TransLitLab engine logic
 * 
 * These hooks handle special patterns that require context awareness:
 * - PRE hooks: Transform input BEFORE the main loop
 * - LOOP hooks: Modify behavior during character-by-character processing
 * - POST hooks: Final cleanup after main loop
 */

/**
 * PRE HOOK 1: Anusvara + Vowel Substitution
 * Handles: ng + vowel → ঙ + matra
 * Example: "ngai" → "ঙাই" (BEFORE core loop processes it)
 */
function preHookAnusvaraVowel(state, config) {
  let input = state.input;
  
  // Remove ZWJ/ZWNJ for pattern matching
  input = input.replace(/[\u200c\u200d]/g, '');
  
  // Get matras from forward map
  const getMatraValue = (key) => {
    if (!config.maps.forward.matras) return '';
    const match = config.maps.forward.matras.find(p => Array.isArray(p) && p[0] === key);
    return match ? match[1] : '';
  };
  
  // Get independent vowel
  const getIndVowel = (key) => {
    if (!config.maps.forward.independent_vowels) return '';
    const match = config.maps.forward.independent_vowels.find(p => Array.isArray(p) && p[0] === key);
    return match ? match[1] : '';
  };
  
  const NGA = '\u0999'; // ঙ
  
  // Patterns: ng + vowel combinations
  // Longest patterns first (to avoid partial matches)
  const patterns = [
    // ng + vowel combinations (with inherent vowel)
    { from: 'ngai',  to: () => NGA + getMatraValue('a') + getIndVowel('i') },
    { from: 'ngOI',  to: () => NGA + getMatraValue('OI') },
    { from: 'ngOU',  to: () => NGA + getMatraValue('OU') },
    { from: 'ngaa',  to: () => NGA + (getMatraValue('aa') || getMatraValue('A')) },
    { from: 'ngee',  to: () => NGA + (getMatraValue('ee') || getMatraValue('ii')) },
    { from: 'ngii',  to: () => NGA + getMatraValue('ii') },
    { from: 'nguu',  to: () => NGA + (getMatraValue('uu') || getMatraValue('U')) },
    { from: 'ngA',   to: () => NGA + getMatraValue('A') },
    { from: 'ngU',   to: () => NGA + getMatraValue('U') },
    { from: 'ngrri', to: () => NGA + getMatraValue('rri') },
    { from: 'ngO',   to: () => NGA + getMatraValue('O') },
    { from: 'nge',   to: () => NGA + getMatraValue('e') },
    { from: 'ngi',   to: () => NGA + getMatraValue('i') },
    { from: 'nga',   to: () => NGA + getMatraValue('a') },
    { from: 'ngo',   to: () => NGA },  // ng + inherent o = just ঙ
  ];
  
  for (const pattern of patterns) {
    if (input.includes(pattern.from)) {
      const replacement = pattern.to();
      if (replacement) {
        input = input.split(pattern.from).join(replacement);
        state.log.push(`[PRE ANUSVARA] ${pattern.from} → ${replacement}`);
      }
    }
  }
  
  state.input = input;
  return state;
}

/**
 * PRE HOOK 2: Reph Immediate Consonant
 * Handles: rr + consonant → ৰ + consonant (reph form)
 * Allows 'rr' to be properly handled in core loop without forced pre-conversion
 */
function preHookRephConsonant(state, config) {
  // Get all consonants from config
  if (!config.maps.forward.consonants) return state;
  
  const consonants = config.maps.forward.consonants
    .filter(p => Array.isArray(p) && p[0] !== '_meta')
    .map(p => p[0])
    .sort((a, b) => b.length - a.length);  // Longest first
  
  let input = state.input;
  
  // Look for 'rr' followed by consonants
  for (const consonant of consonants) {
    if (consonant === 'y') continue;  // Skip y-phala
    
    // Just log that we're allowing natural reph handling
    // Don't force conversion here - let core loop handle it
    const pattern = 'rr' + consonant;
    if (input.includes(pattern)) {
      state.log.push(`[PRE REPH] Allowing natural cluster handling for: ${pattern}`);
    }
  }
  
  state.input = input;
  return state;
}

/**
 * LOOP HOOK 1: Vowel After Vowel → Independent Form
 * When a vowel follows another vowel (or matra), use independent form
 * Example: "ki" + "a" → "কি" + "আ" (not "কিা")
 */
function loopHookVowelAfterVowel(state, config) {
  if (!config.maps.forward.vowels) return state;
  if (!config.maps.forward.matras) return state;
  if (!config.maps.forward.independent_vowels) return state;
  
  // Get all matra keys
  const matras = config.maps.forward.matras
    .filter(p => Array.isArray(p) && p[0] !== '_meta' && p[0] !== 'o')
    .map(p => p[0])
    .sort((a, b) => b.length - a.length);  // Longest first
  
  // Check if previous was a matra
  const consumed = state.input.slice(0, state.pos);
  const prevWasMatra = state.prev.was_matra 
    || matras.some(mk => consumed.endsWith(mk))
    || consumed.endsWith('o');  // 'o' is inherent vowel, counts as matra context
  
  if (!prevWasMatra) return state;  // Previous wasn't matra, continue normally
  
  // Look for vowel at current position
  const vowels = config.maps.forward.vowels
    .filter(p => Array.isArray(p) && p[0] !== '_meta')
    .map(p => p[0])
    .sort((a, b) => b.length - a.length);  // Longest first
  
  for (const vowel of vowels) {
    if (state.input.startsWith(vowel, state.pos)) {
      // Found a vowel after matra - use independent form
      const indVowels = config.maps.forward.independent_vowels
        .find(p => Array.isArray(p) && p[0] === vowel);
      
      if (indVowels && indVowels[1]) {
        const indForm = indVowels[1];
        state.output += indForm;
        state.pos += vowel.length;
        state.prev = { token: vowel, was_consonant: false, was_matra: false };
        state.handled = true;
        state.log.push(`[LOOP V+V] ${vowel} → ${indForm} (independent vowel after matra)`);
        return state;
      }
    }
  }
  
  return state;
}

/**
 * LOOP HOOK 2: Consonant Cluster Analysis
 * Tracks consonant clusters for proper virama insertion
 */
function loopHookConsonantCluster(state, config) {
  if (!config.maps.forward.consonants) return state;
  
  // Check if current position starts with consonant
  const consonants = config.maps.forward.consonants
    .filter(p => Array.isArray(p) && p[0] !== '_meta')
    .map(p => p[0])
    .sort((a, b) => b.length - a.length);
  
  for (const consonant of consonants) {
    if (state.input.startsWith(consonant, state.pos)) {
      // Check if previous was also a consonant (without matra/vowel between)
      if (state.prev.was_consonant && !state.prev.was_matra) {
        // Consonant cluster - may need virama
        state.log.push(`[LOOP CLUSTER] Consonant cluster detected: ${state.prev.token} + ${consonant}`);
      }
      break;
    }
  }
  
  return state;
}

/**
 * Export hooks as array
 */
const TRANSLIT_HOOKS = {
  preHooks: [
    preHookAnusvaraVowel,
    preHookRephConsonant
  ],
  loopHooks: [
    loopHookVowelAfterVowel,
    loopHookConsonantCluster
  ],
  postHooks: []
};

// Export for use in wrapper
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TRANSLIT_HOOKS;
}
if (typeof window !== 'undefined') {
  window.TRANSLIT_HOOKS = TRANSLIT_HOOKS;
}
