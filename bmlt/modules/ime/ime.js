// modules/ime/ime.js
import { transliterate } from "./transliterator.js";
export function attachPhoneticIME(textarea,onUpdate){
textarea.addEventListener("input",()=>{
const buffer=textarea.value;
const assamese=transliterate(buffer);
if(onUpdate)onUpdate(buffer,assamese);
});
}

