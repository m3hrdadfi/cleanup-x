# Adding a dashboard language

The dashboard ships with English, Persian, Swedish, Norwegian Bokmål, Danish, and Finnish. Its typed localization registry supports community translations and both text directions.

## Where to find these files

The folder is `frontend/src/locales`, relative to the project's root (the directory
containing `.env.example`). This guide is `frontend/src/locales/README.md`.
Open that path in your code editor. It is not a browser URL. Settings → Translation ready
also includes an inline reader and download of this same file.

1. Copy `en.ts` to a file named with the new BCP 47 language code, such as `ar.ts`.
2. Translate every value and export it through `createLocale({ ... })`. Keep every key unchanged. Every bundled locale must explicitly supply all keys: there is no silent English spread or partial-resource merge. TypeScript and the coverage tests reject omissions.
3. Import the resource in `index.ts` and add its metadata:

```ts
ar: {
  label: "Arabic",
  nativeLabel: "العربية",
  direction: "rtl",
  translation: ar,
}
```

4. Registering the locale adds it to the Settings selector. `setLocale()` applies its natural direction automatically. There is no manual direction override.
5. Run `npm test` and `npm run build`. Tests discover registered locales automatically, check source-level completeness and interpolation variables, and render the major pages in every locale. If browser testing is available, also check desktop/mobile layouts, keyboard focus, and long labels.

## Writing translatable UI

- Put all app-owned text in the catalog: headings, buttons, placeholders, tooltips, errors, empty/loading states, accessibility labels, and status labels. Do not put English directly in JSX or use English `defaultValue` fallbacks.
- Add new keys to `en.ts` and every bundled locale in the same change. `localization-coverage.test.ts` checks literal JSX text and translation-key usage; only explicitly documented protocol/file labels are exempt.
- Use complete messages with named variables such as `t("selectedSummary", { selected, total })`. Preserve every `{{variable}}` in translations, but reorder it freely. Do not concatenate translated fragments or force lowercasing.
- Use `number`, `percentage`, `currency`, and `languageName` from `lib/localization.ts`. The interface locale, not the browser default, controls formatting. Never localize API payloads, IDs, URLs, or numeric form values.
- For grammatical counts, use i18next's numeric `count` and locale-specific `_zero`, `_one`, `_two`, `_few`, `_many`, `_other` keys. The resource type allows these suffixes. Include the categories returned by `Intl.PluralRules(locale).resolvedOptions().pluralCategories`, and preserve interpolation variables in every form. Current count summaries use label/value phrasing; unit counts use Intl.
- Use explicit status/content mappings from `lib/localization.ts`. Machine values stay unchanged; unknown values get a translated fallback, not raw English labels.

## Content that stays in its original language

Tweets, user prompts, compiled policies, model-generated explanations/topics, identifiers, and exported audit evidence are data, not interface strings. They are not automatically translated or rewritten. Provider/backend diagnostics remain available under a translated “Original technical details” disclosure; the user-facing summary is localized. Supporting a new language never sends content to a translation service.

English remains the runtime fallback for an unsupported stored locale. This is separate from completeness: supported locales must supply all interface strings. Shared Input/Textarea controls supply a localized validation message and clear it on input; browser-owned chrome such as file pickers still follows the browser/OS language.

## Direction rules

- Persian interface text uses self-hosted Vazirmatn through `html:lang(fa)`; all other locales keep Geist. Direction and fonts follow the selected language. Latin code/IDs keep Geist Mono, with Vazirmatn as a Persian-glyph fallback.
- Use logical CSS properties and Tailwind utilities such as `start`, `end`, `ms`, `me`, `ps`, and `pe` for layout.
- Use `dir="auto"` for user-authored post text because its direction may differ from the dashboard.
- Keep identifiers, API values, prices, and code in isolated monospace spans when ordering matters.
- Verify focus order and keyboard navigation in both LTR and RTL. Direction must not reverse the underlying DOM or tab order.
- The locale registry is the single source of layout direction. Changing language updates `lang` and `dir` together, including after reload. Old manual direction preferences are discarded.
