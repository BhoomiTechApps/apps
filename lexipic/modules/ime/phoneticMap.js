// modules/ime/phoneticMap.js
//modules/ime/phoneticMap.js --- Version 1.1
//----------------------------------------------

export const vowels = {
  o: "অ", a: "আ", aa: "আ", A: "আ", i: "ই", ee: "ই", ii: "ঈ", I: "ঈ", u: "উ", oo: "উ", uu: "ঊ", U: "ঊ", rri: "ঋ", e: "এ", OI: "ঐ", O: "ও", OU: "ঔ"
};
export const matras = {
  // Core Vowels
  aa: "া", A: "া", a: "া", 
  i: "ি", ii: "ী", I: "ী",
  u: "ু", uu: "ূ", U: "ূ",
  e: "ে", 
  OI: "ৈ", 
  O: "ো", 
  OU: "ৌ",
  rri: "ৃ",
  
  // The 'o' is the inherent vowel; mapping to empty string prevents Halanta
  o: "", 
  
  // The 'y' acts as the J-fala modifier
  y: "্য", Y: "্য",
  
  // Manual Non-Joiner
  "'": "\u200C"
};
export const consonantRules = [
  // Longest first
  ["ssh", "ষ"], ["kkh", "ক্ষ"], ["t``", "ৎ"], ["t''", "ৎ"], ["Sh", "ষ"], ["kh", "খ"], ["gh", "ঘ"], ["ch", "ছ"], ["jh", "ঝ"], ["Th", "ঠ"],
  ["Dh", "ঢ"], ["th", "থ"], ["dh", "ধ"], ["ph", "ফ"], ["bh", "ভ"], ["sh", "শ"], ["NG", "ঞ"], ["Ng", "ঙ"], ["ng", "ং"], ["Rh", "ঢ়"],
  ["s`", "স"], ["f", "ফ"], ["k", "ক"], ["g", "গ"], ["c", "চ"], ["j", "জ"], ["T", "ট"], ["D", "ড"], ["N", "ণ"], ["t", "ত"], ["d", "দ"],
  ["n", "ন"], ["p", "প"], ["f", "ফ"], ["b", "ব"], ["v", "ভ"], ["m", "ম"], ["y", "য়"], ["z", "য"], ["r", "ৰ"], ["R", "ড়"],
  ["l", "ল"], ["w", "ৱ"], ["S", "স"], ["s", "ছ"], ["h", "হ"], [":", "ঃ"], ["^", "ঁ"]
];
export const nonlinkingConsonants = ["ng", ":", "^", "t``", "t''"];
export const symbolRules = [
  [",,", "্‌"], [".", "।"], ["!", "!"], ["?", "?"], [";", ";"], ["(", "("], [")", ")"], ["-", "-"], ["+", "+"], ["*", "*"]
];
export const conjunctionRules = [
   ["", ""],
];
export const numberRules = [
  ["1", "১"], ["2", "২"], ["3", "৩"], ["4", "৪"], ["5", "৫"], ["6", "৬"], ["7", "৭"], ["8", "৮"], ["9", "৯"], ["0", "০"]
];

