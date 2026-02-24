export function phoneticTransform(text) {
  if (!text) return "";
  
  let result = text;

  // 1. Protect your manual 'O' (from ZWNJ) so it doesn't get 
  // caught in any other string replacements
  result = result.replace(/O/g, "PROTECT_O"); 

  // 2. Handle the 'yo' -> 'oy' rule (e.g., bishoyo -> bishoy)
  // We do this before lowercasing
  result = result.replace(/yo\b/g, "oy"); 

  // 3. Optional: If you find that words like "bishnupriya" 
  // turn into "bishnupriyo", you can add specific fixes here.

  // 4. Restore the manual 'O' as lowercase 'o'
  result = result.replace(/PROTECT_O/g, "o"); 
  
  // 5. Do not render any type of Halanta
  result = result.replace(/্+o/g, "");
  
  return result.toLowerCase().trim();
}