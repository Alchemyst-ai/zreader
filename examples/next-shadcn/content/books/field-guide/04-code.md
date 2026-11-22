---
title: Code
description: Runnable examples, Python and JavaScript in your browser.
---

Code marked with `run` can be run right here. Press **Run** (nothing runs until you do). Examples on this page share variables, so run them in order. The first Python run downloads the runtime, about 10 MB.

```python run id=squares
squares = [n * n for n in range(1, 6)]
squares
```
```output for=squares
[1, 4, 9, 16, 25]
```

The next example uses `squares` from the one above:

```python run id=total
sum(squares)
```

Press **Edit** to change the code, and **Reset** to go back. **Copy to pad** puts the code and its Output in this chapter's scratchpad, where it's yours to keep.

```javascript run id=greet
const name = "reader";
`Hello, ${name}!`
```
