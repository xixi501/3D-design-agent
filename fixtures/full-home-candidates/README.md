# Full-home floorplan candidate pool

Status: development candidates only. These images are not an accepted test set and none of them has a frozen room/furniture evaluation reference yet.

## Selected candidates

| ID              | Source                           | Layout                                                                       | Why selected                                                                    | Current boundary                                                             |
| --------------- | -------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `2bhk-bungalow` | Wikimedia Commons, CC BY-SA 4.0  | Compact living/dining, kitchen, utility, three sanitary spaces, two bedrooms | Modern colored plan; readable furniture, fixtures, openings and room dimensions | Shows an upper-floor stair symbol; only the visible ground floor is in scope |
| `oak-ridge-b1`  | Wikimedia Commons, public domain | Two bedrooms, bath, kitchen, living/dining, storage                          | Clean orthogonal plan with furniture symbols and dimensions                     | Historical scan; room and furniture evidence need independent annotation     |
| `oak-ridge-c`   | Wikimedia Commons, public domain | Three bedrooms, bath, living, kitchen, utility                               | More rooms and an irregular footprint with furniture and dimension chains       | Historical scan; low-contrast furniture lines need review                    |
| `oak-ridge-d`   | Wikimedia Commons, public domain | Three bedrooms, bath, living/dining, utility, kitchen, porch                 | Wide layout with clear bedroom, dining and kitchen symbols                      | Historical scan; porch and utility details need explicit scope               |

`contact-sheet.jpg` is only a human inspection aid. The individual candidate image and `sources.json` are authoritative.

## Intake checks completed

- The four images are single-level visible floor plans, orthogonal or predominantly orthogonal.
- Every image has readable room labels, furniture or fixture symbols, doors/windows and dimension evidence.
- The source page, license, original URL, original SHA-256, working SHA-256 and dimensions are recorded.
- Working copies are limited to 3000 pixels on the longest side to keep repository size bounded.

## Still required

1. Crop framing and normalize each image without moving wall or furniture evidence.
2. Create an evaluation-only room/furniture reference with category, count, center, width, depth and orientation.
3. Review ambiguous beds, chairs, cabinets and fixtures against the source image.
4. Mark each plan `verified` only after the reference overlay passes an independent check.
5. Keep at least two different images outside all prompt, threshold and candidate-rule tuning as the final external set.

No candidate in this directory is allowed to enter recognition prompts. References remain evaluation-only.
