import { reverseVowels, reverseMatras, reverseConsonants, reverseNumbers } from "./reverseMap.js";
import { phoneticTransform } from "./utils.js"; 

const sortedVowels = Object.keys(reverseVowels).sort((a, b) => b.length - a.length);
const sortedCons = Object.keys(reverseConsonants).sort((a, b) => b.length - a.length);
const sortedMatras = Object.keys(reverseMatras).sort((a, b) => b.length - a.length);

export function reverseTransliterate(input) {
  if (!input) return "";

  const ZWNJ = "\u200C";
  const HALANTA = "্";
  
  // List of characters that should NEVER have an automatic 'o' appended
  const O_EXCLUSION_LIST = ["ৎ", "ং", "ঃ", "ঁ"];

  let text = input.replace(/[\u200D]/g, ""); 
  let output = "";
  let i = 0;

  while (i < text.length) {
    let matched = false;

    // 1. MANUAL 'o' OVERRIDE
    if (text[i] === ZWNJ) {
      output += "O"; i++; continue;
    }

    // 2. REPH RULE
    if (text.slice(i, i + 2) === ("ৰ" + HALANTA)) {
      let targetCons = sortedCons.find(c => text.startsWith(c, i + 2));
      if (targetCons) {
        let roman = reverseConsonants[targetCons];
        let nextPos = i + 2 + targetCons.length;
        let isJfala = (text[nextPos] === "্য") || (text[nextPos] === HALANTA && text[nextPos+1] === "য");
        let isRfala = (text[nextPos] === "্ৰ") || (text[nextPos] === HALANTA && text[nextPos+1] === "ৰ");
        let adjunct = isJfala ? "y" : (isRfala ? "r" : "");
        let lookAheadI = (isJfala || isRfala) ? (text[nextPos] === "্য" || text[nextPos] === "্ৰ" ? nextPos + 1 : nextPos + 2) : nextPos;
        let mMatch = sortedMatras.find(m => text.startsWith(m, lookAheadI));
        
        // REPH EXCEPTION CHECK
        let nextIsCons = sortedCons.some(con => text.startsWith(con, lookAheadI));
        let shouldAddO = nextIsCons && !O_EXCLUSION_LIST.includes(targetCons);

        output += "r" + roman + adjunct + (mMatch ? (mMatch === "ো" ? "O" : reverseMatras[mMatch]) : (shouldAddO ? "o" : ""));
        i = lookAheadI + (mMatch ? mMatch.length : 0);
        matched = true; continue;
      }
    }

    // 3. VOWELS/NUMBERS
    if (reverseNumbers[text[i]]) { output += reverseNumbers[text[i]]; i++; continue; }
    for (let v of sortedVowels) {
      if (text.startsWith(v, i)) {
        output += reverseVowels[v]; i += v.length; matched = true; break;
      }
    }
    if (matched) continue;

    // 4. MAIN CONSONANT LOOP
    for (let c of sortedCons) {
      if (text.startsWith(c, i)) {
        let roman = reverseConsonants[c];
        let nextI = i + c.length;

        // 4a. LIGATURES & GREEDY LOOKAHEAD
        if (text[nextI] === HALANTA) {
          let nextCons = sortedCons.find(con => text.startsWith(con, nextI + 1));
          if (nextCons) {
            let nRoman = reverseConsonants[nextCons];
            if (nextCons === "য") { nRoman = "y"; }

            let afterConsI = nextI + 1 + nextCons.length;
            let isNextJfala = (text[afterConsI] === "্য") || (text[afterConsI] === HALANTA && text[afterConsI + 1] === "য");
            let isNextRfala = (text[afterConsI] === "্ৰ") || (text[afterConsI] === HALANTA && text[afterConsI + 1] === "ৰ");
            
            let adjunct = isNextJfala ? "y" : (isNextRfala ? "r" : "");
            let jumpI = (isNextJfala || isNextRfala) ? (text[afterConsI] === "্য" || text[afterConsI] === "্ৰ" ? afterConsI + 1 : afterConsI + 2) : afterConsI;
            let mMatch = sortedMatras.find(m => text.startsWith(m, jumpI));
            
            // LIGATURE EXCEPTION CHECK
            let shouldAddO = !O_EXCLUSION_LIST.includes(nextCons);

            output += roman + nRoman + adjunct + (mMatch ? (mMatch === "ো" ? "O" : reverseMatras[mMatch]) : (shouldAddO ? "o" : ""));
            i = jumpI + (mMatch ? mMatch.length : 0);
            matched = true; break;
          }
        }

        // 5. STANDALONE ADJUNCTS
        let isJfala = (text[nextI] === "্য") || (text[nextI] === HALANTA && text[nextI + 1] === "য");
        let isRfala = (text[nextI] === "্ৰ") || (text[nextI] === HALANTA && text[nextI + 1] === "ৰ");

        if (isJfala || isRfala) {
          let adjunctRoman = isJfala ? "y" : "r";
          let lookAheadI = (text[nextI] === HALANTA) ? nextI + 2 : nextI + 1;
          let mMatch = sortedMatras.find(m => text.startsWith(m, lookAheadI));
          output += roman + adjunctRoman + (mMatch ? (mMatch === "ো" ? "O" : reverseMatras[mMatch]) : "o");
          i = lookAheadI + (mMatch ? mMatch.length : 0);
          matched = true; break;
        }

        // 6. SINGLE LETTER / WORD END
        let mMatch = sortedMatras.find(m => text.startsWith(m, nextI));
        if (mMatch) {
          output += roman + (mMatch === "ো" ? "O" : reverseMatras[mMatch]);
          i = nextI + mMatch.length;
        } else {
          // SINGLE LETTER EXCEPTION CHECK
          let nextIsConsonant = sortedCons.some(con => text.startsWith(con, nextI));
          let shouldAddO = nextIsConsonant && !O_EXCLUSION_LIST.includes(c);

          output += roman + (shouldAddO ? "o" : "");
          i = nextI;
        }
        matched = true; break;
      }
    }

    if (!matched) { output += text[i]; i++; }
  }
  return phoneticTransform(output);
}