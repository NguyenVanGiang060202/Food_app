# Frontend Release Checklist

Use this checklist before publishing the portfolio demo. It reflects the current
inspiration-first Explore flow and the Ask/Bếp recommendation flow.

## Routes

- [ ] `/` opens the Ask/Bếp prompt without a blank state.
- [ ] `/search` opens Explore and shows local inspiration imagery.
- [ ] Clicking an Explore card navigates to `/?prompt=...` and submits the prompt.
- [ ] `/discover`, `/map`, `/restaurants/:id`, `/dishes/:id`, `/auth`, `/saved`, and `/profile` load.
- [ ] Detail pages show a useful loading state, empty state, and source-link fallback.

## Data and states

- [ ] API-backed cards never display fabricated restaurant data.
- [ ] Missing images use `/no-photo.svg` or a verified local asset.
- [ ] Backend error and empty recommendation states provide a next action.
- [ ] Location permission denial does not break Ask or Map layout.

## Accessibility and responsive behavior

- [ ] Every meaningful image has descriptive alt text; decorative images use empty alt.
- [ ] Buttons have explicit type when rendered inside forms.
- [ ] Icon-only controls have an accessible label.
- [ ] Main flows are usable at mobile width and with keyboard focus.
- [ ] Text and controls have sufficient contrast on dark image overlays.

## Verification commands

```text
npm run check
npm test --workspace frontend -- --run
npm run build --workspace frontend
npm run test:e2e --workspace frontend
```

The E2E suite may require the backend fixture/API and Playwright browser binaries.
