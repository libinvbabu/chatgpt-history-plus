# Privacy policy: History+ for ChatGPT

_Last updated: 28 September 2026_

**Short version:** History+ reads conversation titles, IDs and timestamps from the ChatGPT web application solely to organize your conversation history. This information remains locally on your device and is not transmitted to the developer or third parties.

## What History+ reads

When you use History+ on chatgpt.com, it requests your conversation list from ChatGPT, the same way ChatGPT's own sidebar does, and reads for each conversation:

- the conversation ID
- the title
- when it was created and when it was last active
- whether it is archived, and the ID of the GPT/Project it belongs to (if any)

It does **not** read message content, prompts, responses, files, or account details.

To make those requests, History+ uses ChatGPT's short-lived session token. The token is held in memory only for the duration of a sync and is never stored or logged.

## Where it is stored

In your browser's extension storage (`chrome.storage.local`) on this device only, together with your History+ settings (date display, grouping, collapsed groups) and sync pacing. The cache is keyed by a one-way hash of your account and workspace, so different accounts never share a cache.

## What is sent anywhere

Nothing. History+ has no servers, analytics, crash reporting or third-party SDKs. Its only network requests go to `chatgpt.com`, to endpoints the ChatGPT web app itself uses.

If you choose to copy diagnostics (Settings → Copy diagnostics), the report goes only to your clipboard. It contains counts and field names, and no titles, IDs or account identifiers.

## Retention and deletion

Data stays until you remove it:

- **Settings → Clear local data** deletes everything History+ has stored.
- **Uninstalling** the extension also deletes it.
- **Deleted chats:** conversations you delete in ChatGPT are removed from the local index on the next full resync.

## Permissions

- `storage`: to keep the local index and settings.
- Content script on `https://chatgpt.com/*`: to show History+ on ChatGPT and read your conversation list there.

## Changes and contact

Changes to this policy are published in this repository, where the full history is visible. For questions, open an issue at <https://github.com/libinvbabu/chatgpt-history-plus/issues>.

History+ is an independent project, not affiliated with or endorsed by OpenAI. ChatGPT is a trademark of OpenAI.
