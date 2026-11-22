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

NumPy and Matplotlib ship with the Python runtime, so they work without any permission. A figure left open at the end of a run is shown under the code:

```python run id=plot
import numpy as np
import matplotlib.pyplot as plt

x = np.linspace(0, 2 * np.pi, 200)
fig, ax = plt.subplots(figsize=(6, 3))
ax.plot(x, np.sin(x), label="sin")
ax.plot(x, np.cos(x), label="cos")
ax.legend()
ax.set_title("NumPy + Matplotlib")
float(np.trapezoid(np.sin(x) ** 2, x))
```

Press **Edit** to change the code, and **Reset** to go back. **Copy to pad** puts the code and its Output in this chapter's scratchpad, where it's yours to keep.

```javascript run id=greet
const name = "reader";
`Hello, ${name}!`
```
