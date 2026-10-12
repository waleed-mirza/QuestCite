# Visual regression tests

The Week 10 visual gate compares the signed-out landing page, demo dashboard,
demo questionnaire, and Northstar Cloud Trust Center at desktop and mobile
viewports. The pages use fixtures or public data and never require a user,
provider token, prompt, answer, or signed URL.

Run the comparison with:

```bash
pnpm test:visual
```

When an intentional UI change is reviewed, regenerate the Windows baselines
with `pnpm test:visual -- --update-snapshots`, inspect every changed PNG, and
rerun `pnpm test:visual` without the update flag. Release CI runs this gate on
Windows so the committed `win32` baselines use the same browser platform as
the release job.
