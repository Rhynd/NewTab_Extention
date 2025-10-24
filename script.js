document.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    const searchForm = document.getElementById('search-form');
    const searchInput = document.getElementById('search-input');
    const geminiButton = document.getElementById('gemini-icon-button');
    const matchesList = document.getElementById('matches-list');
    const quickLinksGrid = document.getElementById('quick-links-grid');
    const searchContainer = document.querySelector('.search-container');

    if (!searchForm || !searchInput || !geminiButton || !matchesList || !quickLinksGrid || !searchContainer) {
        console.error("Required elements not found. Check your HTML IDs and classes.");
        return;
    }

    // --- State ---
    let abortController = new AbortController();
    let blurTimeout = null; // Keep this for mousedown handlers

    // --- Debounce Function ---
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
    searchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        performSearch(searchInput.value);
    });

    geminiButton.addEventListener('click', () => {
        window.open('https://gemini.google.com/', '_blank');
    });

    searchInput.addEventListener('focus', () => {
        if (blurTimeout) clearTimeout(blurTimeout);
        const query = searchInput.value.trim();
        if (query.length > 0) {
            fetchSuggestions(query);
        } else {
            showInitialSuggestions();
        }
    });

    const debouncedFetchSuggestions = debounce(fetchSuggestions, 200);

    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim();
        if (query.length > 0) {
            debouncedFetchSuggestions(query);
        } else {
            showInitialSuggestions();
        }
    });

    // REMOVED: The 'blur' event listener is no longer needed here.
    // The global click listener will handle closing the suggestions.

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && document.activeElement === searchInput) {
            clearSuggestions();
            searchInput.blur(); // Remove focus from input
        }
    });

    // MODIFIED: Global mousedown listener to handle clicks outside the search area
    document.addEventListener('mousedown', (event) => {
        if (!searchContainer.contains(event.target)) {
            if (matchesList.style.display === 'block') {
                clearSuggestions();
            }
        }
    });


    // --- Initial Page Load ---
    displayTopSites();

    // --- Core Functions ---

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
                        <span>${site.title}</span>
                    `;
                    quickLinksGrid.appendChild(linkItem);
                });
            });
        }
    }

    function groupHistoryItems(historyItems) {
        const itemsByDomain = new Map();
        historyItems.forEach(item => {
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
            items.sort((a, b) => b.lastVisitTime - a.lastVisitTime); // Most recent first

            const mappedItems = items.map(item => ({
                text: item.title || item.url,
                url: item.url,
                type: 'history',
                id: item.id,
                lastVisitTime: item.lastVisitTime
            }));

            if (items.length > 1) {
                processedSuggestions.push({
                    text: domain,
                    url: `https://${domain}`,
                    type: 'history',
                    isGroup: true,
                    items: mappedItems,
                    latestVisitTime: items[0].lastVisitTime
                });
            } else {
                processedSuggestions.push(mappedItems[0]);
            }
        }

        // Sort groups by their most recent visit time
        return processedSuggestions.sort((a, b) => {
            const timeA = a.latestVisitTime || a.lastVisitTime || 0;
            const timeB = b.latestVisitTime || b.lastVisitTime || 0;
            return timeB - timeA;
        });
    }

    function showInitialSuggestions() {
        if (typeof chrome.history === 'undefined') return;
        abortController.abort();
        abortController = new AbortController();

        chrome.history.search({ text: '', maxResults: 25 }, (historyItems) => {
            const filtered = historyItems.filter(item => item.url && item.title !== 'New Tab');
            const suggestions = groupHistoryItems(filtered);
            displaySuggestions(suggestions.slice(0, 10));
        });
    }

    function performSearch(query, url) {
        if (url) {
            window.location.href = url;
            return;
        }
        query = query.trim();
        if (!query) return;
        const navUrl = (query.includes('.') && !query.includes(' '))
            ? (query.startsWith('http') ? query : `https://${query}`)
            : `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        window.location.href = navUrl;
    }

    async function fetchSuggestions(query) {
        abortController.abort();
        abortController = new AbortController();
        const signal = abortController.signal;

        const fetchGoogleSuggestions = async () => {
            try {
                const response = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`, { signal });
                const data = await response.json();
                return data[1].map(text => ({ text, type: 'search' }));
            } catch (error) {
                if (error.name === 'AbortError') return [];
                console.error('Error fetching Google suggestions:', error);
                return [];
            }
        };

        const fetchHistorySuggestions = async () => {
            if (typeof chrome.history === 'undefined') return [];
            return new Promise(resolve => {
                chrome.history.search({ text: query, maxResults: 10 }, (items) => {
                    const suggestions = groupHistoryItems(items);
                    resolve(suggestions);
                });
            });
        };

        const [historySuggestions, googleSuggestions] = await Promise.all([
            fetchHistorySuggestions(),
            fetchGoogleSuggestions()
        ]);

        if (signal.aborted) return;

        const combined = [...historySuggestions, ...googleSuggestions];
        const uniqueSuggestions = combined.filter(
            (suggestion, index, self) =>
                index === self.findIndex((s) => s.text === suggestion.text)
        );

        displaySuggestions(uniqueSuggestions.slice(0, 10));
    }

    function displaySuggestions(suggestions) {
        matchesList.innerHTML = '';
        if (suggestions.length > 0) {
            searchForm.classList.add('suggestions-active');
            matchesList.style.display = 'block';

            suggestions.forEach(suggestion => {
                const item = createSuggestionItem(suggestion);
                matchesList.appendChild(item);

                if (suggestion.isGroup) {
                    const subList = document.createElement('div');
                    subList.className = 'suggestion-sublist';
                    suggestion.items.forEach(subItemData => {
                        const subItem = createSuggestionItem(subItemData);
                        subList.appendChild(subItem);
                    });
                    item.appendChild(subList);

                    const arrow = item.querySelector('.suggestion-arrow');
                    if (arrow) {
                        arrow.addEventListener('mousedown', (e) => {
                            e.preventDefault(); // Prevent input from losing focus
                            e.stopPropagation();
                            item.classList.toggle('expanded');
                        });
                    }
                }
            });
        } else {
            clearSuggestions();
        }
    }

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

        if (suggestion.type === 'history') {
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

        item.addEventListener('mousedown', (e) => {
            if (!e.target.closest('.suggestion-delete-button, .suggestion-arrow')) {
                performSearch(suggestion.text, suggestion.url);
            }
        });

        return item;
    }

    async function handleDeleteSuggestion(suggestion) {
        if (suggestion.type === 'history' && suggestion.url && chrome.history) {
            await new Promise(resolve => chrome.history.deleteUrl({ url: suggestion.url }, resolve));
        }
        const query = searchInput.value.trim();
        if (query.length > 0) {
            fetchSuggestions(query);
        } else {
            showInitialSuggestions();
        }
    }

    function clearSuggestions() {
        searchForm.classList.remove('suggestions-active');
        matchesList.innerHTML = '';
        matchesList.style.display = 'none';
    }
});
