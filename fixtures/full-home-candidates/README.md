# Full-home floorplan candidate pool

Status: partial development references. `2bhk-bungalow` and `oak-ridge-c` now have compilable, hash-bound evaluation references and completed overlay review. `oak-ridge-b1` and `oak-ridge-d` remain unannotated candidates. None of these images is an external final test set.

## Selected candidates

| ID              | Source                           | Layout                                                                       | Why selected                                                                                 | Current boundary                                                             |
| --------------- | -------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `2bhk-bungalow` | Wikimedia Commons, CC BY-SA 4.0  | Compact living/dining, kitchen, utility, three sanitary spaces, two bedrooms | Reviewed development reference with 9 rooms, 21 objects and a compiling wall/opening graph   | Shows an upper-floor stair symbol; only the visible ground floor is in scope |
| `oak-ridge-b1`  | Wikimedia Commons, public domain | Two bedrooms, bath, kitchen, living/dining, storage                          | Clean orthogonal plan with furniture symbols and dimensions                                  | Historical scan; room and furniture evidence need independent annotation     |
| `oak-ridge-c`   | Wikimedia Commons, public domain | Three bedrooms, bath, living, kitchen, utility                               | Reviewed development reference with 10 rooms, 15 clearly drawn objects and a compiling graph | Historical scan; bedrooms do not draw beds, so no beds were invented         |
| `oak-ridge-d`   | Wikimedia Commons, public domain | Three bedrooms, bath, living/dining, utility, kitchen, porch                 | Wide layout with clear bedroom, dining and kitchen symbols                                   | Historical scan; porch and utility details need explicit scope               |

`contact-sheet.jpg` is only a human inspection aid. The individual candidate image and `sources.json` are authoritative.

Reviewed overlays:

- `reviews/2bhk-bungalow.overlay.jpg`
- `reviews/oak-ridge-c.overlay.jpg`

Each candidate manifest binds the source image, evaluation reference, overlay image and entity counts by SHA-256.

## Intake checks completed

- The four images are single-level visible floor plans, orthogonal or predominantly orthogonal.
- Every image has readable room labels, furniture or fixture symbols, doors/windows and dimension evidence.
- The source page, license, original URL, original SHA-256, working SHA-256 and dimensions are recorded.
- Working copies are limited to 3000 pixels on the longest side to keep repository size bounded.
- Reviewed development references are hash-bound and compile through the same `FloorplanData` contract used by evaluation.
- Wall, opening, room and object overlays were visually checked against the source image.

## Still required

1. Have a reviewer independent of this annotation pass approve both development references.
2. Add evaluation references for `oak-ridge-b1` and `oak-ridge-d` only after overlay review.
3. Keep at least two different images outside all prompt, threshold and candidate-rule tuning as the final external set.
4. Run the V4 offline evaluator against the two reviewed development references before any real model call.

No candidate in this directory is allowed to enter recognition prompts. References remain evaluation-only.
