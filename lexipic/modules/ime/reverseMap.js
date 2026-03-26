// A dedicated map for BM -> Roman Reversal (Independent of typing map)
export const reverseVowels = {
  "অ": "o", "আ": "a", "ই": "i", "ঈ": "i", "উ": "u", 
  "ঊ": "u", "ঋ": "ri", "এ": "e", "ঐ": "oi", "ও": "o", "ঔ": "ou"
};

export const reverseMatras = {
  "া": "a", "ি": "i", "ী": "i", "ু": "u", "ূ": "u", "ৃ": "ri",
  "ে": "e", "ৈ": "oi", "ো": "O", "ৌ": "ou" // 'O' is a protection flag for the cleaner
};

export const reverseSymbols = {
  "।": ".",
  "॥": ".."
};

export const reverseConsonants = {
  // 1. Complex Conjuncts (matched first to prevent splitting)
  "ক্ষ": "kkh",
  "জ্ঞ": "jng",
  "ন্দ": "nd",
  "ন্ত": "nt",
  "ষ্ট": "sht",
  "ম্ভ": "mbh",
  "ম্প": "mp",
  "হ্ম": "hm",
  "ণ্ড": "nd",
  "ঞ্চ": "ngc",
  "ঞ্জ": "ngj",
  // 2. Single Consonants
  "য়": "y", "য়": "y", "ক": "k", "খ": "kh", "গ": "g",
  "ঘ": "gh", "ঙ": "ng", "চ": "ch", "ছ": "s", "জ": "j",
  "ঝ": "jh", "ঞ": "ng", "ট": "t", "ঠ": "th", "ড": "d",
  "ঢ": "dh", "ণ": "n", "ত": "t", "থ": "th", "দ": "d",
  "ধ": "dh", "ন": "n", "প": "p", "ফ": "ph", "ব": "b",
  "ভ": "bh", "ম": "m", "য": "z", "ৰ": "r", "ল": "l",
  "শ": "sh","ষ": "sh", "স": "s", "হ": "h", "ড়": "r",
  "ঢ়": "rh", "ৱ": "w", "ৎ": "t",
  // 3. Phonetic Symbols
  // Note: '্য' (J-fala) and '্ৰ' (Ra-fala) are REMOVED from here 
  // because they are handled by logic in reverse.js
  "ং": "ng",
  "ঃ": ":",
  "ঁ": "^",
};

export const reverseNumbers = {
  "১": "1", "২": "2", "৩": "3", "৪": "4", "৫": "5", 
  "৬": "6", "৭": "7", "৮": "8", "৯": "9", "০": "0"
};
