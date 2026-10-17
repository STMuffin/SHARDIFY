<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep music volume preferences in the browser-safe audio-settings module and broadcast changes to the active player; music and game effects need independent controls.
- Keep room answer submission asynchronous with explicit success feedback so failed sends retain the player's input.
- Persist early round revelation with a serialized database answer trigger; all clients and round transitions use the same reveal timestamp to avoid host-only results.
- Store option-to-cover mappings with round tracks so every player sees the same answer artwork without extra music lookups.
- Store player photos in private storage, resize and re-encode in the browser, and resolve temporary URLs through guest-membership-checked server functions; this preserves room access without requiring accounts or public buckets.
- Derive final player statistics from persisted guesses grouped by round in the browser-safe game-results module; this avoids double-counting chat attempts and keeps final outcomes consistent across clients.
