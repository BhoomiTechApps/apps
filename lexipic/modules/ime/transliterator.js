// modules/ime/transliterator.js --- Version 1.4
// ----------------------------------------------

import {
  vowels,
  matras,
  consonantRules,
  nonlinkingConsonants,
  symbolRules,
  numberRules
} from "./phoneticMap.js";

const HALANTA = "্";
const ZWJ = "\u200D"; 
const ZWNJ = "\u200C"; 

const consonantMap = Object.fromEntries(consonantRules);
const symbolMap = Object.fromEntries(symbolRules);
const numberMap = Object.fromEntries(numberRules);

const sortedVowelKeys = Object.keys(vowels).sort((a, b) => b.length - a.length);
const sortedMatraKeys = Object.keys(matras).sort((a, b) => b.length - a.length);
const sortedConsonantKeys = Object.keys(consonantMap).sort((a, b) => b.length - a.length);
const sortedSymbolKeys = Object.keys(symbolMap).sort((a, b) => b.length - a.length);
const sortedNumberKeys = Object.keys(numberMap).sort((a, b) => b.length - a.length);

export function transliterate(input) {
  // Fix for Android Auto-Capitalization: 
  // If the first character is Uppercase, check if it exists in rules.
  // If 'K' isn't a rule but 'k' is, treat it as 'k'.
  if (input.length > 0) {
    let firstChar = input[0];
    if (/[A-Z]/.test(firstChar)) {
      const lowerChar = firstChar.toLowerCase();
      // Only lowercase it if the uppercase version isn't a valid starting rule
      const hasUpperRule = sortedConsonantKeys.includes(firstChar) || sortedVowelKeys.includes(firstChar);
      const hasLowerRule = sortedConsonantKeys.includes(lowerChar) || sortedVowelKeys.includes(lowerChar);
      
      if (!hasUpperRule && hasLowerRule) {
        input = lowerChar + input.slice(1);
      }
    }
  }
  
  let output = "";
  let i = 0;

  while (i < input.length) {
    // 1. SYMBOLS
    let sKey = sortedSymbolKeys.find(k => input.startsWith(k, i));
    if (sKey) {
      output += symbolMap[sKey];
      i += sKey.length;
      continue;
    }

    // 2. INDEPENDENT VOWELS
    let isStart = (i === 0 || /[^a-zA-Z]/.test(input[i - 1]));
    let isAfterVowel = i > 0 && sortedVowelKeys.some(v => input.slice(0, i).endsWith(v));
    let vKey = sortedVowelKeys.find(k => input.startsWith(k, i));

    if (vKey && (isStart || isAfterVowel)) {
        output += vowels[vKey];
        i += vKey.length;
        continue;
    }

    // 3. CONSONANTS & MATRAS
    let cKey = sortedConsonantKeys.find(k => input.startsWith(k, i));
    if (cKey) {
      let char = consonantMap[cKey];
      let nextPos = i + cKey.length;
      let mKey = sortedMatraKeys.find(k => input.startsWith(k, nextPos));

      if (mKey !== undefined) {
        let matraValue = matras[mKey] || "";
        let afterMatraPos = nextPos + mKey.length;

        // --- Multi-Matra Logic (Handles 'ya', 'yo', etc.) ---
        // FIX: Only look for a second matra if the first one is a modifier (like J-fala 'y')
        // This prevents 'koriya' from breaking by incorrectly attaching 'a' to 'i'.
        let secondMKey = (mKey === "y" || mKey === "Y") 
          ? sortedMatraKeys.find(k => input.startsWith(k, afterMatraPos)) 
          : undefined;
        
        if (secondMKey !== undefined) {
          if (secondMKey === "o") {
            let charAfterO = input[afterMatraPos + secondMKey.length];
            const isEndOfWord = !charAfterO || /[^a-zA-Z]/.test(charAfterO);
            output += char + matraValue + (isEndOfWord ? ZWNJ : "");
          } else {
            output += char + matraValue + matras[secondMKey];
          }
          i = afterMatraPos + secondMKey.length;
        } 
        // --- Special Case: 'o' as a Cluster Breaker (for bishoy, Sotyojit) ---

        else if (mKey === "o") {
          let nextChar = input[nextPos + 1];
          const isEndOfWord = !nextChar || /[^a-zA-Z]/.test(nextChar);

          if (isEndOfWord) {
            // Keep ZWNJ for word ends (e.g., 'Sotyo') to prevent accidental joining
            output += char + ZWNJ; 
          } else {
            // FIX: Add NOTHING for mid-word 'o'. 
            // This allows the next consonant (like 'ng') to trigger the Ligature logic.
            output += char; 
          }
          i = nextPos + mKey.length;
        }
		
        // --- Explicit Hosonto / Stop ---
        else if (mKey === "'") {
          output += char + ZWNJ;
          i = nextPos + mKey.length;
        } 
        // --- Standard Matra (i, u, a, etc.) ---
        else {
          output += char + matraValue;
          i = nextPos + mKey.length;
        }
      } 
      else {
        // LIGATURE & REPH LOGIC
        let nextCKey = sortedConsonantKeys.find(k => input.startsWith(k, nextPos));

        if (nextCKey && !nonlinkingConsonants.includes(cKey)) {
          if (cKey === "r" && input.startsWith("r", nextPos)) {
            output += char + HALANTA;
            i = nextPos + 1;
            continue;
          }
          output += (cKey === "r") ? (char + HALANTA + ZWJ) : (char + HALANTA);
        } else {
          output += char;
        }
        i = nextPos;
      }
      continue;
    }

    // 4. FALLBACK
    let nKey = sortedNumberKeys.find(k => input.startsWith(k, i));
    if (nKey) {
      output += numberMap[nKey];
      i += nKey.length;
    } else {
      output += input[i];
      i++;
    }
  }
  return output;
}