// modules/ime/transliterator.js
import {
  vowels,
  matras,
  consonantRules,
  symbolRules,
  conjunctionRules,
  numberRules
} from "./phoneticMap.js";

const HALANTA = "্"; 
const consonantMap = Object.fromEntries(consonantRules);
const symbolMap = Object.fromEntries(symbolRules);
const NON_LINKABLE = ["ং", "ঃ", "ঁ", "ৎ"]; 
const numberMap = Object.fromEntries(numberRules);
const sortedNumberKeys = Object.keys(numberMap).sort((a,b) => b.length - a.length);

// Pre-sort keys once for performance
const sortedConsonantKeys = Object.keys(consonantMap).sort((a, b) => b.length - a.length);
const sortedMatraKeys = Object.keys(matras).sort((a, b) => b.length - a.length);
const sortedVowelKeys = Object.keys(vowels).sort((a, b) => b.length - a.length);
const sortedSymbolKeys = Object.keys(symbolMap).sort((a, b) => b.length - a.length);
const sortedConjunctions = [...conjunctionRules].sort((a, b) => b[0].length - a[0].length);

export function transliterate(input) {
  let output = "";
  let i = 0;

  while (i < input.length) {
    let matched = false;

    // 1️⃣ SYMBOL RULE
    for (let sKey of sortedSymbolKeys) {
      if (input.slice(i, i + sKey.length) === sKey) {
        output += symbolMap[sKey];
        i += sKey.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // 2️⃣ NUMBER RULE
    for (let nKey of sortedNumberKeys) {
      if (input.slice(i, i + nKey.length) === nKey) {
        output += numberMap[nKey];
        i += nKey.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // 3️⃣ UNIFIED REPH RULE (rr + cluster)
    if (input.slice(i, i + 2) === "rr") {
      let nextI = i + 2;
      let nextConsKey = null;
      for (let cKey of sortedConsonantKeys) {
        if (input.slice(nextI, nextI + cKey.length) === cKey) {
          nextConsKey = cKey;
          break;
        }
      }
      if (nextConsKey) {
        let res = "র্" + consonantMap[nextConsKey];
        nextI += nextConsKey.length;
        // Check for J-fala after Reph'd consonant
        if (input[nextI] === "y") {
          res += "্য";
          nextI += 1;
        }
        let vMatch = null;
        for (let vKey of sortedMatraKeys) {
          if (input.slice(nextI, nextI + vKey.length) === vKey) {
            vMatch = vKey;
            break;
          }
        }
        output += res + (vMatch ? matras[vMatch] : "");
        i = nextI + (vMatch ? vMatch.length : 0);
        continue;
      }
    }

    // 4️⃣ SPECIFIC CONJUNCTION RULES
    for (let [cKey, cVal] of sortedConjunctions) {
      if (input.slice(i, i + cKey.length) === cKey) {
        let nextI = i + cKey.length;
        let vMatch = null;
        for (let vKey of sortedMatraKeys) {
          if (input.slice(nextI, nextI + vKey.length) === vKey) {
            vMatch = vKey;
            break;
          }
        }
        output += cVal + (vMatch ? matras[vMatch] : "");
        i = nextI + (vMatch ? vMatch.length : 0);
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // 5️⃣ GENERIC CONSONANT & CLUSTER RULE
    let currentConsKey = null;
    for (let cKey of sortedConsonantKeys) {
      if (input.slice(i, i + cKey.length) === cKey) {
        currentConsKey = cKey;
        break;
      }
    }

    if (currentConsKey) {
      const consChar = consonantMap[currentConsKey];
      let afterConsIndex = i + currentConsKey.length; // The position after the consonant

      // A. Check for Matra first
      let vMatchKey = null;
      for (let vKey of sortedMatraKeys) {
        if (input.slice(afterConsIndex, afterConsIndex + vKey.length) === vKey) {
          vMatchKey = vKey;
          break;
        }
      }

      if (vMatchKey !== null) {
        // IMPORTANT: Advance by the length of the typed Vowel Key (e.g., 'o' or 'aa')
        output += consChar + matras[vMatchKey];
        i = afterConsIndex + vMatchKey.length; 
      } 
      // B. Check for J-fala (y)
      else if (input[afterConsIndex] === "y") {
        let jVowelKey = null;
        let afterYIndex = afterConsIndex + 1;
        for (let vKey of sortedMatraKeys) {
          if (input.slice(afterYIndex, afterYIndex + vKey.length) === vKey) {
            jVowelKey = vKey;
            break;
          }
        }
        output += consChar + "্য" + (jVowelKey ? matras[jVowelKey] : "");
        i = afterYIndex + (jVowelKey ? jVowelKey.length : 0);
      }
      // C. Cluster or Single Consonant
      else {
        let nextConsKey = null;
        for (let cKey of sortedConsonantKeys) {
          if (input.slice(afterConsIndex, afterConsIndex + cKey.length) === cKey) {
            nextConsKey = cKey;
            break;
          }
        }

        if (nextConsKey && !NON_LINKABLE.includes(consChar)) {
          output += consChar + HALANTA;
          // We only advance past the current consonant; 
          // the next loop iteration will handle the nextConsKey.
          i = afterConsIndex;
        } else {
          output += consChar;
          i = afterConsIndex;
        }
      }
      continue; // Restart loop with the newly updated i
    }

    // 6️⃣ INDEPENDENT VOWEL
    for (let vKey of sortedVowelKeys) {
      if (input.slice(i, i + vKey.length) === vKey) {
        output += vowels[vKey];
        i += vKey.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // 7️⃣ FALLBACK
    output += input[i];
    i++;
  }
  return output;
}