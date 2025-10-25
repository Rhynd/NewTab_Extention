/**
 * script.js
 *
 * Handles all client-side logic for the custom new tab page.
 * This includes:
 * - Fetching and displaying top sites.
 * - Handling search input and fetching suggestions from Google and browser history.
 * - Displaying, grouping, and managing search suggestions.
 * - Navigating to URLs or performing searches.
 */
document.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    // Caching DOM elements for performance.
    const searchForm = document.getElementById('search-form');
    const searchInput = document.getElementById('search-input');
    const geminiButton = document.getElementById('gemini-icon-button');
    const matchesList = document.getElementById('matches-list');
    const quickLinksGrid = document.getElementById('quick-links-grid');
    const searchContainer = document.querySelector('.search-container');

    // Early exit if essential elements are not found.
    if (!searchForm || !searchInput || !geminiButton || !matchesList || !quickLinksGrid || !searchContainer) {
        console.error("Required elements not found. Check your HTML IDs and classes.");
        return;
    }

    // --- State ---
    let abortController = new AbortController(); // To cancel in-flight fetch requests.
    let userFocusedInput = false; // Tracks if the user has intentionally focused the input.

    // --- Debounce Function ---
    /**
     * Delays the execution of a function until after a certain time has passed
     * since the last time it was invoked.
     * @param {Function} func The function to debounce.
     * @param {number} delay The delay in milliseconds.
     * @returns {Function} The debounced function.
     */
    function debounce(func, delay) {
        let timeoutId;
        return function(...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                func.apply(this, args);
            }, delay);
        };
    }

    // --- Event Listeners ---

    // Handle form submission to perform a search.
    searchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        performSearch(searchInput.value);
    });

    // Open Google Gemini in a new tab when the icon is clicked.
    geminiButton.addEventListener('click', () => {
        window.open('https://gemini.google.com/', '_blank');
    });

    // When the search input is focused, show initial history or fetch suggestions.
    searchInput.addEventListener('focus', () => {
        userFocusedInput = true;
        const query = searchInput.value.trim();
        if (query.length > 0) {
            fetchSuggestions(query);
        } else {
            showInitialSuggestions();
        }
    });

    // Track when the input loses focus.
    searchInput.addEventListener('blur', () => {
        userFocusedInput = false;
    });

    // Create a debounced version of the fetchSuggestions function.
    const debouncedFetchSuggestions = debounce(fetchSuggestions, 200);

    // Fetch suggestions as the user types in the search input.
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim();
        if (query.length > 0) {
            debouncedFetchSuggestions(query);
        } else {
            showInitialSuggestions();
        }
    });

    // Allow closing the suggestions with the 'Escape' key.
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && document.activeElement === searchInput) {
            clearSuggestions();
            searchInput.blur();
        }
    });

    // Clear suggestions if the user clicks outside the search container.
    document.addEventListener('mousedown', (event) => {
        if (!searchContainer.contains(event.target)) {
            clearSuggestions();
        }
    });

    // Clear suggestions when the window loses focus.
    window.addEventListener('blur', () => {
        clearSuggestions();
        userFocusedInput = false;
    });

    // Prevent re-focusing issues when the window regains focus.
    window.addEventListener('focus', () => {
        if (document.activeElement === searchInput && !userFocusedInput) {
            searchInput.blur();
        }
    });

    // --- Initial Page Load ---
    displayTopSites();

    // --- Core Functions ---

    /**
     * Fetches and displays the user's most visited sites using the chrome.topSites API.
     */
    function displayTopSites() {
        if (chrome.topSites) {
            chrome.topSites.get((sites) => {
                const topSites = sites.slice(0, 8);
                quickLinksGrid.innerHTML = '';
                topSites.forEach(site => {
                    const linkItem = document.createElement('a');
                    linkItem.href = site.url;
                    linkItem.className = 'link-item';
                    linkItem.title = site.title;

                    const faviconUrl = `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${site.url}&size=32`;

                    linkItem.innerHTML = `
                        <div class="link-icon">
                            <img src="${faviconUrl}" alt="">
                        </div>
                        <span>${site.title || new URL(site.url).hostname}</span>
                    `;
                    quickLinksGrid.appendChild(linkItem);
                });
            });
        }
    }

    /**
     * Processes raw history items, groups them by domain, and prepares them for display.
     * @param {chrome.history.HistoryItem[]} historyItems - An array of history items.
     * @returns {Array<Object>} An array of processed suggestion objects.
     */
    function groupHistoryItems(historyItems) {
        const uniqueHistoryItems = [];
        const seenUrls = new Set();
        for (const item of historyItems) {
            if (item.url && !seenUrls.has(item.url)) {
                uniqueHistoryItems.push(item);
                seenUrls.add(item.url);
            }
        }

        const itemsByDomain = new Map();
        uniqueHistoryItems.forEach(item => {
            try {
                const domain = new URL(item.url).hostname.replace(/^www\./, '');
                if (!itemsByDomain.has(domain)) {
                    itemsByDomain.set(domain, []);
                }
                itemsByDomain.get(domain).push(item);
            } catch (e) { /* Ignore invalid URLs */ }
        });

        const processedSuggestions = [];
        for (const [domain, items] of itemsByDomain.entries()) {
            items.sort((a, b) => b.lastVisitTime - a.lastVisitTime);

            const mappedItems = items.map(item => ({
                text: item.title || item.url,
                url: item.url,
                type: 'history',
                id: item.id,
                lastVisitTime: item.lastVisitTime
            }));

            if (items.length > 1) {
                const simpleUrlItem = items.find(item => {
                    try {
                        const url = new URL(item.url);
                        return url.pathname === '/' && url.search === '' && url.hash === '';
                    } catch {
                        return false;
                    }
                });

                const groupUrl = simpleUrlItem ? simpleUrlItem.url : items[0].url;

                processedSuggestions.push({
                    text: domain,
                    url: groupUrl,
                    type: 'history',
                    isGroup: true,
                    items: mappedItems,
                    latestVisitTime: items[0].lastVisitTime
                });
            } else {
                processedSuggestions.push(mappedItems[0]);
            }
        }

        return processedSuggestions.sort((a, b) => {
            const timeA = a.latestVisitTime || a.lastVisitTime || 0;
            const timeB = b.latestVisitTime || b.lastVisitTime || 0;
            return timeB - timeA;
        });
    }

    /**
     * Fetches recent history items to show as initial suggestions when the search bar is empty.
     */
    function showInitialSuggestions() {
        if (typeof chrome.history === 'undefined') return;
        abortController.abort();
        abortController = new AbortController();

        chrome.history.search({ text: '', maxResults: 100 }, (historyItems) => {
            const filtered = historyItems.filter(item => item.url && item.title !== 'New Tab');
            const suggestions = groupHistoryItems(filtered);
            displaySuggestions(suggestions, true);
        });
    }

    /**
     * Navigates to a URL or performs a Google search.
     * @param {string} query - The search query or URL.
     * @param {string} [url] - An optional specific URL to navigate to.
     * @param {boolean} [inNewTab=false] - Whether to open the link in a new tab.
     */
    function performSearch(query, url, inNewTab = false) {
        let targetUrl;
        if (url) {
            targetUrl = url;
        } else {
            query = query.trim();
            if (!query) return;
            // Simple check to see if the query is likely a URL.
            targetUrl = (query.includes('.') && !query.includes(' '))
                ? (query.startsWith('http') ? query : `https://${query}`)
                : `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        }

        if (inNewTab) {
            chrome.tabs.create({ url: targetUrl, active: false });
        } else {
            window.location.href = targetUrl;
        }
    }

    /**
     * Fetches search suggestions from both Google and the user's browser history.
     * @param {string} query - The user's search query.
     */
    async function fetchSuggestions(query) {
        // Cancel previous in-flight request.
        abortController.abort();
        abortController = new AbortController();
        const signal = abortController.signal;

        // Fetches suggestions from Google's public endpoint.
        const fetchGoogleSuggestions = async () => {
            try {
                const endpoint = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`;
                const res = await fetch(endpoint, { signal });
                if (!res.ok) return [];
                const data = await res.json();
                const list = Array.isArray(data?.[1]) ? data[1] : [];
                return list
                    .map(s => (typeof s === 'string' ? s : s?.[0]))
                    .filter(Boolean)
                    .map(text => ({ text, type: 'search' }));
            } catch (error) {
                if (error.name === 'AbortError') return []; // Ignore aborted fetches
                return [];
            }
        };

        // Fetches matching items from the browser's history.
        const fetchHistorySuggestions = async () => {
            if (typeof chrome.history === 'undefined') return [];
            return new Promise(resolve => {
                chrome.history.search({ text: query, maxResults: 50 }, (items) => {
                    resolve(groupHistoryItems(items));
                });
            });
        };

        // Run both fetches in parallel.
        const [historySuggestions, googleSuggestions] = await Promise.all([
            fetchHistorySuggestions(),
            fetchGoogleSuggestions()
        ]);

        if (signal.aborted) return; // Don't update UI if a new request has started.

        // Combine and de-duplicate results, prioritizing history.
        const topHistory = historySuggestions.slice(0, 3);
        const historyTexts = new Set(topHistory.map(s => (s.text || '').toLowerCase()));
        const filteredGoogle = googleSuggestions.filter(s => !historyTexts.has((s.text || '').toLowerCase()));

        const combined = [...topHistory, ...filteredGoogle].slice(0, 10);
        displaySuggestions(combined);
    }

    /**
     * Renders the suggestion items in the dropdown list.
     * @param {Array<Object>} suggestions - The array of suggestion objects to display.
     * @param {boolean} [isInitial=false] - Flag for initial history display.
     */
    function displaySuggestions(suggestions, isInitial = false) {
        matchesList.innerHTML = '';
        if (suggestions.length > 0) {
            searchForm.classList.add('suggestions-active');
            matchesList.style.display = 'block';

            suggestions.forEach(suggestion => {
                const item = createSuggestionItem(suggestion);
                matchesList.appendChild(item);

                // If the suggestion is a group, create and append its sublist.
                if (suggestion.isGroup) {
                    const sublist = document.createElement('div');
                    sublist.className = 'suggestion-sublist';
                    suggestion.items.forEach(subItemData => {
                        const subItem = createSuggestionItem(subItemData);
                        sublist.appendChild(subItem);
                    });
                    item.appendChild(sublist);

                    // Add click listener to the expansion arrow.
                    const arrow = item.querySelector('.suggestion-arrow');
                    if (arrow) {
                        arrow.addEventListener('mousedown', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const isCurrentlyExpanded = item.classList.contains('expanded');

                            // Collapse other expanded groups.
                            document.querySelectorAll('.suggestion-item.expanded').forEach(otherItem => {
                                if (otherItem !== item) {
                                    otherItem.classList.remove('expanded');
                                }
                            });

                            // Toggle the current group.
                            if (!isCurrentlyExpanded) {
                                item.classList.add('expanded');
                            } else {
                                item.classList.remove('expanded');
                            }
                        });
                    }
                }
            });
        } else {
            clearSuggestions();
        }
    }

    /**
     * Creates a single DOM element for a suggestion.
     * @param {Object} suggestion - The suggestion data.
     * @returns {HTMLElement} The created suggestion item element.
     */
    function createSuggestionItem(suggestion) {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        if (suggestion.isGroup) {
            item.classList.add('suggestion-group');
        }
        item.setAttribute('role', 'option');

        const searchIconSvg = `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`;
        const iconHtml = (suggestion.type === 'history' && suggestion.url)
            ? `<img class="favicon" src="https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${suggestion.url}&size=32" alt="">`
            : searchIconSvg;

        let displayText = suggestion.text.length > 70 ? suggestion.text.substring(0, 70) + '...' : suggestion.text;

        const content = document.createElement('div');
        content.className = 'suggestion-content';
        content.innerHTML = `${iconHtml}<span class="suggestion-text">${displayText}</span>`;
        item.appendChild(content);

        const rightContainer = document.createElement('div');
        rightContainer.className = 'suggestion-right-container';
        item.appendChild(rightContainer);

        if (suggestion.isGroup) {
            const arrow = document.createElement('div');
            arrow.className = 'suggestion-arrow';
            arrow.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>`;
            rightContainer.appendChild(arrow);
        }

        if (suggestion.type === 'history' && !suggestion.isGroup) {
            const deleteButton = document.createElement('button');
            deleteButton.className = 'suggestion-delete-button';
            deleteButton.title = `Remove this history item`;
            deleteButton.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleDeleteSuggestion(suggestion);
            });
            rightContainer.appendChild(deleteButton);
        }

        // Handle clicks on the suggestion item for navigation.
        item.addEventListener('mousedown', (e) => {
            // Ignore clicks on delete/arrow buttons.
            if (e.target.closest('.suggestion-delete-button, .suggestion-arrow')) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const openInNewTab = e.button === 1 || e.ctrlKey || e.metaKey; // Middle-click or Ctrl/Cmd-click
            performSearch(suggestion.text, suggestion.url, openInNewTab);
        });

        return item;
    }

    /**
     * Deletes a URL from the browser's history and refreshes the suggestions.
     * @param {Object} suggestion - The history suggestion to delete.
     */
    async function handleDeleteSuggestion(suggestion) {
        if (suggestion.type === 'history' && suggestion.url && chrome.history) {
            await new Promise(resolve => chrome.history.deleteUrl({ url: suggestion.url }, resolve));
        }
        // Refresh the suggestion list.
        const query = searchInput.value.trim();
        if (query.length > 0) {
            fetchSuggestions(query);
        } else {
            showInitialSuggestions();
        }
    }

    /**
     * Hides and clears the suggestions list.
     */
    function clearSuggestions() {
        searchForm.classList.remove('suggestions-active');
        matchesList.innerHTML = '';
        matchesList.style.display = 'none';
    }
});
