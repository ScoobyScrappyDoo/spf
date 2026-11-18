# Testing

From the project folder (where `package.json` is), run:

```
npm test -- --watch=false
```

It runs all the tests once and shows the result, ending with a line like `Tests  430 passed (430)`.

Leave out `-- --watch=false` (just `npm test`) to keep it running: it reruns the tests whenever a file changes. Stop it with Ctrl+C.
