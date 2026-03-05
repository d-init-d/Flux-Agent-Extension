// Flux Agent Service Worker
console.log('Flux Agent SW started');

// Keep service worker alive
chrome.runtime.onInstalled.addListener(() => {
  console.log('Flux Agent extension installed');
});
