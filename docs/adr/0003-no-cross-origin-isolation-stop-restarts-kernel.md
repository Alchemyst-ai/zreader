---
status: accepted
---

# No cross-origin isolation, so Stop restarts the Kernel

Interrupting a browser Kernel while keeping its state needs `SharedArrayBuffer`, which only works on cross-origin-isolated pages (COOP/COEP headers). zreader does not require those headers on reader pages, because they block third-party images and iframes in books and would constrain every host app. Stop and timeouts therefore terminate the worker and start a new Kernel; the Output says the Kernel restarted and its variables were cleared.
