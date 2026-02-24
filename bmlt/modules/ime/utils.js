export function phoneticTransform(text) {
  if (!text) return "";
  
  let result = text;

  result = result.replace(/O/g, "PROTECT_O"); 

  result = result.replace(/yo\b/g, "oy"); 

  result = result.replace(/PROTECT_O/g, "o"); 
  
  return result.toLowerCase().trim();
}
