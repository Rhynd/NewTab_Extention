document.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    const searchForm = document.getElementById('search-form');
    const searchInput = document.getElementById('search-input');
    const geminiButton = document.getElementById('gemini-icon-button');
    const matchesList = document.getElementById('matches-list');
    const quickLinksGrid = document.getElementById('quick-links-grid');

    if (!searchForm || !searchInput || !geminiButton || !matchesList || !quickLinksGrid) {
        console.error("Required elements not found. Check your HTML IDs.");
        return;
    }

    // --- Request Controller ---
    let abortController = new AbortController();
    // --- Timeout for managing focus/blur ---
    let blurTimeout = null;

    // --- [FIX #1: DEBOUNCING] ---
    /**
     * Debounce function to limit how often a function is called.
     * @param {Function} func - The function to debounce.
     * @param {number} delay - The delay in milliseconds.
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
    // --- [END FIX #1] ---


    // --- Event Listeners ---
    searchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        performSearch(searchInput.value);
    });

    geminiButton.addEventListener('click', () => {
        window.open('https://gemini.google.com/', '_blank');
    });

    // Show suggestions on click/focus
    searchInput.addEventListener('focus', () => {
        // [FIX #2] If there's a pending "hide" action, cancel it
        if (blurTimeout) clearTimeout(blurTimeout);

        const query = searchInput.value.trim();
        if (query.length > 0) {
            fetchSuggestions(query);
        } else {
            showInitialSuggestions();
        }
    });

    // [FIX #1] Create a debounced version of the fetch function
    const debouncedFetchSuggestions = debounce(fetchSuggestions, 200); // 200ms delay

    // Update suggestions as user types
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim();
        if (query.length > 0) {
            // [FIX #1] Call the debounced version to prevent lag
            debouncedFetchSuggestions(query);
        } else {
            showInitialSuggestions();
        }
    });


    // [FIX #2: VISUAL GLITCH]
    // Hide suggestions when clicking away
    searchInput.addEventListener('blur', () => {
        // Delay hiding to allow clicks on suggestion items
        blurTimeout = setTimeout(() => {
            // This function now hides the list AND removes the border
            // at the same time, fixing the visual glitch.
            clearSuggestions();
        }, 150);
    });

    // Unfocus on Escape key
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && document.activeElement === searchInput) {
            // [FIX #2] Clear immediately on Escape
            clearSuggestions();
            searchInput.blur();
        }
    });
    // --- [END FIX #2] ---


    // --- Initial Page Load ---
    displayTopSites();

    // --- Core Functions ---

    /**
     * Fetches and displays the user's most visited sites for the quick links.
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
                    linkItem.target = '_blank';
                    linkItem.rel = 'noopener noreferrer';

                    const linkIcon = document.createElement('div');
                    linkIcon.className = 'link-icon';

                    const iconImg = document.createElement('img');
                    iconImg.src = `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${site.url}&size=32`;
                    iconImg.alt = '';

                    const linkTitle = document.createElement('span');
                    linkTitle.textContent = site.title;

                    linkIcon.appendChild(iconImg);
                    linkItem.appendChild(linkIcon);
                    linkItem.appendChild(linkTitle);
                    quickLinksGrid.appendChild(linkItem);
                });
            });
        }
    }

    /**
     * Shows recent history items as initial suggestions on focus.
     */
    function showInitialSuggestions() {
        if (typeof chrome.history === 'undefined') return;

        // Abort any pending fetches
        abortController.abort();
        abortController = new AbortController();

        chrome.history.search({ text: '', maxResults: 12 }, (historyItems) => {
            const suggestions = historyItems
                .filter(item => item.url && item.title !== 'New Tab')
                .map(item => {
                    let displayText = item.title && item.title !== item.url ? item.title : item.url;
                    if (displayText.length > 70) {
                        displayText = displayText.substring(0, 70) + '...';
                    }
                    return {
                        text: displayText,
                        url: item.url,
                        type: 'history',
                        id: item.id
                    };
                })
                .slice(0, 10);
            displaySuggestions(suggestions);
        });
    }

    /**
     * Navigates to a URL or performs a Google search.
     * @param {string} query - The search text.
     * @param {string} [url] - An optional specific URL to navigate to.
     */
    function performSearch(query, url) {
        if (url) {
            window.location.href = url;
            return;
        }
        query = query.trim();
        if (!query) return;

        let navUrl;
        if (query.includes('.') && !query.includes(' ')) {
            navUrl = query.startsWith('http') ? query : `https://`;
        } else {
            navUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        }
        window.location.href = navUrl;
    }

    /**
     * Fetches suggestions from Google, history, and bookmarks based on a query.
     * @param {string} query - The user's input.
     */
    async function fetchSuggestions(query) {
        // Abort any previous fetch request.
        abortController.abort();
        abortController = new AbortController();
        const signal = abortController.signal;

        const fetchGoogleSuggestions = async () => {
            try {
                const response = await fetch(`https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`, { signal });
                if (!response.ok) return [];
                const data = await response.json();
                return (data[1] || []).map(text => ({ text, type: 'search' }));
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error('Google Suggestion fetch error:', error);
                }
                return [];
            }
        };

        const fetchHistorySuggestions = async () => {
            if (typeof chrome.history === 'undefined') return [];
            return new Promise(resolve => {
                chrome.history.search({ text: query, maxResults: 10 }, (historyItems) => {
                    const suggestions = historyItems
                        .filter(item => item.url && item.title !== 'New Tab')
                        .map(item => ({
                            text: item.title || item.url,
                            url: item.url,
                            type: 'history',
                            id: item.id
                        }));
                    resolve(suggestions);
                });
            });
        };

        const fetchBookmarkSuggestions = async () => {
            if (typeof chrome.bookmarks === 'undefined') return [];
            return new Promise(resolve => {
                chrome.bookmarks.search(query, (bookmarkItems) => {
                    const suggestions = bookmarkItems
                        .filter(item => item.url)
                        .map(item => ({
                            text: item.title || item.url,
                            url: item.url,
                            type: 'bookmark',
                            id: item.id
                        }));
                    resolve(suggestions);
                });
            });
        };

        const [bookmarkSuggestions, historySuggestions, googleSuggestions] = await Promise.all([
            fetchBookmarkSuggestions(),
            fetchHistorySuggestions(),
            fetchGoogleSuggestions()
        ]);

        if (signal.aborted) return;

        const combined = [...bookmarkSuggestions, ...historySuggestions, ...googleSuggestions];
        const uniqueSuggestions = combined.filter(
            (suggestion, index, self) =>
                index === self.findIndex((s) => s.text === suggestion.text)
        );

        displaySuggestions(uniqueSuggestions.slice(0, 10));
    }


    /**
     * Renders the suggestion items in the list.
     * @param {Array<Object>} suggestions - Array of suggestion objects.
     */
    function displaySuggestions(suggestions) {
        matchesList.innerHTML = '';
        if (suggestions.length > 0) {
            searchForm.classList.add('suggestions-active');
            matchesList.style.display = 'block';

            const searchIconSvg = `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`;
            const bookmarkIconSvg = `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`;

            suggestions.forEach(suggestion => {
                const item = document.createElement('div');
                item.className = 'suggestion-item';
                item.setAttribute('role', 'option');

                let iconHtml;
                if (suggestion.type === 'bookmark') {
                    iconHtml = bookmarkIconSvg;
                } else if (suggestion.type === 'history' && suggestion.url) {
                    iconHtml = `<img class="favicon" src="https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${suggestion.url}&size=32" alt="">`;
                } else {
                    iconHtml = searchIconSvg;
                }

                let displayText = suggestion.text;
                if (displayText.length > 70) {
                    displayText = displayText.substring(0, 70) + '...';
                }

                const content = document.createElement('div');
                content.style.display = 'contents';
                content.innerHTML = `${iconHtml}<span class="suggestion-text">${displayText}</span>`;

                item.appendChild(content);

                if (suggestion.type === 'history' || suggestion.type === 'bookmark') {
                    const deleteButton = document.createElement('button');
                    deleteButton.className = 'suggestion-delete-button';
                    deleteButton.title = `Remove this ${suggestion.type}`;
                    deleteButton.addEventListener('mousedown', (e) => {
                        // [FIX #2] Cancel the blur timeout if deleting
                        if (blurTimeout) clearTimeout(blurTimeout);
                        e.preventDefault();
                        e.stopPropagation();
                        handleDeleteSuggestion(suggestion);
                    });
                    item.appendChild(deleteButton);
                }

                item.addEventListener('mousedown', () => {
                    // [FIX #2] Cancel the blur timeout if clicking
                    if (blurTimeout) clearTimeout(blurTimeout);
                    searchInput.value = suggestion.text;
                    performSearch(suggestion.text, suggestion.url);
                });

                matchesList.appendChild(item);
            });
        } else {
            clearSuggestions();
        }
    }

    /**
     * Deletes a suggestion and then refreshes the list.
     * @param {object} suggestion - The suggestion object to delete.
     */
    async function handleDeleteSuggestion(suggestion) {
        const deletePromise = new Promise(resolve => {
            if (suggestion.type === 'history' && suggestion.url && chrome.history) {
                chrome.history.deleteUrl({ url: suggestion.url }, resolve);
            } else if (suggestion.type === 'bookmark' && suggestion.id && chrome.bookmarks) {
                chrome.bookmarks.remove(suggestion.id, resolve);
            } else {
                resolve();
            }
        });

        await deletePromise;

        const query = searchInput.value.trim();
        if (query.length > 0) {
            fetchSuggestions(query);
        } else {
            showInitialSuggestions();
        }
    }

    /**
     * [FIX #2] Clears the suggestion list from the UI immediately.
     * This function is now the single source of truth for hiding suggestions.
     */
    function clearSuggestions() {
        searchForm.classList.remove('suggestions-active'); // Hides border
        matchesList.innerHTML = '';
        matchesList.style.display = 'none'; // Hides list
    }
});