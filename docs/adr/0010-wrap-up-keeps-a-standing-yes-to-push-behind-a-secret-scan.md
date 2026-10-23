# Wrap-up keeps a standing yes to push, behind a secret scan

A pushed token is the one mistake no undo fixes, so `npm run wrap-up` keeps its yes to push only because it first scans the lines its outgoing commits add for token shapes, such as Google, GitHub and Anthropic keys and private key blocks. A hit fails the landing at a `secret-scan` step naming each repo, file and line, keeps the landed master and pushes nothing. A session workspace's landing, `npm run wrap-up -- --session`, runs the same scan and needs no yes either, mid-session included.

Source: byronbroughten/byro-repo#275, byronbroughten/byro-repo#257
