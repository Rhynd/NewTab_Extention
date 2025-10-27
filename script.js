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
    const expandedGroups = new Set(); // Remember which groups are expanded across refreshes.
    let originalUserQuery = ''; // To store the user's typed query during keyboard navigation.
    let isDisplayingInitialSuggestions = false; // Tracks if the current view is the initial history.

    // --- Constants ---
    const DEBOUNCE_DELAY = 200;
    const MAX_SUGGESTIONS = 10;
    const MAX_INITIAL_HISTORY = 100;
    const MAX_QUERY_HISTORY = 50;
    const MAX_QUICK_LINKS = 8;

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
        const debouncedFunc = function(...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                func.apply(this, args);
            }, delay);
        };

        // Add a `cancel` method to the debounced function.
        // This allows us to prevent a scheduled execution from running.
        debouncedFunc.cancel = () => {
            clearTimeout(timeoutId);
        };

        return debouncedFunc;
    }

    // --- Event Listeners ---

    // Handle form submission to perform a search.
    searchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const openInNewTab = event.shiftKey; // Check if Shift key was held
        const selectedItem = matchesList.querySelector('.suggestion-item.selected');

        if (selectedItem) {
            // If a keyboard-selected item exists, trigger its navigation logic.
            // We can directly call performSearch with the correct parameters.
            const data = selectedItem.suggestionData;
            if (data) {
                // Use the URL if available, otherwise the text, for the search.
                performSearch(data.url || data.text, openInNewTab);
            }
        } else {
            // Otherwise, perform a standard search with the input's value.
            performSearch(searchInput.value, openInNewTab);
        }
    });

    // Handle clicks on the Gemini button to open it.
    geminiButton.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const geminiUrl = 'https://gemini.google.com/';
        const openInNewTab = e.button === 1 || e.ctrlKey || e.metaKey;

        performSearch(geminiUrl, openInNewTab);
    });

    // When the search input is focused, show initial history or fetch suggestions.
    searchInput.addEventListener('focus', () => {
        userFocusedInput = true;
        const query = searchInput.value.trim();
        if (query.length > 0) {
            fetchSuggestions(query);
        } else {
            searchInput.setAttribute('aria-expanded', 'true');
            showInitialSuggestions();
        }
    });

    // Track when the input loses focus.
    searchInput.addEventListener('blur', () => {
        userFocusedInput = false;
    });

    // Create a debounced version of the fetchSuggestions function.
    const debouncedFetchSuggestions = debounce(fetchSuggestions, DEBOUNCE_DELAY);

    // Fetch suggestions as the user types in the search input.
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim();
        originalUserQuery = query; // Store the user's own typing
        if (query.length > 0) {
            debouncedFetchSuggestions(query);
        } else {
            // Cancel any scheduled (debounced) suggestion fetch to prevent a race condition
            // where old results appear after clearing the input.
            debouncedFetchSuggestions.cancel();
            showInitialSuggestions();
        }
    });

    // Allow closing the suggestions with the 'Escape' key.
    document.addEventListener('keydown', (event) => {
        // If the user is typing in the search input, handle special keys.
        if (document.activeElement === searchInput) {
            handleSearchInputKeyDown(event);
        } else {
            // If not in an input, handle global "type-to-search" functionality.
            handleGlobalKeyDown(event);
        }
    });

    /**
     * Handles keydown events when the search input is focused.
     * @param {KeyboardEvent} event The keyboard event.
     */
    function handleSearchInputKeyDown(event) {
        const selectedItem = matchesList.querySelector('.suggestion-item.selected');

        switch (event.key) {
            case 'Escape':
                if (searchContainer.classList.contains('has-suggestions')) {
                    clearSuggestions();
                } else {
                    searchInput.blur();
                }
                break;

            case 'Enter':
            case ' ':
                if (!searchContainer.classList.contains('has-suggestions')) {
                    event.preventDefault();
                    const query = searchInput.value.trim();
                    query ? fetchSuggestions(query) : showInitialSuggestions();
                } else if (event.key === 'Enter' && selectedItem?.suggestionData) {
                    // If an item is selected, Enter should navigate to it.
                    // This handles both normal Enter and Shift+Enter.
                    event.preventDefault();
                    const openInNewTab = event.shiftKey;
                    performSearch(selectedItem.suggestionData.url || selectedItem.suggestionData.text, openInNewTab);
                }
                break;

            case 'ArrowDown':
            case 'ArrowUp':
                event.preventDefault();
                navigateSuggestions(event.key);
                break;

            case 'ArrowRight':
                if (selectedItem?.classList.contains('suggestion-group') && !selectedItem.classList.contains('expanded')) {
                    event.preventDefault();
                    const arrow = selectedItem.querySelector('.suggestion-arrow');
                    if (arrow) arrow.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                }
                break;

            case 'ArrowLeft':
                const group = selectedItem?.closest('.suggestion-group');
                if (group?.classList.contains('expanded')) {
                    event.preventDefault();
                    const arrow = group.querySelector('.suggestion-arrow');
                    if (arrow) arrow.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

                    selectedItem.classList.remove('selected');
                    group.classList.add('selected');

                    if (!isDisplayingInitialSuggestions) {
                        searchInput.value = group.suggestionData.text;
                    }
                    group.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
                break;

            case 'Delete':
                if (selectedItem?.suggestionData?.type === 'history') {
                    event.preventDefault();
                    if (selectedItem.suggestionData.isGroup) {
                        handleDeleteGroupSuggestion(selectedItem.suggestionData, selectedItem);
                    } else {
                        handleDeleteSuggestion(selectedItem.suggestionData, selectedItem);
                    }
                }
                break;
        }
    }

    /**
     * Handles global keydown events for "type-to-search" functionality.
     * @param {KeyboardEvent} event The keyboard event.
     */
    function handleGlobalKeyDown(event) {
        const target = event.target;
        const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
        const isActionKey = event.key.length === 1 || event.key === 'Enter';

        if (!isTyping && isActionKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
            if (event.key === 'Enter') {
                event.preventDefault();
                searchInput.focus();
                showInitialSuggestions();
            } else {
                searchInput.focus();
            }
        }
    }

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
                const topSites = sites.slice(0, MAX_QUICK_LINKS);
                quickLinksGrid.innerHTML = '';
                topSites.forEach(site => {
                    const linkItem = document.createElement('a');
                    linkItem.href = site.url;
                    linkItem.className = 'link-item';
                    linkItem.title = site.title;

                    const faviconUrl = `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(site.url)}&size=32`;

                    const linkIcon = document.createElement('div');
                    linkIcon.className = 'link-icon';
                    linkIcon.innerHTML = `<img src="${faviconUrl}" alt="Favicon for ${site.title}">`;

                    const linkTitle = document.createElement('span');
                    // Use textContent to prevent XSS from malicious site titles.
                    linkTitle.textContent = site.title || new URL(site.url).hostname;

                    linkItem.appendChild(linkIcon);
                    linkItem.appendChild(linkTitle);

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

        chrome.history.search({ text: '', maxResults: MAX_INITIAL_HISTORY }, (historyItems) => {
            const filtered = historyItems.filter(item => item.url && item.title !== 'New Tab');
            const suggestions = groupHistoryItems(filtered);
            displaySuggestions(suggestions, true);
        });
    }

    /**
     * Navigates to a URL or performs a Google search.
     * @param {string} queryOrUrl - The search query or a full URL.
     * @param {boolean} [inNewTab=false] - Whether to open the link in a new tab.
     */
    function performSearch(queryOrUrl, inNewTab = false) {
        let targetUrl;
        const query = (queryOrUrl || '').trim();
        if (!query) return;

        // Simple check to see if the query is likely a URL.
        const isUrl = query.startsWith('http') || (query.includes('.') && !query.includes(' '));
        targetUrl = isUrl
            ? (query.startsWith('http') ? query : `https://${query}`)
            : `https://www.google.com/search?q=${encodeURIComponent(query)}`;

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
            try {
                const items = await new Promise((resolve, reject) => {
                    chrome.history.search({ text: query, maxResults: MAX_QUERY_HISTORY }, (results) => {
                        // Check for a runtime error, which is how older Chrome APIs report issues.
                        if (chrome.runtime.lastError) {
                            return reject(chrome.runtime.lastError);
                        }
                        resolve(results);
                    });
                });
                return groupHistoryItems(items);
            } catch (error) {
                console.error("Error fetching history suggestions:", error);
                return []; // Return an empty array to prevent crashes.
            }
        };

        // Fetches matching items from the browser's bookmarks.
        const fetchBookmarkSuggestions = async () => {
            if (typeof chrome.bookmarks === 'undefined') return [];
            try {
                const items = await new Promise((resolve, reject) => {
                    chrome.bookmarks.search(query, (results) => {
                        if (chrome.runtime.lastError) {
                            return reject(chrome.runtime.lastError);
                        }
                        resolve(results);
                    });
                });
                // Filter out folders and map to the standard suggestion format.
                const suggestions = items
                    .filter(item => item.url) // Ensure it's a bookmark, not a folder
                    .map(item => ({
                        text: item.title || item.url,
                        url: item.url,
                        type: 'bookmark'
                    }));
                return suggestions;
            } catch (error) {
                console.error("Error fetching bookmark suggestions:", error);
                return [];
            }
        };

        // Run both fetches in parallel.
        const [historySuggestions, googleSuggestions, bookmarkSuggestions] = await Promise.all([
            fetchHistorySuggestions(),
            fetchGoogleSuggestions(),
            fetchBookmarkSuggestions()
        ]);

        if (signal.aborted) return; // Don't update UI if a new request has started.

        // Combine and de-duplicate results in a balanced way.
        const combined = [];
        const seen = new Set();

        const addSuggestion = (suggestion) => {
            // Use URL for history/bookmarks, text for search to de-duplicate.
            const key = suggestion.url || (suggestion.text || '').toLowerCase();
            if (key && !seen.has(key) && combined.length < MAX_SUGGESTIONS) {
                combined.push(suggestion);
                seen.add(key);
            }
        };

        // Add suggestions in order of priority, filling up to the max.
        bookmarkSuggestions.forEach(addSuggestion);
        historySuggestions.forEach(addSuggestion);
        googleSuggestions.forEach(addSuggestion);

        displaySuggestions(combined);
    }

    /**
     * Renders the suggestion items in the dropdown list.
     * @param {Array<Object>} suggestions - The array of suggestion objects to display.
     * @param {boolean} [isInitial=false] - Flag for initial history display.
     */
    function displaySuggestions(suggestions, isInitial = false) {
        isDisplayingInitialSuggestions = isInitial; // Set state for navigation logic.
        matchesList.innerHTML = '';
        if (suggestions.length > 0) {
            searchContainer.classList.add('has-suggestions');
            searchForm.classList.add('suggestions-active');

            // Track which groups are present so we can prune stale expanded keys.
            const presentGroups = new Set();

            suggestions.forEach(suggestion => {
                const item = createSuggestionItem(suggestion);

                // If the suggestion is a group, create and append its sublist.
                if (suggestion.isGroup) {
                    const groupKey = suggestion.url || suggestion.text;
                    presentGroups.add(groupKey);
                    item.dataset.groupKey = groupKey;

                    // Restore expansion if previously expanded.
                    if (expandedGroups.has(groupKey)) {
                        item.classList.add('expanded');
                    }

                    const sublist = document.createElement('div');
                    sublist.className = 'suggestion-sublist';
                    suggestion.items.forEach(subItemData => {
                        const subItem = createSuggestionItem(subItemData);
                        // Mark subitems with the parent group key so they keep context on refresh/delete.
                        subItem.dataset.groupKey = groupKey;
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
                                    const otherKey = otherItem.dataset.groupKey;
                                    otherItem.classList.remove('expanded');
                                    if (otherKey) expandedGroups.delete(otherKey);
                                }
                            });

                            // Toggle the current group and update expandedGroups accordingly.
                            if (!isCurrentlyExpanded) {
                                item.classList.add('expanded');
                                expandedGroups.add(groupKey);
                            } else {
                                item.classList.remove('expanded');
                                expandedGroups.delete(groupKey);
                            }
                        });
                    }
                }

                matchesList.appendChild(item);
            });

            // Remove any expanded keys that are no longer present (e.g., group emptied/deleted).
            for (const key of Array.from(expandedGroups)) {
                if (!presentGroups.has(key)) {
                    expandedGroups.delete(key);
                }
            }
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
        item.suggestionData = suggestion; // Attach data to the element for easy access
        item.className = 'suggestion-item';
        if (suggestion.isGroup) {
            item.classList.add('suggestion-group');
        }
        item.setAttribute('role', 'option');

        const searchIconTemplate = document.getElementById('template-search-icon');
        const bookmarkIconTemplate = document.getElementById('template-bookmark-icon');

        let iconHtml;
        if (suggestion.type === 'history' && suggestion.url) {
                        iconHtml = `<img class="favicon" src="https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(suggestion.url)}&size=32" alt="">`;
        } else if (suggestion.type === 'bookmark') {
            iconHtml = bookmarkIconTemplate.outerHTML;
        } else {
            iconHtml = searchIconTemplate.outerHTML; // Default to search icon
        }

        let displayText = suggestion.text.length > 70 ? suggestion.text.substring(0, 70) + '...' : suggestion.text;

        const content = document.createElement('div');
        content.className = 'suggestion-content';
        // Use innerHTML only for the safe, pre-defined icon SVG.
        content.innerHTML = iconHtml;
        item.appendChild(content);
        const textSpan = document.createElement('span');
        textSpan.className = 'suggestion-text';
        // Use textContent to prevent XSS from malicious suggestion text.
        textSpan.textContent = displayText;
        content.appendChild(textSpan);

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
                e.stopPropagation(); // Prevent the item click from firing.
                handleDeleteSuggestion(suggestion, item); // Pass the element to be removed.
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
            performSearch(suggestion.url || suggestion.text, e.button === 1 || e.ctrlKey || e.metaKey);
        });

        return item;
    }

    /**
     * Deletes a URL from the browser's history and refreshes the suggestions.
     * This function now intelligently removes the item from the DOM without a full refresh,
     * keeping the parent group expanded.
     * @param {Object} suggestion - The history suggestion to delete.
     * @param {HTMLElement} element - The DOM element of the suggestion to remove.
     */
    async function handleDeleteSuggestion(suggestion, element) {
        if (suggestion.type === 'history' && suggestion.url && chrome.history) {
            // Asynchronously delete the URL from the browser's history.
            await new Promise(resolve => chrome.history.deleteUrl({ url: suggestion.url }, resolve));
        }

        // Get all visible items to determine the index of the one being deleted.
        const visibleItems = Array.from(matchesList.querySelectorAll('.suggestion-item:not(.suggestion-sublist .suggestion-item), .suggestion-item.expanded .suggestion-sublist .suggestion-item'));
        const deletedIndex = visibleItems.findIndex(item => item === element);

        // Find the parent group element, if the deleted item was in a group.
        const parentGroupElement = element.closest('.suggestion-group');
        const sublist = element.parentElement; // The sublist element

        // Remove the item's element from the DOM.
        element.remove();

        selectNextItemAfterDeletion(deletedIndex);

        // If the item was inside a group, check if the group needs to be updated.
        if (parentGroupElement && sublist && sublist.classList.contains('suggestion-sublist')) {
            // If the sublist now has one or zero items left, it's no longer a group.
            if (sublist.childElementCount <= 1) {
                // Instead of a full refresh, transform the group element in place.
                const remainingItemElement = sublist.querySelector('.suggestion-item');
                if (remainingItemElement && remainingItemElement.suggestionData) {
                    // Create a new single item from the remaining suggestion's data.
                    const newItem = createSuggestionItem(remainingItemElement.suggestionData);
                    // Replace the old group element with the new single item element.
                    parentGroupElement.replaceWith(newItem);
                    // Since we replaced the element, we need to re-select the new one.
                    newItem.classList.add('selected');
                    return; // Exit early as we've handled the selection.
                } else {
                    // If the group is now empty, just remove it.
                    parentGroupElement.remove();
                    if (matchesList.childElementCount === 0) {
                        clearSuggestions();
                    }
                }
            }
        } else {
            // If the deleted item was a top-level item (not in a group),
            // or if it was the last item in the list, we can just remove it.
            // If the list is now empty, clear everything.
            if (matchesList.childElementCount === 0) {
                clearSuggestions();
            }
        }
    }

    /**
     * Deletes all history items within a group suggestion.
     * @param {Object} groupSuggestion - The suggestion data for the group.
     * @param {HTMLElement} groupElement - The DOM element of the group to remove.
     */
    async function handleDeleteGroupSuggestion(groupSuggestion, groupElement) {
        if (!groupSuggestion.isGroup || !groupSuggestion.items) return;

        // Create an array of promises for all deletion operations.
        const deletePromises = groupSuggestion.items.map(item => {
            if (item.url && chrome.history) {
                return new Promise(resolve => chrome.history.deleteUrl({ url: item.url }, resolve));
            }
            return Promise.resolve(); // Return a resolved promise for items without a URL
        });

        // Wait for all history items to be deleted.
        await Promise.all(deletePromises);

        // Get all visible items to determine the index of the one being deleted.
        const visibleItems = Array.from(matchesList.querySelectorAll('.suggestion-item:not(.suggestion-sublist .suggestion-item), .suggestion-item.expanded .suggestion-sublist .suggestion-item'));
        const deletedIndex = visibleItems.findIndex(item => item === groupElement);

        // Remove the group element from the DOM.
        groupElement.remove();

        selectNextItemAfterDeletion(deletedIndex);
    }

    /**
     * Hides and clears the suggestions list.
     * This also resets the state of any expanded suggestion groups.
     */
    function clearSuggestions() {
        isDisplayingInitialSuggestions = false; // Reset the initial suggestions flag.
        searchContainer.classList.remove('has-suggestions');
        searchForm.classList.remove('suggestions-active');
        matchesList.innerHTML = '';
        searchInput.setAttribute('aria-expanded', 'false');
        // Clear the set that tracks which suggestion groups are expanded.
        // This ensures that when the user focuses the search bar again, all groups will be collapsed by default.
        expandedGroups.clear();
    }

    /**
     * Handles keyboard navigation (Up/Down arrows) through the suggestions list.
     * @param {string} key - The key that was pressed ('ArrowDown' or 'ArrowUp').
     */
    function navigateSuggestions(key) {
        // Get all *visible* suggestion items. This query correctly excludes items in collapsed groups.
        const items = Array.from(matchesList.querySelectorAll('.suggestion-item:not(.suggestion-sublist .suggestion-item), .suggestion-item.expanded .suggestion-sublist .suggestion-item'));
        if (items.length === 0) return;

        let currentIndex = items.findIndex(item => item.classList.contains('selected'));

        // If this is the first navigation, store the current input as the original query.
        if (currentIndex === -1) {
            originalUserQuery = searchInput.value;
        }

        // Remove selection from the current item
        if (currentIndex !== -1) {
            items[currentIndex].classList.remove('selected');
        }

        // Calculate the next index.
        let nextIndex;
        if (key === 'ArrowDown') {
            nextIndex = currentIndex + 1;
            // If we go past the last item, restore the original query and exit.
            if (nextIndex >= items.length) {
                // Deselect the last item before exiting.
                if (currentIndex !== -1) items[currentIndex].classList.remove('selected');
                searchInput.value = originalUserQuery;
                return;
            }
        } else if (key === 'ArrowUp') {
            // If at the top item, restore the original query and exit.
            if (currentIndex === 0) {
                items[currentIndex].classList.remove('selected');
                searchInput.value = originalUserQuery;
                return;
            }
            // If coming from the input, go to the last item. Otherwise, go to the previous.
            nextIndex = currentIndex === -1 ? items.length - 1 : currentIndex - 1;
        }

        // Add selection to the new item, update the search input, and scroll into view.
        const newItem = items[nextIndex];
        if (newItem && newItem.suggestionData) {
            newItem.classList.add('selected');
            // Only update the search bar text if we are NOT showing the initial history list.
            if (!isDisplayingInitialSuggestions) {
                searchInput.value = newItem.suggestionData.text;
            }

            // The 'nearest' block alignment ensures the item becomes visible with minimal scrolling.
            newItem.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest'
            });
        }
    }

    /**
     * Selects the appropriate item in the suggestions list after one has been deleted.
     * @param {number} deletedIndex The index of the item that was just removed.
     */
    function selectNextItemAfterDeletion(deletedIndex) {
        const newVisibleItems = Array.from(matchesList.querySelectorAll('.suggestion-item:not(.suggestion-sublist .suggestion-item), .suggestion-item.expanded .suggestion-sublist .suggestion-item'));

        if (newVisibleItems.length === 0) {
            clearSuggestions();
            return;
        }

        // Determine which item to select next: the one that took the deleted item's place,
        // or the new last item if the original last item was deleted.
        const newIndex = Math.min(deletedIndex, newVisibleItems.length - 1);
        const itemToSelect = newVisibleItems[newIndex];

        if (itemToSelect) {
            itemToSelect.classList.add('selected');
            if (!isDisplayingInitialSuggestions && itemToSelect.suggestionData) {
                searchInput.value = itemToSelect.suggestionData.text;
            }
        }
    }
});