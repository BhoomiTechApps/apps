import {
  vowels,
  matras,
  consonantRules,
  symbolRules,
  numberRules
} from "./phoneticMap.js";

const HALANTA = "্";
const ZWJ = "\u200D"; 
const ZWNJ = "\u200C";

const NON_JOINERS = ["ং", "ঃ", "ঁ", "ৎ", "য়", "ৱ"];
const BANNED_CONJUNCTIONS = [];

const consonantMap = Object.fromEntries(consonantRules);
const symbolMap = Object.fromEntries(symbolRules);
const numberMap = Object.fromEntries(numberRules);

const sortedConsonantKeys = Object.keys(consonantMap).sort((a, b) => b.length - a.length);
const sortedMatraKeys = Object.keys(matras).sort((a, b) => b.length - a.length);
const sortedVowelKeys = Object.keys(vowels).sort((a, b) => b.length - a.length);
const sortedSymbolKeys = Object.keys(symbolMap).sort((a, b) => b.length - a.length);
const sortedNumberKeys = Object.keys(numberMap).sort((a, b) => b.length - a.length);

export function transliterate(input) {
  let output = "";
  let i = 0;

  while (i < input.length) {
    const checkKeys = (keys, map) => {
      for (let key of keys) {
        if (input.slice(i, i + key.length) === key) {
          output += map[key];
          i += key.length;
          return true;
        }
      }
      return false;
    };

    if (checkKeys(sortedSymbolKeys, symbolMap) || checkKeys(sortedNumberKeys, numberMap)) continue;

    let vKey = sortedVowelKeys.find(vk => input.slice(i, i + vk.length) === vk);
    if (vKey) {
      output += vowels[vKey];
      i += vKey.length;
      continue;
    }

    if (input.slice(i, i + 2) === "rr") {
      let lookAheadI = i + 2;
      let nextConsKey = sortedConsonantKeys.find(k => input.slice(lookAheadI, lookAheadI + k.length) === k);
      if (nextConsKey) {
        output += "ৰ" + HALANTA; 
        i += 2; 
        continue;
      } else {
        output += "ৰ";
        i += 2;
        continue;
      }
    }

    let currentConsKey = sortedConsonantKeys.find(k => input.slice(i, i + k.length) === k);
    if (currentConsKey) {
      let char = consonantMap[currentConsKey];
      let nextI = i + currentConsKey.length;

      let nextMatraKey = sortedMatraKeys.find(k => input.slice(nextI, nextI + k.length) === k);
      let nextConsKey = sortedConsonantKeys.find(k => input.slice(nextI, nextI + k.length) === k);

      if (nextMatraKey) {
        if (nextMatraKey === "'") {
          output += char + ZWNJ;
          i = nextI + 1;
        } 
        else {
          output += char + (nextMatraKey === "o" ? "" : matras[nextMatraKey]);
          i = nextI + nextMatraKey.length;
        }
      } 
      else if (nextConsKey) {
        if (NON_JOINERS.includes(char)) {
          output += char; 
        } else if (currentConsKey === "r") {
          output += char + HALANTA + ZWJ;
        } else {
          output += char + HALANTA;
        }
        i = nextI;
      } 
      else {
        output += char;
        i = nextI;
      }
      continue;
    }

    output += input[i];
    i++;
  }
  return output;
}
