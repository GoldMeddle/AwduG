// ==UserScript==
// @name         Automat wider den unequestrisch Geist
// @namespace    local.scripts
// @version      1.0
// @description  Scrape a user's story IDs, then bulk-dislike them via the AJAX endpoint
// @match        https://www.fimfiction.net/user/*
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @run-at       document-idle
// @icon         https://static.fimfiction.net/favicon.ico
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Scraper ----------

  function getUserId() {
    const m = location.href.match(/fimfiction\.net\/user\/(\d+)/);
    return m ? m[1] : null;
  }

  async function fetchListPage(userId, page) {
    const res = await fetch(`https://www.fimfiction.net/user/${userId}//stories?page=${page}`, {
      credentials: 'include',
      headers: { 'Cache-Control': 'no-cache' }
    });
    return res.text();
  }

  function extractIds(doc) {
    return [...doc.querySelectorAll('a.story_name')]
      .map(a => a.getAttribute('href'))
      .filter(Boolean)
      .map(href => (href.match(/\/story\/(\d+)/) || [])[1])
      .filter(Boolean);
  }

  function hasNextPage(doc) {
    return !!doc.querySelector('a > i.fa-chevron-right, a i.fa-chevron-right');
  }

  async function scrape() {
    const userId = getUserId();
    if (!userId) { alert('Error: navigate to a /user/<id>/... page first'); return; }

    let page = 1;
    let html = await fetchListPage(userId, page);
    let doc = new DOMParser().parseFromString(html, 'text/html');
    const allIds = extractIds(doc);

    while (hasNextPage(doc)) {
      page++;
      html = await fetchListPage(userId, page);
      doc = new DOMParser().parseFromString(html, 'text/html');
      allIds.push(...extractIds(doc));
    }

    GM_setValue('storyids_queue', allIds);
    console.log(`Scraped ${allIds.length} story IDs across ${page} page(s). Stored for disliking.`);
    alert(`Scraped ${allIds.length} story IDs. Run "Dislike from list" when ready.`);
  }

  // ---------- Disliker ----------

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function timestamp() {
    return new Date().toISOString();
  }

  async function dislikeOne(storyId) {
    const url = `/ajax/stories/${storyId}/dislike`;
    const sig = unsafeWindow.SignString('', url).signature;

    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `signature=${encodeURIComponent(sig)}`
    });
    return res.text();
  }

  async function dislikeAll() {
    let queue = GM_getValue('storyids_queue', []);
    if (!queue.length) { alert('No story IDs queued: run the scraper first.'); return; }

    for (const storyId of [...queue]) {
      let delay = 300;

      while (true) {
        console.log(timestamp());
        console.log(`Disliking ${storyId}...`);

        let output, parsed;
        try {
          output = await dislikeOne(storyId);
          parsed = JSON.parse(output);
        } catch (e) {
          console.log(`Error: mangled response, retrying (${e})`);
          continue;
        }

        if (parsed.disliked === true) {
          console.log(`Success: ${output}`);
          break;
        } else if (parsed.error === 'You cannot perform this action any more right now') {
          delay *= 2;
          console.log(`Error: rate limit hit; waiting ${delay} seconds before retrying`);
          await sleep(delay * 1000);
        } else if (parsed.disliked === false) {
          console.log('Error: already disliked; reversing reversal');
        } else if (parsed.error === 'Permissions required for this action were not met') {
          console.log(`Permission error; skipping ${storyId}`);
          break;
        } else {
          console.log(`Error: unrecognized response, retrying: ${output}`);
        }
      }

      // remove from queue once resolved (success, permission-skip, or otherwise broken out of)
      queue = queue.filter(id => id !== storyId);
      GM_setValue('storyids_queue', queue);
    }

    console.log('Disliking run complete.');
    alert('Disliking run complete.');
  }

  GM_registerMenuCommand('Scrape story IDs', scrape);
  GM_registerMenuCommand('Dislike from list', dislikeAll);
})();
