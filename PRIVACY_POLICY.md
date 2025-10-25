# Privacy Policy for Rhynd's Custom New Tab Page

**Last Updated:** `25/10/2025`

Thank you for using Rhynd's Custom New Tab Page. This privacy policy explains what information the extension accesses and how it is used. Your privacy is important to us, and this extension is designed to be as transparent as possible.

## Summary

This extension **does not** collect, store, or sell any of your personal data. All data accessed is used locally within your browser to provide the extension's features or is transmitted to trusted third-party services (Google) as described below to enable core functionality.

## Information We Access Locally

To provide its features, the extension needs permission to access certain data stored locally in your browser. This data is not sent to the developer.

1.  **Browsing History (`history` permission)**:
    *   **Why?** To provide relevant suggestions from your past browsing as you type in the search bar. This also allows you to remove specific pages from your history directly from the suggestions list.
    *   **Usage:** Your history is queried locally. You have direct control to delete items via the UI.

2.  **Most Visited Sites (`topSites` permission)**:
    *   **Why?** To display a grid of "Quick Links" to your most frequently visited websites on the new tab page for convenient access.
    *   **Usage:** The extension reads your top sites and displays them.

3.  **Bookmarks (`bookmarks` permission)**:
    *   **Why?** This permission is requested to allow for potential future features involving bookmarks.
    *   **Usage:** As of the current version, this permission **is not actively used**. No bookmark data is read or modified.

4.  **Network Request Modification (`declarativeNetRequest` permission)**:
    *   **Why?** This permission is used to modify network requests before they are sent. It is included to ensure compatibility and proper functioning with Google services.
    *   **Usage:** The extension uses this permission to apply rules that help manage requests to Google's services securely and efficiently, without reading the content of your network traffic.


## Information Transmitted to Third Parties

Certain features require sending data to external services. This is limited to what is necessary for the feature to work.

1.  **Google Search Suggestions**:
    *   **What is sent?** The text you type into the search bar.
    *   **Where is it sent?** To Google's suggestion service (`suggestqueries.google.com`).
    *   **Why?** To fetch real-time search suggestions, similar to how Chrome's omnibox works.

2.  **Favicons (Website Icons)**:
    *   **What is sent?** The URLs of your most visited sites and history suggestions.
    *   **Where is it sent?** To Google's favicon service (`t2.gstatic.com`).
    *   **Why?** To fetch and display the correct icon for each website in your Quick Links and history suggestions.

3.  **Search Execution**:
    *   **What is sent?** Your search query.
    *   **Where is it sent?** To Google Search (`google.com`).
    *   **Why?** To perform a search when you submit the search form.

4.  **Opening Google Gemini**:
    *   **What is sent?** No data is sent automatically. Clicking the Gemini icon opens the Google Gemini website in a new tab.
    *   **Where is it sent?** To Google Gemini (`gemini.google.com`).
    *   **Why?** To provide a convenient shortcut to Google's AI chat service.


## Data Security

The extension operates entirely within your browser. No personal data is ever collected or stored on any server controlled by the developer. The transmission of data to third-party services like Google is handled over secure HTTPS connections.

## Changes to This Privacy Policy

We may update this privacy policy from time to time. We will notify you of any changes by posting the new privacy policy on this page.

## Contact Us

If you have any questions about this Privacy Policy, you can contact the developer via [GitHub](https://github.com/Rhynd) or email (justrhynd@gmail.com).
